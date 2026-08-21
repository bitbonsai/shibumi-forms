import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { migrate, openDatabase, type AppDatabase } from "../src/database";
import type { Mailer } from "../src/email";

const config = loadConfig({
  NODE_ENV: "test", PUBLIC_URL: "http://localhost:3000", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef", EMAIL_FROM: "forms@example.com",
  EMAIL_PROVIDER: "discard", TERMS_URL: "https://example.com/terms", TERMS_VERSION: "1",
  PRIVACY_URL: "https://example.com/privacy",
});
const mailer: Mailer = { async sendMagicLink() {} };
let database: AppDatabase | undefined;
afterEach(() => database?.close());

function setup() {
  database = openDatabase(":memory:");
  migrate(database);
  const now = new Date().toISOString();
  database.query("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run("user-1", "owner@example.com", "owner@example.com", now, "1", now);
  database.query(`INSERT INTO forms (id, public_id, user_id, name, page_url, allowed_origin, success_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("form-1", "public-1", "user-1", "Contact", "https://site.example/contact", "https://site.example", "https://site.example/thanks", now, now);
  return { app: createApp(config, database, mailer), database };
}

function count(db: AppDatabase) {
  return db.query<{ count: number }, []>("SELECT count(*) AS count FROM submissions").get()!.count;
}

async function tokenHash(token: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
}

async function addSession(db: AppDatabase, userId: string, byte: number) {
  const token = Buffer.alloc(32, byte).toString("base64url");
  const now = new Date();
  db.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, device_label)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`session-${byte}`, userId, await tokenHash(token), new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), now.toISOString(), "Test");
  return token;
}

describe("public submission endpoint", () => {
  test("stores repeated HTML fields and redirects to registered URL", async () => {
    const { app, database } = setup();
    const body = new URLSearchParams([["email", "person@example.com"], ["interest", "design"], ["interest", "code"], ["website", ""]]);
    const response = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://site.example" }, body,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://site.example/thanks");
    const payload = JSON.parse(database.query<{ payload_json: string }, []>("SELECT payload_json FROM submissions").get()!.payload_json);
    expect(payload).toEqual({ email: "person@example.com", interest: ["design", "code"] });
  });

  test("accepts JSON only from exact origin with narrow CORS", async () => {
    const { app, database } = setup();
    const response = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://site.example" },
      body: JSON.stringify({ name: "Ada", topics: ["one", "two"] }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://site.example");
    expect(await response.json()).toEqual({ ok: true });
    expect(count(database)).toBe(1);
  });

  test("rejects wrong origins and nested JSON", async () => {
    const { app, database } = setup();
    const wrongOrigin = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}",
    });
    expect(wrongOrigin.status).toBe(403);
    const nested = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://site.example" }, body: JSON.stringify({ profile: { admin: true } }),
    });
    expect(nested.status).toBe(400);
    expect(count(database)).toBe(0);
  });

  test("enforces field count and value limits", async () => {
    const { app, database } = setup();
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`field${index}`, "x"]));
    const fields = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://site.example" }, body: JSON.stringify(many),
    });
    expect(fields.status).toBe(400);
    const large = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://site.example" }, body: JSON.stringify({ note: "x".repeat(10 * 1024 + 1) }),
    });
    expect(large.status).toBe(400);
    expect(count(database)).toBe(0);
  });

  test("honeypot returns success without storage", async () => {
    const { app, database } = setup();
    const response = await app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=bot%40example.com&website=spam",
    });
    expect(response.status).toBe(303);
    expect(count(database)).toBe(0);
  });

  test("renders inert submission details and authorizes deletion", async () => {
    const { app, database } = setup();
    database.query("INSERT INTO submissions (id, form_id, payload_json, created_at) VALUES (?, ?, ?, ?)").run("submission-1", "form-1", JSON.stringify({ name: "Ada", attack: "<img src=x onerror=alert(1)>", formula: "=cmd" }), new Date().toISOString());
    const token = await addSession(database, "user-1", 6);
    const cookie = `shibumi_forms_session=${token}`;
    const page = await app.request("/admin/forms/form-1", { headers: { cookie } });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Copy agent prompt");
    expect(html).toContain("Set form action to http://localhost:3000/f/public-1");
    expect(html).toContain('name=&quot;website&quot;');
    expect(html).toContain(">Dashboard</a>");
    expect(html).not.toContain(">Sign in</a>");
    const csvResponse = await app.request("/admin/forms/form-1/submissions.csv", { headers: { cookie } });
    const csv = await csvResponse.text();
    expect(csvResponse.headers.get("content-disposition")).toContain("Contact.csv");
    expect(csv).toContain("\"'=cmd\"");
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
    const deleted = await app.request("/admin/forms/form-1/submissions/submission-1/delete", {
      method: "POST", headers: { cookie, origin: config.publicUrl.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf }),
    });
    expect(deleted.status).toBe(303);
    expect(count(database)).toBe(0);
  });

  test("form setup requires tenant ownership", async () => {
    const { app, database } = setup();
    const now = new Date();
    database.query("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run("user-2", "other@example.com", "other@example.com", now.toISOString(), "1", now.toISOString());
    const token = await addSession(database, "user-2", 7);
    const response = await app.request("/admin/forms/form-1", { headers: { cookie: `shibumi_forms_session=${token}` } });
    expect(response.status).toBe(404);
  });

  test("submission quota returns 429 and stores nothing over cap", async () => {
    const capped = loadConfig({
      NODE_ENV: "test", PUBLIC_URL: "http://localhost:3000", DATABASE_PATH: ":memory:",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef", EMAIL_FROM: "forms@example.com",
      EMAIL_PROVIDER: "discard", TERMS_URL: "https://example.com/terms", TERMS_VERSION: "1",
      PRIVACY_URL: "https://example.com/privacy", MAX_SUBMISSIONS_PER_FORM: "2",
    });
    const { database } = setup();
    const app = createApp(capped, database, mailer);
    const post = () => app.request("/f/public-1", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://site.example" },
      body: new URLSearchParams({ email: "a@example.com" }),
    });
    expect((await post()).status).toBe(303);
    expect((await post()).status).toBe(303);
    const rejected = await post();
    expect(rejected.status).toBe(429);
    expect(count(database)).toBe(2);
  });

  test("form quota rejects creation over per-account cap", async () => {
    const capped = loadConfig({
      NODE_ENV: "test", PUBLIC_URL: "http://localhost:3000", DATABASE_PATH: ":memory:",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef", EMAIL_FROM: "forms@example.com",
      EMAIL_PROVIDER: "discard", TERMS_URL: "https://example.com/terms", TERMS_VERSION: "1",
      PRIVACY_URL: "https://example.com/privacy", MAX_FORMS_PER_ACCOUNT: "1",
    });
    const { database } = setup();
    const app = createApp(capped, database, mailer);
    const token = await addSession(database, "user-1", 9);
    const cookie = `shibumi_forms_session=${token}`;
    const admin = await app.request("/admin", { headers: { cookie } });
    const csrf = (await admin.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
    const response = await app.request("/admin/forms/create", {
      method: "POST",
      headers: { cookie, origin: capped.publicUrl.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, page_url: "https://site.example/second" }),
    });
    expect(response.status).toBe(429);
    expect(database.query<{ count: number }, []>("SELECT count(*) AS count FROM forms").get()!.count).toBe(1);
  });

  test("per-form rate limit trips on the 61st request in a minute", async () => {
    const { app } = setup();
    const post = () => app.request("/f/public-1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://site.example", "user-agent": "burst-source" },
      body: new URLSearchParams({ email: "a@example.com" }),
    });
    for (let i = 0; i < 60; i++) expect((await post()).status).toBe(303);
    expect((await post()).status).toBe(429);
  });

  test("one source spraying many forms trips pivot cap without hurting others", async () => {
    const { app, database } = setup();
    const now = new Date().toISOString();
    for (let i = 0; i < 21; i++) {
      database.query(`INSERT INTO forms (id, public_id, user_id, name, page_url, allowed_origin, success_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`pivot-form-${i}`, `pivot-${i}`, "user-1", `Pivot ${i}`, "https://site.example/p", "https://site.example", "https://site.example/thanks", now, now);
    }
    const post = (index: number, agent: string) => app.request(`/f/pivot-${index}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://site.example", "user-agent": agent },
      body: new URLSearchParams({ email: "a@example.com" }),
    });
    for (let i = 0; i < 20; i++) expect((await post(i, "sprayer")).status).toBe(303);
    expect((await post(20, "sprayer")).status).toBe(429);
    expect((await post(20, "bystander")).status).toBe(303);
  });

  test("preflight and unknown IDs reveal no permissive CORS", async () => {
    const { app } = setup();
    const allowed = await app.request("/f/public-1", { method: "OPTIONS", headers: { origin: "https://site.example" } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://site.example");
    const missing = await app.request("/f/missing", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.example" }, body: "{}" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBeNull();
  });
});
