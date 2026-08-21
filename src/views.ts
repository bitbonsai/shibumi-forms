import type { AppConfig } from "./config";

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(iso)}, ${hours}:${minutes}`;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return formatDate(iso);
}

function layout(config: AppConfig, title: string, content: string, admin = false): string {
  const turnstileScript = config.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f3e8">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e1510">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · Shibumi Forms</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <script src="/assets/theme.js"></script>
  <link rel="stylesheet" href="/assets/styles.css">
  ${turnstileScript}
</head>
<body>
  <div class="shell">
    <header class="site-header">
      <a class="mark" href="/" aria-label="Shibumi Forms home"><img src="/assets/favicon.png" alt=""><span>shibumi<span class="mark-tld"> forms</span></span></a>
      <nav aria-label="Primary"><a href="https://shibumistack.dev">Shibumi Stack</a><a href="${admin ? "/admin" : "/login"}">${admin ? "Account" : "Sign in"}</a><button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme"><svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button></nav>
    </header>
    <main>${content}${admin ? '<script src="/assets/admin.js" defer></script>' : ""}</main>
    <footer class="site-footer">
      <span>Simple infrastructure for static sites.</span>
      <nav aria-label="Policies"><a href="${escapeHtml(config.termsUrl.href)}">Terms</a><a href="${escapeHtml(config.privacyUrl.href)}">Privacy</a></nav>
    </footer>
  </div>
</body>
</html>`;
}

// Symmetric bases: square, isosceles triangle, circle, hexagon, octagon
const GLYPH_SHAPES = [
  '<rect x="6.5" y="6.5" width="11" height="11"/>',
  '<path d="M12 5 19 18H5z"/>',
  '<circle cx="12" cy="12" r="6.5"/>',
  '<path d="M12 4.5 18.5 8.25v7.5L12 19.5 5.5 15.75v-7.5z"/>',
  '<path d="M14.7 5.5l3.8 3.8v5.4l-3.8 3.8H9.3l-3.8-3.8V9.3l3.8-3.8z"/>',
];
const GLYPH_COLOR_COUNT = 10;
const centered = (t: string) => `translate(12 12) ${t} translate(-12 -12)`;
// Allocation order: pure symmetric shapes first, then progressively deformed variants
const GLYPH_VARIANTS: Array<[number, string]> = [
  [0, ""], [1, ""], [2, ""], [3, ""], [4, ""],
  [0, "rotate(45 12 12)"], [1, "rotate(180 12 12)"], [2, centered("scale(1.3 .75)")], [3, "rotate(30 12 12)"], [4, "rotate(22.5 12 12)"],
  [0, centered("scale(1.3 .75)")], [1, "rotate(90 12 12)"], [2, centered("scale(.75 1.3)")], [3, centered("scale(1.3 .75)")], [4, centered("scale(1.3 .75)")],
  [0, centered("scale(.75 1.3)")], [1, "rotate(270 12 12)"], [3, centered("scale(.75 1.3)")], [4, centered("scale(.75 1.3)")], [1, centered("scale(1.35 .8)")],
];

export function formGlyph(seed: string, used = new Set<string>()): string {
  let hash = 0x811c9dc5;
  for (const char of seed) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const color = (hash >>> 13) % GLYPH_COLOR_COUNT;
  let body = "";
  for (const [shape, transform] of GLYPH_VARIANTS) {
    const key = `${shape}:${transform}`;
    if (used.has(key)) continue;
    used.add(key);
    body = transform ? `<g transform="${transform}">${GLYPH_SHAPES[shape]}</g>` : GLYPH_SHAPES[shape]!;
    break;
  }
  if (!body) {
    // single-shape variants exhausted on this page: concentric two-shape composition
    const total = GLYPH_VARIANTS.length * (GLYPH_SHAPES.length - 1);
    for (let i = 0; i < total; i++) {
      const [shape, transform] = GLYPH_VARIANTS[i % GLYPH_VARIANTS.length]!;
      const other = (Math.floor(i / GLYPH_VARIANTS.length) + shape + 1) % GLYPH_SHAPES.length;
      const key = `${shape}:${transform}+${other}`;
      if (used.has(key) && i < total - 1) continue;
      used.add(key);
      const outer = transform ? `<g transform="${transform}">${GLYPH_SHAPES[shape]}</g>` : GLYPH_SHAPES[shape];
      body = `${outer}<g transform="rotate(45 12 12) translate(5.4 5.4) scale(.55)" stroke-width="3.1">${GLYPH_SHAPES[other]}</g>`;
      break;
    }
  }
  return `<span class="form-mark glyph-c${color}" aria-hidden="true"><svg class="form-glyph" viewBox="0 0 24 24">${body}</svg></span>`;
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
      <p class="eyebrow">Now your forms have a dashboard</p>
      <h1>Forms for<br>static sites.</h1>
      <p class="lede">Easy, free, no strings attached.</p>
      <div class="signal" aria-hidden="true"><span>your form</span><i></i><span>one endpoint</span></div>
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
    <div class="status-mark" aria-hidden="true"><i class="icon icon-arrow-up-right"></i></div>
    <h1>Check your email</h1>
    <p>If the address can receive email, a link should arrive shortly. It signs you in, or creates your account if you are new. Link expires in 15 minutes.</p>
    <p class="alternate"><a href="/login">Try another address</a></p>
  </div></section>`);
}

export function confirmView(config: AppConfig, token: string, hostname?: string, input: { needsTerms?: boolean; error?: string } = {}): string {
  const context = hostname ? ` for ${hostname}` : "";
  const creating = input.needsTerms === true;
  const error = input.error ? `<p class="notice error" role="alert">${escapeHtml(input.error)}</p>` : "";
  const terms = creating
    ? `<label class="check"><input name="accepted_terms" type="checkbox" value="yes" required><span>I agree to the <a href="${escapeHtml(config.termsUrl.href)}">Terms</a> and accept responsibility for submission data.</span></label>`
    : "";
  return layout(config, creating ? "Create your account" : "Confirm sign-in", `<section class="single-panel"><div class="panel result">
    <p class="step">02 / Verify</p>
    <h1>${creating ? "Create your account" : `Confirm sign-in${escapeHtml(context)}`}</h1>
    <p>${creating ? "This address has no account yet. This button creates one and signs you in." : "This button signs you in."} Link works once and expires after 15 minutes.</p>
    ${error}
    <form action="/auth/confirm" method="post">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${terms}
      <label class="check"><input name="remember" type="checkbox" value="yes"><span>Keep me signed in for 30 days on this device</span></label>
      <button type="submit">${creating ? "Create account and continue" : "Confirm and continue"} <span aria-hidden="true">→</span></button>
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
    <div><strong>${escapeHtml(session.deviceLabel)}${session.current ? " · This device" : ""}</strong><small>Created ${escapeHtml(formatDate(session.createdAt))} · Last used ${escapeHtml(formatRelative(session.lastSeenAt))}</small></div>
    ${session.current ? "" : `<form action="/admin/sessions/${escapeHtml(session.id)}/revoke" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="text-button" type="submit">Revoke</button></form>`}
  </li>`).join("");
  const usedGlyphs = new Set<string>();
  const formCards = forms.map((form) => `<a class="form-card" href="/admin/forms/${escapeHtml(form.id)}">
    <div class="form-card-head">${formGlyph(form.id, usedGlyphs)}<span>${escapeHtml(new URL(form.pageUrl).hostname)}</span></div>
    <div class="form-card-copy"><h2>${escapeHtml(form.name)}</h2><p>${form.latestSubmission ? `Latest ${escapeHtml(formatRelative(form.latestSubmission))}` : "Waiting for first submission"}</p></div>
    <div class="form-card-stat"><strong>${form.submissionCount}</strong><span>${form.submissionCount === 1 ? "submission" : "submissions"}</span><i>Open form →</i></div>
  </a>`).join("");
  return layout(config, "Account", `<section class="workspace admin-workspace">
    <header class="workspace-title admin-title">
      <div><p class="eyebrow">Forms workspace</p><h1>Your forms</h1><p class="workspace-dek">Endpoints, submissions, and account access in one place.</p></div>
      <div class="account-chip"><span>Signed in as</span><strong>${escapeHtml(email)}</strong></div>
    </header>
    <div class="admin-layout">
      <section class="form-library" aria-labelledby="forms-heading">
        <div class="section-heading compact-heading"><div><p class="step">Collection</p><div class="heading-row"><h2 id="forms-heading">Form endpoints</h2><span class="count-badge">${forms.length}</span></div></div></div>
        <div class="forms-grid">${formCards || '<div class="empty-state"><span class="empty-mark" aria-hidden="true"><i class="icon icon-plus"></i></span><h2>No forms yet</h2><p>Create your first endpoint.</p></div>'}</div>
        <aside class="create-card" aria-labelledby="create-heading">
          <div class="create-copy"><span class="create-mark" aria-hidden="true"><i class="icon icon-plus"></i></span><div><p class="step">New endpoint</p><h2 id="create-heading">Connect another page</h2></div></div>
          <p class="create-guidance"><strong>What happens next</strong><span>We generate endpoint, paste-ready HTML, and coding-agent prompt.</span></p>
          <form action="/admin/forms/create" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="new-page-url">Public page URL</label><div class="create-input-row"><input id="new-page-url" name="page_url" type="url" required placeholder="https://your-site.com/contact"><button type="submit">Continue <span aria-hidden="true">→</span></button></div></form>
        </aside>
      </section>
    </div>
    <section class="account-section" aria-labelledby="access-heading">
      <header class="account-section-head"><div><p class="step">Security</p><h2 id="access-heading">Account &amp; access</h2></div><p>Manage signed-in devices and account data.</p></header>
      <div class="settings-grid">
        <article class="settings-card sessions-card"><header><div><h3>Active sessions</h3><p>${sessions.length} signed-in ${sessions.length === 1 ? "device" : "devices"}</p></div><span class="status-dot" aria-label="Active"></span></header><ul>${rows}</ul><form action="/admin/sessions/revoke-others" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">Revoke other sessions</button></form></article>
        <article class="settings-card account-card"><div><h3>Account</h3><p class="account-email">${escapeHtml(email)}</p></div><form action="/auth/logout" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">Sign out</button></form><details class="delete-account"><summary>Delete account</summary>
          <div class="delete-body">
            <p>Permanently deletes all forms, submissions, and sessions for this account.</p>
            <div class="confirm-email"><span>Your account email</span><code id="delete-email">${escapeHtml(email)}</code><button class="icon-button" type="button" data-copy-target="delete-email" aria-label="Copy email"><i class="icon icon-copy"></i></button></div>
            <form action="/admin/account/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="account-confirmation">Type your email to confirm</label><input id="account-confirmation" name="confirmation" autocomplete="off" placeholder="${escapeHtml(email)}" required><p class="fine-print">Deleted records may remain in encrypted backups for up to ${config.backupRetentionDays} days.</p><button class="danger" type="submit">Delete account</button></form>
          </div></details></article>
      </div>
    </section>
  </section>`, true);
}

export type SubmissionView = { id: string; createdAt: string; payload: Record<string, string | string[]>; note?: string | null };

export function formView(config: AppConfig, form: { id: string; name: string; page_url: string; active: number; submission_count: number }, endpoint: string, honeypot: string, csrf: string, submissions: SubmissionView[], columns: string[], page = 1, totalPages = 1): string {
  const snippet = `<form action="${endpoint}" method="post">\n  <label>\n    Email\n    <input type="email" name="email" required>\n  </label>\n  <input type="text" name="${honeypot}" tabindex="-1" autocomplete="off" aria-hidden="true">\n  <button type="submit">Send</button>\n</form>`;
  const agentPrompt = `Connect the form on ${form.page_url} to Shibumi Forms.\n\nRequirements:\n- Set form action to ${endpoint}\n- Set form method to post\n- Preserve current fields, validation, styling, and accessibility\n- Ensure every submitted field has a name attribute\n- Add this spam honeypot inside the form:\n  <input type="text" name="${honeypot}" tabindex="-1" autocomplete="off" aria-hidden="true">\n- Do not collect passwords, payment details, health data, or government identifiers\n- Keep submission working without JavaScript\n\nAfter submission, Shibumi Forms redirects back to ${form.page_url}.`;
  const cells = (value: string | string[] | undefined) => escapeHtml(Array.isArray(value) ? value.join(", ") : value || "");
  const tableRows = submissions.map((submission) => `<tr data-dialog="submission-${escapeHtml(submission.id)}"><td><button class="row-button" type="button" title="${escapeHtml(submission.createdAt)}">${escapeHtml(formatDateTime(submission.createdAt))}</button>${submission.note ? '<span class="note-flag" role="img" aria-label="Has note" title="Has note"></span>' : ""}</td>${columns.map((column) => `<td>${cells(submission.payload[column])}</td>`).join("")}</tr>`).join("");
  const dialogs = submissions.map((submission) => `<dialog id="submission-${escapeHtml(submission.id)}" aria-labelledby="title-${escapeHtml(submission.id)}"><div class="dialog-head"><div><p class="step">Submission</p><h2 id="title-${escapeHtml(submission.id)}">${escapeHtml(formatDateTime(submission.createdAt))}</h2></div><button class="dialog-close" type="button" data-close aria-label="Close"><i class="icon icon-x"></i></button></div><dl>${Object.entries(submission.payload).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${Array.isArray(value) ? value.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : escapeHtml(value)}</dd></div>`).join("")}</dl><form class="note-form" action="/admin/forms/${escapeHtml(form.id)}/submissions/${escapeHtml(submission.id)}/note" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="note-${escapeHtml(submission.id)}">Note to self</label><textarea id="note-${escapeHtml(submission.id)}" name="note" rows="3" maxlength="2000" placeholder="Remind yourself what to do with this submission">${escapeHtml(submission.note || "")}</textarea><button class="secondary" type="submit">${submission.note ? "Update note" : "Save note"}</button></form><p class="fine-print">ID: ${escapeHtml(submission.id)}</p><form action="/admin/forms/${escapeHtml(form.id)}/submissions/${escapeHtml(submission.id)}/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="danger" type="submit">Delete submission</button></form></dialog>`).join("");
  const hasSubmissions = submissions.length > 0;
  const setupSection = `<section class="setup-section" aria-labelledby="setup-heading">
      <header class="setup-heading"><div><p class="step">Setup</p><h2 id="setup-heading">Connect this form</h2><p>Paste HTML yourself or give exact instructions to a coding agent.</p></div></header>
      <div class="endpoint-bar"><div><span>Submission endpoint</span><code id="form-endpoint">${escapeHtml(endpoint)}</code></div><button class="secondary copy-button" type="button" data-copy-target="form-endpoint">Copy endpoint</button></div>
      <details class="integration-details"${hasSubmissions ? "" : " open"}>
        <summary><span>Integration guides</span><small>Paste-ready HTML and a coding-agent prompt</small></summary>
        <div class="integration-grid">
          <article class="integration-card"><header><span>01</span><div><h3>Paste into your page</h3><p>Use this as a new form or copy action, method, and honeypot into existing markup.</p></div></header><pre id="html-snippet"><code>${escapeHtml(snippet)}</code></pre><button class="secondary copy-button" type="button" data-copy-target="html-snippet">Copy HTML</button><p class="fine-print">Every submitted field needs a <code>name</code>. Visitors return to <a href="${escapeHtml(form.page_url)}">${escapeHtml(form.page_url)}</a>.</p></article>
          <article class="integration-card agent-card"><header><span>02</span><div><h3>Hand it to a coding agent</h3><p>Copy prompt into your agent from project containing form page.</p></div></header><pre id="agent-prompt"><code>${escapeHtml(agentPrompt)}</code></pre><button class="copy-button" type="button" data-copy-target="agent-prompt">Copy agent prompt <span aria-hidden="true">→</span></button><p class="fine-print">Prompt preserves existing design and keeps form working without JavaScript.</p></article>
        </div>
      </details>
    </section>`;
  const inboxSection = `<section class="submission-section"><div class="section-heading"><div><p class="step">Inbox</p><div class="heading-row"><h2>Submissions</h2><span class="count-badge">${form.submission_count}</span></div></div>${hasSubmissions ? `<a class="ghost-link" href="/admin/forms/${escapeHtml(form.id)}/submissions.csv">Export CSV</a>` : ""}</div>${hasSubmissions ? `<div class="table-wrap"><table><thead><tr><th>Received</th>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>${totalPages > 1 ? `<nav class="pager-nav" aria-label="Submission pages">${page > 1 ? `<a class="icon-button" href="?page=${page - 1}" aria-label="Newer submissions"><i class="icon icon-chevron-left"></i></a>` : '<span class="icon-button is-disabled"><i class="icon icon-chevron-left"></i></span>'}<span class="pager-label">${page} of ${totalPages}</span>${page < totalPages ? `<a class="icon-button" href="?page=${page + 1}" aria-label="Older submissions"><i class="icon icon-chevron-right"></i></a>` : '<span class="icon-button is-disabled"><i class="icon icon-chevron-right"></i></span>'}</nav>` : ""}` : `<div class="empty-state"><span class="empty-mark" aria-hidden="true"><i class="icon icon-inbox"></i></span><h2>Waiting for the first submission</h2><p>${form.active ? "Your endpoint is live and listening. New submissions appear here the moment your form sends them." : "This endpoint is disabled. Enable it in form settings to start accepting submissions."}</p></div>`}</section>`;
  return layout(config, form.name, `<section class="workspace">
    <p class="breadcrumb"><a class="ghost-link" href="/admin">Back to all forms</a></p>
    <header class="workspace-title"><div><p class="eyebrow">${form.active ? "Active endpoint" : "Inactive endpoint"}</p><h1>${escapeHtml(form.name)}</h1></div><span class="endpoint-status${form.active ? " active" : ""}"><i aria-hidden="true"></i>${form.active ? "Accepting submissions" : "Endpoint disabled"}</span></header>
    ${hasSubmissions ? inboxSection + setupSection : setupSection + inboxSection}
    <details class="danger-zone">
      <summary><span>Form settings</span><small>Endpoint control and deletion</small></summary>
      <div class="danger-grid">
        <article class="settings-card"><div><h3>Endpoint</h3><p>${form.active ? "Disabling stops new submissions. Stored submissions stay." : "Endpoint is disabled and rejects new submissions."}</p></div><form action="/admin/forms/${escapeHtml(form.id)}/toggle" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">${form.active ? "Disable endpoint" : "Enable endpoint"}</button></form></article>
        <article class="settings-card danger-card"><div><h3>Delete this form</h3><p>Permanently removes the form and its ${form.submission_count} ${form.submission_count === 1 ? "submission" : "submissions"}. This cannot be undone.</p></div><form action="/admin/forms/${escapeHtml(form.id)}/delete" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label for="confirm-name">Type <strong>${escapeHtml(form.name)}</strong> to confirm</label><input id="confirm-name" name="confirmation" autocomplete="off" required placeholder="${escapeHtml(form.name)}"><button class="danger" type="submit">Delete form</button></form></article>
      </div>
    </details>
    ${dialogs}
  </section>`, true);
}
