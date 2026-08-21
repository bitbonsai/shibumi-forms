# Project invariants

- Magic-link GET never consumes token.
- Store only hashes of magic-link and session tokens.
- Every admin data query includes authenticated `user_id` ownership.
- Never fetch user-supplied page URLs server-side.
- Never log email, submission payload, token, cookie, or secret.
- Render submission values as inert text.
- Redirect only to stored same-origin success URL.
- Preserve SQLite volume across deploy and rollback.
- Keep deletion copy aligned with backup retention.

Run `bun run typecheck && bun test && bun audit` after changes.

## Gotchas

- `Referrer-Policy: no-referrer` makes Chrome send `Origin: null` on same-origin form POSTs; breaks `sameOrigin()` CSRF check. Keep `same-origin` in security.ts.
- Alpha server `~/.local/bin/ensure-forms-caddy` (systemd user timer `forms-caddy-route`) hardcodes Caddy vhost headers for forms.shibumistack.dev; proxy overrides app headers. Edit script + `FORCE=1 ~/.local/bin/ensure-forms-caddy` to reload. Referrer-Policy removed; X-Frame-Options/nosniff/HSTS still hardcoded there.
- CSS mask icons need BOTH `public/assets/icons/<name>.svg` AND `.icon-<name> { mask-image: url(...) }` in styles.css; missing rule renders a solid box (happened twice: copy, send).
- Compose interpolation (`${SHIBUMI_PORT:-9001}`) reads `.env` only. Container app env comes from `.env.production`, falling back to `.env` (ship deploys keep secrets in `.env` on the server).
- `scripts/ship.ts` is vendored and self-updating; excluded from tsconfig (fails strict). Commit its self-update bump after `bun ship`.
- New migrations: tests use column-named INSERTs and derive migration count from the `migrations/` dir; keep both patterns.
