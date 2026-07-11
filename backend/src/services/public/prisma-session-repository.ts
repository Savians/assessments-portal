import {
  AssessmentStatus as PrismaAssessmentStatus,
  DeliveryStatus
} from "@prisma/client";
import type { ClientType as PrismaClientType, PrismaClient } from "@prisma/client";
import type {
  AssessmentSessionRecord,
  AssessmentSessionRepository,
  AssessmentStatus,
  CreateAssessmentRecord
} from "./start-assessment";

const toRecord = (session: {
  id: string;
  normalizedEmail: string;
  assessmentYear: number;
  status: PrismaAssessmentStatus;
}): AssessmentSessionRecord => ({
  ...session,
  status: session.status as AssessmentStatus
});

export class PrismaAssessmentSessionRepository implements AssessmentSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAnnualSession(
    normalizedEmail: string,
    assessmentYear: number
  ): Promise<AssessmentSessionRecord | null> {
    const session = await this.prisma.assessmentSession.findUnique({
      where: {
        normalizedEmail_serviceCode_assessmentYear: {
          normalizedEmail,
          serviceCode: "TAX_ASSESSMENT",
          assessmentYear
        }
      },
      select: {
        id: true,
        normalizedEmail: true,
        assessmentYear: true,
        status: true
      }
    });
    return session ? toRecord(session) : null;
  }

  async createAnnualSession(input: CreateAssessmentRecord): Promise<AssessmentSessionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.assessmentSession.create({
        data: {
          normalizedEmail: input.normalizedEmail,
          phone: input.phone,
          firstName: input.firstName,
          middleName: input.middleName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth,
          clientType: input.clientType as PrismaClientType,
          businessName: input.businessName,
          state: input.state,
          incomeRange: input.incomeRange,
          estimatedTaxPaidRange: input.estimatedTaxPaidRange,
          consentAcceptedAt: input.consentAcceptedAt,
          assessmentYear: input.assessmentYear,
          status: PrismaAssessmentStatus.AGREEMENT_PENDING,
          statusTokenHash: input.statusTokenHash,
          statusTokenExpiresAt: input.statusTokenExpiresAt
        },
        select: {
          id: true,
          normalizedEmail: true,
          assessmentYear: true,
          status: true
        }
      });

      await transaction.assessmentStatusHistory.create({
        data: {
          sessionId: session.id,
          newStatus: PrismaAssessmentStatus.AGREEMENT_PENDING,
          reason: "Annual assessment started",
          actorType: "CLIENT"
        }
      });
      await transaction.auditLog.create({
        data: {
          sessionId: session.id,
          action: "ASSESSMENT_SESSION_CREATED",
          entityType: "AssessmentSession",
          entityId: session.id,
          actorType: "CLIENT",
          ipAddress: input.actorIp,
          userAgent: input.actorUserAgent,
          metadata: {
            assessmentYear: input.assessmentYear,
            serviceCode: "TAX_ASSESSMENT"
          }
        }
      });

      return toRecord(session);
    });
  }

  async rotateStatusToken(
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    actorIp?: string,
    actorUserAgent?: string
  ): Promise<AssessmentSessionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.assessmentSession.update({
        where: { id: sessionId },
        data: {
          statusTokenHash: tokenHash,
          statusTokenExpiresAt: expiresAt
        },
        select: {
          id: true,
          normalizedEmail: true,
          assessmentYear: true,
          status: true
        }
      });
      await transaction.auditLog.create({
        data: {
          sessionId,
          action: "ASSESSMENT_SESSION_RESUMED",
          entityType: "AssessmentSession",
          entityId: sessionId,
          actorType: "CLIENT",
          ipAddress: actorIp,
          userAgent: actorUserAgent,
          metadata: { assessmentYear: session.assessmentYear }
        }
      });
      return toRecord(session);
    });
  }

  async recordResumeEmail(
    sessionId: string,
    recipientEmail: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    providerMessageId?: string,
    failureReason?: string
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailEvent.create({
        data: {
          sessionId,
          templateKey: "RESUME_AGREEMENT",
          recipientEmail,
          providerMessageId,
          status: DeliveryStatus[status],
          failureReason,
          sentAt: status === "SENT" ? new Date() : undefined
        }
      }),
      this.prisma.assessmentSession.update({
        where: { id: sessionId },
        data: { lastResumeEmailSentAt: status === "SENT" ? new Date() : undefined }
      })
    ]);
  }
}
