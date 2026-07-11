import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { ResumeAgreementNotifier } from "./start-assessment";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ] ?? character
  );

export class ResendResumeAgreementNotifier implements ResumeAgreementNotifier {
  constructor(private readonly secrets: ApplicationSecrets) {}

  async send(input: {
    recipientEmail: string;
    recipientName: string;
    resumeUrl: string;
    assessmentYear: number;
  }): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) {
      return { status: "SKIPPED" };
    }

    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.resumeUrl);
    const result = await resend.emails.send({
      from: "Savians Tax Advisors <" + this.secrets.EMAIL_FROM + ">",
      to: [input.recipientEmail],
      replyTo: this.secrets.EMAIL_REPLY_TO,
      subject: "Continue your " + input.assessmentYear + " Savians Tax Assessment",
      text:
        "Hi " +
        input.recipientName +
        ",\n\nContinue your Savians Tax Assessment and review the legal agreement here:\n" +
        input.resumeUrl +
        "\n\nNo QuickBooks invoice has been created yet.",
      html:
        '<div style="font-family:Arial,sans-serif;color:#2c2c2c;line-height:1.6">' +
        '<h1 style="color:#14235c">Continue your Savians Tax Assessment</h1>' +
        "<p>Hi " +
        safeName +
        ",</p>" +
        "<p>Your " +
        input.assessmentYear +
        " assessment has been saved. Review and sign the legal agreement to continue.</p>" +
        '<p><a href="' +
        safeUrl +
        '" style="display:inline-block;background:#14235c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Review Legal Agreement</a></p>' +
        "<p><strong>No QuickBooks invoice has been created yet.</strong></p>" +
        "<p>Savians Tax Advisors</p></div>"
    });

    if (result.error) throw new Error(result.error.message);
    return { status: "SENT", providerMessageId: result.data?.id };
  }
}
