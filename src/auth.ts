import { timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { AppConfig } from "./config";
import type { AppDatabase } from "./database";
import type { Mailer } from "./email";
import type { AppVariables } from "./security";
import { docsMarkdownSource, renderDocsPage } from "./docs";
import { aboutView, accountView, checkEmailView, confirmView, invalidLinkView, loginView, registrationView } from "./views";

const MAGIC_LINK_MINUTES = 15;
const SESSION_HOURS = 24;
const REMEMBER_DAYS = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type AuthUser = { id: string; email: string };
type AuthSession = { id: string; token: string };
export type AuthVariables = AppVariables & { user: AuthUser; session: AuthSession };
export type AuthBindings = { remoteAddress?: string };
export type AuthEnv = { Bindings: AuthBindings; Variables: AuthVariables };
type App = Hono<AuthEnv>;

type MagicLinkRow = {
  id: string;
  email: string | null;
  email_normalized: string;
  purpose: "register" | "login" | "delete";
  pending_page_url: string | null;
  terms_version: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  email: string;
};

export class RateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  allows(key: string, limit = 5, windowMs = 15 * 60_000, now = Date.now()): boolean {
    if (this.entries.size >= this.maxEntries) {
      for (const [candidate, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(candidate);
      }
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    }
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))).toString("base64url");
}

function normalizeEmail(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
  return value.toLowerCase();
}

function pageUrl(raw: string, production: boolean): URL | undefined {
  try {
    const value = new URL(raw);
    if (value.username || value.password || value.hash) return;
    if (production && value.protocol !== "https:") return;
    if (!production && !["http:", "https:"].includes(value.protocol)) return;
    const hostname = value.hostname.toLowerCase();
    if (production && (hostname === "localhost" || hostname.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname))) return;
    return value;
  } catch {
    return;
  }
}

function stringField(body: Record<string, string | File | (string | File)[]>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

function sessionCookieName(config: AppConfig): string {
  return config.environment === "production" ? "__Host-shibumi_forms_session" : "shibumi_forms_session";
}

function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox/i.test(userAgent) ? "Firefox" : /Edg/i.test(userAgent) ? "Edge" : /Chrome|CriOS/i.test(userAgent) ? "Chrome" : /Safari/i.test(userAgent) ? "Safari" : "Browser";
  const system = /iPhone|iPad/i.test(userAgent) ? "iOS" : /Android/i.test(userAgent) ? "Android" : /Mac OS/i.test(userAgent) ? "macOS" : /Windows/i.test(userAgent) ? "Windows" : /Linux/i.test(userAgent) ? "Linux" : "device";
  return `${browser} on ${system}`;
}

async function verifyTurnstile(config: AppConfig, token: string): Promise<boolean> {
  if (!config.turnstileSecretKey) return true;
  if (!token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: config.turnstileSecretKey, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json() as { success?: boolean };
    return response.ok && result.success === true;
  } catch {
    return false;
  }
}

function requestSource(context: Context<AuthEnv>, config: AppConfig): string {
  const peer = context.env?.remoteAddress;
  const loopback = peer === "::1" || peer === "127.0.0.1" || peer?.startsWith("::ffff:127.");
  if (config.trustedProxy === "loopback" && loopback) {
    const forwarded = context.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
    if (forwarded && forwarded.length <= 45 && /^[0-9a-f:.]+$/i.test(forwarded)) return forwarded;
  }
  return peer || `ua:${context.req.header("user-agent") || "unknown"}`;
}

export function sameOrigin(config: AppConfig, origin: string | undefined, fetchSite: string | undefined): boolean {
  if (origin && origin !== config.publicUrl.origin) return false;
  return fetchSite !== "cross-site";
}

export async function csrfToken(config: AppConfig, sessionToken: string): Promise<string> {
  return hmac(config.sessionSecret, `csrf:${sessionToken}`);
}

export async function validCsrf(config: AppConfig, sessionToken: string, candidate: string): Promise<boolean> {
  const expected = await csrfToken(config, sessionToken);
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerAuthRoutes(app: App, config: AppConfig, database: AppDatabase, mailer: Mailer, limiter = new RateLimiter()): void {
  // Read-only session check for public pages: no redirect, no last-seen update.
  async function hasSession(context: Context<AuthEnv>): Promise<boolean> {
    const token = getCookie(context, sessionCookieName(config));
    if (!token || !TOKEN_PATTERN.test(token)) return false;
    const tokenHash = await sha256(token);
    return database.query("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, new Date().toISOString()) !== null;
  }

  app.get("/", async (context) => context.html(registrationView(config, { signedIn: await hasSession(context) })));
  app.get("/login", async (context) => context.html(loginView(config, { signedIn: await hasSession(context) })));
  app.get("/about", async (context) => context.html(aboutView(config, await hasSession(context))));
  app.get("/docs", async (context) => context.html(renderDocsPage(config, "", await hasSession(context))!));
  app.get("/docs/:page", async (context) => {
    const param = context.req.param("page");
    if (param.endsWith(".md")) {
      const source = docsMarkdownSource(param === "index.md" ? "" : param.slice(0, -3));
      if (!source) return context.json({ error: "Not found" }, 404);
      return new Response(source, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    }
    const html = renderDocsPage(config, param, await hasSession(context));
    if (!html) return context.json({ error: "Not found" }, 404);
    return context.html(html);
  });

  app.post("/auth/magic-link", async (context) => {
    const body = await context.req.parseBody();
    const purpose = stringField(body, "purpose");
    const enteredEmail = stringField(body, "email").trim();
    const email = normalizeEmail(enteredEmail);
    const rawPageUrl = stringField(body, "page_url").trim();
    const registration = purpose === "register";
    const renderError = (message: string) => context.html(registration
      ? registrationView(config, { email: enteredEmail, pageUrl: rawPageUrl, error: message })
      : loginView(config, { email: enteredEmail, error: message }), 400);

    if (!email || (purpose !== "register" && purpose !== "login")) return renderError("Enter a valid email address.");
    const page = registration ? pageUrl(rawPageUrl, config.environment === "production") : undefined;
    if (registration && !page) return renderError("Enter a public HTTPS page URL without credentials or fragments.");
    if (registration && stringField(body, "accepted_terms") !== "yes") return renderError("Accept the Terms to continue.");
    if (!await verifyTurnstile(config, stringField(body, "cf-turnstile-response"))) return renderError("Verification failed. Try again.");

    const rateKey = await hmac(config.sessionSecret, `magic-link:${email}`);
    const fingerprint = await hmac(config.sessionSecret, `request:${requestSource(context, config)}:${email}:${new Date().toISOString().slice(0, 10)}`);
    if (!limiter.allows(rateKey) || !limiter.allows(fingerprint, 20)) {
      console.log(JSON.stringify({ event: "rate_limited", route: "auth" }));
      return context.html(checkEmailView(config, enteredEmail));
    }

    // Global daily email budget: over budget, render the same neutral view
    // (no enumeration) but send nothing. Rows in magic_links proxy for sends.
    const sentToday = database.query<{ count: number }, [string]>("SELECT count(*) AS count FROM magic_links WHERE created_at >= ?")
      .get(new Date().toISOString().slice(0, 10))!.count;
    if (sentToday >= config.maxEmailsPerDay) {
      console.log(JSON.stringify({ event: "email_budget_exceeded", budget: config.maxEmailsPerDay }));
      return context.html(checkEmailView(config, enteredEmail));
    }

    // Sign-in for an unknown address sends an account-creation link instead of
    // silently dropping the request. The on-site response stays identical.
    let signup = false;
    if (!registration) {
      const exists = database.query<{ found: number }, [string]>("SELECT 1 AS found FROM users WHERE email_normalized = ?").get(email);
      signup = !exists;
    }
    const storedPurpose = registration || signup ? "register" : "login";

    const id = crypto.randomUUID();
    const token = randomToken();
    const tokenHash = await sha256(token);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + MAGIC_LINK_MINUTES * 60_000);

    database.transaction(() => {
      database.query("DELETE FROM magic_links WHERE email_normalized = ? AND purpose = ? AND consumed_at IS NULL").run(email, storedPurpose);
      database.query(`
        INSERT INTO magic_links (id, email, email_normalized, token_hash, purpose, pending_page_url, terms_version, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, enteredEmail, email, tokenHash, storedPurpose, page?.href || null, registration ? config.termsVersion : null, expiresAt.toISOString(), createdAt.toISOString());
    })();

    const confirmUrl = new URL("/auth/confirm", config.publicUrl);
    confirmUrl.searchParams.set("token", token);
    try {
      await mailer.sendMagicLink({ id, to: enteredEmail, confirmUrl: confirmUrl.href, expiresMinutes: MAGIC_LINK_MINUTES, hostname: page?.hostname, variant: signup ? "create-account" : "signin" });
    } catch (error) {
      console.error(JSON.stringify({ event: "email_failed", messageId: id, error: error instanceof Error ? error.name : "Error" }));
    }
    return context.html(checkEmailView(config, enteredEmail));
  });

  app.get("/auth/confirm", async (context) => {
    const token = context.req.query("token") || "";
    if (!TOKEN_PATTERN.test(token)) return context.html(invalidLinkView(config), 400);
    const tokenHash = await sha256(token);
    const row = database.query<{ pending_page_url: string | null; purpose: string; terms_version: string | null }, [string, string]>(`
      SELECT pending_page_url, purpose, terms_version FROM magic_links
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(tokenHash, new Date().toISOString());
    if (!row) return context.html(invalidLinkView(config), 400);
    const hostname = row.pending_page_url ? new URL(row.pending_page_url).hostname : undefined;
    const needsTerms = row.purpose === "register" && !row.terms_version;
    return context.html(confirmView(config, token, hostname, { needsTerms, deleting: row.purpose === "delete" }));
  });

  app.post("/auth/confirm", async (context) => {
    // Login CSRF: a cross-site POST with an attacker's token would sign the
    // victim in as the attacker. Same policy as admin mutations.
    if (!sameOrigin(config, context.req.header("origin"), context.req.header("sec-fetch-site"))) {
      return context.json({ error: "Forbidden" }, 403);
    }
    const body = await context.req.parseBody();
    const token = stringField(body, "token");
    if (!TOKEN_PATTERN.test(token)) return context.html(invalidLinkView(config), 400);
    const tokenHash = await sha256(token);
    const sessionToken = randomToken();
    const sessionTokenHash = await sha256(sessionToken);
    const sessionId = crypto.randomUUID();
    const formId = crypto.randomUUID();
    const publicId = randomToken();
    const now = new Date();
    const remembered = stringField(body, "remember") === "yes";
    const acceptedTerms = stringField(body, "accepted_terms") === "yes";
    const expiresAt = new Date(now.getTime() + (remembered ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000));

    // Account-creation links carry no terms consent; collect it here without consuming the link.
    const pending = database.query<{ purpose: string; terms_version: string | null }, [string, string]>(`
      SELECT purpose, terms_version FROM magic_links WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(tokenHash, now.toISOString());
    if (!pending) return context.html(invalidLinkView(config), 400);
    if (pending.purpose === "register" && !pending.terms_version && !acceptedTerms) {
      return context.html(confirmView(config, token, undefined, { needsTerms: true, error: "Accept the Terms to create your account." }), 400);
    }

    let accountDeleted = false;
    try {
      database.transaction(() => {
        const link = database.query<MagicLinkRow, [string, string]>(`
          SELECT id, email, email_normalized, purpose, pending_page_url, terms_version
          FROM magic_links WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `).get(tokenHash, now.toISOString());
        if (!link) throw new Error("INVALID_LINK");
        const consumed = database.query("UPDATE magic_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(now.toISOString(), link.id);
        if (consumed.changes !== 1) throw new Error("INVALID_LINK");

        if (link.purpose === "delete") {
          const target = database.query<{ id: string }, [string]>("SELECT id FROM users WHERE email_normalized = ?").get(link.email_normalized);
          if (!target) throw new Error("INVALID_LINK");
          database.query("DELETE FROM users WHERE id = ?").run(target.id);
          accountDeleted = true;
          return;
        }

        let user = database.query<{ id: string }, [string]>("SELECT id FROM users WHERE email_normalized = ?").get(link.email_normalized);
        const termsVersion = link.terms_version ?? (acceptedTerms ? config.termsVersion : null);
        if (!user && link.purpose === "register" && termsVersion) {
          const userId = crypto.randomUUID();
          database.query(`
            INSERT INTO users (id, email, email_normalized, accepted_terms_at, terms_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, link.email || link.email_normalized, link.email_normalized, now.toISOString(), termsVersion, now.toISOString());
          user = { id: userId };
        }
        if (!user) throw new Error("INVALID_LINK");

        const owned = database.query<{ count: number }, [string]>("SELECT count(*) AS count FROM forms WHERE user_id = ?").get(user.id)!.count;
        if (link.pending_page_url && owned < config.maxFormsPerAccount) {
          const page = new URL(link.pending_page_url);
          const path = page.pathname === "/" ? "" : page.pathname.replace(/\/$/, "");
          database.query(`
            INSERT INTO forms (id, public_id, user_id, name, page_url, allowed_origin, success_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(formId, publicId, user.id, `${page.hostname}${path}`, page.href, page.origin, page.href, now.toISOString(), now.toISOString());
        }

        database.query(`
          INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, device_label)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, user.id, sessionTokenHash, expiresAt.toISOString(), now.toISOString(), now.toISOString(), deviceLabel(context.req.header("user-agent")));
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_LINK") return context.html(invalidLinkView(config), 400);
      throw error;
    }

    if (accountDeleted) {
      deleteCookie(context, sessionCookieName(config), { path: "/", secure: config.environment === "production" });
      return context.redirect("/", 303);
    }

    setCookie(context, sessionCookieName(config), sessionToken, {
      httpOnly: true,
      secure: config.environment === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: remembered ? REMEMBER_DAYS * 86_400 : undefined,
    });
    return context.redirect("/admin", 303);
  });

  const requireSession: MiddlewareHandler<AuthEnv> = async (context, next) => {
    const token = getCookie(context, sessionCookieName(config));
    if (!token || !TOKEN_PATTERN.test(token)) return context.redirect("/login", 303);
    const tokenHash = await sha256(token);
    const row = database.query<SessionRow, [string, string]>(`
      SELECT sessions.id, sessions.user_id, users.email
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, new Date().toISOString());
    if (!row) {
      deleteCookie(context, sessionCookieName(config), { path: "/", secure: config.environment === "production" });
      return context.redirect("/login", 303);
    }
    database.query("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    context.set("user", { id: row.user_id, email: row.email });
    context.set("session", { id: row.id, token });
    await next();
  };

  app.use("/admin", requireSession);
  app.use("/admin/*", requireSession);

  app.get("/admin", async (context) => {
    const user = context.get("user");
    const session = context.get("session");
    const sessions = database.query<{ id: string; created_at: string; last_seen_at: string; device_label: string }, [string, string]>(`
      SELECT id, created_at, last_seen_at, device_label FROM sessions
      WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC
    `).all(user.id, new Date().toISOString()).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      deviceLabel: row.device_label,
      current: row.id === session.id,
    }));
    const forms = database.query<{ id: string; name: string; page_url: string; submission_count: number; latest_submission: string | null }, [string]>(`
      SELECT forms.id, forms.name, forms.page_url, count(submissions.id) AS submission_count,
        max(submissions.created_at) AS latest_submission
      FROM forms LEFT JOIN submissions ON submissions.form_id = forms.id
      WHERE forms.user_id = ? GROUP BY forms.id ORDER BY forms.created_at DESC
    `).all(user.id).map((form) => ({
      id: form.id,
      name: form.name,
      pageUrl: form.page_url,
      submissionCount: form.submission_count,
      latestSubmission: form.latest_submission,
    }));
    return context.html(accountView(config, user.email, await csrfToken(config, session.token), sessions, forms));
  });

  async function mutation(context: Context<AuthEnv>) {
    const body = await context.req.parseBody();
    const session = context.get("session");
    return {
      body,
      valid: sameOrigin(config, context.req.header("origin"), context.req.header("sec-fetch-site"))
        && await validCsrf(config, session.token, stringField(body, "csrf")),
    };
  }

  app.post("/auth/logout", requireSession, async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    database.query("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(context.get("session").id, context.get("user").id);
    deleteCookie(context, sessionCookieName(config), { path: "/", secure: config.environment === "production" });
    return context.redirect("/login", 303);
  });

  app.post("/admin/forms/create", async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    const raw = stringField(result.body, "page_url");
    const page = pageUrl(raw, config.environment === "production");
    if (!page) return context.json({ error: "Invalid page URL" }, 400);
    const owned = database.query<{ count: number }, [string]>("SELECT count(*) AS count FROM forms WHERE user_id = ?").get(context.get("user").id)!.count;
    if (owned >= config.maxFormsPerAccount) return context.json({ error: `Account limit of ${config.maxFormsPerAccount} forms reached` }, 429);
    const now = new Date().toISOString();
    const path = page.pathname === "/" ? "" : page.pathname.replace(/\/$/, "");
    const id = crypto.randomUUID();
    database.query(`INSERT INTO forms (id, public_id, user_id, name, page_url, allowed_origin, success_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, randomToken(), context.get("user").id, `${page.hostname}${path}`, page.href, page.origin, page.href, now, now);
    return context.redirect(`/admin/forms/${id}`, 303);
  });

  // Typed email is the first gate; actual deletion requires clicking a fresh
  // emailed link, so a stolen session alone cannot destroy the account.
  app.post("/admin/account/delete", async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    const user = context.get("user");
    if (stringField(result.body, "confirmation") !== user.email) return context.json({ error: "Confirmation does not match" }, 400);
    const email = normalizeEmail(user.email);
    if (!email) return context.json({ error: "Invalid request" }, 400);
    const id = crypto.randomUUID();
    const token = randomToken();
    const tokenHash = await sha256(token);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + MAGIC_LINK_MINUTES * 60_000);
    database.transaction(() => {
      database.query("DELETE FROM magic_links WHERE email_normalized = ? AND purpose = 'delete' AND consumed_at IS NULL").run(email);
      database.query(`
        INSERT INTO magic_links (id, email, email_normalized, token_hash, purpose, expires_at, created_at)
        VALUES (?, ?, ?, ?, 'delete', ?, ?)
      `).run(id, user.email, email, tokenHash, expiresAt.toISOString(), createdAt.toISOString());
    })();
    const confirmUrl = new URL("/auth/confirm", config.publicUrl);
    confirmUrl.searchParams.set("token", token);
    try {
      await mailer.sendMagicLink({ id, to: user.email, confirmUrl: confirmUrl.href, expiresMinutes: MAGIC_LINK_MINUTES, variant: "delete-account" });
    } catch (error) {
      console.error(JSON.stringify({ event: "email_failed", messageId: id, error: error instanceof Error ? error.name : "Error" }));
    }
    return context.html(checkEmailView(config, user.email));
  });

  app.post("/admin/sessions/revoke-others", async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    database.query("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(context.get("user").id, context.get("session").id);
    return context.redirect("/admin", 303);
  });

  app.post("/admin/sessions/:id/revoke", async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    database.query("DELETE FROM sessions WHERE id = ? AND user_id = ? AND id <> ?")
      .run(context.req.param("id"), context.get("user").id, context.get("session").id);
    return context.redirect("/admin", 303);
  });
}
