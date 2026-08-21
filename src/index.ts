import { createApp } from "./app";
import { loadConfig } from "./config";
import { cleanupExpired, migrate, openDatabase } from "./database";

process.umask(0o077);
const config = loadConfig();
const database = openDatabase(config.databasePath);
migrate(database);

function runCleanup() {
  const removed = cleanupExpired(database);
  console.log(JSON.stringify({ event: "cleanup", ...removed }));
}
runCleanup();
setInterval(runCleanup, 6 * 3_600_000).unref?.();

const app = createApp(config, database);
const server = Bun.serve({
  fetch(request, server) {
    return app.fetch(request, { remoteAddress: server.requestIP(request)?.address });
  },
  hostname: "0.0.0.0",
  port: config.port,
});

console.log(JSON.stringify({ event: "started", port: server.port }));

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "stopping", signal }));
  await server.stop();
  database.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
