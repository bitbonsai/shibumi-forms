# shibumi-forms implementation plan

## Product

Open-source form collection for static sites. One container, one SQLite database, passwordless administration.

Hosted instance: `https://forms.shibumistack.dev`

Primary flow:

1. User enters page URL and account email.
2. Service sends one-time magic link.
3. User confirms link and reaches admin dashboard.
4. Dashboard provides public form endpoint and integration snippet.
5. Static page submits any named fields.
6. Dashboard shows submissions in dynamic table.
7. Clicking row opens complete details in accessible dialog.
8. User exports CSV or permanently deletes data.

## MVP boundaries

Included:

- Multiple forms and domains per account
- Email-only magic-link authentication
- Dynamic text fields
- Standard HTML form posts and JavaScript `fetch`
- Submission table, detail dialog, pagination, CSV export
- Submission, form, account, and session deletion
- SQLite persistence and backup documentation
- Hosted and self-hosted operation

Excluded initially:

- File uploads
- Form builder
- Submission notification emails
- Teams and roles
- Outbound webhooks
- Conditional logic
- Analytics
- Custom domains for service endpoint
- Password authentication
- Sensitive-data compliance products

## Stack

- Bun
- Hono
- `bun:sqlite`
- Server-rendered HTML
- Small vanilla JavaScript modules
- Plain CSS using Shibumi visual tokens
- SQLite WAL on local persistent volume
- Transactional email adapter for magic links
- Optional Cloudflare Turnstile on account-entry endpoints
- Docker/Podman Compose
- Shibumi deployment

No client framework. No ORM unless schema complexity proves raw prepared statements insufficient.

## Repository shape

```text
shibumi-forms/
  .github/workflows/ci.yml
  .plans/
  migrations/
    001_initial.sql
  public/
    admin.js
    styles.css
  scripts/
    backup.ts
    migrate.ts
  src/
    app.ts
    auth.ts
    config.ts
    database.ts
    email.ts
    forms.ts
    security.ts
    submissions.ts
    views.ts
  test/
  compose.yaml
  Dockerfile
  .dockerignore
  .env.example
  AGENTS.md
  LICENSE
  README.md
  SECURITY.md
  package.json
  bun.lock
  tsconfig.json
```

## Configuration

Validate all environment at startup. Fail with field-specific messages.

```dotenv
PORT=3000
PUBLIC_URL=https://forms.example.com
DATABASE_PATH=/data/shibumi-forms.sqlite
SESSION_SECRET=<32+ random bytes>
EMAIL_FROM=forms@example.com
EMAIL_PROVIDER=resend
RESEND_API_KEY=<secret>
TURNSTILE_SITE_KEY=<optional>
TURNSTILE_SECRET_KEY=<optional>
TRUSTED_PROXY=loopback
TERMS_URL=https://example.com/terms
PRIVACY_URL=https://example.com/privacy
BACKUP_RETENTION_DAYS=30
```

Production requires HTTPS through reverse proxy. Application listens on `0.0.0.0:${PORT}`. Trust forwarded client data only from configured loopback proxy.

## Database

Use migrations tracked in Git. Run migrations before server starts. Use foreign keys, WAL, busy timeout, and explicit transactions.

### `users`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  accepted_terms_at TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### `magic_links`

```sql
CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  pending_page_url TEXT,
  terms_version TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
```

Store only token hash. Keep one active token per email and purpose. Expire after 15 minutes. Remove expired rows regularly.

### `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
```

Default session: 24 hours. Remembered session: 30 days. Do not silently extend beyond selected duration.

### `forms`

```sql
CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_url TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  success_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Do not fetch registered page server-side. This avoids SSRF. Derive exact HTTPS origin from validated page URL. Public form ID is random and unguessable but is not treated as secret.

### `submissions`

```sql
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX submissions_form_created
  ON submissions(form_id, created_at DESC);
```

Store field values as strings or arrays of strings. Do not create dynamic SQL columns.

### Optional abuse counters

Use bounded expiring counters. Never store raw IP addresses. If IP-based limiting is needed, store daily rotating HMAC values and delete expired counters.

## Authentication

### Request magic link

`POST /auth/magic-link`

Inputs:

- email
- optional page URL during registration
- required Terms acknowledgement during registration
- Turnstile token when configured

Behavior:

- Normalize email for comparison while retaining entered display value.
- Validate page URL as public HTTPS URL in production.
- Return same response for existing and new accounts.
- Rate-limit by normalized email and privacy-safe request fingerprint.
- Invalidate prior unused token for same email/purpose.
- Generate 32-byte random token.
- Store SHA-256 token hash.
- Send link without logging token or recipient.

Response:

> Check your email. If the address can receive a sign-in link, it should arrive shortly.

### Consume magic link safely

Email scanners often open links. Never consume token on GET.

- `GET /auth/confirm?token=...` validates token and renders confirmation page.
- `POST /auth/confirm` consumes token in transaction and creates session.
- Confirmation page includes checkbox: `Keep me signed in for 30 days on this device`.
- Unchecked creates 24-hour server session and session cookie.
- Checked creates persistent 30-day cookie and session.
- Rotate session token on login.

Cookie:

```text
__Host-shibumi_forms_session
HttpOnly
Secure
SameSite=Lax
Path=/
```

Use opaque 32-byte random value. Store only hash. No JWT.

### Session actions

- Log out current session
- View active sessions with created/last-used time and coarse device label
- Revoke one session
- Revoke all other sessions

State-changing requests require same-origin validation and CSRF token.

## Registration disclaimer

Required checkbox:

> I agree to the Terms and acknowledge that I am responsible for collecting and using submission data lawfully.

Supporting copy:

> You must provide required privacy notices and obtain any necessary consent from visitors. Do not collect passwords, payment card details, health information, government identifiers, or other highly sensitive data. You are responsible for data you export, share, retain, or use.

Terms and Privacy links come from environment configuration. Hosted policy must describe controller/processor roles, subprocessors, hosting location, retention, backups, deletion, and abuse reporting. Legal text requires legal review before public hosted launch.

## Form registration

Registration input:

- Page URL
- Account email
- Terms acknowledgement

After magic-link confirmation:

- Create user if absent.
- Create form from pending page URL.
- Derive form name from hostname/path, editable later.
- Derive allowed origin and default success URL.
- Show endpoint and integration snippet.

HTML integration:

```html
<form action="https://forms.shibumistack.dev/f/<public-id>" method="post">
  <label>
    Email
    <input type="email" name="email" required>
  </label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Notify me</button>
</form>
```

Honeypot field name must be configurable or generated so documentation and server agree. Hide it accessibly without preventing bot autofill.

JavaScript `fetch` integration is secondary. Standard HTML must work without JavaScript.

## Submission endpoint

`POST /f/:publicId`

Accepted content types:

- `application/x-www-form-urlencoded`
- `multipart/form-data` without files
- `application/json` for approved CORS origins

Limits:

- 64 KiB body
- 64 fields
- 100 characters per field name
- 10 KiB per field value
- 20 values per repeated field
- No files
- No nested objects initially

Rules:

- Reject inactive or unknown form with generic `404`.
- Parse all named fields as text or text arrays.
- Strip reserved internal fields before storage.
- Reject control characters in field names.
- Preserve newlines in values.
- Never render captured HTML.
- If honeypot is populated, return normal success without storing.
- Apply bounded per-form and privacy-safe request rate limits.
- Check browser `Origin` when present. Origin is abuse signal, not authentication.
- Optionally require Turnstile per form after host-management design is proven.
- Insert submission transactionally.

Response negotiation:

- Standard HTML form: `303` to registered same-origin success URL.
- JSON/fetch: `202 { "ok": true }` with exact CORS origin.
- Never accept arbitrary redirect target from request.

Do not deduplicate arbitrary submissions. Waitlist users can deduplicate later by email through form-specific option if real use requires it.

## Admin dashboard

### Home

- Account email
- Forms list
- Page URL and hostname
- Submission count
- Latest submission time
- Create form
- Account/session menu

### Form page

- Form name and page URL
- Endpoint and copy button
- HTML snippet
- Active/inactive state
- Paginated submissions table
- CSV download
- Form settings
- Delete form

### Dynamic table

- Timestamp first
- Build columns from union of fields in current page
- Keep stable first-seen order
- Cap visible dynamic columns; place remaining values in `More`
- Display values as text only
- Truncate long values visually without mutating stored value
- Keyboard-accessible rows
- Responsive card representation on narrow screens

### Submission dialog

- Native `<dialog>` with labelled title
- Focus management and Escape support
- Timestamp and submission ID
- Every key/value, preserving arrays and newlines
- Copy individual value
- Delete submission
- No automatic linkification of untrusted values

### Pagination

Use cursor based on `(created_at, id)`. Default 50 rows. Avoid unbounded table and CSV browser memory.

## CSV export

`GET /admin/forms/:id/submissions.csv`

- Auth and ownership required
- Stream response
- Stable header union across export
- UTF-8
- Correct quote/newline escaping
- Include submission ID and timestamp
- Prefix values beginning with `=`, `+`, `-`, or `@` to prevent spreadsheet formula injection
- `Content-Disposition` with safe form filename
- Never include internal abuse metadata

## Deletion

### Submission

Copy:

> Delete this submission? It will disappear from the dashboard and CSV exports. Shibumi Forms cannot restore it.

Require explicit confirmation. Delete in transaction.

### Form

Copy:

> Delete “<form>”? This permanently deletes <count> submissions and disables its endpoint. Existing forms will stop working.

Require typing form name or page hostname. Delete form and submissions in transaction. Endpoint returns `404` afterward.

### Account

List exact number of forms, submissions, and sessions. Require typing account email. Revoke sessions and delete owned data in one transaction.

Hosted copy must disclose backup retention accurately:

> Deleted records may remain in encrypted backups for up to <retention> days before automatic expiration.

Do not claim immediate physical deletion while backups retain records.

## Spam and abuse

MVP layers:

1. Body and field limits
2. Honeypot
3. Exact configured CORS response
4. Origin checks when browser provides it
5. Per-form request rate limits
6. Global circuit breaker
7. Turnstile for registration/login on hosted instance
8. Form deactivate action

Admin should see submission counts, not raw IPs. Add abuse-report contact. Do not build content classification initially.

## Security requirements

- Tenant ownership condition on every admin query
- Prepared statements only
- Output escaping and text-only rendering
- CSRF protection on all authenticated mutations
- Magic tokens and sessions stored hashed
- Constant-time token comparisons where applicable
- Generic auth responses to prevent email enumeration
- Strict security headers
- Narrow CORS per form
- No open redirects
- No server-side page fetching
- No raw submission bodies in logs
- No emails, payloads, tokens, cookies, or secrets in logs
- Request IDs safe to share
- Mode-`0600` database and backups
- Container runs as unprivileged user
- SQLite directory writable, application filesystem otherwise read-only where practical
- Dependency audit in CI

Required tests:

- Cross-account form/submission access
- ID guessing
- Magic-link expiry, replay, scanner GET, and race
- Session expiry and revocation
- CSRF and CORS
- Stored XSS payloads
- CSV formula injection
- SQL injection field names/values
- Oversized bodies and repeated fields
- Honeypot behavior
- Open redirect attempts
- Delete authorization and cascade
- Malformed SQLite rows fail safely

## Email delivery

Define small interface:

```ts
interface Mailer {
  sendMagicLink(input: { to: string; confirmUrl: string; expiresMinutes: number }): Promise<void>;
}
```

Implement Resend as production provider and one test transport. Provider errors return generic user response but log safe request ID and provider status. Do not log recipient or URL token. Use idempotency key based on magic-link record ID when provider supports it.

Email content:

- Shibumi Forms brand
- Requested hostname, if registration
- Expiry time
- Confirm button and plain URL
- Warning if user did not request link
- No marketing content

## Health and operations

Routes:

- `GET /healthz`: process alive
- `GET /readyz`: bounded SQLite `SELECT 1`, no sensitive detail

Structured logs:

- request ID
- route class
- response status
- duration
- form ID only when safe
- no personal fields

Admin CLI or scripts:

```text
bun run migrate
bun run backup
bun run restore -- <backup>
bun run admin:stats
```

Backups:

- Use SQLite online backup API or safe checkpoint/copy procedure
- Encrypt off-host
- Daily schedule
- Retention from config
- Quarterly restore test
- Document named-volume location without hardcoding production path

## Container and Compose

Use pinned Bun Alpine image. Install production dependencies with frozen lockfile and ignored lifecycle scripts. Run unprivileged.

```yaml
services:
  app:
    build: .
    restart: always
    ports:
      - "127.0.0.1:${SHIBUMI_PORT:-9001}:3000"
    environment:
      PORT: 3000
      DATABASE_PATH: /data/shibumi-forms.sqlite
    env_file:
      - .env
    volumes:
      - forms-data:/data
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  forms-data:
```

Production secrets stay outside Git. Shibumi deploy/rollback replaces image while preserving named volume.

## Open-source repository

- MIT license
- Generic domains only in tracked examples
- `SECURITY.md` with private reporting route and supported versions
- Self-host guide
- Hosted-service distinction
- Threat model
- Backup/restore guide
- Privacy/operator responsibilities guide
- No production database, backups, account emails, API keys, Turnstile secrets, session secrets, or real host config

README positioning:

> Open-source form collection for static sites. One container, one SQLite database, passwordless administration.

## Visual and UX direction

Use Shibumi visual language: warm neutral field, persimmon accent, restrained typography, dense readable data table. Admin should feel operational and calm rather than like marketing dashboard.

Accessibility:

- Labels for every input
- Visible focus
- Full keyboard path
- Native dialog semantics
- Focus return after close
- Table headers and responsive alternative
- Status announced through live region
- Reduced-motion support
- `NO_COLOR` for CLI scripts
- Error text independent of color

## Implementation phases

### Phase 1: foundation

- Initialize Bun/Hono/TypeScript project
- Add config validation
- Add SQLite connection and migration runner
- Add security headers, request IDs, error boundary
- Add health/readiness
- Add Dockerfile, Compose, persistent volume
- Add CI tests, typecheck, audit, container build

Acceptance: container starts with empty volume, migrates once, restarts without changing data, health checks pass.

### Phase 2: magic-link auth

- Registration/login page
- Terms acknowledgement
- Magic-link creation and email interface
- Scanner-safe GET plus POST confirmation
- 24-hour and optional 30-day sessions
- Logout and session revocation
- Rate limiting and optional Turnstile

Acceptance: login, replay, expiry, scanner, enumeration, CSRF, and cross-session tests pass.

### Phase 3: forms and submissions

- Form creation after registration
- Form list/settings
- Public endpoint
- URL-encoded, multipart text, and JSON parsing
- Limits, honeypot, CORS, safe redirect
- Submission storage

Acceptance: static fixture page submits arbitrary named fields without JavaScript and returns to registered page.

### Phase 4: admin experience

- Paginated dynamic table
- Accessible row detail dialog
- Copy values
- Submission deletion
- Form disable/delete
- Account delete
- Session management

Acceptance: keyboard-only user can inspect and delete submission; tenant isolation tests cover every route.

### Phase 5: CSV and operations

- Streaming CSV export
- Formula-injection defense
- Backup/restore scripts
- Retention documentation
- Structured safe logs
- Admin stats

Acceptance: exported adversarial values open as text, restore reproduces accounts/forms/submissions, logs contain no personal data.

### Phase 6: hosted launch

- Deploy `forms.shibumistack.dev` through Shibumi
- Configure email provider and account-entry Turnstile
- Publish Terms and Privacy
- Run external security review
- Connect `shibumistack.dev` CLI notification dialog
- Test production registration, submission, CSV, deletion, backup, restore
- Add uptime and backup alerts

Acceptance: real static BusyBox site captures waitlist lead end to end; deletion and restore behavior match published policy.

## Launch checklist

- [ ] One external security review of tenant isolation and auth
- [ ] Legal review of hosted Terms and Privacy
- [ ] Production backup restored on blank host
- [ ] Magic-link email passes SPF, DKIM, DMARC, and major inbox tests
- [ ] Rate limits tested without storing raw IP
- [ ] Static no-JavaScript form tested
- [ ] Mobile and keyboard admin tested
- [ ] CSV tested in Excel, Numbers, and LibreOffice
- [ ] All destructive actions list impact and require explicit confirmation
- [ ] Hosted instance contains no default credentials
- [ ] Repository contains no production data or secrets
