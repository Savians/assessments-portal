import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { PaymentConfirmationNotifier } from "./payment-service";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ] ?? character
  );

export const buildPaymentConfirmedEmailContent = (input: {
  assessmentYear: number;
  invoiceNumber?: string;
}): {
  subject: string;
  heading: string;
  confirmation: string;
  proceedNow: string;
  proceedLater: string;
  ctaLabel: string;
} => {
  const invoiceReference = input.invoiceNumber
    ? `QuickBooks invoice ${input.invoiceNumber}`
    : "Your QuickBooks invoice";
  return {
    subject:
      `Payment confirmed - continue your ${input.assessmentYear} Savians account setup`,
    heading: "Payment confirmed",
    confirmation:
      `${invoiceReference} has been verified as paid in full. ` +
      "Account setup is now available; no account has been created automatically.",
    proceedNow:
      "Proceed now: open the secure recovery page, enter this email address, " +
      "and we will send a fresh secure status link for account setup.",
    proceedLater:
      "Proceed later: no action is required now. Your payment remains verified, " +
      "and you can use the same recovery page whenever you are ready.",
    ctaLabel: "Proceed to Account Setup"
  };
};

export const paymentConfirmedIdempotencyKey = (sessionId: string): string =>
  `payment-confirmed-${sessionId}`;

export class ResendPaymentConfirmedNotifier
  implements PaymentConfirmationNotifier
{
  constructor(private readonly secrets: ApplicationSecrets) {}

  async sendPaymentConfirmed(input: {
    sessionId: string;
    email: string;
    firstName: string;
    assessmentYear: number;
    invoiceNumber?: string;
    continueUrl: string;
  }): Promise<{
    status: "SENT" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
  }> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) {
      return {
        status: "SKIPPED",
        failureReason: "Email delivery is disabled or Resend is not configured"
      };
    }

    const content = buildPaymentConfirmedEmailContent(input);
    const safeName = escapeHtml(input.firstName);
    const safeUrl = escapeHtml(input.continueUrl);
    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const result = await resend.emails.send(
      {
        from: `Savians Tax Advisors <${this.secrets.EMAIL_FROM}>`,
        to: [input.email],
        replyTo: this.secrets.EMAIL_REPLY_TO,
        subject: content.subject,
        text:
          `Hi ${input.firstName},\n\n` +
          `${content.confirmation}\n\n` +
          `${content.proceedNow}\n${input.continueUrl}\n\n` +
          `${content.proceedLater}\n\n` +
          "Savians Tax Advisors",
        html:
          '<div style="font-family:Arial,sans-serif;color:#2c2c2c;line-height:1.6">' +
          `<h1 style="color:#14235c">${escapeHtml(content.heading)}</h1>` +
          `<p>Hi ${safeName},</p>` +
          `<p>${escapeHtml(content.confirmation)}</p>` +
          `<p><strong>${escapeHtml(content.proceedNow)}</strong></p>` +
          `<p><a href="${safeUrl}" style="display:inline-block;background:#14235c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">${escapeHtml(content.ctaLabel)}</a></p>` +
          `<p>${escapeHtml(content.proceedLater)}</p>` +
          "<p>Savians Tax Advisors</p></div>"
      },
      { idempotencyKey: paymentConfirmedIdempotencyKey(input.sessionId) }
    );

    if (result.error) {
      throw new Error(`Resend payment-confirmation email failed: ${result.error.message}`);
    }
    return {
      status: "SENT",
      providerMessageId: result.data?.id
    };
  }
}
