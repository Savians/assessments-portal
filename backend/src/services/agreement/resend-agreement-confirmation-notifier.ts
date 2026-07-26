import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { AgreementConfirmationNotifier } from "./agreement-service";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ] ?? character
  );

const formatDate = (value: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "America/Chicago"
  }).format(value);

export const buildAgreementConfirmationEmail = (input: {
  recipientName: string;
  assessmentYear: number;
  agreementTitle: string;
  signedAt: Date;
  downloadUrl: string;
  downloadExpiresAt: Date;
}) => {
  const signedDate = formatDate(input.signedAt);
  const expiryDate = formatDate(input.downloadExpiresAt);
  const subject = `Your signed ${input.assessmentYear} Savians agreement`;
  const text =
    `Hi ${input.recipientName},\n\n` +
    `You successfully signed the ${input.agreementTitle} on ${signedDate}.\n\n` +
    `Download the exact agreement PDF you signed:\n${input.downloadUrl}\n\n` +
    `For your security, this private download link expires on ${expiryDate}. ` +
    "Your electronic signature evidence remains securely recorded with your assessment.\n\n" +
    "Savians Tax Advisors";
  const html =
    '<div style="font-family:Arial,sans-serif;color:#2c2c2c;line-height:1.6">' +
    '<h1 style="color:#14235c">Agreement signed successfully</h1>' +
    `<p>Hi ${escapeHtml(input.recipientName)},</p>` +
    `<p>You successfully signed the <strong>${escapeHtml(input.agreementTitle)}</strong> on ${escapeHtml(signedDate)}.</p>` +
    `<p><a href="${escapeHtml(input.downloadUrl)}" style="display:inline-block;background:#14235c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Download Signed Agreement PDF</a></p>` +
    `<p>For your security, this private download link expires on ${escapeHtml(expiryDate)}. Your electronic signature evidence remains securely recorded with your assessment.</p>` +
    "<p>Savians Tax Advisors</p></div>";
  return { subject, text, html };
};

export interface AgreementEmailClient {
  send(
    payload: {
      from: string;
      replyTo: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    },
    options: { idempotencyKey: string }
  ): Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>;
}

export class ResendAgreementConfirmationNotifier implements AgreementConfirmationNotifier {
  constructor(
    private readonly secrets: ApplicationSecrets,
    private readonly emailClient?: AgreementEmailClient
  ) {}

  async send(input: Parameters<AgreementConfirmationNotifier["send"]>[0]): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) {
      return { status: "SKIPPED" };
    }
    const emailClient = this.emailClient ?? new Resend(this.secrets.RESEND_API_KEY).emails;
    const content = buildAgreementConfirmationEmail(input);
    const result = await emailClient.send(
      {
        from: `Savians Tax Advisors <${this.secrets.EMAIL_FROM}>`,
        replyTo: this.secrets.EMAIL_REPLY_TO,
        to: input.recipientEmail,
        ...content
      },
      { idempotencyKey: input.idempotencyKey }
    );
    if (result.error) throw new Error(`Resend agreement confirmation email failed: ${result.error.message}`);
    return { status: "SENT", providerMessageId: result.data?.id };
  }
}
