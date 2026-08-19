import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { migrate, openDatabase, type AppDatabase } from "../src/database";

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
  return createApp(config, database);
}

describe("service routes", () => {
  test("reports liveness with security headers", async () => {
    const response = await setup().request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("reports database readiness", async () => {
    const response = await setup().request("/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("serves local stylesheet", async () => {
    const response = await setup().request("/assets/styles.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  test("rejects oversized bodies", async () => {
    const response = await setup().request("/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(65 * 1024),
    });
    expect(response.status).toBe(413);
  });

  test("returns inert JSON for unknown routes", async () => {
    const response = await setup().request("/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
