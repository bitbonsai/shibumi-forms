# Security and data handling

Shibumi Forms stores as little as it can and keeps what it stores inert. Each account is walled off from the others at the query level.

## Authentication

- Passwordless magic links, valid for 15 minutes, consumed exactly once by an explicit confirmation click. Link scanners that prefetch URLs cannot consume them.
- Magic-link and session tokens are stored as SHA-256 hashes. A database copy contains no usable credentials.
- Sessions last 24 hours, or 30 days when you choose to be remembered. Every device can be revoked from the account page.
- Account deletion requires a fresh confirmation link sent to your email; a stolen session alone cannot destroy an account.

## Submission handling

- Values are stored as JSON strings and rendered as inert text. Nothing submitted can execute in the dashboard.
- CSV export escapes spreadsheet formula injection.
- Every admin query includes the authenticated account, so one tenant can never read another's data.
- Admin mutations require CSRF tokens and same-origin requests; the public endpoint pins CORS to your registered origin.

## Logging

Logs contain request IDs, route classes, status codes, and durations. They never contain emails, submission payloads, tokens, cookies, or secrets.

## Deletion

You can delete individual submissions, whole forms, or your account at any time. Deleted records may persist in encrypted backups for up to 30 days before expiring.

## Reporting

Found a vulnerability or abusive form? [security.txt](/.well-known/security.txt) has the contact, or write to <info@shibumistack.dev>.
