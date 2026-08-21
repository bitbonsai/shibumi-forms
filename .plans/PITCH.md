# Shibumi Forms

## Why

Static sites are easy to publish and awkward to make interactive. A contact form, waitlist, or survey usually forces its owner to adopt a hosted form builder, run a larger application stack, or send visitor data through a service they do not control.

Form collection should fit the site it serves:

- plain HTML works without client JavaScript
- setup takes one endpoint and a small form snippet
- operators can inspect, export, and delete their own data
- self-hosting uses one container and one durable file
- hosted and self-hosted versions share the same open-source core

The main users are independent makers and small teams publishing static sites. They need reliable collection, not a form builder or marketing platform.

## What

Shibumi Forms is open-source form collection for static sites. One container, one SQLite database, passwordless administration.

A user registers a page URL and email, confirms a magic link, and receives a public endpoint. Any HTML form with named fields can post to it. Shibumi Forms stores the submission and returns the visitor to the registered site. The owner sees submissions in a dynamic table, opens complete details, exports CSV, or permanently deletes data.

Two ways to run it:

- hosted at `https://forms.shibumistack.dev`
- self-hosted with Docker or Podman Compose

Core promise:

> Create a form endpoint in minutes. Keep the page simple and the data under operator control.

MVP includes:

- multiple forms and domains per account
- email magic-link authentication, including account creation from a sign-in attempt with an unknown email
- arbitrary text fields and repeated values
- standard HTML posts plus approved-origin `fetch` requests
- paginated submission table and detail dialog
- per-submission owner notes
- CSV export
- submission, form, session, and account deletion
- documented backup and restore

MVP excludes file uploads, a form builder, teams, webhooks, notification emails, conditional logic, analytics, and custom service domains.

## Definition of done

Product is ready when:

1. New user can enter page URL and email, accept terms, confirm a scanner-safe magic link, and receive an endpoint plus working HTML snippet.
2. Static fixture can submit arbitrary named text fields without JavaScript and return to its registered same-origin success URL.
3. Approved-origin JavaScript client can submit JSON and receive `202 { "ok": true }` with narrow CORS headers.
4. Owner can use keyboard alone to browse paginated submissions, inspect every value, copy data, export safe CSV, and delete records.
5. Account boundaries hold under cross-tenant access, guessed IDs, CSRF, stored XSS, SQL injection, open redirect, and magic-link replay tests.
6. One-container deployment starts from empty durable volume, migrates once, survives restart, and preserves data across image replacement.
7. Backup from production-shaped SQLite can restore into blank instance and reproduce accounts, forms, and submissions.
8. Logs, metrics, and errors contain no submission payloads, email addresses, tokens, cookies, or secrets.
9. Hosted Terms and Privacy text accurately covers data roles, subprocessors, retention, backups, deletion, and abuse reporting after legal review.
10. Hosted instance completes registration, submission, inspection, CSV export, deletion, backup, and restore end to end.
