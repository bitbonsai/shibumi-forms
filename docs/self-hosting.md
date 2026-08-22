# Self-hosting

The compose file binds to `127.0.0.1:9001`; put your TLS reverse proxy in front.

## Quick start

```sh
git clone https://github.com/bitbonsai/shibumi-forms.git
cd shibumi-forms
cp .env.example .env.production   # fill in every value
docker compose up --build -d      # or podman compose
```

Startup validates the whole configuration and names the missing field, so a bad deploy fails fast instead of half-working.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | HTTPS origin the app is served from |
| `DATABASE_PATH` | SQLite file location (volume-mounted at `/data`) |
| `SESSION_SECRET` | 32+ bytes, generate with `openssl rand -base64 48` |
| `EMAIL_PROVIDER` | `resend` in production, `discard` for development |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend delivers the sign-in links |
| `TERMS_URL`, `PRIVACY_URL`, `TERMS_VERSION` | Your policy documents |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile on sign-in pages |
| `MAX_FORMS_PER_ACCOUNT` | Forms per account, default 10 |
| `MAX_SUBMISSIONS_PER_FORM` | Stored submissions per form, default 10,000 |
| `MAX_EMAILS_PER_DAY` | Global daily sign-in email budget, default 80 |
| `TRUSTED_PROXY` | `loopback` (default) trusts `X-Forwarded-For` from a local proxy; `none` never does |
| `BACKUP_RETENTION_DAYS` | Backup retention, default 30 |
| `PORT` | Listen port inside the container, default 3000 |

## The container

- Runs unprivileged with a read-only filesystem; only `/data` and `/tmp` are writable.
- `GET /healthz` answers process liveness, `GET /readyz` checks SQLite.
- Migrations run at startup before traffic is accepted.
- Expired sessions and stale magic links are cleaned on boot and every six hours.

## Reverse proxy

Terminate TLS in front (Caddy, nginx, Traefik) and forward to the loopback port. With `TRUSTED_PROXY=loopback` the app reads the client IP from `X-Forwarded-For` only when the request arrives from loopback, which keeps IP-keyed rate limits honest.
