import { Resend } from "resend";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import type { AccountInviteNotifier } from "./account-auth-service";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export class ResendAccountInviteNotifier implements AccountInviteNotifier {
  constructor(private readonly secrets: ApplicationSecrets) {}

  async send(input: { email: string; firstName: string; setupUrl: string; assessmentYear: number }): Promise<void> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) return;
    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: this.secrets.EMAIL_FROM,
      replyTo: this.secrets.EMAIL_REPLY_TO,
      to: input.email,
      subject: `Create your Savians Assessment account for ${input.assessmentYear}`,
      text: `Hi ${input.firstName},\n\nYour payment has been verified. Create your Savians Assessment account here:\n\n${input.setupUrl}\n\nThis setup link expires in 7 days.`,
      html: `<p>Hi ${escapeHtml(input.firstName)},</p><p>Your payment has been verified. You can now create your Savians Assessment account.</p><p><a href="${escapeHtml(input.setupUrl)}" style="display:inline-block;background:#14235c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Create Account</a></p><p>This setup link expires in 7 days.</p>`
    });
    if (result.error) throw new Error(`Resend account invite email failed: ${result.error.message}`);
  }

  async sendVerificationCode(input: { email: string; firstName: string; code: string; assessmentYear: number }): Promise<void> {
    if (!this.secrets.EMAIL_ENABLED || !this.secrets.RESEND_API_KEY) return;
    const resend = new Resend(this.secrets.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: this.secrets.EMAIL_FROM,
      replyTo: this.secrets.EMAIL_REPLY_TO,
      to: input.email,
      subject: `Verify your ${input.assessmentYear} Savians Assessment account`,
      text: `Hi ${input.firstName},\n\nYour Savians Assessment verification code is:\n\n${input.code}\n\nThis code expires in 15 minutes.`,
      html: `<p>Hi ${escapeHtml(input.firstName)},</p><p>Your Savians Assessment verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(input.code)}</p><p>This code expires in 15 minutes.</p>`
    });
    if (result.error) throw new Error(`Resend account verification email failed: ${result.error.message}`);
  }
}
