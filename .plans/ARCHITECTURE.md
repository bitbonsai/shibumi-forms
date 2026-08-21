# Shibumi Forms architecture

## Goals

- deploy as one unprivileged container with one durable SQLite database
- support hosted and self-hosted operation from same codebase
- accept plain HTML forms without client JavaScript
- isolate every account and form at query boundary
- keep tokens, personal data, and submission bodies out of logs
- preserve data through deploy, restart, backup, and restore

## Tech stack

- Bun runtime and package manager
- Hono HTTP server
- TypeScript
- `bun:sqlite` with prepared statements
- server-rendered HTML
- small vanilla JavaScript modules
- plain CSS using Shibumi visual tokens
- SQLite in WAL mode on local persistent volume
- Resend adapter for transactional magic links
- optional Cloudflare Turnstile on account-entry routes
- Docker or Podman Compose
- Shibumi for hosted deployment

No client framework. No ORM unless raw prepared statements become measurably unsafe or difficult to maintain.

## System shape

```text
static site                    owner browser
    |                               |
    | POST /f/:publicId             | /auth/*, /admin/*
    v                               v
              reverse proxy / TLS
                       |
                       v
              Bun + Hono container
              |    |       |      |
              |    |       |      +-- email provider
              |    |       +--------- server-rendered views
              |    +----------------- auth and security
              +---------------------- SQLite /data
                                             |
                                             +-- encrypted off-host backups
```

Application listens on `0.0.0.0:${PORT}`. Production TLS terminates at reverse proxy. Forwarded client data is trusted only from configured proxy addresses.

## Runtime modules

```text
src/index.ts        startup: config, migrate, serve
src/config.ts       environment parsing and startup validation
src/database.ts     connection, pragmas, migrations, transactions
src/security.ts     headers, route-class logging, request IDs
src/auth.ts         magic links, sessions, account routes, form creation
src/submissions.ts  public ingestion, rate limiting, listing, notes, CSV, form toggle/delete
src/email.ts        Mailer interface, magic-link email rendering, Resend/Discard transports
src/views.ts        escaped server-rendered HTML
src/app.ts          route composition, body limit, error boundary, health
```

There is no separate forms module: form creation lives in `auth.ts`, form settings and deletion in `submissions.ts`.

Scripts own migrations, backup, restore, and operational stats. Browser JavaScript only enhances copy, dialogs, and pending states.

## Request flows

### Register and sign in

1. `POST /auth/magic-link` validates email, optional public HTTPS page URL, Terms acknowledgement, rate limit, and Turnstile when configured.
2. Service returns same response for existing and new accounts.
3. Service invalidates prior unused token for same email and purpose, stores SHA-256 hash of new 32-byte token, then sends email through `Mailer`.
4. `GET /auth/confirm?token=...` validates and renders confirmation without consuming token.
5. `POST /auth/confirm` consumes token and creates session in one transaction.
6. Session cookie contains opaque token. Database stores token hash only.

Session cookie (production; development drops the `__Host-` prefix):

```text
__Host-shibumi_forms_session
HttpOnly
Secure
SameSite=Lax
Path=/
```

Default session lasts 24 hours. Explicit remembered session lasts 30 days. Login rotates session token.

### Register form

1. Validate page URL without fetching it.
2. Require public HTTPS URL in production.
3. Derive exact allowed origin and same-origin default success URL.
4. Generate unguessable public ID.
5. Store form under authenticated user ownership.

Public ID reduces accidental discovery but is not treated as secret.

### Accept submission

1. Resolve active form by public ID or return generic `404`.
2. Enforce 64 KiB body limit (Hono `bodyLimit`) before parsing.
3. Accept URL-encoded, multipart without files, or JSON from approved CORS origin.
4. Parse at most 64 named fields, names ≤ 100 chars, values ≤ 10 KiB, ≤ 20 repetitions per name.
5. Reject files, nested objects, invalid field names, and unsupported content types.
6. Strip reserved fields. Return normal success without storing when honeypot is populated.
7. Apply per-form and privacy-safe request limits.
8. Store strings or arrays of strings as JSON in transaction.
9. Return `303` to registered same-origin success URL for HTML or `202 { "ok": true }` for approved JSON client.

Origin is abuse signal, not authentication. Request cannot choose redirect target.

### Read and mutate admin data

1. Resolve server session from hashed cookie token.
2. Require CSRF token and same-origin validation for mutations.
3. Include authenticated `user_id` in every form, submission, export, and deletion query.
4. Escape values on server and render as text in browser.
5. Page submissions 12 at a time with `LIMIT/OFFSET` ordered by `(created_at, id) DESC` and a numbered pager.
6. Stream CSV with stable header union, correct escaping, and formula-injection defense.
7. Perform form and account cascades in explicit transactions.

## Persistence

Tracked migrations create:

- `users`: normalized unique email, Terms version and acceptance time
- `magic_links`: hashed one-time token, purpose (`register`/`login`), original email, pending page URL, expiry, consumption
- `sessions`: user, hashed token, device label, fixed expiry, created and last-seen times
- `forms`: owner, public ID, page URL, exact origin, success URL, active state
- `submissions`: form, JSON payload, optional owner note, creation time

Applied migrations: `001_initial`, `002_auth_metadata` (magic-link email, session device label), `003_submission_notes`.

Key index:

```sql
CREATE INDEX submissions_form_created
  ON submissions(form_id, created_at DESC);
```

SQLite startup settings:

- foreign keys enabled
- WAL enabled
- bounded busy timeout
- mode `0600` for database and backups
- migrations run before server accepts traffic

Payload remains JSON. User field names never become SQL identifiers.

## Security boundaries and invariants

### Browser to public submission endpoint

Untrusted input. Bound body before parsing, reject files and nested objects, validate names, preserve values as inert text, narrow CORS, and never log body.

### Owner browser to admin routes

Authenticated but still untrusted. Require tenant ownership on every query, CSRF on mutation, output escaping, and explicit destructive confirmation.

### Application to email provider

Only recipient and confirmation URL leave service for delivery. Use idempotency key based on magic-link record ID when provider supports it. Logs may contain safe request ID and provider status, never recipient or token URL.

### Application to reverse proxy

Trust forwarded scheme and client data only from configured proxy. Production requires HTTPS. Application never binds public host port in Compose.

### Application to storage

Container filesystem is read-only where practical. Only `/data` is writable. Deploy replaces image while preserving named volume.

Invariants:

- magic links are consumed only by confirmation POST
- raw magic-link and session tokens are never stored
- admin reads and writes always include tenant ownership
- server never fetches registered page URLs
- redirects only use stored same-origin success URL
- submission values never execute as HTML, links, SQL, or spreadsheet formulas
- logs never contain email, payload, token, cookie, or secret
- old database remains available until replacement is healthy and migration is complete
- deletion claims match backup retention

## Availability and operations

Routes:

- `GET /healthz` confirms process liveness
- `GET /readyz` runs bounded SQLite `SELECT 1`

Structured logs contain request ID, route class, status, duration, and safe form ID when needed.

Operational commands:

```text
bun run migrate
bun run backup
bun run restore -- <backup>
bun run admin:stats
bun ship          # vendored self-updating deploy script (excluded from tsconfig)
```

Backups use SQLite online backup API or safe checkpoint/copy flow, leave host encrypted, follow configured retention, and receive quarterly restore tests. Restore into blank volume is release requirement.

Compose binds service to loopback, mounts named volume at `/data`, runs health check, and restarts on failure. CI runs tests, typecheck, dependency audit, and container build.

## Required proof

Automated tests cover:

- cross-account form and submission access
- guessed IDs and missing ownership conditions
- magic-link expiry, replay, scanner GET, and concurrent consume
- session expiry, rotation, and revocation
- CSRF, origin, and CORS behavior
- stored XSS and malicious field names
- CSV formula injection and escaping
- body, field, value, and repetition limits
- honeypot success-without-store behavior
- open redirect attempts
- authorized deletion and cascade
- malformed persisted payloads failing safely

Deployment proof covers empty-volume startup, repeat migration, restart persistence, image rollback compatibility, backup, and restore.

## Accepted risks

- **In-memory rate limiting:** counters reset on restart and do not share state across replicas. Accepted for the single-container deployment; limiter trips emit `event: "rate_limited"` logs for abuse forensics. Revisit with a SQLite-backed limiter when running more than one replica or on observed abuse.
- **Fixed session tokens:** session tokens live 24h (30d when remembered) without rotation. Mitigations: hashed at rest, revocable per device and in bulk from the account page, cleaned up after expiry.

## Resolved decisions

1. **Rate-limit store:** in-process sliding-window counters (`WindowLimiter` in `src/submissions.ts`): 60 requests/min per form+source key, plus a per-source pivot cap (20 distinct forms/min). Counters reset on restart; acceptable for single replica.
2. **Privacy-safe fingerprint:** HMAC-SHA256 keyed by `SESSION_SECRET` over `formId:source:UTC-date`; source is forwarded client IP when trusted proxy is loopback, else peer address or user agent. Day component rotates keys daily; no raw IP is stored.
3. **CSV header discovery:** two-pass prepared-statement iteration: first pass collects header union, second streams rows through `ReadableStream`. No full payload set in memory.

## Unknowns

Resolve before affected phase starts:

1. **Hosted topology:** persistent-volume path, proxy trust configuration, deployment health gate, rollback rules, and backup destination.
2. **Backup mechanism:** Bun SQLite online backup support versus explicit WAL checkpoint and copy procedure.
3. **Policy configuration:** Terms version, policy URLs, hosting location, backup retention, subprocessors, and abuse contact.
4. **Turnstile scope:** account-entry only for MVP (configured via `TURNSTILE_SITE_KEY`; unset in production today); per-form challenge deferred.
5. **Migration compatibility:** rollback policy once schema changes stop being backward compatible.
