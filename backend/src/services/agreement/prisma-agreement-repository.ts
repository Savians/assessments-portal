import {
  AssessmentStatus,
  DeliveryStatus,
  Prisma,
  type PrismaClient
} from "@prisma/client";
import { findAssessmentSessionByAccessTokenHash } from "../../shared/assessment-access-token";
import type {
  AcceptedSignature,
  AgreementConfirmationCandidate,
  AgreementDownloadRecord,
  AgreementRepository,
  AgreementSession,
  AgreementTemplateRecord,
  SignatureEvidence
} from "./agreement-service";

const agreementDownloadVerificationType = "AGREEMENT_DOWNLOAD";

const sessionShape = (session: {
  id: string;
  normalizedEmail: string;
  phone: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  assessmentYear: number;
  serviceAmount: Prisma.Decimal;
  currency: string;
  status: AssessmentStatus;
  statusTokenHash: string;
  statusTokenExpiresAt: Date;
  agreementSignedAt: Date | null;
  qbCustomerId: string | null;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
  qbInvoiceBalance: Prisma.Decimal | null;
}): AgreementSession => ({
  id: session.id,
  normalizedEmail: session.normalizedEmail,
  phone: session.phone,
  firstName: session.firstName,
  middleName: session.middleName,
  lastName: session.lastName,
  assessmentYear: session.assessmentYear,
  serviceAmount: session.serviceAmount.toNumber(),
  currency: session.currency,
  status: session.status,
  statusTokenExpiresAt: session.statusTokenExpiresAt,
  downloadTokenSeed: session.statusTokenHash,
  agreementSignedAt: session.agreementSignedAt,
  qbCustomerId: session.qbCustomerId,
  qbInvoiceId: session.qbInvoiceId,
  qbInvoiceNumber: session.qbInvoiceNumber,
  qbInvoiceBalance: session.qbInvoiceBalance?.toNumber()
});

export class PrismaAgreementRepository implements AgreementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSessionByTokenHash(tokenHash: string): Promise<AgreementSession | null> {
    const session = await findAssessmentSessionByAccessTokenHash(this.prisma, tokenHash);
    return session ? sessionShape(session) : null;
  }

  async findActiveTemplate(at: Date): Promise<AgreementTemplateRecord | null> {
    return this.prisma.agreementTemplate.findFirst({
      where: { isActive: true, effectiveFrom: { lte: at }, OR: [{ deprecatedAt: null }, { deprecatedAt: { gt: at } }] },
      orderBy: { effectiveFrom: "desc" }
    });
  }

  async findSignedTemplate(sessionId: string): Promise<AgreementTemplateRecord | null> {
    const signature = await this.prisma.agreementSignature.findUnique({
      where: { sessionId },
      select: { template: true }
    });
    return signature?.template ?? null;
  }

  async acceptSignature(evidence: SignatureEvidence): Promise<AcceptedSignature> {
    return this.prisma.$transaction(async (tx) => {
      // The unique sessionId constraint and atomic upsert make the first accepted
      // signature immutable even when two requests arrive at the same time.
      const signature = await tx.agreementSignature.upsert({
        where: { sessionId: evidence.sessionId },
        update: {},
        create: evidence,
        select: {
          signedAt: true,
          evidencePayloadSha256: true,
          ipAddress: true,
          userAgent: true,
          template: true
        }
      });
      const moved = await tx.assessmentSession.updateMany({
        where: {
          id: evidence.sessionId,
          status: AssessmentStatus.AGREEMENT_PENDING
        },
        data: {
          status: AssessmentStatus.AGREEMENT_SIGNED,
          agreementSignedAt: signature.signedAt
        }
      });
      if (moved.count === 1) {
        await tx.assessmentStatusHistory.create({
          data: {
            sessionId: evidence.sessionId,
            oldStatus: AssessmentStatus.AGREEMENT_PENDING,
            newStatus: AssessmentStatus.AGREEMENT_SIGNED,
            reason: "Legal agreement accepted",
            actorType: "CLIENT"
          }
        });
        await tx.auditLog.create({
          data: {
            sessionId: evidence.sessionId,
            action: "AGREEMENT_SIGNED",
            entityType: "AGREEMENT_SIGNATURE",
            actorType: "CLIENT",
            ipAddress: signature.ipAddress,
            userAgent: signature.userAgent,
            metadata: {
              templateVersion: signature.template.version,
              evidencePayloadSha256: signature.evidencePayloadSha256
            }
          }
        });
      }
      return signature;
    });
  }

  async saveQuickBooksCustomer(sessionId: string, customerId: string, requestId: string): Promise<void> {
    await this.transition(
      sessionId,
      [AssessmentStatus.AGREEMENT_SIGNED],
      AssessmentStatus.QB_CUSTOMER_CREATED,
      { qbCustomerId: customerId, qbCustomerRequestId: requestId },
      "QuickBooks customer linked"
    );
  }
  async saveQuickBooksInvoice(sessionId: string, invoice: { id: string; number?: string; balance: number }, requestId: string): Promise<void> {
    await this.transition(
      sessionId,
      [AssessmentStatus.AGREEMENT_SIGNED, AssessmentStatus.QB_CUSTOMER_CREATED],
      AssessmentStatus.INVOICE_CREATED,
      { qbInvoiceId: invoice.id, qbInvoiceNumber: invoice.number, qbInvoiceBalance: invoice.balance, qbInvoiceRequestId: requestId, invoiceCreatedAt: new Date() },
      "QuickBooks invoice created"
    );
  }
  async markInvoiceSent(sessionId: string): Promise<void> {
    await this.transition(
      sessionId,
      [AssessmentStatus.INVOICE_CREATED, AssessmentStatus.INVOICE_SENT],
      AssessmentStatus.PAYMENT_PENDING,
      { invoiceSentAt: new Date() },
      "QuickBooks invoice sent"
    );
  }
  async recordBillingFailure(sessionId: string, message: string): Promise<void> {
    await this.prisma.auditLog.create({ data: { sessionId, action: "AGREEMENT_BILLING_FAILED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { message: message.slice(0, 500) } } });
  }
  async ensureAgreementDownloadToken(input: { sessionId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await this.prisma.recoveryToken.upsert({
      where: { tokenHash: input.tokenHash },
      // Refresh the deterministic private link before every provider retry. If
      // Resend returns a prior idempotent delivery, that already-emailed link is
      // therefore still valid for a fresh full delivery window.
      update: { expiresAt: input.expiresAt },
      create: {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        verificationType: agreementDownloadVerificationType,
        expiresAt: input.expiresAt
      }
    });
  }
  async findAgreementConfirmationCandidates(
    limit: number
  ): Promise<AgreementConfirmationCandidate[]> {
    const sessions = await this.prisma.assessmentSession.findMany({
      where: {
        deletedAt: null,
        signatures: { some: {} },
        emailEvents: {
          none: {
            templateKey: "AGREEMENT_SIGNED_CONFIRMATION",
            status: DeliveryStatus.SENT
          }
        }
      },
      include: {
        signatures: {
          orderBy: { createdAt: "asc" },
          take: 1,
          include: { template: true }
        }
      },
      orderBy: [{ agreementSignedAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100))
    });
    return sessions.flatMap((session) => {
      const signature = session.signatures[0];
      if (!signature) return [];
      return [{
        ...sessionShape(session),
        agreementSignedAt: signature.signedAt,
        template: signature.template
      }];
    });
  }
  async findAgreementDownloadByTokenHash(tokenHash: string): Promise<AgreementDownloadRecord | null> {
    const token = await this.prisma.recoveryToken.findFirst({
      where: {
        tokenHash,
        verificationType: agreementDownloadVerificationType,
        usedAt: null
      },
      select: {
        sessionId: true,
        expiresAt: true,
        session: { select: { assessmentYear: true } }
      }
    });
    if (!token) return null;
    const signature = await this.prisma.agreementSignature.findUnique({
      where: { sessionId: token.sessionId },
      select: { template: true }
    });
    if (!signature) return null;
    return {
      assessmentYear: token.session.assessmentYear,
      expiresAt: token.expiresAt,
      template: signature.template
    };
  }
  async hasSentAgreementConfirmation(sessionId: string): Promise<boolean> {
    return Boolean(await this.prisma.emailEvent.findFirst({
      where: { sessionId, templateKey: "AGREEMENT_SIGNED_CONFIRMATION", status: DeliveryStatus.SENT },
      select: { id: true }
    }));
  }
  async recordAgreementConfirmation(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    attemptedAt: Date;
    providerMessageId?: string;
    failureReason?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "assessment_sessions" WHERE "id" = ${input.sessionId}::uuid FOR UPDATE`
      );
      const existing = await tx.emailEvent.findFirst({
        where: {
          sessionId: input.sessionId,
          templateKey: "AGREEMENT_SIGNED_CONFIRMATION"
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true }
      });
      const eventData = {
        recipientEmail: input.recipientEmail,
        providerMessageId: input.providerMessageId ?? null,
        status: DeliveryStatus[input.status],
        failureReason: input.failureReason?.slice(0, 1000) ?? null,
        sentAt: input.status === "SENT" ? input.attemptedAt : null
      };
      if (!existing) {
        await tx.emailEvent.create({
          data: {
            sessionId: input.sessionId,
            templateKey: "AGREEMENT_SIGNED_CONFIRMATION",
            ...eventData
          }
        });
      } else if (existing.status !== DeliveryStatus.SENT) {
        await tx.emailEvent.update({
          where: { id: existing.id },
          data: eventData
        });
      }
      await tx.auditLog.create({
        data: {
          sessionId: input.sessionId,
          action: input.status === "SENT" ? "AGREEMENT_CONFIRMATION_SENT" : `AGREEMENT_CONFIRMATION_${input.status}`,
          entityType: "ASSESSMENT_SESSION",
          entityId: input.sessionId,
          actorType: "SYSTEM",
          metadata: {
            recipientEmail: input.recipientEmail,
            ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
            ...(input.failureReason ? { failureReason: input.failureReason.slice(0, 500) } : {})
          }
        }
      });
    });
  }

  private async transition(
    sessionId: string,
    allowedFrom: readonly AssessmentStatus[],
    next: AssessmentStatus,
    data: Prisma.AssessmentSessionUpdateManyMutationInput,
    reason: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      while (true) {
        const current = await tx.assessmentSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { status: true }
        });
        if (current.status === next || !allowedFrom.includes(current.status)) return;
        const moved = await tx.assessmentSession.updateMany({
          where: { id: sessionId, status: current.status },
          data: { ...data, status: next }
        });
        if (moved.count === 0) continue;
        await tx.assessmentStatusHistory.create({
          data: {
            sessionId,
            oldStatus: current.status,
            newStatus: next,
            reason,
            actorType: "SYSTEM"
          }
        });
        await tx.auditLog.create({
          data: {
            sessionId,
            action: next,
            entityType: "ASSESSMENT_SESSION",
            entityId: sessionId,
            actorType: "SYSTEM"
          }
        });
        return;
      }
    });
  }
}
