# Plans

## Active

- [Hardening for free public launch](hardening.md): login CSRF fix, per-account quotas, Turnstile + email budget, rate-limiter rework, ops checks. Items 1–4 block public announcement.

## Planned

- Trim remaining hardcoded headers from alpha's `ensure-forms-caddy` script (X-Frame-Options, nosniff, HSTS) so the app owns all headers.
- Consider SES mailer (`EMAIL_PROVIDER=ses`, aws4fetch) if Resend's 100/day ceiling nears.

## Recently shipped

- 2026-08-21: account creation from sign-in link (unknown emails), styled magic-link emails, About page, hero copy rework, check-email redesign, GitHub nav icon, MIT footer.
- 2026-08-20: submission notes (migration 003), page-numbered pagination (12/page, in-place swap), Catppuccin stroke glyphs, lucide icons, type scale, Referrer-Policy CSRF fix, delete-account rebuild.
- 2026-08-19: admin workspace + form setup refinement (pre-session).

Reference docs: PITCH.md, EXPERIENCE.md, ARCHITECTURE.md, implementation.md
