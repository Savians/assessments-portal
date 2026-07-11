import { AssessmentStatus, DeliveryStatus, ReconciliationStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type { PaymentRepository, PaymentSession } from "./payment-service";

const toSession = (session: {
  id: string;
  normalizedEmail: string;
  firstName: string;
  phone: string;
  assessmentYear: number;
  serviceAmount: Prisma.Decimal;
  currency: string;
  status: AssessmentStatus;
  statusTokenExpiresAt: Date;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
  qbInvoiceBalance: Prisma.Decimal | null;
  invoiceSentAt: Date | null;
  lastStatusCheckedAt: Date | null;
  paymentVerifiedAt: Date | null;
  accountCreationAllowed: boolean;
}): PaymentSession => ({
  ...session,
  serviceAmount: session.serviceAmount.toNumber(),
  qbInvoiceBalance: session.qbInvoiceBalance?.toNumber(),
  status: session.status
});

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSessionByTokenHash(tokenHash: string): Promise<PaymentSession | null> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { statusTokenHash: tokenHash } });
    return session ? toSession(session) : null;
  }

  async findSessionByInvoiceId(invoiceId: string): Promise<PaymentSession | null> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { qbInvoiceId: invoiceId } });
    return session ? toSession(session) : null;
  }

  async findOpenInvoiceSessions(limit: number): Promise<PaymentSession[]> {
    const sessions = await this.prisma.assessmentSession.findMany({
      where: { status: { in: [AssessmentStatus.PAYMENT_PENDING, AssessmentStatus.PAYMENT_VERIFYING] }, qbInvoiceId: { not: null } },
      orderBy: [{ lastStatusCheckedAt: "asc" }, { updatedAt: "asc" }],
      take: limit
    });
    return sessions.map(toSession);
  }

  async recordStillOpen(sessionId: string, balance: number, checkedAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assessmentSession.update({
        where: { id: sessionId },
        data: { qbInvoiceBalance: balance, lastStatusCheckedAt: checkedAt }
      }),
      this.prisma.paymentReconciliation.create({
        data: { sessionId, status: ReconciliationStatus.STILL_OPEN, invoiceBalance: balance, checkedAt }
      }),
      this.prisma.auditLog.create({
        data: { sessionId, action: "PAYMENT_STILL_OPEN", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { balance } }
      })
    ]);
  }

  async recordPaidVerified(sessionId: string, balance: number, checkedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
      await tx.assessmentSession.update({
        where: { id: sessionId },
        data: { status: AssessmentStatus.PAID_VERIFIED, qbInvoiceBalance: balance, lastStatusCheckedAt: checkedAt, paymentVerifiedAt: checkedAt, accountCreationAllowed: true }
      });
      await tx.paymentReconciliation.create({
        data: { sessionId, status: ReconciliationStatus.VERIFIED_PAID, invoiceBalance: balance, checkedAt }
      });
      if (current.status !== AssessmentStatus.PAID_VERIFIED) {
        await tx.assessmentStatusHistory.create({
          data: { sessionId, oldStatus: current.status, newStatus: AssessmentStatus.PAID_VERIFIED, reason: "QuickBooks invoice balance verified as zero", actorType: "SYSTEM" }
        });
      }
      await tx.auditLog.create({
        data: { sessionId, action: "PAYMENT_VERIFIED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { balance } }
      });
    });
  }

  async recordVerificationFailure(sessionId: string, message: string, checkedAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assessmentSession.update({ where: { id: sessionId }, data: { lastStatusCheckedAt: checkedAt } }),
      this.prisma.paymentReconciliation.create({
        data: { sessionId, status: ReconciliationStatus.FAILED, checkedAt, errorMessage: message.slice(0, 1000) }
      }),
      this.prisma.auditLog.create({
        data: { sessionId, action: "PAYMENT_VERIFICATION_FAILED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { message: message.slice(0, 500) } }
      })
    ]);
  }

  async hasRecentInvoiceStatusEmail(sessionId: string, since: Date): Promise<boolean> {
    const recent = await this.prisma.emailEvent.findFirst({
      where: { sessionId, templateKey: "INVOICE_STATUS", status: DeliveryStatus.SENT, sentAt: { gte: since } },
      select: { id: true }
    });
    return Boolean(recent);
  }

  async recordInvoiceStatusEmail(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    failureReason?: string;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.emailEvent.create({
      data: {
        sessionId: input.sessionId,
        templateKey: "INVOICE_STATUS",
        recipientEmail: input.recipientEmail,
        status: DeliveryStatus[input.status],
        failureReason: input.failureReason,
        sentAt: input.status === "SENT" ? input.sentAt : undefined
      }
    });
  }
}
