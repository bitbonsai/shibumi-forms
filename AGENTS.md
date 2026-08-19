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
