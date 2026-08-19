import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/config";

const validEnvironment = {
  NODE_ENV: "test",
  PORT: "3000",
  PUBLIC_URL: "http://localhost:3000",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  EMAIL_FROM: "forms@example.com",
  EMAIL_PROVIDER: "discard",
  TRUSTED_PROXY: "loopback",
  TERMS_URL: "https://example.com/terms",
  TERMS_VERSION: "1",
  PRIVACY_URL: "https://example.com/privacy",
  BACKUP_RETENTION_DAYS: "30",
};

describe("loadConfig", () => {
  test("parses valid environment", () => {
    const config = loadConfig(validEnvironment);
    expect(config.port).toBe(3000);
    expect(config.publicUrl.href).toBe("http://localhost:3000/");
    expect(config.backupRetentionDays).toBe(30);
  });

  test("names missing field", () => {
    const { PUBLIC_URL: _, ...environment } = validEnvironment;
    expect(() => loadConfig(environment)).toThrow(new ConfigError("PUBLIC_URL", "is required"));
  });

  test("requires HTTPS in production", () => {
    expect(() => loadConfig({ ...validEnvironment, NODE_ENV: "production" }))
      .toThrow("PUBLIC_URL: must use HTTPS in production");
  });

  test("requires production email provider", () => {
    expect(() => loadConfig({
      ...validEnvironment,
      NODE_ENV: "production",
      PUBLIC_URL: "https://forms.example.com",
      SESSION_SECRET: "production-secret-0123456789abcdef",
    })).toThrow("EMAIL_PROVIDER: must be resend in production");
  });

  test("requires both Turnstile keys", () => {
    expect(() => loadConfig({ ...validEnvironment, TURNSTILE_SITE_KEY: "site" }))
      .toThrow("TURNSTILE_SITE_KEY: must be set together with TURNSTILE_SECRET_KEY");
  });
});
