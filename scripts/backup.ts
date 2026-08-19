import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/database";

process.umask(0o077);
const config = loadConfig();
const directory = resolve(process.argv[2] || "backups");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(":", "-");
const destination = resolve(directory, `shibumi-forms-${stamp}.sqlite`);
const database = openDatabase(config.databasePath);
try {
  database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  database.close();
}
chmodSync(destination, 0o600);
const cutoff = Date.now() - config.backupRetentionDays * 86_400_000;
for (const name of readdirSync(directory)) {
  const path = resolve(directory, name);
  if (/^shibumi-forms-.+\.sqlite$/.test(name) && statSync(path).mtimeMs < cutoff) rmSync(path);
}
console.log(destination);
