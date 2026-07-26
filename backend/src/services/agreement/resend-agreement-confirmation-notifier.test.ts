import { describe, expect, it } from "vitest";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import {
  buildAgreementConfirmationEmail,
  ResendAgreementConfirmationNotifier,
  type AgreementEmailClient
} from "./resend-agreement-confirmation-notifier";

const secrets: ApplicationSecrets = {
  DATABASE_URL: "postgresql://test",
  RESEND_API_KEY: "re_test",
  EMAIL_ENABLED: true,
  EMAIL_FROM: "contactus@savians.com",
  EMAIL_REPLY_TO: "contactus@savians.com",
  QB_ENVIRONMENT: "sandbox",
  QB_BASE_URL: "https://sandbox-quickbooks.api.intuit.com/v3"
};

describe("buildAgreementConfirmationEmail", () => {
  it("includes the signed-agreement confirmation, secure download link, and expiry", () => {
    const result = buildAgreementConfirmationEmail({
      recipientName: "Jane Client",
      assessmentYear: 2026,
      agreementTitle: "Tax Assessment Plan Legal Service Agreement",
      signedAt: new Date("2026-07-05T12:00:00.000Z"),
      downloadUrl: "https://assessments.savians.com/assessment/agreement/download/private-token",
      downloadExpiresAt: new Date("2026-08-04T12:00:00.000Z")
    });

    expect(result.subject).toBe("Your signed 2026 Savians agreement");
    expect(result.text).toContain("You successfully signed");
    expect(result.text).toContain("/assessment/agreement/download/private-token");
    expect(result.text).toContain("expires on August 4, 2026");
    expect(result.html).toContain("Download Signed Agreement PDF");
  });

  it("escapes client-controlled values in HTML", () => {
    const result = buildAgreementConfirmationEmail({
      recipientName: '<script>alert("name")</script>',
      assessmentYear: 2026,
      agreementTitle: '<img src=x onerror="alert(1)">',
      signedAt: new Date("2026-07-05T12:00:00.000Z"),
      downloadUrl: 'https://example.com/?next="unsafe"&value=<unsafe>',
      downloadExpiresAt: new Date("2026-08-04T12:00:00.000Z")
    });

    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&quot;unsafe&quot;&amp;value=&lt;unsafe&gt;");
  });

  it("passes a deterministic idempotency key to Resend and returns its message id", async () => {
    const calls: Array<{ options: { idempotencyKey: string }; subject: string }> = [];
    const client: AgreementEmailClient = {
      async send(payload, options) {
        calls.push({ options, subject: payload.subject });
        return { data: { id: "resend-message-1" }, error: null };
      }
    };
    const notifier = new ResendAgreementConfirmationNotifier(secrets, client);

    const result = await notifier.send({
      recipientEmail: "jane@example.com",
      recipientName: "Jane Client",
      assessmentYear: 2026,
      agreementTitle: "Tax Assessment Plan Legal Service Agreement",
      signedAt: new Date("2026-07-05T12:00:00.000Z"),
      downloadUrl: "https://assessments.savians.com/assessment/agreement/download/private-token",
      downloadExpiresAt: new Date("2026-08-04T12:00:00.000Z"),
      idempotencyKey: "agreement-signed-session-1"
    });

    expect(result).toEqual({ status: "SENT", providerMessageId: "resend-message-1" });
    expect(calls).toEqual([{
      options: { idempotencyKey: "agreement-signed-session-1" },
      subject: "Your signed 2026 Savians agreement"
    }]);
  });

  it("reports a Resend rejection to the service for persisted failure handling", async () => {
    const client: AgreementEmailClient = {
      async send() {
        return { data: null, error: { message: "recipient suppressed" } };
      }
    };
    const notifier = new ResendAgreementConfirmationNotifier(secrets, client);

    await expect(notifier.send({
      recipientEmail: "jane@example.com",
      recipientName: "Jane Client",
      assessmentYear: 2026,
      agreementTitle: "Tax Assessment Plan Legal Service Agreement",
      signedAt: new Date("2026-07-05T12:00:00.000Z"),
      downloadUrl: "https://assessments.savians.com/assessment/agreement/download/private-token",
      downloadExpiresAt: new Date("2026-08-04T12:00:00.000Z"),
      idempotencyKey: "agreement-signed-session-1"
    })).rejects.toThrow("Resend agreement confirmation email failed: recipient suppressed");
  });
});
