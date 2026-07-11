import { AssessmentStatus, type PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { AgreementRepository, AgreementSession, AgreementTemplateRecord, SignatureEvidence } from "./agreement-service";

const sessionShape = (session: { id: string; normalizedEmail: string; phone: string; firstName: string; middleName: string | null; lastName: string; assessmentYear: number; serviceAmount: Prisma.Decimal; currency: string; status: AssessmentStatus; statusTokenExpiresAt: Date; qbCustomerId: string | null; qbInvoiceId: string | null; qbInvoiceNumber: string | null; qbInvoiceBalance: Prisma.Decimal | null }): AgreementSession => ({
  ...session, serviceAmount: session.serviceAmount.toNumber(), qbInvoiceBalance: session.qbInvoiceBalance?.toNumber()
});

export class PrismaAgreementRepository implements AgreementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSessionByTokenHash(tokenHash: string): Promise<AgreementSession | null> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { statusTokenHash: tokenHash } });
    return session ? sessionShape(session) : null;
  }

  async findActiveTemplate(at: Date): Promise<AgreementTemplateRecord | null> {
    return this.prisma.agreementTemplate.findFirst({
      where: { isActive: true, effectiveFrom: { lte: at }, OR: [{ deprecatedAt: null }, { deprecatedAt: { gt: at } }] },
      orderBy: { effectiveFrom: "desc" }
    });
  }

  async acceptSignature(evidence: SignatureEvidence): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.agreementSignature.findUnique({ where: { sessionId: evidence.sessionId } });
      if (!existing) {
        await tx.agreementSignature.create({ data: evidence });
        await tx.assessmentSession.update({ where: { id: evidence.sessionId }, data: { status: AssessmentStatus.AGREEMENT_SIGNED, agreementSignedAt: evidence.signedAt } });
        await tx.assessmentStatusHistory.create({ data: { sessionId: evidence.sessionId, oldStatus: AssessmentStatus.AGREEMENT_PENDING, newStatus: AssessmentStatus.AGREEMENT_SIGNED, reason: "Legal agreement accepted", actorType: "CLIENT" } });
        await tx.auditLog.create({ data: { sessionId: evidence.sessionId, action: "AGREEMENT_SIGNED", entityType: "AGREEMENT_SIGNATURE", actorType: "CLIENT", ipAddress: evidence.ipAddress, userAgent: evidence.userAgent, metadata: { templateVersion: evidence.templateVersion, evidencePayloadSha256: evidence.evidencePayloadSha256 } } });
      }
    });
  }

  async saveQuickBooksCustomer(sessionId: string, customerId: string, requestId: string): Promise<void> {
    await this.transition(sessionId, AssessmentStatus.QB_CUSTOMER_CREATED, { qbCustomerId: customerId, qbCustomerRequestId: requestId }, "QuickBooks customer linked");
  }
  async saveQuickBooksInvoice(sessionId: string, invoice: { id: string; number?: string; balance: number }, requestId: string): Promise<void> {
    await this.transition(sessionId, AssessmentStatus.INVOICE_CREATED, { qbInvoiceId: invoice.id, qbInvoiceNumber: invoice.number, qbInvoiceBalance: invoice.balance, qbInvoiceRequestId: requestId, invoiceCreatedAt: new Date() }, "QuickBooks invoice created");
  }
  async markInvoiceSent(sessionId: string): Promise<void> {
    await this.transition(sessionId, AssessmentStatus.PAYMENT_PENDING, { invoiceSentAt: new Date() }, "QuickBooks invoice sent");
  }
  async recordBillingFailure(sessionId: string, message: string): Promise<void> {
    await this.prisma.auditLog.create({ data: { sessionId, action: "AGREEMENT_BILLING_FAILED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { message: message.slice(0, 500) } } });
  }
  async recordNotificationFailure(sessionId: string, message: string): Promise<void> {
    await this.prisma.auditLog.create({ data: { sessionId, action: "INVOICE_STATUS_EMAIL_FAILED", entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM", metadata: { message: message.slice(0, 500) } } });
  }

  private async transition(sessionId: string, next: AssessmentStatus, data: Prisma.AssessmentSessionUpdateInput, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
      await tx.assessmentSession.update({ where: { id: sessionId }, data: { ...data, status: next } });
      if (current.status !== next) await tx.assessmentStatusHistory.create({ data: { sessionId, oldStatus: current.status, newStatus: next, reason, actorType: "SYSTEM" } });
      await tx.auditLog.create({ data: { sessionId, action: next, entityType: "ASSESSMENT_SESSION", entityId: sessionId, actorType: "SYSTEM" } });
    });
  }
}