import {
  AssessmentStatus,
  DeliveryStatus,
  Prisma,
  ReconciliationStatus,
  type PrismaClient
} from "@prisma/client";
import { findAssessmentSessionByAccessTokenHash } from "../../shared/assessment-access-token";
import type { PaymentRepository, PaymentSession } from "./payment-service";

const paymentPendingStatuses = [
  AssessmentStatus.INVOICE_CREATED,
  AssessmentStatus.INVOICE_SENT,
  AssessmentStatus.PAYMENT_PENDING,
  AssessmentStatus.PAYMENT_VERIFYING
];

const paymentConfirmationRetryStatuses = [
  AssessmentStatus.PAID_VERIFIED,
  AssessmentStatus.ACCOUNT_INVITED,
  AssessmentStatus.ACCOUNT_CREATED,
  AssessmentStatus.PROFILE_IN_PROGRESS,
  AssessmentStatus.PROFILE_COMPLETED,
  AssessmentStatus.DOCUMENTS_IN_PROGRESS,
  AssessmentStatus.DOCUMENTS_SUBMITTED,
  AssessmentStatus.IN_PROGRESS,
  AssessmentStatus.COMPLETED
];

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
    const session = await findAssessmentSessionByAccessTokenHash(this.prisma, tokenHash);
    return session ? toSession(session) : null;
  }

  async findSessionByInvoiceId(invoiceId: string): Promise<PaymentSession | null> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { qbInvoiceId: invoiceId } });
    return session ? toSession(session) : null;
  }

  async findOpenInvoiceSessions(limit: number): Promise<PaymentSession[]> {
    const sessions = await this.prisma.assessmentSession.findMany({
      where: {
        qbInvoiceId: { not: null },
        OR: [
          {
            status: {
              in: [
                AssessmentStatus.PAYMENT_PENDING,
                AssessmentStatus.PAYMENT_VERIFYING
              ]
            }
          },
          {
            status: { in: paymentConfirmationRetryStatuses },
            accountCreationAllowed: true,
            emailEvents: {
              none: {
                templateKey: "PAYMENT_CONFIRMED",
                status: DeliveryStatus.SENT
              }
            }
          }
        ]
      },
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

  async recordPaidVerified(
    sessionId: string,
    balance: number,
    checkedAt: Date
  ): Promise<{ transitioned: boolean; session: PaymentSession }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
      const transition = await tx.assessmentSession.updateMany({
        where: {
          id: sessionId,
          status: { in: paymentPendingStatuses }
        },
        data: { status: AssessmentStatus.PAID_VERIFIED, qbInvoiceBalance: balance, lastStatusCheckedAt: checkedAt, paymentVerifiedAt: checkedAt, accountCreationAllowed: true }
      });
      const transitioned = transition.count === 1;
      if (!transitioned) {
        // A concurrent verifier may have won the transition, or account setup may
        // already be farther along. Refresh reconciliation metadata without ever
        // moving a later journey status backward to PAID_VERIFIED.
        await tx.assessmentSession.update({
          where: { id: sessionId },
          data: { qbInvoiceBalance: balance, lastStatusCheckedAt: checkedAt }
        });
      }
      await tx.paymentReconciliation.create({
        data: { sessionId, status: ReconciliationStatus.VERIFIED_PAID, invoiceBalance: balance, checkedAt }
      });
      if (transitioned) {
        await tx.assessmentStatusHistory.create({
          data: { sessionId, oldStatus: current.status, newStatus: AssessmentStatus.PAID_VERIFIED, reason: "QuickBooks invoice balance verified as zero", actorType: "SYSTEM" }
        });
      }
      await tx.auditLog.create({
        data: { sessionId, action: "PAYMENT_VERIFIED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { balance, firstTransition: transitioned } }
      });
      const updated = await tx.assessmentSession.findUniqueOrThrow({
        where: { id: sessionId }
      });
      return { transitioned, session: toSession(updated) };
    });
  }

  async recordPaymentConfirmationEmail(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    providerMessageId?: string;
    failureReason?: string;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialize event upserts per assessment. Resend's idempotency key prevents
      // duplicate delivery; this lock prevents concurrent retries creating
      // duplicate PAYMENT_CONFIRMED event rows.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "assessment_sessions" WHERE "id" = ${input.sessionId}::uuid FOR UPDATE`
      );
      const existing = await tx.emailEvent.findFirst({
        where: {
          sessionId: input.sessionId,
          templateKey: "PAYMENT_CONFIRMED"
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true }
      });
      const eventData = {
        recipientEmail: input.recipientEmail,
        providerMessageId: input.providerMessageId ?? null,
        status: DeliveryStatus[input.status],
        failureReason: input.failureReason ?? null,
        sentAt: input.status === "SENT" ? input.sentAt : null
      };
      if (existing) {
        const terminal = existing.status === DeliveryStatus.SENT;
        if (!terminal) {
          await tx.emailEvent.update({
            where: { id: existing.id },
            data: eventData
          });
        }
      } else {
        await tx.emailEvent.create({
          data: {
            sessionId: input.sessionId,
            templateKey: "PAYMENT_CONFIRMED",
            ...eventData
          }
        });
      }
      await tx.auditLog.create({
        data: {
          sessionId: input.sessionId,
          action: `PAYMENT_CONFIRMED_EMAIL_${input.status}`,
          entityType: "ASSESSMENT_SESSION",
          entityId: input.sessionId,
          actorType: "SYSTEM",
          metadata: {
            deliveryStatus: input.status,
            ...(input.providerMessageId
              ? { providerMessageId: input.providerMessageId }
              : {}),
            ...(input.failureReason
              ? { failureReason: input.failureReason.slice(0, 500) }
              : {})
          }
        }
      });
    });
  }

  async shouldSendPaymentConfirmation(sessionId: string): Promise<boolean> {
    const terminal = await this.prisma.emailEvent.findFirst({
      where: {
        sessionId,
        templateKey: "PAYMENT_CONFIRMED",
        status: DeliveryStatus.SENT
      },
      select: { id: true }
    });
    return !terminal;
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

  async findLatestInvoiceResendAt(sessionId: string): Promise<Date | null> {
    const latest = await this.prisma.emailEvent.findFirst({
      where: {
        sessionId,
        templateKey: "QUICKBOOKS_INVOICE_RESEND",
        status: DeliveryStatus.SENT,
        sentAt: { not: null }
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true }
    });
    return latest?.sentAt ?? null;
  }

  async recordInvoiceResend(input: {
    sessionId: string;
    recipientEmail: string;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailEvent.create({
        data: {
          sessionId: input.sessionId,
          templateKey: "QUICKBOOKS_INVOICE_RESEND",
          recipientEmail: input.recipientEmail,
          status: DeliveryStatus.SENT,
          sentAt: input.sentAt
        }
      }),
      this.prisma.auditLog.create({
        data: {
          sessionId: input.sessionId,
          action: "QUICKBOOKS_INVOICE_RESENT",
          entityType: "ASSESSMENT_SESSION",
          entityId: input.sessionId,
          actorType: "CLIENT"
        }
      })
    ]);
  }

  async findLatestPaymentSupportRequestAt(sessionId: string): Promise<Date | null> {
    const latest = await this.prisma.emailEvent.findFirst({
      where: { sessionId, templateKey: "PAYMENT_SUPPORT_REQUEST", status: DeliveryStatus.SENT, sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true }
    });
    return latest?.sentAt ?? null;
  }

  async recordPaymentSupportRequest(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED"; failureReason?: string; sentAt: Date }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailEvent.create({ data: { sessionId: input.sessionId, templateKey: "PAYMENT_SUPPORT_REQUEST", recipientEmail: input.recipientEmail, status: DeliveryStatus[input.status], failureReason: input.failureReason, sentAt: input.status === "SENT" ? input.sentAt : undefined } }),
      this.prisma.auditLog.create({ data: { sessionId: input.sessionId, action: input.status === "SENT" ? "PAYMENT_SUPPORT_REQUESTED" : "PAYMENT_SUPPORT_NOTIFICATION_FAILED", entityType: "ASSESSMENT_SESSION", entityId: input.sessionId, actorType: "CLIENT", metadata: input.failureReason ? { failureReason: input.failureReason.slice(0, 500) } : undefined } })
    ]);
  }
}
