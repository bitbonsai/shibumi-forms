# Hardening plan: free public launch

Source: security analysis 2026-08-21. Findings ranked by launch risk. Each item: fix, files, tests.

Order matters: 1–4 block public announcement; 5–7 before scaling past single container; 8–10 when convenient.

## 1. Login CSRF on /auth/confirm POST (HIGH)

Cross-site form POST with attacker's token logs victim in as attacker.

- Add `sameOrigin(config, origin, sec-fetch-site)` check to `POST /auth/confirm`; 403 on mismatch.
- Keep behavior: no-Origin + non-cross-site Sec-Fetch-Site still allowed (matches admin mutation pattern).
- Files: `src/auth.ts`.
- Test: POST /auth/confirm with `Origin: https://evil.example` → 403; valid same-origin → session created.

## 2. Per-account quotas (HIGH, storage DoS)

Current: 60 submissions/min/form, 64KB body, no caps on count or size.

- Migration 004: no schema change needed if caps enforced in code; counts via `count(submissions.id)`.
- Caps (configurable via env, defaults):
  - `MAX_FORMS_PER_ACCOUNT` = 10 → reject `/admin/forms/create` and registration-with-page over cap.
  - `MAX_SUBMISSIONS_PER_FORM` = 10_000 → reject new submissions over cap with 429 + flag in dashboard ("inbox full").
  - Retention is owner-managed (export CSV + delete exists); no auto-delete.
- Files: `src/config.ts`, `src/auth.ts` (create), `src/submissions.ts` (POST /f), `src/views.ts` (full-inbox notice).
- Tests: create 11th form → 400/429; submission 10_001 → 429, not stored.

## 3. Email quota protection (HIGH, cost drain)

Resend free = 100/day. Per-IP cap 20/day is not enough vs rotating IPs.

- Turn on Turnstile in production (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` in `.env.production`). Code already supports it; verify widget renders on register + login and CSP allows Cloudflare.
- Global daily email budget: `MAX_EMAILS_PER_DAY` = 80 (config). Count sends in DB or in-memory; over budget → render check-email view anyway (no enumeration) but skip send, log `email_budget_exceeded`.
- Files: `src/config.ts`, `src/auth.ts` (`/auth/magic-link`), deploy `.env.production`.
- Tests: budget 0 → no send, same 200 view; Turnstile secret set + missing token → 400 error view.

## 4. Shared-fate global submission bucket (HIGH)

`limiter.allows("global", 1000, 60_000)` lets one attacker starve all forms.

- Remove global key, or raise to 10_000/min and add per-source cross-form cap: same source hitting N distinct public_ids/min → 429 (pivot detection).
- Files: `src/submissions.ts` (`requestKey`, POST /f).
- Tests: 61st request/min per form → 429; one source across 20 forms → 429 without touching other sources.

## 5. Durable rate limiting (MEDIUM)

In-memory limiters reset on restart and break across replicas.

- Single container for now: accept resets, add structured log on limiter trip (`event: "rate_limited", route class`) for abuse forensics.
- Defer SQLite-backed limiter until multi-replica or observed abuse. Note in ARCHITECTURE.md.
- Files: `src/auth.ts`, `src/submissions.ts` (logging only).

## 6. Verify network isolation on alpha (MEDIUM, ops)

XFF spoofing bypasses all IP-keyed limits if app port is reachable directly.

- Check compose: app port must bind `127.0.0.1:9001`, not `0.0.0.0`. Confirm Caddy is the only ingress.
- Probe from outside: `curl http://<alpha-ip>:9001/healthz` must fail.
- Files: `docker-compose.yml` (or compose file used by ship), no code change.

## 7. Expired-row cleanup (MEDIUM)

`magic_links` and `sessions` grow forever.

- On boot + every 6h: `DELETE FROM magic_links WHERE expires_at < ?`, `DELETE FROM sessions WHERE expires_at < ?`. `setInterval` in `src/index.ts`, unref'd; reuse in tests.
- Files: `src/index.ts` (or `src/database.ts` helper), tests.

## 8. Re-auth for destructive actions (LOW)

Stolen session can delete account today (typed email only).

- Account deletion: send confirmation magic link (`purpose: "delete"` variant or one-time flag); click + confirm executes. Keep typed-email gate as first step.
- Revoke-others: keep as-is (low blast radius).
- Files: `src/auth.ts`, `src/views.ts`, `src/email.ts` (new variant), migration if storing purpose extension.
- Tests: deletion without fresh link → no-op; with link → cascades.

## 9. Abuse channel (LOW, launch hygiene)

Anonymous-write endpoints attract spam-form abuse reports.

- Add `public/.well-known/security.txt` (contact, expiry) and abuse contact line on About page + footer.
- Files: `public/.well-known/security.txt`, `src/views.ts`, `src/app.ts` (serve if needed).

## 10. Session rotation note (LOW)

- Document accepted risk (24h/30d fixed tokens, revocable via UI) in ARCHITECTURE.md. No code change.

## Verification

After each item: `bun run typecheck && bun test && bun audit`. Suite currently 24 tests; add per-item tests above. Deploy with `bun ship`, commit ship.ts self-update bump if it appears.

## Done when

- [x] Login CSRF closed (test proves cross-origin confirm POST 403s)
- [x] Quotas enforced + dashboard full-state copy
- [x] Turnstile live on alpha (verified: widget renders, tokenless POST 400s), email budget enforced
- [x] Alpha port probe from outside fails (91.99.125.239:9105 unreachable)
- [x] Global bucket replaced with per-source pivot cap
- [x] Cleanup job running (boot log: {"event":"cleanup",...} verified on alpha)
- [x] security.txt + abuse contact live (200 at /.well-known/security.txt, links on about + footer)
- [x] Account deletion requires emailed confirmation link (migration 004)
- [x] rate_limited logging + accepted-risk notes in ARCHITECTURE.md
