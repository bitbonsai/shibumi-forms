import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AppDatabase = Database;

const migrationsDirectory = join(import.meta.dir, "..", "migrations");

export function openDatabase(path: string): AppDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const database = new Database(path, { create: true, strict: true });
  // busy_timeout first: journal_mode = WAL takes a lock and fails with
  // SQLITE_BUSY_RECOVERY on concurrent starts if the timeout is still 0.
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");

  if (path !== ":memory:") chmodSync(path, 0o600);
  return database;
}

export function migrate(database: AppDatabase, directory = migrationsDirectory): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = database.query<{ name: string }, []>("SELECT name FROM schema_migrations").all();
  const appliedNames = new Set(applied.map(({ name }) => name));
  const files = readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort();

  for (const name of files) {
    if (appliedNames.has(name)) continue;
    const sql = readFileSync(join(directory, name), "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, new Date().toISOString());
    })();
  }
}

export function checkDatabase(database: AppDatabase): boolean {
  return database.query<{ ok: number }, []>("SELECT 1 AS ok").get()?.ok === 1;
}

export function cleanupExpired(database: AppDatabase, now = new Date()): { magicLinks: number; sessions: number } {
  // Magic links stay 48h past creation, not just past expiry: the daily email
  // budget counts today's magic_links rows, so deleting them early would
  // silently refill the budget.
  const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const magicLinks = database.query("DELETE FROM magic_links WHERE created_at < ?").run(cutoff).changes;
  const sessions = database.query("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString()).changes;
  return { magicLinks, sessions };
}
