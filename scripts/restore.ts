import { Database } from "bun:sqlite";
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";

process.umask(0o077);
const source = process.argv[2] && resolve(process.argv[2]);
if (!source || !existsSync(source)) throw new Error("Usage: bun run restore -- <backup.sqlite>");
const config = loadConfig();
const check = new Database(source, { readonly: true, strict: true });
try {
  if (check.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("Backup failed integrity check");
} finally { check.close(); }
const destination = resolve(config.databasePath);
const temporary = `${destination}.restore-${crypto.randomUUID()}`;
const previous = `${destination}.before-restore`;
copyFileSync(source, temporary);
chmodSync(temporary, 0o600);
try {
  if (existsSync(destination)) renameSync(destination, previous);
  renameSync(temporary, destination);
  rmSync(`${destination}-wal`, { force: true });
  rmSync(`${destination}-shm`, { force: true });
  console.log(`Restored ${destination}. Previous database: ${previous}`);
} catch (error) {
  if (existsSync(previous) && !existsSync(destination)) renameSync(previous, destination);
  rmSync(temporary, { force: true });
  throw error;
}
