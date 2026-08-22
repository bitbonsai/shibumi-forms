# Plans

## Active

(none)

## Planned

- Trim remaining hardcoded headers from alpha's `ensure-forms-caddy` script (X-Frame-Options, nosniff, HSTS) so the app owns all headers.
- Consider SES mailer (`EMAIL_PROVIDER=ses`, aws4fetch) if Resend's 100/day ceiling nears.
- Reddit launch: posts ready in `reddit-launch.local.md` (gitignored); all hardening gates cleared.

## Recently shipped

- 2026-08-22: docs site (/docs, 7 md pages, sidebar/outline/pager, syntax highlighting, llms.txt + raw md), unslop copy pass, Dockerfile docs/ fix.
- 2026-08-21 pm: hardening 1-10 complete + deployed (login CSRF, quotas, email budget, pivot cap, cleanup job, delete re-auth, security.txt, Turnstile live).
- 2026-08-21 pm: brand logo rollout (header/hero/buttons/favicon/og), about page rebuild, form simplification, session-aware nav, stack popover, view transitions.
- 2026-08-21 am: account creation from sign-in link, styled magic-link emails, About page, hero copy rework, GitHub nav icon, MIT footer.
- 2026-08-20: submission notes (migration 003), pagination, Catppuccin glyphs, type scale, Referrer-Policy CSRF fix, delete-account rebuild.

Reference docs: PITCH.md, EXPERIENCE.md, ARCHITECTURE.md, implementation.md

Archived plans: .plans/.archive/
