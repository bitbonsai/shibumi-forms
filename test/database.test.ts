import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupExpired, migrate, openDatabase } from "../src/database";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("database migrations", () => {
  test("are idempotent and persist data", () => {
    const directory = mkdtempSync(join(tmpdir(), "shibumi-forms-"));
    directories.push(directory);
    const path = join(directory, "forms.sqlite");

    const first = openDatabase(path);
    migrate(first);
    first.query(`
      INSERT INTO users (id, email, email_normalized, accepted_terms_at, terms_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("user-1", "test@example.com", "test@example.com", "2026-01-01T00:00:00.000Z", "1", "2026-01-01T00:00:00.000Z");
    first.close();

    const second = openDatabase(path);
    migrate(second);
    const migrationCount = readdirSync(join(import.meta.dir, "..", "migrations")).filter((name) => /^\d+.*\.sql$/.test(name)).length;
    expect(second.query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations").get()?.count).toBe(migrationCount);
    expect(second.query<{ email: string }, []>("SELECT email FROM users WHERE id = 'user-1'").get()?.email)
      .toBe("test@example.com");
    second.close();
  });

  test("cleanup removes old magic links and expired sessions, keeps fresh rows", () => {
    const database = openDatabase(":memory:");
    migrate(database);
    const now = new Date("2026-08-21T12:00:00.000Z");
    const iso = (offsetHours: number) => new Date(now.getTime() + offsetHours * 3_600_000).toISOString();
    database.query(`INSERT INTO users (id, email, email_normalized, accepted_terms_at, terms_version, created_at)
      VALUES ('user-1', 'a@example.com', 'a@example.com', ?, '1', ?)`).run(iso(-100), iso(-100));
    const link = database.query(`INSERT INTO magic_links (id, email_normalized, token_hash, purpose, expires_at, created_at)
      VALUES (?, 'a@example.com', ?, 'login', ?, ?)`);
    link.run("old-link", "hash-1", iso(-99), iso(-100));   // created 100h ago -> removed
    link.run("fresh-link", "hash-2", iso(1), iso(-1));     // created 1h ago -> kept even if near expiry
    const session = database.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, device_label)
      VALUES (?, 'user-1', ?, ?, ?, ?, 'Test')`);
    session.run("dead-session", "hash-3", iso(-1), iso(-30), iso(-1));
    session.run("live-session", "hash-4", iso(24), iso(-1), iso(0));

    const removed = cleanupExpired(database, now);
    expect(removed).toEqual({ magicLinks: 1, sessions: 1 });
    expect(database.query<{ id: string }, []>("SELECT id FROM magic_links").all().map((row) => row.id)).toEqual(["fresh-link"]);
    expect(database.query<{ id: string }, []>("SELECT id FROM sessions").all().map((row) => row.id)).toEqual(["live-session"]);
    database.close();
  });
});
