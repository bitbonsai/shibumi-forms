# Shibumi Forms

Open-source form collection for static sites. One container, one SQLite database, passwordless administration.

> Pre-alpha. Core self-hosted flow exists: magic-link authentication, form ingestion, submission dashboard, CSV export, deletion, backup, and restore.

User docs (integration, JSON API, limits, self-hosting): <https://forms.shibumistack.dev/docs>, sources in `docs/`.

## Development

Requires Bun 1.3.14+.

```sh
bun install
cp .env.example .env
bun run migrate
bun run dev
```

Generate production session secret with:

```sh
openssl rand -base64 48
```

Checks:

```sh
bun run typecheck
bun test
bun audit
```

`EMAIL_PROVIDER=discard` builds UI and discards sign-in mail without logging recipient or token. To test full sign-in, set:

```dotenv
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=Shibumi Forms <forms@your-verified-domain.example>
```

Resend sends both plain text and HTML with idempotency key per magic-link record. Disable click and open tracking for transactional domain.

Public forms accept URL-encoded or multipart text fields and approved-origin JSON. Dashboard shows endpoint and integration snippet after sign-in.

Operations:

```sh
bun run backup -- ./backups
# Stop application before restore
bun run restore -- ./backups/<backup.sqlite>
bun run admin:stats
```

Backups use SQLite `VACUUM INTO`, mode `0600`, configured retention, and operator-managed off-host encryption.

Health endpoints:

- `GET /healthz`: process liveness
- `GET /readyz`: SQLite readiness

## Container

Set every value in `.env.production`, including HTTPS public and policy URLs, then run:

```sh
docker compose up --build -d
```

Service binds to `127.0.0.1:9001` by default. Put TLS reverse proxy in front. SQLite persists in `forms-data` volume.

## Configuration

See `.env.example`. Startup rejects missing fields, weak session secrets, missing Resend credentials, partial Turnstile configuration, invalid URLs, and non-HTTPS production URLs.

Never commit `.env`, `.env.production`, SQLite files, backups, API keys, or real account data.

## Plans

- `.plans/PITCH.md`
- `.plans/EXPERIENCE.md`
- `.plans/ARCHITECTURE.md`
- `.plans/implementation.md`

## License

MIT
