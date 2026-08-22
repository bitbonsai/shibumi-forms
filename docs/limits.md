# Limits

The hosted service enforces quotas so its email and storage budgets survive being free. Self-hosted instances tune all of them through [environment variables](/docs/self-hosting).

## Quotas

| Limit | Hosted default |
| --- | --- |
| Forms per account | 10 |
| Stored submissions per form | 10,000 |
| Submissions per minute per form | 60 |
| Sign-in emails | Rate limited per address, per requester, and per day |

## What happens at the limit

- A full inbox rejects new posts with `429` until you export a CSV and delete submissions. The dashboard shows an inbox-full notice.
- Creating a form past the account cap returns `429`.
- Rate-limited submissions return `429` without being stored; senders can retry after a minute.
- Abuse patterns across many forms from one source are limited independently, so one noisy sender cannot starve everyone else.

## Per-request limits

- 64 KiB body
- 64 named fields
- Field names up to 100 characters
- Values up to 10 KiB
- 20 repeats per field name
