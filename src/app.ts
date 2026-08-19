import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { registerAuthRoutes, type AuthEnv } from "./auth";
import type { AppConfig } from "./config";
import { checkDatabase, type AppDatabase } from "./database";
import { createMailer, type Mailer } from "./email";
import { security } from "./security";
import { registerSubmissionRoutes } from "./submissions";

export function createApp(config: AppConfig, database: AppDatabase, mailer: Mailer = createMailer(config)) {
  const app = new Hono<AuthEnv>();

  app.use("*", security(config));
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (context) => context.json({ error: "Request body too large" }, 413) }));
  app.use("/assets/*", serveStatic({ root: "./public" }));

  app.get("/healthz", (context) => context.json({ ok: true }));

  app.get("/readyz", (context) => {
    try {
      return checkDatabase(database)
        ? context.json({ ok: true })
        : context.json({ ok: false }, 503);
    } catch {
      return context.json({ ok: false }, 503);
    }
  });

  registerAuthRoutes(app, config, database, mailer);
  registerSubmissionRoutes(app, config, database);

  app.notFound((context) => context.json({ error: "Not found" }, 404));

  app.onError((error, context) => {
    const requestId = context.get("requestId");
    console.error(JSON.stringify({ requestId, error: error.name }));
    return context.json({ error: "Internal server error", requestId }, 500);
  });

  return app;
}
