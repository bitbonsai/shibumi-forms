# Shibumi Forms experience

## Feel

Calm, direct, and operational. Shibumi Forms should feel like a small dependable tool attached to the user's site, not a marketing dashboard.

- warm neutral field with persimmon accent
- restrained typography and compact spacing
- dense, readable data where density helps
- plain language around security, retention, and deletion
- minimal motion, with reduced-motion support
- clear hierarchy without decorative dashboard chrome

Success should feel uneventful. User knows what happened, where data went, and what to do next.

## Principles

### Plain HTML first

Primary integration is normal HTML `action` and `method`. It must work without client JavaScript. `fetch` and JSON are secondary options.

### One obvious next step

Each screen leads to one main action: check email, confirm sign-in, copy endpoint, inspect submission, or confirm deletion. Avoid competing calls to action.

### Explain consequences before commitment

Terms, sensitive-data limits, session duration, and deletion impact appear before user commits. Destructive actions state exact scope and backup retention.

### Data stays legible

Render captured values as text. Preserve newlines and repeated values. Never linkify or execute untrusted input. Tables may truncate visually, but detail view and exports retain full values.

### Safe defaults stay quiet

Security should shape behavior without burdening normal use: exact-origin redirects, narrow CORS, scanner-safe magic links, hashed tokens, CSRF protection, and bounded requests.

### Accessibility is part of completion

Every task has full keyboard path, visible focus, explicit labels, semantic controls, announced status, and mobile equivalent. Color never carries meaning alone.

## Core journeys

### 1. Register first form

Entry screen asks for:

- page URL
- account email
- Terms acknowledgement (short form: "I agree to the Terms.")

The sensitive-data warning and full responsibility clause appear on the create-account confirmation screen, before the commit button:

> Do not collect passwords, card details, health information, government identifiers, or other highly sensitive data.

Submission always returns neutral response:

> Check your email. If the address can receive a sign-in link, it should arrive shortly.

Email link opens confirmation screen but does not consume token. User explicitly confirms with optional `Keep me signed in for 30 days on this device`. Successful POST signs user in, creates first form when needed, then opens setup screen.

Signing in with an unknown email sends a create-account link instead of failing; the confirmation screen then collects Terms acceptance. The response stays neutral either way.

### 2. Connect static page

Setup screen shows:

- form name and registered page URL
- public endpoint
- copy button
- complete HTML snippet
- short note explaining accepted named text fields

Primary snippet:

```html
<form action="https://forms.shibumistack.dev/f/<public-id>" method="post">
  <label>
    Email
    <input type="email" name="email" required>
  </label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Notify me</button>
</form>
```

Copy action reports success through live region. Documentation must keep honeypot name and server configuration aligned.

### 3. Review submissions

Form page puts operational context first:

- form name and page URL
- active state
- endpoint and snippet
- CSV export
- paginated submissions

Table behavior:

- timestamp is first column
- dynamic columns come from union of current page fields
- columns retain first-seen order, capped at 6 visible
- long values truncate visually only
- rows with a saved note carry a note marker
- row opens complete detail dialog
- pages hold 12 submissions with a numbered `‹ N of M ›` pager; page swaps happen in place
- narrow screens use card representation instead of squeezed table

Detail dialog includes timestamp, submission ID, every key/value, arrays, preserved newlines, copy action per value, an editable owner note, and delete action. Escape closes dialog and focus returns to originating row.

### 4. Manage forms and account

Home lists forms with page URL, hostname, submission count, and latest submission time. User can create another form, disable an endpoint, manage active sessions, or open account deletion.

Destructive confirmations:

- submission: state loss and effect on CSV
- form: show name, submission count, endpoint impact, and require typed form name or hostname
- account: show exact form, submission, and session counts, then require account email

Hosted deletion copy must say:

> Deleted records may remain in encrypted backups for up to <retention> days before automatic expiration.

## States

### Empty

- no forms: explain page registration and offer `Create form`
- no submissions: show endpoint and snippet again, then explain that new posts appear here

### Loading

Server-rendered navigation should usually avoid skeletons. For enhanced actions, keep control disabled only while request is pending and announce progress.

### Success

Use short status tied to action: `Endpoint copied`, `Form disabled`, `Submission deleted`. Return focus to stable nearby control after DOM changes.

### Error

Name field and recovery action. Preserve safe user input. Never expose stack traces, account existence, provider details, SQL errors, or rejected submission data.

### Expired or used link

Explain that link cannot be used and provide direct action to request another. Do not reveal whether account exists.

## Content rules

- use familiar words: form, submission, endpoint, sign-in link
- put action first in buttons: `Copy endpoint`, `Export CSV`, `Delete form`
- include exact counts in irreversible confirmations
- distinguish disabling from deleting
- call stored records `submissions`, not leads or responses
- avoid claims of immediate physical deletion while backups retain records

## Responsive and accessible acceptance

- all inputs have programmatic labels and field-specific errors
- complete registration, integration, inspection, export, and deletion paths work by keyboard
- focus order follows visible order
- native `<dialog>` has labelled title, Escape support, initial focus, and focus return
- table headers map correctly to cells; card alternative exposes same data
- status uses live region without stealing focus
- zoom to 200% does not hide actions or values
- reduced motion removes nonessential transitions
- CLI tools honor `NO_COLOR`
