import type { AppConfig } from "./config";

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(config: AppConfig, title: string, content: string): string {
  const turnstileScript = config.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Shibumi Forms</title>
  <link rel="stylesheet" href="/assets/styles.css">
  ${turnstileScript}
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Shibumi Forms home"><span aria-hidden="true">◉</span> Shibumi Forms</a>
  </header>
  <main>${content}</main>
  <footer>
    <span>Quiet infrastructure for static sites.</span>
    <nav aria-label="Policies"><a href="${escapeHtml(config.termsUrl.href)}">Terms</a><a href="${escapeHtml(config.privacyUrl.href)}">Privacy</a></nav>
  </footer>
</body>
</html>`;
}

function turnstile(config: AppConfig): string {
  return config.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(config.turnstileSiteKey)}"></div>`
    : "";
}

export function registrationView(config: AppConfig, input: { email?: string; pageUrl?: string; error?: string } = {}): string {
  const error = input.error ? `<p class="notice error" role="alert">${escapeHtml(input.error)}</p>` : "";
  return layout(config, "Connect your site", `<section class="auth-grid">
    <div class="intro">
      <p class="eyebrow">Static page, working form</p>
      <h1>Collect replies.<br>Keep things simple.</h1>
      <p class="lede">Add one endpoint to any HTML form. Review submissions in one calm, private place.</p>
      <div class="signal" aria-hidden="true"><span>your site</span><i></i><span>one database</span></div>
    </div>
    <div class="panel">
      <p class="step">01 / Connect</p>
      <h2>Create your first form</h2>
      ${error}
      <form action="/auth/magic-link" method="post">
        <input type="hidden" name="purpose" value="register">
        <label for="page_url">Page URL</label>
        <input id="page_url" name="page_url" type="url" inputmode="url" required autocomplete="url" placeholder="https://your-site.com/contact" value="${escapeHtml(input.pageUrl || "")}">
        <label for="email">Account email</label>
        <input id="email" name="email" type="email" inputmode="email" required autocomplete="email" placeholder="you@example.com" value="${escapeHtml(input.email || "")}">
        <label class="check"><input name="accepted_terms" type="checkbox" value="yes" required><span>I agree to the <a href="${escapeHtml(config.termsUrl.href)}">Terms</a> and accept responsibility for submission data.</span></label>
        <p class="fine-print">Do not collect passwords, card details, health information, government identifiers, or other highly sensitive data.</p>
        ${turnstile(config)}
        <button type="submit">Email my sign-in link <span aria-hidden="true">→</span></button>
      </form>
      <p class="alternate">Already have forms? <a href="/login">Sign in</a></p>
    </div>
  </section>`);
}

export function loginView(config: AppConfig, input: { email?: string; error?: string } = {}): string {
  const error = input.error ? `<p class="notice error" role="alert">${escapeHtml(input.error)}</p>` : "";
  return layout(config, "Sign in", `<section class="single-panel">
    <div class="panel">
      <p class="step">Welcome back</p>
      <h1>Sign in by email</h1>
      <p>We will send a one-time link. No password needed.</p>
      ${error}
      <form action="/auth/magic-link" method="post">
        <input type="hidden" name="purpose" value="login">
        <label for="email">Account email</label>
        <input id="email" name="email" type="email" inputmode="email" required autocomplete="email" value="${escapeHtml(input.email || "")}">
        ${turnstile(config)}
        <button type="submit">Email sign-in link <span aria-hidden="true">→</span></button>
      </form>
      <p class="alternate"><a href="/">Create your first form</a></p>
    </div>
  </section>`);
}

export function checkEmailView(config: AppConfig): string {
  return layout(config, "Check your email", `<section class="single-panel"><div class="panel result">
    <p class="step">02 / Verify</p>
    <div class="status-mark" aria-hidden="true">↗</div>
    <h1>Check your email</h1>
    <p>If the address can receive a sign-in link, it should arrive shortly. Link expires in 15 minutes.</p>
    <p class="alternate"><a href="/login">Try another address</a></p>
  </div></section>`);
}

export function confirmView(config: AppConfig, token: string, hostname?: string): string {
  const context = hostname ? ` for ${hostname}` : "";
  return layout(config, "Confirm sign-in", `<section class="single-panel"><div class="panel result">
    <p class="step">02 / Verify</p>
    <h1>Confirm sign-in${escapeHtml(context)}</h1>
    <p>This button signs you in. Link works once and expires after 15 minutes.</p>
    <form action="/auth/confirm" method="post">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label class="check"><input name="remember" type="checkbox" value="yes"><span>Keep me signed in for 30 days on this device</span></label>
      <button type="submit">Confirm and continue <span aria-hidden="true">→</span></button>
    </form>
  </div></section>`);
}

export function invalidLinkView(config: AppConfig): string {
  return layout(config, "Link unavailable", `<section class="single-panel"><div class="panel result">
    <p class="step">Link unavailable</p>
    <h1>Request a fresh link</h1>
    <p>This sign-in link expired or has already been used.</p>
    <p><a class="button-link" href="/login">Request another link <span aria-hidden="true">→</span></a></p>
  </div></section>`);
}

export type SessionView = { id: string; createdAt: string; lastSeenAt: string; deviceLabel: string; current: boolean };
export type FormSummary = { id: string; name: string; pageUrl: string; submissionCount: number; latestSubmission: string | null };

export function accountView(config: AppConfig, email: string, csrf: string, sessions: SessionView[], forms: FormSummary[]): string {
  const rows = sessions.map((session) => `<li>
    <div><strong>${escapeHtml(session.deviceLabel)}${session.current ? " · This device" : ""}</strong><small>Created ${escapeHtml(session.createdAt)} · Last used ${escapeHtml(session.lastSeenAt)}</small></div>
    ${session.current ? "" : `<form action="/admin/sessions/${escapeHtml(session.id)}/revoke" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="text-button" type="submit">Revoke</button></form>`}
  </li>`).join("");
  const formCards = forms.map((form) => `<a class="form-card" href="/admin/forms/${escapeHtml(form.id)}"><div><span>${escapeHtml(new URL(form.pageUrl).hostname)}</span><h2>${escapeHtml(form.name)}</h2></div><strong>${form.submissionCount}</strong><small>${form.submissionCount === 1 ? "submission" : "submissions"}${form.latestSubmission ? ` · Latest ${escapeHtml(form.latestSubmission)}` : ""}</small></a>`).join("");
  return layout(config, "Account", `<section class="workspace">
    <header class="workspace-title"><div><p class="eyebrow">Account</p><h1>Your forms</h1></div><p>${escapeHtml(email)}</p></header>
    <section class="forms-grid" aria-label="Forms">${formCards || '<div class="empty-state"><span aria-hidden="true">＋</span><h2>No forms yet</h2><p>Create one below.</p></div>'}</section><details class="danger-zone"><summary>Create another form</summary><form action="/admin/forms/create" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="new-page-url">Page URL</label><input id="new-page-url" name="page_url" type="url" required placeholder="https://your-site.com/contact"><button type="submit">Create form</button></form></details>
    <section class="sessions"><div><p class="step">Security</p><h2>Active sessions</h2></div><ul>${rows}</ul>
      <div class="session-actions">
        <form action="/admin/sessions/revoke-others" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">Revoke other sessions</button></form>
        <form action="/auth/logout" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">Sign out</button></form>
      </div>
    </section>
    <details class="danger-zone"><summary>Delete account</summary><form action="/admin/account/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="account-confirmation">Type ${escapeHtml(email)} to delete all forms, submissions, and sessions</label><input id="account-confirmation" name="confirmation" required><p class="fine-print">Deleted records may remain in encrypted backups for up to ${config.backupRetentionDays} days.</p><button class="danger" type="submit">Delete account</button></form></details>
  </section>`);
}

export type SubmissionView = { id: string; createdAt: string; payload: Record<string, string | string[]> };

export function formView(config: AppConfig, form: { id: string; name: string; page_url: string; active: number; submission_count: number }, endpoint: string, honeypot: string, csrf: string, submissions: SubmissionView[], columns: string[], nextCursor?: string): string {
  const snippet = `<form action="${endpoint}" method="post">\n  <label>\n    Email\n    <input type="email" name="email" required>\n  </label>\n  <input type="text" name="${honeypot}" tabindex="-1" autocomplete="off" aria-hidden="true">\n  <button type="submit">Send</button>\n</form>`;
  const cells = (value: string | string[] | undefined) => escapeHtml(Array.isArray(value) ? value.join(", ") : value || "");
  const tableRows = submissions.map((submission) => `<tr><td><button class="row-button" type="button" data-dialog="submission-${escapeHtml(submission.id)}">${escapeHtml(submission.createdAt)}</button></td>${columns.map((column) => `<td>${cells(submission.payload[column])}</td>`).join("")}</tr>`).join("");
  const dialogs = submissions.map((submission) => `<dialog id="submission-${escapeHtml(submission.id)}" aria-labelledby="title-${escapeHtml(submission.id)}"><div class="dialog-head"><div><p class="step">Submission</p><h2 id="title-${escapeHtml(submission.id)}">${escapeHtml(submission.createdAt)}</h2></div><button class="dialog-close" type="button" data-close aria-label="Close">×</button></div><dl>${Object.entries(submission.payload).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${Array.isArray(value) ? value.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : escapeHtml(value)}</dd></div>`).join("")}</dl><p class="fine-print">ID: ${escapeHtml(submission.id)}</p><form action="/admin/forms/${escapeHtml(form.id)}/submissions/${escapeHtml(submission.id)}/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="danger" type="submit">Delete submission</button></form></dialog>`).join("");
  return layout(config, form.name, `<section class="workspace">
    <p><a href="/admin">← All forms</a></p>
    <header class="workspace-title"><div><p class="eyebrow">${form.active ? "Active endpoint" : "Inactive endpoint"}</p><h1>${escapeHtml(form.name)}</h1></div><p>${form.submission_count} submissions</p></header>
    <section class="setup-grid"><div><p class="step">Public endpoint</p><p class="endpoint"><code>${escapeHtml(endpoint)}</code></p><p>Posts return visitors to <a href="${escapeHtml(form.page_url)}">${escapeHtml(form.page_url)}</a>.</p></div><div><p class="step">HTML integration</p><pre><code>${escapeHtml(snippet)}</code></pre><p class="fine-print">Any named text field works. Keep hidden honeypot field unchanged.</p></div></section>
    <section class="submission-section"><div class="section-heading"><div><p class="step">Inbox</p><h2>Submissions</h2></div><a href="/admin/forms/${escapeHtml(form.id)}/submissions.csv">Export CSV</a></div>${submissions.length ? `<div class="table-wrap"><table><thead><tr><th>Received</th>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>${nextCursor ? `<p><a class="button-link pager" href="?cursor=${escapeHtml(nextCursor)}">Older submissions →</a></p>` : ""}` : '<div class="empty-state"><span aria-hidden="true">↓</span><h2>No submissions yet</h2><p>New posts appear here.</p></div>'}</section>
    <details class="danger-zone"><summary>Form settings</summary><div><form action="/admin/forms/${escapeHtml(form.id)}/toggle" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">${form.active ? "Disable endpoint" : "Enable endpoint"}</button></form><form action="/admin/forms/${escapeHtml(form.id)}/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="confirm-name">Type ${escapeHtml(form.name)} to permanently delete form and ${form.submission_count} submissions</label><input id="confirm-name" name="confirmation" required><button class="danger" type="submit">Delete form</button></form></div></details>
    ${dialogs}<script src="/assets/admin.js" defer></script>
  </section>`);
}
