import {
  AssessmentStatus as PrismaAssessmentStatus,
  DeliveryStatus
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ASSESSMENT_RESUME_VERIFICATION_TYPE } from "../../shared/assessment-access-token";
import type {
  AssessmentSessionRecord,
  AssessmentSessionRepository,
  AssessmentStatus,
  CreateAssessmentRecord
} from "./start-assessment";

const toRecord = (session: {
  id: string;
  normalizedEmail: string;
  firstName: string;
  lastName: string;
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
        firstName: true,
        lastName: true,
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
          consentAcceptedAt: input.consentAcceptedAt,
          assessmentYear: input.assessmentYear,
          status: PrismaAssessmentStatus.AGREEMENT_PENDING,
          statusTokenHash: input.statusTokenHash,
          statusTokenExpiresAt: input.statusTokenExpiresAt
        },
        select: {
          id: true,
          normalizedEmail: true,
          firstName: true,
          lastName: true,
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

  async createAssessmentResumeGrant(
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    actorIp?: string,
    actorUserAgent?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const grant = await transaction.recoveryToken.create({
        data: {
          sessionId,
          tokenHash,
          verificationType: ASSESSMENT_RESUME_VERIFICATION_TYPE,
          expiresAt
        },
        select: { id: true }
      });
      await transaction.auditLog.create({
        data: {
          sessionId,
          action: "ASSESSMENT_RESUME_GRANT_CREATED",
          entityType: "RecoveryToken",
          entityId: grant.id,
          actorType: "CLIENT",
          ipAddress: actorIp,
          userAgent: actorUserAgent,
          metadata: {
            verificationType: ASSESSMENT_RESUME_VERIFICATION_TYPE,
            expiresAt: expiresAt.toISOString()
          }
        }
      });
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
