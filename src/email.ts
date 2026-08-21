import { Resend } from "resend";
import type { AppConfig } from "./config";
import { escapeHtml } from "./views";

export type MagicLinkEmail = {
  id: string;
  to: string;
  confirmUrl: string;
  expiresMinutes: number;
  hostname?: string;
  variant?: "signin" | "create-account" | "delete-account";
};

export interface Mailer {
  sendMagicLink(input: MagicLinkEmail): Promise<void>;
}

export function renderMagicLinkEmail(input: MagicLinkEmail): { subject: string; text: string; html: string } {
  const creating = input.variant === "create-account";
  const deleting = input.variant === "delete-account";
  const context = input.hostname ? ` for ${input.hostname}` : "";
  const subject = deleting ? "Confirm Shibumi Forms account deletion"
    : creating ? "Create your Shibumi Forms account" : `Confirm your Shibumi Forms sign-in${context}`;
  const heading = deleting ? "Delete your account"
    : creating ? "Create your account" : `Confirm your sign-in${context}`;
  const lead = deleting
    ? "You asked to delete your Shibumi Forms account. Confirming removes your forms and submissions permanently."
    : creating
      ? "You tried to sign in, but this address has no Shibumi Forms account yet. Confirm to create one."
      : "One tap and you are back in your forms workspace.";
  const action = deleting ? "Confirm deletion" : creating ? "Create account" : "Confirm sign-in";
  const finePrint = `This link works once and expires in ${input.expiresMinutes} minutes. If you did not request it, ignore this email.`;

  const text = [
    creating || deleting ? lead : `Confirm your Shibumi Forms sign-in${context}.`,
    "",
    input.confirmUrl,
    "",
    finePrint,
    "",
    "Shibumi Forms - Simple infrastructure for static sites.",
  ].join("\n");

  const url = escapeHtml(input.confirmUrl);
  const serif = "Georgia,'Iowan Old Style','Times New Roman',serif";
  const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const mono = "'SF Mono',Menlo,Consolas,monospace";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f3e8;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e8;">
<tr><td align="center" style="padding:40px 16px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td style="padding:0 4px 16px;">
      <span style="font-family:${sans};font-size:16px;font-weight:600;color:#252116;">shibumi</span><span style="font-family:${sans};font-size:16px;color:#a89f8d;"> forms</span>
    </td></tr>
    <tr><td style="background:#fdfbf3;border:1px solid #e5dfd0;border-radius:16px;padding:36px 40px;">
      <p style="margin:0 0 20px;font-family:${mono};font-size:11px;font-weight:700;letter-spacing:3px;color:#ff6600;">${deleting ? "CONFIRM / DELETE" : creating ? "01 / CREATE" : "02 / VERIFY"}</p>
      <h1 style="margin:0 0 12px;font-family:${serif};font-weight:400;font-size:30px;line-height:1.1;letter-spacing:-.5px;color:#252116;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 28px;font-family:${serif};font-size:16px;line-height:1.6;color:#7a6f5d;">${escapeHtml(lead)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="border-radius:8px;background:#ff6600;">
          <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${sans};font-size:15px;font-weight:600;color:#f7f3e8;text-decoration:none;border-radius:8px;">${escapeHtml(action)} &rarr;</a>
        </td>
      </tr></table>
      <p style="margin:28px 0 0;font-family:${sans};font-size:12px;line-height:1.6;color:#7a6f5d;">Button not working? Paste this link into your browser:<br>
      <a href="${url}" style="color:#e55a00;word-break:break-all;">${url}</a></p>
      <hr style="margin:28px 0 20px;border:0;border-top:1px solid #e5dfd0;">
      <p style="margin:0;font-family:${sans};font-size:12px;line-height:1.6;color:#7a6f5d;">${escapeHtml(finePrint)}</p>
    </td></tr>
    <tr><td align="center" style="padding:20px 4px 0;">
      <p style="margin:0;font-family:${sans};font-size:12px;color:#a89f8d;">Simple infrastructure for static sites.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

export class MailDeliveryError extends Error {
  constructor() {
    super("Email delivery failed");
    this.name = "MailDeliveryError";
  }
}

export class DiscardMailer implements Mailer {
  async sendMagicLink(input: MagicLinkEmail): Promise<void> {
    console.log(JSON.stringify({ event: "email_discarded", messageId: input.id }));
  }
}

export class ResendMailer implements Mailer {
  private readonly resend: Resend;

  constructor(private readonly from: string, apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendMagicLink(input: MagicLinkEmail): Promise<void> {
    const { subject, text, html } = renderMagicLinkEmail(input);

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: [input.to],
        subject,
        html,
        text,
      }, { idempotencyKey: `magic-link/${input.id}` });

      if (!error) return;
      const retryable = ["rate_limit_exceeded", "api_error", "concurrent_idempotent_requests"].includes(error.name);
      if (!retryable || attempt === 2) throw new MailDeliveryError();
      await Bun.sleep(2 ** attempt * 1000);
    }
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.emailProvider === "resend") {
    return new ResendMailer(config.emailFrom, config.emailApiKey!);
  }
  return new DiscardMailer();
}
