import { createHash } from "node:crypto";
import type { QuickBooksInvoiceStatus } from "../agreement/quickbooks-client";

export type PaymentSessionStatus =
  | "AGREEMENT_PENDING"
  | "AGREEMENT_SIGNED"
  | "QB_CUSTOMER_CREATED"
  | "INVOICE_CREATED"
  | "INVOICE_SENT"
  | "PAYMENT_PENDING"
  | "PAYMENT_VERIFYING"
  | "PAID_VERIFIED"
  | "ACCOUNT_INVITED"
  | "ACCOUNT_CREATED"
  | "PROFILE_IN_PROGRESS"
  | "PROFILE_COMPLETED"
  | "DOCUMENTS_IN_PROGRESS"
  | "DOCUMENTS_SUBMITTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ERROR";

export interface PaymentSession {
  id: string;
  normalizedEmail: string;
  firstName: string;
  phone: string;
  assessmentYear: number;
  serviceAmount: number;
  currency: string;
  status: PaymentSessionStatus;
  statusTokenExpiresAt: Date;
  qbInvoiceId?: string | null;
  qbInvoiceNumber?: string | null;
  qbInvoiceBalance?: number | null;
  invoiceSentAt?: Date | null;
  lastStatusCheckedAt?: Date | null;
  paymentVerifiedAt?: Date | null;
  accountCreationAllowed: boolean;
}

export interface PaymentRepository {
  findSessionByTokenHash(tokenHash: string): Promise<PaymentSession | null>;
  findSessionByInvoiceId(invoiceId: string): Promise<PaymentSession | null>;
  findOpenInvoiceSessions(limit: number): Promise<PaymentSession[]>;
  recordStillOpen(sessionId: string, balance: number, checkedAt: Date): Promise<void>;
  recordPaidVerified(sessionId: string, balance: number, checkedAt: Date): Promise<void>;
  recordVerificationFailure(sessionId: string, message: string, checkedAt: Date): Promise<void>;
  findLatestInvoiceStatusEmailSentAt(sessionId: string): Promise<Date | null>;
  recordInvoiceStatusEmail(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    failureReason?: string;
    sentAt: Date;
  }): Promise<void>;
  findLatestPaymentSupportRequestAt(sessionId: string): Promise<Date | null>;
  recordPaymentSupportRequest(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED";
    failureReason?: string;
    sentAt: Date;
  }): Promise<void>;
}

export interface InvoiceStatusGateway {
  getInvoice(invoiceId: string): Promise<QuickBooksInvoiceStatus>;
  sendInvoice(invoiceId: string, email: string, requestId: string): Promise<void>;
}

export interface PaymentNotifier {
  send(input: { sessionId: string; email: string; firstName: string; invoiceNumber?: string; amount: number; statusUrl: string }): Promise<void>;
  sendPaymentSupport(input: { sessionId: string; email: string; firstName: string; phone: string; assessmentYear: number; invoiceNumber?: string; balance?: number | null; amount: number; statusUrl: string }): Promise<void>;
}

export class PaymentFlowError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

const hashStatusToken = (token: string) => createHash("sha256").update(token).digest("hex");
const requestId = (kind: string, sessionId: string) => createHash("sha256").update(`${kind}:${sessionId}`).digest("hex").slice(0, 50);
const moneyEquals = (left: number | undefined, right: number) => Math.round((left ?? Number.NaN) * 100) === Math.round(right * 100);
export const INVOICE_RESEND_COOLDOWN_SECONDS = 60;
export const PAYMENT_SUPPORT_COOLDOWN_SECONDS = 600;

export class PaymentStatusService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly quickBooks: InvoiceStatusGateway,
    private readonly notifier: PaymentNotifier,
    private readonly frontendUrl: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async load(token: string) {
    const session = await this.resolveToken(token);
    return this.toResponse(session, token, await this.resendAvailableAt(session.id));
  }

  async refresh(token: string) {
    const session = await this.resolveToken(token);
    if (!session.qbInvoiceId) return this.toResponse(session, token);
    const refreshed = await this.verifyInvoice(session);
    return this.toResponse(refreshed, token, await this.resendAvailableAt(session.id));
  }

  async resendInvoiceEmail(token: string) {
    const session = await this.resolveToken(token);
    if (!session.qbInvoiceId) throw new PaymentFlowError("INVOICE_NOT_READY", "The QuickBooks invoice is not ready yet.", 409);
    if (!["PAYMENT_PENDING", "PAYMENT_VERIFYING", "PAID_VERIFIED"].includes(session.status)) {
      throw new PaymentFlowError("INVOICE_NOT_SENDABLE", "This assessment is not ready for invoice resend.", 409);
    }
    const availableAt = await this.resendAvailableAt(session.id);
    if (availableAt) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(availableAt).getTime() - this.now().getTime()) / 1000));
      throw new PaymentFlowError("RESEND_RATE_LIMITED", `Please wait ${retryAfterSeconds} seconds before resending the invoice email.`, 429, retryAfterSeconds);
    }
    await this.quickBooks.sendInvoice(session.qbInvoiceId, session.normalizedEmail, requestId("manual-send-invoice", session.id));
    const statusUrl = `${this.frontendUrl.replace(/\/$/, "")}/assessment/status/${token}`;
    try {
      await this.notifier.send({
        sessionId: session.id,
        email: session.normalizedEmail,
        firstName: session.firstName,
        invoiceNumber: session.qbInvoiceNumber ?? undefined,
        amount: session.serviceAmount,
        statusUrl
      });
      await this.repository.recordInvoiceStatusEmail({ sessionId: session.id, recipientEmail: session.normalizedEmail, status: "SENT", sentAt: this.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification error";
      await this.repository.recordInvoiceStatusEmail({ sessionId: session.id, recipientEmail: session.normalizedEmail, status: "FAILED", failureReason: message, sentAt: this.now() });
      throw new PaymentFlowError("RESEND_EMAIL_FAILED", "QuickBooks was asked to resend the invoice, but the Savians status email failed.", 502);
    }
    return { ok: true, retryAfterSeconds: INVOICE_RESEND_COOLDOWN_SECONDS };
  }

  async requestPaymentSupport(token: string) {
    const session = await this.resolveToken(token);
    if (!session.qbInvoiceId || !["PAYMENT_PENDING", "PAYMENT_VERIFYING"].includes(session.status)) {
      throw new PaymentFlowError("PAYMENT_SUPPORT_NOT_AVAILABLE", "Payment support is available while a QuickBooks invoice is awaiting payment.", 409);
    }
    const latest = await this.repository.findLatestPaymentSupportRequestAt(session.id);
    if (latest) {
      const availableAt = new Date(latest.getTime() + PAYMENT_SUPPORT_COOLDOWN_SECONDS * 1000);
      if (availableAt.getTime() > this.now().getTime()) {
        const retryAfterSeconds = Math.max(1, Math.ceil((availableAt.getTime() - this.now().getTime()) / 1000));
        throw new PaymentFlowError("PAYMENT_SUPPORT_RATE_LIMITED", `Savians was already notified. You can send another request in ${retryAfterSeconds} seconds.`, 429, retryAfterSeconds);
      }
    }
    const statusUrl = `${this.frontendUrl.replace(/\/$/, "")}/assessment/status/${token}`;
    const recipientEmail = "contactus@savians.com";
    try {
      await this.notifier.sendPaymentSupport({
        sessionId: session.id, email: session.normalizedEmail, firstName: session.firstName,
        phone: session.phone, assessmentYear: session.assessmentYear, invoiceNumber: session.qbInvoiceNumber ?? undefined,
        balance: session.qbInvoiceBalance, amount: session.serviceAmount, statusUrl
      });
      await this.repository.recordPaymentSupportRequest({ sessionId: session.id, recipientEmail, status: "SENT", sentAt: this.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown payment support notification error";
      await this.repository.recordPaymentSupportRequest({ sessionId: session.id, recipientEmail, status: "FAILED", failureReason: message, sentAt: this.now() });
      throw new PaymentFlowError("PAYMENT_SUPPORT_EMAIL_FAILED", "We could not notify Savians automatically. Please email contactus@savians.com.", 502);
    }
    return { ok: true, retryAfterSeconds: PAYMENT_SUPPORT_COOLDOWN_SECONDS };
  }

  async reconcileInvoiceId(invoiceId: string): Promise<PaymentSession | null> {
    const session = await this.repository.findSessionByInvoiceId(invoiceId);
    if (!session) return null;
    return this.verifyInvoice(session);
  }

  async reconcileOpenInvoices(limit = 25): Promise<{ checked: number; verifiedPaid: number; failed: number }> {
    const sessions = await this.repository.findOpenInvoiceSessions(limit);
    let verifiedPaid = 0;
    let failed = 0;
    for (const session of sessions) {
      try {
        const result = await this.verifyInvoice(session);
        if (result.status === "PAID_VERIFIED") verifiedPaid++;
      } catch {
        failed++;
      }
    }
    return { checked: sessions.length, verifiedPaid, failed };
  }

  private async resolveToken(token: string): Promise<PaymentSession> {
    const session = await this.repository.findSessionByTokenHash(hashStatusToken(token));
    if (!session) throw new PaymentFlowError("INVALID_TOKEN", "This status link is invalid.", 404);
    if (session.statusTokenExpiresAt.getTime() <= this.now().getTime()) throw new PaymentFlowError("EXPIRED_TOKEN", "This status link has expired.", 410);
    return session;
  }

  private async verifyInvoice(session: PaymentSession): Promise<PaymentSession> {
    if (!session.qbInvoiceId) return session;
    const checkedAt = this.now();
    try {
      const invoice = await this.quickBooks.getInvoice(session.qbInvoiceId);
      if (invoice.id !== session.qbInvoiceId) throw new Error("QuickBooks returned a different invoice ID");
      if (invoice.currency && invoice.currency !== session.currency) throw new Error(`Invoice currency mismatch: expected ${session.currency}, received ${invoice.currency}`);
      if (!moneyEquals(invoice.totalAmount, session.serviceAmount)) throw new Error(`Invoice amount mismatch: expected ${session.serviceAmount}, received ${invoice.totalAmount ?? "unknown"}`);
      if (moneyEquals(invoice.balance, 0)) {
        await this.repository.recordPaidVerified(session.id, invoice.balance, checkedAt);
        return { ...session, status: "PAID_VERIFIED", qbInvoiceBalance: invoice.balance, lastStatusCheckedAt: checkedAt, paymentVerifiedAt: checkedAt, accountCreationAllowed: true };
      }
      await this.repository.recordStillOpen(session.id, invoice.balance, checkedAt);
      return { ...session, qbInvoiceBalance: invoice.balance, lastStatusCheckedAt: checkedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown QuickBooks verification error";
      await this.repository.recordVerificationFailure(session.id, message, checkedAt);
      throw new PaymentFlowError("PAYMENT_VERIFICATION_FAILED", "Payment could not be verified safely. Please try again.", 502);
    }
  }

  private async resendAvailableAt(sessionId: string): Promise<string | undefined> {
    const latest = await this.repository.findLatestInvoiceStatusEmailSentAt(sessionId);
    if (!latest) return undefined;
    const availableAt = new Date(latest.getTime() + INVOICE_RESEND_COOLDOWN_SECONDS * 1000);
    return availableAt.getTime() > this.now().getTime() ? availableAt.toISOString() : undefined;
  }

  private toResponse(session: PaymentSession, token: string, invoiceEmailResendAvailableAt?: string) {
    return {
      status: session.status,
      invoiceNumber: session.qbInvoiceNumber ?? undefined,
      invoiceBalance: session.qbInvoiceBalance ?? undefined,
      invoiceAmount: session.serviceAmount,
      currency: session.currency,
      lastStatusCheckedAt: session.lastStatusCheckedAt?.toISOString(),
      paymentVerifiedAt: session.paymentVerifiedAt?.toISOString(),
      accountCreationAllowed: session.accountCreationAllowed,
      invoiceEmailResendAvailableAt,
      nextUrl: session.status === "PAID_VERIFIED" || session.status === "ACCOUNT_INVITED" ? "/assessment/recover?stage=account" : `/assessment/status/${token}`
    };
  }
}
