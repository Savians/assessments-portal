import { createHash } from "node:crypto";
import { log } from "../../shared/logger";
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
  recordPaidVerified(
    sessionId: string,
    balance: number,
    checkedAt: Date
  ): Promise<{ transitioned: boolean; session: PaymentSession }>;
  recordVerificationFailure(sessionId: string, message: string, checkedAt: Date): Promise<void>;
  recordPaymentConfirmationEmail(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
    sentAt: Date;
  }): Promise<void>;
  shouldSendPaymentConfirmation(sessionId: string): Promise<boolean>;
  findLatestInvoiceResendAt(sessionId: string): Promise<Date | null>;
  recordInvoiceResend(input: {
    sessionId: string;
    recipientEmail: string;
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

export interface PaymentSupportNotifier {
  sendPaymentSupport(input: { sessionId: string; email: string; firstName: string; phone: string; assessmentYear: number; invoiceNumber?: string; balance?: number | null; amount: number; statusUrl: string }): Promise<void>;
}

export interface PaymentConfirmationNotifier {
  sendPaymentConfirmed(input: {
    sessionId: string;
    email: string;
    firstName: string;
    assessmentYear: number;
    invoiceNumber?: string;
    continueUrl: string;
  }): Promise<{
    status: "SENT" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
  }>;
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
const invoiceResendStatuses = new Set<PaymentSessionStatus>(["PAYMENT_PENDING", "PAYMENT_VERIFYING"]);
const invoiceResendAllowed = (session: PaymentSession) =>
  Boolean(session.qbInvoiceId && invoiceResendStatuses.has(session.status));
const invoiceResendRequestId = (sessionId: string, at: Date) =>
  requestId(
    "manual-send-invoice",
    `${sessionId}:${Math.floor(at.getTime() / (INVOICE_RESEND_COOLDOWN_SECONDS * 1000))}`
  );

export class PaymentStatusService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly quickBooks: InvoiceStatusGateway,
    private readonly supportNotifier: PaymentSupportNotifier,
    private readonly confirmationNotifier: PaymentConfirmationNotifier,
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
    if (!invoiceResendAllowed(session)) {
      throw new PaymentFlowError("INVOICE_NOT_SENDABLE", "This assessment is not ready for invoice resend.", 409);
    }
    const availableAt = await this.resendAvailableAt(session.id);
    if (availableAt) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(availableAt).getTime() - this.now().getTime()) / 1000));
      throw new PaymentFlowError("RESEND_RATE_LIMITED", `Please wait ${retryAfterSeconds} seconds before resending the invoice email.`, 429, retryAfterSeconds);
    }
    const sentAt = this.now();
    await this.quickBooks.sendInvoice(
      session.qbInvoiceId,
      session.normalizedEmail,
      invoiceResendRequestId(session.id, sentAt)
    );
    await this.repository.recordInvoiceResend({
      sessionId: session.id,
      recipientEmail: session.normalizedEmail,
      sentAt
    });
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
      await this.supportNotifier.sendPaymentSupport({
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
        const verified = await this.repository.recordPaidVerified(
          session.id,
          invoice.balance,
          checkedAt
        );
        if (
          verified.session.accountCreationAllowed &&
          await this.repository.shouldSendPaymentConfirmation(verified.session.id)
        ) {
          await this.sendPaymentConfirmation(verified.session, checkedAt);
        }
        return verified.session;
      }
      await this.repository.recordStillOpen(session.id, invoice.balance, checkedAt);
      return { ...session, qbInvoiceBalance: invoice.balance, lastStatusCheckedAt: checkedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown QuickBooks verification error";
      await this.repository.recordVerificationFailure(session.id, message, checkedAt);
      throw new PaymentFlowError("PAYMENT_VERIFICATION_FAILED", "Payment could not be verified safely. Please try again.", 502);
    }
  }

  private async sendPaymentConfirmation(
    session: PaymentSession,
    sentAt: Date
  ): Promise<void> {
    const continueUrl =
      `${this.frontendUrl.replace(/\/$/, "")}/assessment/recover?stage=account`;
    let delivery: {
      status: "SENT" | "FAILED" | "SKIPPED";
      providerMessageId?: string;
      failureReason?: string;
    };

    try {
      delivery = await this.confirmationNotifier.sendPaymentConfirmed({
        sessionId: session.id,
        email: session.normalizedEmail,
        firstName: session.firstName,
        assessmentYear: session.assessmentYear,
        invoiceNumber: session.qbInvoiceNumber ?? undefined,
        continueUrl
      });
    } catch (error) {
      delivery = {
        status: "FAILED",
        failureReason:
          error instanceof Error
            ? error.message
            : "Unknown payment confirmation email error"
      };
    }

    try {
      await this.repository.recordPaymentConfirmationEmail({
        sessionId: session.id,
        recipientEmail: session.normalizedEmail,
        status: delivery.status,
        providerMessageId: delivery.providerMessageId,
        failureReason: delivery.failureReason,
        sentAt
      });
    } catch (error) {
      log("error", "payment confirmation email event could not be recorded", {
        sessionId: session.id,
        deliveryStatus: delivery.status,
        error: error instanceof Error ? error.message : "Unknown persistence error"
      });
    }
  }

  private async resendAvailableAt(sessionId: string): Promise<string | undefined> {
    const latest = await this.repository.findLatestInvoiceResendAt(sessionId);
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
      invoiceResendAllowed: invoiceResendAllowed(session),
      invoiceEmailResendAvailableAt,
      nextUrl: session.status === "PAID_VERIFIED" || session.status === "ACCOUNT_INVITED" ? "/assessment/recover?stage=account" : `/assessment/status/${token}`
    };
  }
}
