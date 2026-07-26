import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { PaymentSupportNotifier } from "../payment/payment-service";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
export class ResendPaymentSupportNotifier implements PaymentSupportNotifier {
  constructor(private readonly secrets: ApplicationSecrets) {}

  async sendPaymentSupport(input: { sessionId: string; email: string; firstName: string; phone: string; assessmentYear: number; invoiceNumber?: string; balance?: number | null; amount: number; statusUrl: string }): Promise<void> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) throw new Error("Payment support email is not configured");
    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const invoice = input.invoiceNumber ?? "Pending";
    const balance = typeof input.balance === "number" ? `$${input.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "Not available";
    const result = await resend.emails.send({
      from: this.secrets.EMAIL_FROM,
      replyTo: input.email,
      to: "contactus@savians.com",
      subject: `Payment help requested - invoice ${invoice}`,
      text: `A client requested help with a QuickBooks payment.\n\nClient: ${input.firstName}\nEmail: ${input.email}\nPhone: ${input.phone}\nAssessment year: ${input.assessmentYear}\nInvoice: ${invoice}\nInvoice amount: $${input.amount.toLocaleString("en-US")}\nCurrent balance: ${balance}\nSession: ${input.sessionId}\nSecure status page: ${input.statusUrl}\n\nThe portal remains locked until QuickBooks verifies a zero invoice balance.`,
      html: `<p>A client requested help with a QuickBooks payment.</p><ul><li><strong>Client:</strong> ${escapeHtml(input.firstName)}</li><li><strong>Email:</strong> ${escapeHtml(input.email)}</li><li><strong>Phone:</strong> ${escapeHtml(input.phone)}</li><li><strong>Assessment year:</strong> ${input.assessmentYear}</li><li><strong>Invoice:</strong> ${escapeHtml(invoice)}</li><li><strong>Invoice amount:</strong> $${input.amount.toLocaleString("en-US")}</li><li><strong>Current balance:</strong> ${escapeHtml(balance)}</li><li><strong>Session:</strong> ${escapeHtml(input.sessionId)}</li></ul><p><a href="${escapeHtml(input.statusUrl)}">Open secure payment status page</a></p><p>The portal remains locked until QuickBooks verifies a zero invoice balance.</p>`
    });
    if (result.error) throw new Error(`Resend payment-support email failed: ${result.error.message}`);
  }
}
