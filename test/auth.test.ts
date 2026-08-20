import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { migrate, openDatabase, type AppDatabase } from "../src/database";
import type { MagicLinkEmail, Mailer } from "../src/email";

class RecordingMailer implements Mailer {
  messages: MagicLinkEmail[] = [];
  async sendMagicLink(input: MagicLinkEmail) { this.messages.push(input); }
}

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_URL: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  EMAIL_FROM: "forms@example.com",
  EMAIL_PROVIDER: "discard",
  TERMS_URL: "https://example.com/terms",
  TERMS_VERSION: "1",
  PRIVACY_URL: "https://example.com/privacy",
});

let database: AppDatabase | undefined;
afterEach(() => database?.close());

function setup() {
  database = openDatabase(":memory:");
  migrate(database);
  const mailer = new RecordingMailer();
  return { app: createApp(config, database, mailer), mailer, database };
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (Mac OS) Chrome/120" },
    body: new URLSearchParams(fields).toString(),
  };
}

async function requestRegistration(app: ReturnType<typeof createApp>, mailer: RecordingMailer) {
  const response = await app.request("/auth/magic-link", form({
    purpose: "register",
    email: "Person@Example.com",
    page_url: "https://example.com/contact",
    accepted_terms: "yes",
  }));
  expect(response.status).toBe(200);
  expect(mailer.messages).toHaveLength(1);
  return new URL(mailer.messages[0]!.confirmUrl).searchParams.get("token")!;
}

function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

describe("magic-link authentication", () => {
  test("GET validates but does not consume; POST creates account, form, and hashed session", async () => {
    const { app, mailer, database } = setup();
    const token = await requestRegistration(app, mailer);

    const storedLink = database.query<{ token_hash: string; consumed_at: string | null }, []>("SELECT token_hash, consumed_at FROM magic_links").get()!;
    expect(storedLink.token_hash).not.toContain(token);
    expect(storedLink.consumed_at).toBeNull();

    const scannerResponse = await app.request(`/auth/confirm?token=${token}`);
    expect(scannerResponse.status).toBe(200);
    expect(database.query<{ consumed_at: string | null }, []>("SELECT consumed_at FROM magic_links").get()!.consumed_at).toBeNull();

    const confirmResponse = await app.request("/auth/confirm", form({ token }));
    expect(confirmResponse.status).toBe(303);
    expect(confirmResponse.headers.get("location")).toBe("/admin");
    const cookie = cookieFrom(confirmResponse);
    expect(cookie).toStartWith("shibumi_forms_session=");
    expect(cookie).not.toContain(token);

    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM users").get()!.count).toBe(1);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM forms").get()!.count).toBe(1);
    const session = database.query<{ token_hash: string; device_label: string }, []>("SELECT token_hash, device_label FROM sessions").get()!;
    expect(cookie).not.toContain(session.token_hash);
    expect(session.device_label).toBe("Chrome on macOS");

    const adminResponse = await app.request("/admin", { headers: { cookie } });
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.text()).toContain("Person@Example.com");

    const replayResponse = await app.request("/auth/confirm", form({ token }));
    expect(replayResponse.status).toBe(400);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count).toBe(1);
  });

  test("unknown login sends account-creation link and confirm requires terms", async () => {
    const { app, mailer, database } = setup();
    const response = await app.request("/auth/magic-link", form({ purpose: "login", email: "unknown@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("If the address can receive email");
    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.variant).toBe("create-account");
    const token = new URL(mailer.messages[0]!.confirmUrl).searchParams.get("token")!;

    const page = await app.request(`/auth/confirm?token=${token}`);
    expect(await page.text()).toContain("Create your account");

    const withoutTerms = await app.request("/auth/confirm", form({ token }));
    expect(withoutTerms.status).toBe(400);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM users").get()!.count).toBe(0);
    expect(database.query<{ consumed_at: string | null }, []>("SELECT consumed_at FROM magic_links").get()!.consumed_at).toBeNull();

    const confirmed = await app.request("/auth/confirm", form({ token, accepted_terms: "yes" }));
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe("/admin");
    const user = database.query<{ email: string; terms_version: string }, []>("SELECT email, terms_version FROM users").get()!;
    expect(user.email).toBe("unknown@example.com");
    expect(user.terms_version).toBe("1");
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM forms").get()!.count).toBe(0);
  });

  test("known login sends sign-in link without terms prompt", async () => {
    const { app, mailer } = setup();
    const registerToken = await requestRegistration(app, mailer);
    await app.request("/auth/confirm", form({ token: registerToken }));
    await app.request("/auth/magic-link", form({ purpose: "login", email: "person@example.com" }));
    expect(mailer.messages).toHaveLength(2);
    expect(mailer.messages[1]!.variant).toBe("signin");
    const token = new URL(mailer.messages[1]!.confirmUrl).searchParams.get("token")!;
    const page = await app.request(`/auth/confirm?token=${token}`);
    expect(await page.text()).not.toContain("accepted_terms");
  });

  test("expired link cannot be confirmed", async () => {
    const { app, mailer, database } = setup();
    const token = await requestRegistration(app, mailer);
    database.query("UPDATE magic_links SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
    expect((await app.request(`/auth/confirm?token=${token}`)).status).toBe(400);
    expect((await app.request("/auth/confirm", form({ token }))).status).toBe(400);
  });

  test("concurrent confirmation consumes link once", async () => {
    const { app, mailer, database } = setup();
    const token = await requestRegistration(app, mailer);
    const responses = await Promise.all([
      app.request("/auth/confirm", form({ token })),
      app.request("/auth/confirm", form({ token })),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([303, 400]);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count).toBe(1);
  });

  test("remembered session can revoke other sessions", async () => {
    const { app, mailer, database } = setup();
    const registerToken = await requestRegistration(app, mailer);
    const first = await app.request("/auth/confirm", form({ token: registerToken }));
    const firstCookie = cookieFrom(first);

    await app.request("/auth/magic-link", form({ purpose: "login", email: "person@example.com" }));
    const loginToken = new URL(mailer.messages[1]!.confirmUrl).searchParams.get("token")!;
    const second = await app.request("/auth/confirm", form({ token: loginToken, remember: "yes" }));
    const secondCookie = cookieFrom(second);
    expect(second.headers.get("set-cookie")).toContain("Max-Age=2592000");
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count).toBe(2);

    const account = await app.request("/admin", { headers: { cookie: secondCookie } });
    const csrf = (await account.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
    const revoked = await app.request("/admin/sessions/revoke-others", {
      ...form({ csrf }),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: secondCookie, origin: config.publicUrl.origin },
    });
    expect(revoked.status).toBe(303);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count).toBe(1);
    expect((await app.request("/admin", { headers: { cookie: firstCookie } })).headers.get("location")).toBe("/login");
    expect((await app.request("/admin", { headers: { cookie: secondCookie } })).status).toBe(200);
  });

  test("CSRF protects logout", async () => {
    const { app, mailer, database } = setup();
    const token = await requestRegistration(app, mailer);
    const confirmation = await app.request("/auth/confirm", form({ token }));
    const cookie = cookieFrom(confirmation);

    const rejected = await app.request("/auth/logout", { ...form({ csrf: "wrong" }), headers: { ...form({}).headers, cookie } });
    expect(rejected.status).toBe(403);

    const admin = await app.request("/admin", { headers: { cookie } });
    const csrf = (await admin.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
    const accepted = await app.request("/auth/logout", {
      ...form({ csrf }),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: config.publicUrl.origin },
    });
    expect(accepted.status).toBe(303);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count).toBe(0);
  });
});
