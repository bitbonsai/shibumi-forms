import { Resend } from "resend";
import type { AppConfig } from "./config";
import { escapeHtml } from "./views";

export type MagicLinkEmail = {
  id: string;
  to: string;
  confirmUrl: string;
  expiresMinutes: number;
  hostname?: string;
  variant?: "signin" | "create-account";
};

export interface Mailer {
  sendMagicLink(input: MagicLinkEmail): Promise<void>;
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
    const creating = input.variant === "create-account";
    const context = input.hostname ? ` for ${input.hostname}` : "";
    const subject = creating ? "Create your Shibumi Forms account" : `Confirm your Shibumi Forms sign-in${context}`;
    const lead = creating
      ? "You tried to sign in, but this address has no Shibumi Forms account yet. Confirm to create one."
      : `Confirm your Shibumi Forms sign-in${context}.`;
    const action = creating ? "Create account" : "Confirm sign-in";
    const text = [
      lead,
      "",
      input.confirmUrl,
      "",
      `This link expires in ${input.expiresMinutes} minutes.`,
      "If you did not request it, ignore this email.",
    ].join("\n");
    const html = `<p>${escapeHtml(lead)}</p>
<p><a href="${escapeHtml(input.confirmUrl)}">${escapeHtml(action)}</a></p>
<p>This link expires in ${input.expiresMinutes} minutes.</p>
<p>If you did not request it, ignore this email.</p>`;

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
