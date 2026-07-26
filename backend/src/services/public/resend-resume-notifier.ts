import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type {
  AssessmentStatus,
  ResumeAgreementNotifier
} from "./start-assessment";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ] ?? character
  );

export interface AssessmentAccessEmailContent {
  subject: string;
  heading: string;
  message: string;
  ctaLabel: string;
  note: string;
}

export const buildResumeEmailContent = (input: {
  assessmentYear: number;
  assessmentStatus: AssessmentStatus;
  emailPurpose: "START" | "RESUME";
  requestReference: string;
}): AssessmentAccessEmailContent => {
  const reference = ` - link ${input.requestReference}`;

  if (input.emailPurpose === "START") {
    return {
      subject: `Start your ${input.assessmentYear} Savians Tax Assessment${reference}`,
      heading: "Start your Savians Tax Assessment",
      message:
        `Your ${input.assessmentYear} assessment has been started. ` +
        "Review and sign the legal agreement to continue.",
      ctaLabel: "Review Legal Agreement",
      note: "No QuickBooks invoice has been created yet."
    };
  }

  if (input.assessmentStatus === "AGREEMENT_PENDING") {
    return {
      subject: `Resume your ${input.assessmentYear} Savians legal agreement${reference}`,
      heading: "Resume your legal agreement",
      message:
        `Your saved ${input.assessmentYear} assessment is waiting for your legal agreement. ` +
        "Review and sign it when you are ready.",
      ctaLabel: "Review and Sign Agreement",
      note: "No QuickBooks invoice has been created yet."
    };
  }

  if (
    input.assessmentStatus === "AGREEMENT_SIGNED" ||
    input.assessmentStatus === "QB_CUSTOMER_CREATED"
  ) {
    return {
      subject: `Continue billing setup for your ${input.assessmentYear} Savians assessment${reference}`,
      heading: "Continue to invoice setup",
      message:
        "Your legal agreement is signed. Return securely to continue or retry QuickBooks invoice setup.",
      ctaLabel: "Continue Invoice Setup",
      note: "You will see the latest billing result after you continue."
    };
  }

  if (
    [
      "INVOICE_CREATED",
      "INVOICE_SENT",
      "PAYMENT_PENDING",
      "PAYMENT_VERIFYING"
    ].includes(input.assessmentStatus)
  ) {
    return {
      subject: `View payment status for your ${input.assessmentYear} Savians assessment${reference}`,
      heading: "View your invoice and payment status",
      message:
        "Your legal agreement is complete and QuickBooks billing is in progress. " +
        "Open the secure status page for the latest invoice and verified payment details.",
      ctaLabel: "View Invoice and Payment Status",
      note: "Account setup unlocks only after QuickBooks verifies payment in full."
    };
  }

  if (
    input.assessmentStatus === "PAID_VERIFIED" ||
    input.assessmentStatus === "ACCOUNT_INVITED"
  ) {
    return {
      subject: `Payment confirmed - continue your ${input.assessmentYear} Savians account setup${reference}`,
      heading: "Payment confirmed",
      message:
        "QuickBooks has verified your invoice as paid in full. Your Savians account setup is now available.",
      ctaLabel: "Continue Account Setup",
      note: "Proceed now, or keep this secure link and return when you are ready."
    };
  }

  if (
    [
      "ACCOUNT_CREATED",
      "PROFILE_IN_PROGRESS",
      "PROFILE_COMPLETED",
      "DOCUMENTS_IN_PROGRESS",
      "DOCUMENTS_SUBMITTED",
      "IN_PROGRESS",
      "COMPLETED"
    ].includes(input.assessmentStatus)
  ) {
    return {
      subject: `Open your ${input.assessmentYear} Savians client dashboard${reference}`,
      heading: "Continue in your client dashboard",
      message:
        "Your Savians account is already set up. Sign in to your client dashboard to continue your profile or documents.",
      ctaLabel: "Open Client Dashboard",
      note: "Use the password already associated with your Savians account."
    };
  }

  return {
    subject: `Return to your ${input.assessmentYear} Savians assessment${reference}`,
    heading: "Return to your Savians assessment",
    message:
      "Open the recovery page to review the current assessment status and the available next step.",
    ctaLabel: "Recover Assessment",
    note: "If you still need help, reply to this email and Savians will assist you."
  };
};

export const buildResumeEmailSubject = (
  assessmentYear: number,
  requestReference: string,
  assessmentStatus: AssessmentStatus = "AGREEMENT_PENDING",
  emailPurpose: "START" | "RESUME" = "RESUME"
): string =>
  buildResumeEmailContent({
    assessmentYear,
    assessmentStatus,
    emailPurpose,
    requestReference
  }).subject;

export class ResendResumeAgreementNotifier implements ResumeAgreementNotifier {
  constructor(private readonly secrets: ApplicationSecrets) {}

  async send(input: {
    recipientEmail: string;
    recipientName: string;
    resumeUrl: string;
    assessmentYear: number;
    assessmentStatus: AssessmentStatus;
    emailPurpose: "START" | "RESUME";
  }): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) {
      return { status: "SKIPPED" };
    }

    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.resumeUrl);
    // Gmail groups identical subjects even though Resend supplies a new Message-ID.
    // A per-request reference keeps every requested resume link as a new inbox item.
    const requestReference = randomUUID().slice(0, 8).toUpperCase();
    const content = buildResumeEmailContent({
      assessmentYear: input.assessmentYear,
      assessmentStatus: input.assessmentStatus,
      emailPurpose: input.emailPurpose,
      requestReference
    });
    const result = await resend.emails.send({
      from: "Savians Tax Advisors <" + this.secrets.EMAIL_FROM + ">",
      to: [input.recipientEmail],
      replyTo: this.secrets.EMAIL_REPLY_TO,
      subject: content.subject,
      text:
        "Hi " +
        input.recipientName +
        ",\n\n" +
        content.message +
        "\n\n" +
        content.ctaLabel +
        ":\n" +
        input.resumeUrl +
        "\n\n" +
        content.note +
        "\n\nSavians Tax Advisors",
      html:
        '<div style="font-family:Arial,sans-serif;color:#2c2c2c;line-height:1.6">' +
        '<h1 style="color:#14235c">' +
        escapeHtml(content.heading) +
        "</h1>" +
        "<p>Hi " +
        safeName +
        ",</p>" +
        "<p>" +
        escapeHtml(content.message) +
        "</p>" +
        '<p><a href="' +
        safeUrl +
        '" style="display:inline-block;background:#14235c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">' +
        escapeHtml(content.ctaLabel) +
        "</a></p>" +
        "<p><strong>" +
        escapeHtml(content.note) +
        "</strong></p>" +
        "<p>Savians Tax Advisors</p></div>"
    });

    if (result.error) throw new Error(result.error.message);
    return { status: "SENT", providerMessageId: result.data?.id };
  }
}
