import { AssessmentStatus, DeliveryStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type { AccountAuthRepository, AccountInvite, PaidSession, PasswordResetSubject } from "./account-auth-service";

const toPaidSession = (session: {
  id: string;
  normalizedEmail: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  assessmentYear: number;
  status: AssessmentStatus;
  accountCreationAllowed: boolean;
  statusTokenExpiresAt: Date;
  clientId: string | null;
}): PaidSession => ({ ...session, status: session.status });

const inviteInclude = {
  session: {
    select: {
      id: true,
      normalizedEmail: true,
      firstName: true,
      middleName: true,
      lastName: true,
      assessmentYear: true,
      status: true,
      accountCreationAllowed: true,
      statusTokenExpiresAt: true,
      clientId: true
    }
  }
} satisfies Prisma.AccountInviteInclude;

export class PrismaAccountAuthRepository implements AccountAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSessionByStatusTokenHash(tokenHash: string): Promise<PaidSession | null> {
    const session = await this.prisma.assessmentSession.findUnique({
      where: { statusTokenHash: tokenHash },
      select: {
        id: true,
        normalizedEmail: true,
        firstName: true,
        middleName: true,
        lastName: true,
        assessmentYear: true,
        status: true,
        accountCreationAllowed: true,
        statusTokenExpiresAt: true,
        clientId: true
      }
    });
    return session ? toPaidSession(session) : null;
  }

  async createAccountInvite(input: { sessionId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await this.prisma.accountInvite.create({ data: input });
  }

  async revokeUnusedInvites(sessionId: string, at: Date): Promise<void> {
    await this.prisma.accountInvite.updateMany({ where: { sessionId, usedAt: null, revokedAt: null }, data: { revokedAt: at } });
  }

  async markSessionInvited(sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
      if (current.status === AssessmentStatus.PAID_VERIFIED) {
        await tx.assessmentSession.update({ where: { id: sessionId }, data: { status: AssessmentStatus.ACCOUNT_INVITED } });
        await tx.assessmentStatusHistory.create({
          data: { sessionId, oldStatus: current.status, newStatus: AssessmentStatus.ACCOUNT_INVITED, reason: "Paid account setup invite issued", actorType: "SYSTEM" }
        });
      }
      await tx.auditLog.create({ data: { sessionId, action: "ACCOUNT_INVITE_ISSUED", entityType: "ACCOUNT_INVITE", actorType: "SYSTEM" } });
    });
  }

  async findInviteByTokenHash(tokenHash: string): Promise<AccountInvite | null> {
    const invite = await this.prisma.accountInvite.findUnique({ where: { tokenHash }, include: inviteInclude });
    return invite ? { ...invite, session: toPaidSession(invite.session) } : null;
  }

  async linkConfirmedAccount(input: {
    sessionId: string;
    normalizedEmail: string;
    cognitoUserId: string;
    inviteId: string;
    confirmedAt: Date;
    verificationTokenHash?: string;
    verificationType?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const client = await tx.assessmentClient.upsert({
        where: { normalizedEmail: input.normalizedEmail },
        update: { cognitoUserId: input.cognitoUserId, emailVerifiedAt: input.confirmedAt },
        create: { normalizedEmail: input.normalizedEmail, cognitoUserId: input.cognitoUserId, emailVerifiedAt: input.confirmedAt }
      });
      const current = await tx.assessmentSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { status: true } });
      await tx.assessmentSession.update({
        where: { id: input.sessionId },
        data: { clientId: client.id, status: AssessmentStatus.ACCOUNT_CREATED }
      });
      await tx.accountInvite.update({ where: { id: input.inviteId }, data: { usedAt: input.confirmedAt } });
      if (input.verificationTokenHash && input.verificationType) {
        await tx.recoveryToken.updateMany({
          where: {
            sessionId: input.sessionId,
            tokenHash: input.verificationTokenHash,
            verificationType: input.verificationType,
            usedAt: null
          },
          data: { usedAt: input.confirmedAt }
        });
      }
      if (current.status !== AssessmentStatus.ACCOUNT_CREATED) {
        await tx.assessmentStatusHistory.create({
          data: { sessionId: input.sessionId, oldStatus: current.status, newStatus: AssessmentStatus.ACCOUNT_CREATED, reason: "Cognito account confirmed and linked", actorType: "CLIENT" }
        });
      }
      await tx.auditLog.create({
        data: { clientId: client.id, sessionId: input.sessionId, action: "ACCOUNT_CREATED", entityType: "ASSESSMENT_CLIENT", entityId: client.id, actorType: "CLIENT" }
      });
    });
  }

  async recordInviteEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED" | "SKIPPED"; failureReason?: string; sentAt: Date }): Promise<void> {
    await this.prisma.emailEvent.create({
      data: {
        sessionId: input.sessionId,
        templateKey: "ACCOUNT_SETUP_INVITE",
        recipientEmail: input.recipientEmail,
        status: DeliveryStatus[input.status],
        failureReason: input.failureReason,
        sentAt: input.status === "SENT" ? input.sentAt : undefined
      }
    });
  }

  async revokeAccountVerificationCodes(
    sessionId: string,
    verificationType: string,
    at: Date
  ): Promise<void> {
    await this.prisma.recoveryToken.updateMany({
      where: { sessionId, verificationType, usedAt: null },
      data: { usedAt: at }
    });
  }

  async createAccountVerificationCode(input: {
    sessionId: string;
    tokenHash: string;
    verificationType: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.recoveryToken.create({
      data: {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        verificationType: input.verificationType,
        expiresAt: input.expiresAt
      }
    });
  }

  async findLatestAccountVerificationCodeCreatedAt(
    sessionId: string,
    verificationType: string
  ): Promise<Date | null> {
    const token = await this.prisma.recoveryToken.findFirst({
      where: { sessionId, verificationType },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    });
    return token?.createdAt ?? null;
  }

  async hasActiveAccountVerificationCode(input: {
    sessionId: string;
    tokenHash: string;
    verificationType: string;
    now: Date;
  }): Promise<boolean> {
    const token = await this.prisma.recoveryToken.findFirst({
      where: {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        verificationType: input.verificationType,
        usedAt: null,
        expiresAt: { gt: input.now }
      },
      select: { id: true }
    });
    return Boolean(token);
  }

  async markAccountVerificationCodeUsed(input: {
    sessionId: string;
    tokenHash: string;
    verificationType: string;
    usedAt: Date;
  }): Promise<void> {
    await this.prisma.recoveryToken.updateMany({
      where: {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        verificationType: input.verificationType,
        usedAt: null
      },
      data: { usedAt: input.usedAt }
    });
  }

  async findPasswordResetSubjectByEmail(normalizedEmail: string): Promise<PasswordResetSubject | null> {
    const client = await this.prisma.assessmentClient.findFirst({
      where: {
        normalizedEmail,
        deletedAt: null,
        cognitoUserId: { not: null },
        emailVerifiedAt: { not: null }
      },
      select: {
        normalizedEmail: true,
        sessions: {
          orderBy: [{ assessmentYear: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { id: true, firstName: true, assessmentYear: true }
        }
      }
    });
    const session = client?.sessions[0];
    return client && session
      ? {
          sessionId: session.id,
          normalizedEmail: client.normalizedEmail,
          firstName: session.firstName,
          assessmentYear: session.assessmentYear
        }
      : null;
  }

  async consumeRecoveryCode(input: {
    sessionId: string;
    tokenHash: string;
    verificationType: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.recoveryToken.updateMany({
      where: {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        verificationType: input.verificationType,
        usedAt: null,
        expiresAt: { gt: input.now }
      },
      data: { usedAt: input.now }
    });
    return result.count === 1;
  }
}
