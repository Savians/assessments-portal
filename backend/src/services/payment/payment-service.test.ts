import { describe, expect, it } from "vitest";
import type { QuickBooksInvoiceStatus } from "../agreement/quickbooks-client";
import {
  PaymentFlowError,
  PaymentStatusService,
  type InvoiceStatusGateway,
  type PaymentConfirmationNotifier,
  type PaymentRepository,
  type PaymentSession
} from "./payment-service";

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
  stillOpen = 0;
  paid = 0;
  failed = 0;
  invoiceResends = 0;
  supportRequests = 0;
  paymentConfirmationEvents: Array<{
    status: "SENT" | "FAILED" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
  }> = [];
  latestInvoiceResendAt: Date | null = null;
  latestSupportAt: Date | null = null;
  async findSessionByTokenHash() { return this.session; }
  async findSessionByInvoiceId(invoiceId: string) { return invoiceId === this.session.qbInvoiceId ? this.session : null; }
  async findOpenInvoiceSessions() {
    if (["PAYMENT_PENDING", "PAYMENT_VERIFYING"].includes(this.session.status)) {
      return [this.session];
    }
    if (
      [
        "PAID_VERIFIED",
        "ACCOUNT_INVITED",
        "ACCOUNT_CREATED",
        "PROFILE_IN_PROGRESS",
        "PROFILE_COMPLETED",
        "DOCUMENTS_IN_PROGRESS",
        "DOCUMENTS_SUBMITTED",
        "IN_PROGRESS",
        "COMPLETED"
      ].includes(this.session.status) &&
      this.session.accountCreationAllowed &&
      await this.shouldSendPaymentConfirmation(this.session.id)
    ) {
      return [this.session];
    }
    return [];
  }
  async recordStillOpen(_sessionId: string, balance: number, checkedAt: Date, invoiceNumber?: string) {
    this.stillOpen++;
    this.session.qbInvoiceBalance = balance;
    this.session.lastStatusCheckedAt = checkedAt;
    if (invoiceNumber) this.session.qbInvoiceNumber = invoiceNumber;
  }
  async recordPaidVerified(_sessionId: string, balance: number, checkedAt: Date, invoiceNumber?: string) {
    const transitioned = [
      "INVOICE_CREATED",
      "INVOICE_SENT",
      "PAYMENT_PENDING",
      "PAYMENT_VERIFYING"
    ].includes(this.session.status);
    if (transitioned) {
      this.paid++;
      this.session.status = "PAID_VERIFIED";
      this.session.paymentVerifiedAt = checkedAt;
      this.session.accountCreationAllowed = true;
    }
    this.session.qbInvoiceBalance = balance;
    this.session.lastStatusCheckedAt = checkedAt;
    if (invoiceNumber) this.session.qbInvoiceNumber = invoiceNumber;
    return { transitioned, session: this.session };
  }
  async recordVerificationFailure() { this.failed++; }
  async recordPaymentConfirmationEmail(input: Parameters<PaymentRepository["recordPaymentConfirmationEmail"]>[0]) {
    this.paymentConfirmationEvents.splice(0, this.paymentConfirmationEvents.length, {
      status: input.status,
      providerMessageId: input.providerMessageId,
      failureReason: input.failureReason
    });
  }
  async shouldSendPaymentConfirmation(_sessionId: string) {
    void _sessionId;
    return !this.paymentConfirmationEvents.some(
      (event) => event.status === "SENT"
    );
  }
  async findLatestInvoiceResendAt() { return this.latestInvoiceResendAt; }
  async recordInvoiceResend(input: Parameters<PaymentRepository["recordInvoiceResend"]>[0]) {
    this.invoiceResends++;
    this.latestInvoiceResendAt = input.sentAt;
  }
  async findLatestPaymentSupportRequestAt() { return this.latestSupportAt; }
  async recordPaymentSupportRequest() { this.supportRequests++; }
}

class Qbo implements InvoiceStatusGateway {
  invoice: QuickBooksInvoiceStatus = { id: "invoice-1", number: "1001", balance: 2997, totalAmount: 2997, currency: "USD" };
  sends = 0;
  sendRequestIds: string[] = [];
  async getInvoice() { return this.invoice; }
  async sendInvoice(_invoiceId: string, _email: string, requestId: string) {
    this.sends++;
    this.sendRequestIds.push(requestId);
  }
}

class ConfirmationNotifier implements PaymentConfirmationNotifier {
  calls = 0;
  mode: "SENT" | "SKIPPED" | "FAILED" = "SENT";
  inputs: Array<Parameters<PaymentConfirmationNotifier["sendPaymentConfirmed"]>[0]> = [];

  async sendPaymentConfirmed(
    input: Parameters<PaymentConfirmationNotifier["sendPaymentConfirmed"]>[0]
  ): Promise<{
    status: "SENT" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
  }> {
    this.calls++;
    this.inputs.push(input);
    if (this.mode === "FAILED") throw new Error("Resend timed out");
    if (this.mode === "SKIPPED") {
      return {
        status: "SKIPPED",
        failureReason: "Email is disabled"
      };
    }
    return {
      status: "SENT",
      providerMessageId: "resend-payment-1"
    };
  }
}

const token = "a".repeat(43);
const build = () => {
  const repo = new Repo();
  const qbo = new Qbo();
  const confirmation = new ConfirmationNotifier();
  let supportNotices = 0;
  const service = new PaymentStatusService(
    repo,
    qbo,
    { sendPaymentSupport: async () => { supportNotices++; } },
    confirmation,
    "https://assessments.savians.com",
    () => new Date("2026-07-05T12:00:00Z")
  );
  return { repo, qbo, confirmation, service, supportNotices: () => supportNotices };
};

describe("PaymentStatusService", () => {
  it("keeps access locked when the QuickBooks invoice still has a balance", async () => {
    const { repo, service } = build();
    repo.session.qbInvoiceNumber = null;
    const result = await service.refresh(token);
    expect(result.status).toBe("PAYMENT_PENDING");
    expect(result.invoiceNumber).toBe("1001");
    expect(result.invoiceBalance).toBe(2997);
    expect(repo.stillOpen).toBe(1);
    expect(repo.paid).toBe(0);
    expect(repo.session.qbInvoiceNumber).toBe("1001");
    expect(repo.session.accountCreationAllowed).toBe(false);
  });

  it("marks paid only for the exact invoice amount, currency, and zero balance", async () => {
    const { repo, qbo, confirmation, service } = build();
    repo.session.qbInvoiceNumber = null;
    qbo.invoice = { id: "invoice-1", number: "1001", balance: 0, totalAmount: 2997, currency: "USD" };
    const result = await service.refresh(token);
    expect(result.status).toBe("PAID_VERIFIED");
    expect(result.invoiceNumber).toBe("1001");
    expect(result.accountCreationAllowed).toBe(true);
    expect(repo.paid).toBe(1);
    expect(repo.session.qbInvoiceNumber).toBe("1001");
    expect(confirmation.calls).toBe(1);
    expect(confirmation.inputs[0]).toMatchObject({
      sessionId: "session-1",
      invoiceNumber: "1001",
      continueUrl: "https://assessments.savians.com/assessment/recover?stage=account"
    });
    expect(repo.paymentConfirmationEvents).toEqual([
      {
        status: "SENT",
        providerMessageId: "resend-payment-1",
        failureReason: undefined
      }
    ]);
  });

  it("preserves a known invoice number when QuickBooks omits DocNumber", async () => {
    const { repo, qbo, service } = build();
    qbo.invoice = {
      id: "invoice-1",
      balance: 2997,
      totalAmount: 2997,
      currency: "USD"
    };

    await expect(service.refresh(token)).resolves.toMatchObject({
      status: "PAYMENT_PENDING",
      invoiceNumber: "1001"
    });
    expect(repo.session.qbInvoiceNumber).toBe("1001");
  });

  it("sends payment confirmation once across manual refresh, webhook, and scheduler reconciliation", async () => {
    const { repo, qbo, confirmation, service } = build();
    qbo.invoice = {
      id: "invoice-1",
      number: "1001",
      balance: 0,
      totalAmount: 2997,
      currency: "USD"
    };

    await service.refresh(token);
    await service.reconcileInvoiceId("invoice-1");
    await service.reconcileOpenInvoices();

    expect(repo.paid).toBe(1);
    expect(confirmation.calls).toBe(1);
    expect(repo.paymentConfirmationEvents).toHaveLength(1);
    expect(repo.paymentConfirmationEvents[0]?.status).toBe("SENT");
  });

  it("keeps payment verification non-blocking and retries a failed confirmation idempotently", async () => {
    const { repo, qbo, confirmation, service } = build();
    qbo.invoice = {
      id: "invoice-1",
      number: "1001",
      balance: 0,
      totalAmount: 2997,
      currency: "USD"
    };
    confirmation.mode = "FAILED";

    await expect(service.refresh(token)).resolves.toMatchObject({
      status: "PAID_VERIFIED",
      accountCreationAllowed: true
    });
    expect(repo.failed).toBe(0);
    expect(repo.paymentConfirmationEvents).toEqual([
      {
        status: "FAILED",
        providerMessageId: undefined,
        failureReason: "Resend timed out"
      }
    ]);

    confirmation.mode = "SENT";
    await expect(service.reconcileOpenInvoices()).resolves.toMatchObject({
      checked: 1,
      verifiedPaid: 1,
      failed: 0
    });
    expect(repo.paid).toBe(1);
    expect(confirmation.calls).toBe(2);
    expect(repo.paymentConfirmationEvents).toHaveLength(1);
    expect(repo.paymentConfirmationEvents[0]?.status).toBe("SENT");
  });

  it("retries a skipped confirmation after email delivery is configured", async () => {
    const { repo, qbo, confirmation, service } = build();
    qbo.invoice = {
      id: "invoice-1",
      number: "1001",
      balance: 0,
      totalAmount: 2997,
      currency: "USD"
    };
    confirmation.mode = "SKIPPED";

    await expect(service.refresh(token)).resolves.toMatchObject({
      status: "PAID_VERIFIED"
    });
    confirmation.mode = "SENT";
    await expect(service.reconcileOpenInvoices()).resolves.toMatchObject({
      checked: 1,
      verifiedPaid: 1,
      failed: 0
    });
    expect(confirmation.calls).toBe(2);
    expect(repo.paymentConfirmationEvents[0]).toEqual({
      status: "SENT",
      providerMessageId: "resend-payment-1",
      failureReason: undefined
    });
  });

  it.each([
    "ACCOUNT_INVITED",
    "ACCOUNT_CREATED",
    "PROFILE_IN_PROGRESS",
    "PROFILE_COMPLETED",
    "DOCUMENTS_IN_PROGRESS",
    "DOCUMENTS_SUBMITTED",
    "IN_PROGRESS",
    "COMPLETED"
  ] as const)("retries a missing confirmation without downgrading %s", async (status) => {
    const { repo, qbo, confirmation, service } = build();
    repo.session.status = status;
    repo.session.accountCreationAllowed = true;
    repo.session.paymentVerifiedAt = new Date("2026-07-05T11:00:00Z");
    qbo.invoice = {
      id: "invoice-1",
      number: "1001",
      balance: 0,
      totalAmount: 2997,
      currency: "USD"
    };

    await expect(service.reconcileInvoiceId("invoice-1")).resolves.toMatchObject({
      status,
      accountCreationAllowed: true
    });
    expect(repo.session.status).toBe(status);
    expect(repo.paid).toBe(0);
    expect(confirmation.calls).toBe(1);
    expect(repo.paymentConfirmationEvents[0]?.status).toBe("SENT");
  });

  it("does not resend a completed confirmation after account setup advances", async () => {
    const { repo, qbo, confirmation, service } = build();
    repo.session.status = "ACCOUNT_INVITED";
    repo.session.accountCreationAllowed = true;
    repo.paymentConfirmationEvents.push({
      status: "SENT",
      providerMessageId: "resend-payment-1"
    });
    qbo.invoice = {
      id: "invoice-1",
      number: "1001",
      balance: 0,
      totalAmount: 2997,
      currency: "USD"
    };

    await expect(service.reconcileInvoiceId("invoice-1")).resolves.toMatchObject({
      status: "ACCOUNT_INVITED"
    });
    expect(repo.session.status).toBe("ACCOUNT_INVITED");
    expect(confirmation.calls).toBe(0);
    expect(repo.paymentConfirmationEvents).toHaveLength(1);
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
    repo.latestInvoiceResendAt = new Date("2026-07-05T11:59:30Z");
    await expect(service.resendInvoiceEmail(token)).rejects.toMatchObject({
      code: "RESEND_RATE_LIMITED",
      retryAfterSeconds: 30
    });
    expect(qbo.sends).toBe(0);
  });

  it("exposes resend availability and starts a new cooldown after a successful resend", async () => {
    const { repo, qbo, service } = build();
    repo.latestInvoiceResendAt = new Date("2026-07-05T11:59:30Z");
    await expect(service.load(token)).resolves.toMatchObject({
      invoiceResendAllowed: true,
      invoiceEmailResendAvailableAt: "2026-07-05T12:00:30.000Z"
    });
    repo.latestInvoiceResendAt = null;
    await expect(service.resendInvoiceEmail(token)).resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(qbo.sends).toBe(1);
    expect(qbo.sendRequestIds[0]).toHaveLength(50);
    expect(repo.invoiceResends).toBe(1);
    await expect(service.resendInvoiceEmail(token)).rejects.toMatchObject({
      code: "RESEND_RATE_LIMITED",
      retryAfterSeconds: 60
    });
  });

  it("allows QuickBooks resend when the optional invoice number is absent", async () => {
    const { repo, qbo, service } = build();
    repo.session.qbInvoiceNumber = null;

    await expect(service.load(token)).resolves.toMatchObject({
      invoiceNumber: undefined,
      invoiceResendAllowed: true
    });
    await expect(service.resendInvoiceEmail(token)).resolves.toEqual({
      ok: true,
      retryAfterSeconds: 60
    });
    expect(qbo.sends).toBe(1);
    expect(repo.invoiceResends).toBe(1);
  });

  it("does not offer or send invoice email after payment is verified", async () => {
    const { repo, qbo, service } = build();
    repo.session.status = "PAID_VERIFIED";
    repo.session.accountCreationAllowed = true;

    await expect(service.load(token)).resolves.toMatchObject({
      invoiceResendAllowed: false
    });
    await expect(service.resendInvoiceEmail(token)).rejects.toMatchObject({
      code: "INVOICE_NOT_SENDABLE",
      statusCode: 409
    });
    expect(qbo.sends).toBe(0);
  });

  it("notifies Savians about an open payment without unlocking access", async () => {
    const { repo, service, supportNotices } = build();
    await expect(service.requestPaymentSupport(token)).resolves.toEqual({ ok: true, retryAfterSeconds: 600 });
    expect(supportNotices()).toBe(1);
    expect(repo.supportRequests).toBe(1);
    expect(repo.session.accountCreationAllowed).toBe(false);
  });

  it("rate-limits duplicate payment support requests", async () => {
    const { repo, service, supportNotices } = build();
    repo.latestSupportAt = new Date("2026-07-05T11:55:00Z");
    await expect(service.requestPaymentSupport(token)).rejects.toMatchObject({ code: "PAYMENT_SUPPORT_RATE_LIMITED", retryAfterSeconds: 300 });
    expect(supportNotices()).toBe(0);
  });
});
