import type { MiddlewareHandler } from "hono";
import type { AppConfig } from "./config";

export type AppVariables = {
  requestId: string;
};

function routeClass(path: string): string {
  if (path === "/healthz") return "health";
  if (path === "/readyz") return "readiness";
  if (path.startsWith("/auth/")) return "auth";
  if (path.startsWith("/admin/")) return "admin";
  if (path.startsWith("/f/")) return "submission";
  return "other";
}

export function security(config: AppConfig): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);

    context.header("X-Request-Id", requestId);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    const turnstile = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    context.header("Content-Security-Policy", `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'${turnstile}; frame-src 'self'${turnstile}; connect-src 'self'${turnstile}; style-src 'self'`);
    context.header("Cross-Origin-Opener-Policy", "same-origin");
    context.header("Cache-Control", "no-store");
    if (config.environment === "production") {
      context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    try {
      await next();
    } finally {
      console.log(JSON.stringify({
        requestId,
        route: routeClass(context.req.path),
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      }));
    }
  };
}
