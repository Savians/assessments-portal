import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { InvoiceStatusNotifier } from "./agreement-service";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
export class ResendInvoiceStatusNotifier implements InvoiceStatusNotifier {
  constructor(private readonly secrets: ApplicationSecrets) {}
  async send(input: { email: string; firstName: string; invoiceNumber?: string; amount: number; statusUrl: string }): Promise<void> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) return;
    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const invoice = input.invoiceNumber ? ` ${input.invoiceNumber}` : "";
    const result = await resend.emails.send({
      from: this.secrets.EMAIL_FROM, replyTo: this.secrets.EMAIL_REPLY_TO, to: input.email,
      subject: `Your Savians Tax Assessment invoice${invoice}`,
      text: `Hi ${input.firstName},\n\nYour legal agreement is signed and QuickBooks has sent your $${input.amount.toLocaleString("en-US")} invoice${invoice}.\n\nTrack payment status: ${input.statusUrl}`,
      html: `<p>Hi ${escapeHtml(input.firstName)},</p><p>Your legal agreement is signed and QuickBooks has sent your <strong>$${input.amount.toLocaleString("en-US")}</strong> invoice${escapeHtml(invoice)}.</p><p><a href="${escapeHtml(input.statusUrl)}">Track payment status</a></p>`
    });
    if (result.error) throw new Error(`Resend invoice-status email failed: ${result.error.message}`);
  }
}