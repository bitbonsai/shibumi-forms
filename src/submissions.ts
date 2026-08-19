import type { Context, Hono } from "hono";
import { csrfToken, sameOrigin, validCsrf, type AuthEnv } from "./auth";
import type { AppConfig } from "./config";
import type { AppDatabase } from "./database";
import { formView } from "./views";

const HONEYPOT = "website";
const MAX_FIELDS = 64;
const MAX_NAME = 100;
const MAX_VALUE_BYTES = 10 * 1024;
const MAX_REPEATED = 20;

type FormRow = {
  id: string;
  public_id: string;
  user_id: string;
  name: string;
  page_url: string;
  allowed_origin: string;
  success_url: string;
  active: number;
};

type Payload = Record<string, string | string[]>;

class WindowLimiter {
  private entries = new Map<string, { count: number; reset: number }>();
  allows(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const current = this.entries.get(key);
    if (!current || current.reset <= now) {
      if (this.entries.size > 20_000) this.entries.clear();
      this.entries.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    return ++current.count <= limit;
  }
}

const limiter = new WindowLimiter();

function add(payload: Payload, name: string, value: string): void {
  if (!name || name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("INVALID_FIELD");
  if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) throw new Error("INVALID_FIELD");
  const existing = payload[name];
  if (existing === undefined && Object.keys(payload).length >= MAX_FIELDS) throw new Error("INVALID_FIELD");
  if (existing === undefined) payload[name] = value;
  else if (Array.isArray(existing)) {
    if (existing.length >= MAX_REPEATED) throw new Error("INVALID_FIELD");
    existing.push(value);
  } else payload[name] = [existing, value];
}

async function parsePayload(context: Context<AuthEnv>): Promise<{ payload: Payload; json: boolean }> {
  const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const payload: Payload = {};
  if (contentType === "application/json") {
    const value = await context.req.json<unknown>();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_FIELD");
    for (const [name, item] of Object.entries(value)) {
      if (typeof item === "string") add(payload, name, item);
      else if (Array.isArray(item) && item.length > 0 && item.every((entry) => typeof entry === "string")) {
        for (const entry of item) add(payload, name, entry);
      } else throw new Error("INVALID_FIELD");
    }
    return { payload, json: true };
  }
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "multipart/form-data") {
    throw new Error("UNSUPPORTED_TYPE");
  }
  const data = await context.req.formData();
  for (const [name, value] of data) {
    if (value instanceof File) throw new Error("INVALID_FIELD");
    add(payload, name, value);
  }
  return { payload, json: false };
}

function successful(context: Context<AuthEnv>, form: FormRow, json: boolean) {
  if (json) {
    context.header("Access-Control-Allow-Origin", form.allowed_origin);
    context.header("Vary", "Origin");
    return context.json({ ok: true }, 202);
  }
  return context.redirect(form.success_url, 303);
}

async function requestKey(context: Context<AuthEnv>, config: AppConfig, formId: string): Promise<string> {
  const peer = context.env?.remoteAddress;
  const loopback = peer === "::1" || peer === "127.0.0.1" || peer?.startsWith("::ffff:127.");
  const forwarded = config.trustedProxy === "loopback" && loopback
    ? context.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim()
    : undefined;
  const source = forwarded && forwarded.length <= 45 && /^[0-9a-f:.]+$/i.test(forwarded)
    ? forwarded
    : peer || context.req.header("user-agent") || "unknown";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${formId}:${source}:${new Date().toISOString().slice(0, 10)}`));
  return Buffer.from(digest).toString("base64url");
}

export function registerSubmissionRoutes(app: Hono<AuthEnv>, config: AppConfig, database: AppDatabase): void {
  app.options("/f/:publicId", (context) => {
    const form = database.query<FormRow, [string]>("SELECT * FROM forms WHERE public_id = ? AND active = 1").get(context.req.param("publicId"));
    const origin = context.req.header("origin");
    if (!form || origin !== form.allowed_origin) return context.body(null, 404);
    context.header("Access-Control-Allow-Origin", form.allowed_origin);
    context.header("Access-Control-Allow-Methods", "POST");
    context.header("Access-Control-Allow-Headers", "Content-Type");
    context.header("Access-Control-Max-Age", "600");
    context.header("Vary", "Origin");
    return context.body(null, 204);
  });

  app.post("/f/:publicId", async (context) => {
    const form = database.query<FormRow, [string]>("SELECT * FROM forms WHERE public_id = ? AND active = 1").get(context.req.param("publicId"));
    if (!form) return context.json({ error: "Not found" }, 404);
    const origin = context.req.header("origin");
    if (origin && origin !== form.allowed_origin) return context.json({ error: "Origin not allowed" }, 403);
    if (!limiter.allows(await requestKey(context, config, form.id), 60, 60_000) || !limiter.allows("global", 1000, 60_000)) {
      return context.json({ error: "Too many requests" }, 429);
    }

    let parsed: { payload: Payload; json: boolean };
    try {
      parsed = await parsePayload(context);
    } catch (error) {
      const status = error instanceof Error && error.message === "UNSUPPORTED_TYPE" ? 415 : 400;
      return context.json({ error: status === 415 ? "Unsupported content type" : "Invalid form data" }, status);
    }
    if (parsed.json && origin !== form.allowed_origin) return context.json({ error: "Origin required" }, 403);
    if (Object.keys(parsed.payload).length > MAX_FIELDS) return context.json({ error: "Invalid form data" }, 400);

    const honeypot = parsed.payload[HONEYPOT];
    delete parsed.payload[HONEYPOT];
    for (const name of Object.keys(parsed.payload)) if (name.startsWith("_shibumi_")) delete parsed.payload[name];
    if ((typeof honeypot === "string" && honeypot) || (Array.isArray(honeypot) && honeypot.some(Boolean))) {
      return successful(context, form, parsed.json);
    }

    database.query("INSERT INTO submissions (id, form_id, payload_json, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), form.id, JSON.stringify(parsed.payload), new Date().toISOString());
    return successful(context, form, parsed.json);
  });

  app.get("/admin/forms/:id/submissions.csv", (context) => {
    const form = database.query<{ id: string; name: string }, [string, string]>("SELECT id, name FROM forms WHERE id = ? AND user_id = ?").get(context.req.param("id"), context.get("user").id);
    if (!form) return context.json({ error: "Not found" }, 404);
    const query = database.query<{ id: string; created_at: string; payload_json: string }, [string]>("SELECT id, created_at, payload_json FROM submissions WHERE form_id = ? ORDER BY created_at DESC, id DESC");
    const columns = new Set<string>();
    for (const row of query.iterate(form.id)) {
      try { for (const key of Object.keys(JSON.parse(row.payload_json))) columns.add(key); } catch {}
    }
    const headers = ["submission_id", "created_at", ...columns];
    const csv = (value: unknown) => {
      let text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const encoder = new TextEncoder();
    const rows = query.iterate(form.id)[Symbol.iterator]();
    let headerPending = true;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (headerPending) {
          headerPending = false;
          controller.enqueue(encoder.encode(`${headers.map(csv).join(",")}\r\n`));
          return;
        }
        const next = rows.next();
        if (next.done) return controller.close();
        const row = next.value;
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(row.payload_json); } catch {}
        controller.enqueue(encoder.encode(`${[row.id, row.created_at, ...[...columns].map((key) => payload[key])].map(csv).join(",")}\r\n`));
      },
    });
    const filename = `${form.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "submissions"}.csv`;
    context.header("Content-Type", "text/csv; charset=utf-8");
    context.header("Content-Disposition", `attachment; filename="${filename}"`);
    return context.body(stream);
  });

  app.get("/admin/forms/:id", async (context) => {
    const form = database.query<FormRow & { submission_count: number }, [string, string]>(`
      SELECT forms.*, count(submissions.id) AS submission_count
      FROM forms LEFT JOIN submissions ON submissions.form_id = forms.id
      WHERE forms.id = ? AND forms.user_id = ? GROUP BY forms.id
    `).get(context.req.param("id"), context.get("user").id);
    if (!form) return context.json({ error: "Not found" }, 404);
    let cursor: [string, string] | undefined;
    try {
      const raw = context.req.query("cursor");
      if (raw) cursor = JSON.parse(Buffer.from(raw, "base64url").toString());
      if (cursor && (cursor.length !== 2 || !cursor.every((value) => typeof value === "string"))) throw new Error();
    } catch { return context.json({ error: "Invalid cursor" }, 400); }
    const rows = cursor
      ? database.query<{ id: string; payload_json: string; created_at: string }, [string, string, string, string, number]>(`SELECT id, payload_json, created_at FROM submissions WHERE form_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`).all(form.id, cursor[0], cursor[0], cursor[1], 51)
      : database.query<{ id: string; payload_json: string; created_at: string }, [string, number]>("SELECT id, payload_json, created_at FROM submissions WHERE form_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(form.id, 51);
    const more = rows.length > 50;
    if (more) rows.pop();
    const submissions = rows.map((row) => {
      let payload: Record<string, string | string[]>;
      try { payload = JSON.parse(row.payload_json); } catch { payload = { error: "Stored submission is unreadable" }; }
      return { id: row.id, createdAt: row.created_at, payload };
    });
    const columns = [...new Set(submissions.flatMap(({ payload }) => Object.keys(payload)))].slice(0, 6);
    const last = rows.at(-1);
    const next = more && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url") : undefined;
    const endpoint = new URL(`/f/${form.public_id}`, config.publicUrl).href;
    const csrf = await csrfToken(config, context.get("session").token);
    return context.html(formView(config, form, endpoint, HONEYPOT, csrf, submissions, columns, next));
  });

  async function mutation(context: Context<AuthEnv>) {
    const body = await context.req.parseBody();
    const candidate = typeof body.csrf === "string" ? body.csrf : "";
    const valid = sameOrigin(config, context.req.header("origin"), context.req.header("sec-fetch-site"))
      && await validCsrf(config, context.get("session").token, candidate);
    return { body, valid };
  }

  app.post("/admin/forms/:formId/submissions/:id/delete", async (context) => {
    if (!(await mutation(context)).valid) return context.json({ error: "Invalid request" }, 403);
    database.query(`DELETE FROM submissions WHERE id = ? AND form_id IN (SELECT id FROM forms WHERE id = ? AND user_id = ?)`)
      .run(context.req.param("id"), context.req.param("formId"), context.get("user").id);
    return context.redirect(`/admin/forms/${context.req.param("formId")}`, 303);
  });

  app.post("/admin/forms/:id/toggle", async (context) => {
    if (!(await mutation(context)).valid) return context.json({ error: "Invalid request" }, 403);
    database.query("UPDATE forms SET active = 1 - active, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), context.req.param("id"), context.get("user").id);
    return context.redirect(`/admin/forms/${context.req.param("id")}`, 303);
  });

  app.post("/admin/forms/:id/delete", async (context) => {
    const result = await mutation(context);
    if (!result.valid) return context.json({ error: "Invalid request" }, 403);
    const confirmation = typeof result.body.confirmation === "string" ? result.body.confirmation : "";
    const form = database.query<{ name: string }, [string, string]>("SELECT name FROM forms WHERE id = ? AND user_id = ?").get(context.req.param("id"), context.get("user").id);
    if (!form || confirmation !== form.name) return context.json({ error: "Confirmation does not match" }, 400);
    database.query("DELETE FROM forms WHERE id = ? AND user_id = ?").run(context.req.param("id"), context.get("user").id);
    return context.redirect("/admin", 303);
  });
}
