import { describe, expect, it } from "vitest";
import type { QuickBooksInvoiceStatus } from "../agreement/quickbooks-client";
import { PaymentFlowError, PaymentStatusService, type InvoiceStatusGateway, type PaymentRepository, type PaymentSession } from "./payment-service";

class Repo implements PaymentRepository {
  session: PaymentSession = {
    id: "session-1",
    normalizedEmail: "client@example.com",
    firstName: "Jane",
    phone: "+19185550123",
    assessmentYear: 2026,
    serviceAmount: 2997,
    currency: "USD",
    status: "PAYMENT_PENDING",
    statusTokenExpiresAt: new Date("2026-08-01T00:00:00Z"),
    qbInvoiceId: "invoice-1",
    qbInvoiceNumber: "1001",
    qbInvoiceBalance: 2997,
    accountCreationAllowed: false
  };
  stillOpen = 0; paid = 0; failed = 0; emails = 0; latestEmailSentAt: Date | null = null;
  async findSessionByTokenHash() { return this.session; }
  async findSessionByInvoiceId(invoiceId: string) { return invoiceId === this.session.qbInvoiceId ? this.session : null; }
  async findOpenInvoiceSessions() { return [this.session]; }
  async recordStillOpen(_sessionId: string, balance: number, checkedAt: Date) { this.stillOpen++; this.session.qbInvoiceBalance = balance; this.session.lastStatusCheckedAt = checkedAt; }
  async recordPaidVerified(_sessionId: string, balance: number, checkedAt: Date) { this.paid++; this.session.status = "PAID_VERIFIED"; this.session.qbInvoiceBalance = balance; this.session.lastStatusCheckedAt = checkedAt; this.session.paymentVerifiedAt = checkedAt; this.session.accountCreationAllowed = true; }
  async recordVerificationFailure() { this.failed++; }
  async findLatestInvoiceStatusEmailSentAt() { return this.latestEmailSentAt; }
  async recordInvoiceStatusEmail() { this.emails++; }
}

class Qbo implements InvoiceStatusGateway {
  invoice: QuickBooksInvoiceStatus = { id: "invoice-1", number: "1001", balance: 2997, totalAmount: 2997, currency: "USD" };
  sends = 0;
  async getInvoice() { return this.invoice; }
  async sendInvoice() { this.sends++; }
}

const token = "a".repeat(43);
const build = () => {
  const repo = new Repo();
  const qbo = new Qbo();
  const service = new PaymentStatusService(repo, qbo, { send: async () => undefined }, "https://assessments.savians.com", () => new Date("2026-07-05T12:00:00Z"));
  return { repo, qbo, service };
};

describe("PaymentStatusService", () => {
  it("keeps access locked when the QuickBooks invoice still has a balance", async () => {
    const { repo, service } = build();
    const result = await service.refresh(token);
    expect(result.status).toBe("PAYMENT_PENDING");
    expect(result.invoiceBalance).toBe(2997);
    expect(repo.stillOpen).toBe(1);
    expect(repo.paid).toBe(0);
    expect(repo.session.accountCreationAllowed).toBe(false);
  });

  it("marks paid only for the exact invoice amount, currency, and zero balance", async () => {
    const { repo, qbo, service } = build();
    qbo.invoice = { id: "invoice-1", number: "1001", balance: 0, totalAmount: 2997, currency: "USD" };
    const result = await service.refresh(token);
    expect(result.status).toBe("PAID_VERIFIED");
    expect(result.accountCreationAllowed).toBe(true);
    expect(repo.paid).toBe(1);
  });

  it("does not unlock access when QuickBooks returns a mismatched amount", async () => {
    const { repo, qbo, service } = build();
    qbo.invoice = { id: "invoice-1", number: "1001", balance: 0, totalAmount: 100, currency: "USD" };
    await expect(service.refresh(token)).rejects.toBeInstanceOf(PaymentFlowError);
    expect(repo.failed).toBe(1);
    expect(repo.session.accountCreationAllowed).toBe(false);
  });

  it("rate-limits invoice email resend", async () => {
    const { repo, qbo, service } = build();
    repo.latestEmailSentAt = new Date("2026-07-05T11:59:30Z");
    await expect(service.resendInvoiceEmail(token)).rejects.toMatchObject({
      code: "RESEND_RATE_LIMITED",
      retryAfterSeconds: 30
    });
    expect(qbo.sends).toBe(0);
  });

  it("exposes resend availability and starts a new cooldown after a successful resend", async () => {
    const { repo, qbo, service } = build();
    repo.latestEmailSentAt = new Date("2026-07-05T11:59:30Z");
    await expect(service.load(token)).resolves.toMatchObject({
      invoiceEmailResendAvailableAt: "2026-07-05T12:00:30.000Z"
    });
    repo.latestEmailSentAt = null;
    await expect(service.resendInvoiceEmail(token)).resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(qbo.sends).toBe(1);
  });
});
