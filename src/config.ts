export type AppConfig = {
  environment: "development" | "test" | "production";
  port: number;
  publicUrl: URL;
  databasePath: string;
  sessionSecret: string;
  emailFrom: string;
  emailProvider: "discard" | "resend";
  emailApiKey?: string;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  trustedProxy: "none" | "loopback";
  termsUrl: URL;
  termsVersion: string;
  privacyUrl: URL;
  backupRetentionDays: number;
  maxFormsPerAccount: number;
  maxSubmissionsPerForm: number;
  maxEmailsPerDay: number;
};

type Environment = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ConfigError";
  }
}

function required(env: Environment, field: string): string {
  const value = env[field]?.trim();
  if (!value) throw new ConfigError(field, "is required");
  return value;
}

function integer(env: Environment, field: string, fallback: number, min: number, max: number): number {
  const raw = env[field]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(field, `must be an integer from ${min} to ${max}`);
  }
  return value;
}

function url(env: Environment, field: string): URL {
  const raw = required(env, field);
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new ConfigError(field, "must be an absolute HTTP URL");
  }
  if (!["http:", "https:"].includes(value.protocol) || value.username || value.password) {
    throw new ConfigError(field, "must be an absolute HTTP URL without credentials");
  }
  return value;
}

function optional(env: Environment, field: string): string | undefined {
  return env[field]?.trim() || undefined;
}

export function loadConfig(env: Environment = Bun.env): AppConfig {
  const environment = env.NODE_ENV?.trim() || "development";
  if (!["development", "test", "production"].includes(environment)) {
    throw new ConfigError("NODE_ENV", "must be development, test, or production");
  }

  const publicUrl = url(env, "PUBLIC_URL");
  if (environment === "production" && publicUrl.protocol !== "https:") {
    throw new ConfigError("PUBLIC_URL", "must use HTTPS in production");
  }

  const sessionSecret = required(env, "SESSION_SECRET");
  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new ConfigError("SESSION_SECRET", "must contain at least 32 bytes");
  }
  if (environment === "production" && sessionSecret.startsWith("replace-with-")) {
    throw new ConfigError("SESSION_SECRET", "must not use example value in production");
  }

  const trustedProxy = env.TRUSTED_PROXY?.trim() || "loopback";
  if (trustedProxy !== "none" && trustedProxy !== "loopback") {
    throw new ConfigError("TRUSTED_PROXY", "must be none or loopback");
  }

  const emailProvider = required(env, "EMAIL_PROVIDER");
  if (emailProvider !== "discard" && emailProvider !== "resend") {
    throw new ConfigError("EMAIL_PROVIDER", "must be discard or resend");
  }
  const emailApiKey = optional(env, "RESEND_API_KEY");
  if (emailProvider === "resend" && !emailApiKey) {
    throw new ConfigError("RESEND_API_KEY", "is required when EMAIL_PROVIDER=resend");
  }
  if (environment === "production" && emailProvider === "discard") {
    throw new ConfigError("EMAIL_PROVIDER", "must be resend in production");
  }

  const turnstileSiteKey = optional(env, "TURNSTILE_SITE_KEY");
  const turnstileSecretKey = optional(env, "TURNSTILE_SECRET_KEY");
  if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecretKey)) {
    throw new ConfigError("TURNSTILE_SITE_KEY", "must be set together with TURNSTILE_SECRET_KEY");
  }

  const termsUrl = url(env, "TERMS_URL");
  const privacyUrl = url(env, "PRIVACY_URL");
  if (environment === "production" && termsUrl.protocol !== "https:") {
    throw new ConfigError("TERMS_URL", "must use HTTPS in production");
  }
  if (environment === "production" && privacyUrl.protocol !== "https:") {
    throw new ConfigError("PRIVACY_URL", "must use HTTPS in production");
  }

  return {
    environment: environment as AppConfig["environment"],
    port: integer(env, "PORT", 3000, 1, 65_535),
    publicUrl,
    databasePath: required(env, "DATABASE_PATH"),
    sessionSecret,
    emailFrom: required(env, "EMAIL_FROM"),
    emailProvider,
    emailApiKey,
    turnstileSiteKey,
    turnstileSecretKey,
    trustedProxy,
    termsUrl,
    termsVersion: required(env, "TERMS_VERSION"),
    privacyUrl,
    backupRetentionDays: integer(env, "BACKUP_RETENTION_DAYS", 30, 1, 3650),
    maxFormsPerAccount: integer(env, "MAX_FORMS_PER_ACCOUNT", 10, 1, 1000),
    maxSubmissionsPerForm: integer(env, "MAX_SUBMISSIONS_PER_FORM", 10_000, 1, 1_000_000),
    maxEmailsPerDay: integer(env, "MAX_EMAILS_PER_DAY", 80, 0, 100_000),
  };
}
