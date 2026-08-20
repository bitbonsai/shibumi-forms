import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "../src/database";

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
});
