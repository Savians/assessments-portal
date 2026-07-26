import { AssessmentStatus, type PrismaClient } from "@prisma/client";

export interface PortalClaims {
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  "cognito:groups"?: string | string[];
}

export class PortalEntitlementError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const entitledStatuses: AssessmentStatus[] = [
  AssessmentStatus.ACCOUNT_CREATED,
  AssessmentStatus.PROFILE_IN_PROGRESS,
  AssessmentStatus.PROFILE_COMPLETED,
  AssessmentStatus.DOCUMENTS_IN_PROGRESS,
  AssessmentStatus.DOCUMENTS_SUBMITTED,
  AssessmentStatus.IN_PROGRESS,
  AssessmentStatus.COMPLETED
];

async function repairPaidAccountLink(
  prisma: PrismaClient,
  input: { cognitoUserId: string; normalizedEmail: string }
) {
  return prisma.$transaction(async (tx) => {
    const [emailClient, session] = await Promise.all([
      tx.assessmentClient.findUnique({
        where: { normalizedEmail: input.normalizedEmail },
        select: { id: true, cognitoUserId: true }
      }),
      tx.assessmentSession.findFirst({
        where: {
          normalizedEmail: input.normalizedEmail,
          accountCreationAllowed: true,
          deletedAt: null,
          OR: [
            {
              status: {
                in: [
                  AssessmentStatus.PAID_VERIFIED,
                  AssessmentStatus.ACCOUNT_INVITED
                ]
              }
            },
            { status: AssessmentStatus.ACCOUNT_CREATED, clientId: null }
          ]
        },
        orderBy: [{ assessmentYear: "desc" }, { createdAt: "desc" }],
        select: { id: true, clientId: true, status: true, assessmentYear: true }
      })
    ]);
    if (!session) return null;
    if (emailClient?.cognitoUserId && emailClient.cognitoUserId !== input.cognitoUserId) {
      return null;
    }
    if (session.clientId && session.clientId !== emailClient?.id) return null;

    const client = await tx.assessmentClient.upsert({
      where: { normalizedEmail: input.normalizedEmail },
      update: {
        cognitoUserId: input.cognitoUserId,
        emailVerifiedAt: new Date()
      },
      create: {
        normalizedEmail: input.normalizedEmail,
        cognitoUserId: input.cognitoUserId,
        emailVerifiedAt: new Date()
      },
      select: { id: true }
    });
    const nextStatus =
      session.status === AssessmentStatus.ACCOUNT_CREATED
        ? session.status
        : AssessmentStatus.ACCOUNT_CREATED;
    await tx.assessmentSession.update({
      where: { id: session.id },
      data: { clientId: client.id, status: nextStatus }
    });
    await tx.accountInvite.updateMany({
      where: { sessionId: session.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() }
    });
    if (nextStatus !== session.status) {
      await tx.assessmentStatusHistory.create({
        data: {
          sessionId: session.id,
          oldStatus: session.status,
          newStatus: nextStatus,
          reason: "Verified Cognito login linked to paid assessment",
          actorType: "CLIENT",
          actorId: input.cognitoUserId
        }
      });
    }
    await tx.auditLog.create({
      data: {
        clientId: client.id,
        sessionId: session.id,
        action: "PAID_ACCOUNT_LINK_REPAIRED",
        entityType: "ASSESSMENT_CLIENT",
        entityId: client.id,
        actorType: "CLIENT",
        actorId: input.cognitoUserId
      }
    });
    return {
      clientId: client.id,
      sessionId: session.id,
      assessmentYear: session.assessmentYear
    };
  });
}

export async function assertPaidPortalEntitlement(prisma: PrismaClient, claims: PortalClaims) {
  if (!claims.sub || !claims.email) throw new PortalEntitlementError("AUTH_CLAIMS_MISSING", "Your login session is missing required account claims.", 401);
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new PortalEntitlementError("EMAIL_NOT_VERIFIED", "Please verify your email before accessing the portal.", 403);
  const client = await prisma.assessmentClient.findUnique({
    where: { cognitoUserId: claims.sub },
    include: {
      sessions: {
        where: {
          normalizedEmail: normalizeEmail(claims.email),
          accountCreationAllowed: true,
          status: { in: entitledStatuses }
        },
        orderBy: { assessmentYear: "desc" },
        take: 1
      }
    }
  });
  if (!client || normalizeEmail(client.normalizedEmail) !== normalizeEmail(claims.email) || client.sessions.length === 0) {
    const repaired = await repairPaidAccountLink(prisma, {
      cognitoUserId: claims.sub,
      normalizedEmail: normalizeEmail(claims.email)
    });
    if (repaired) return repaired;
    throw new PortalEntitlementError("PAID_ENTITLEMENT_REQUIRED", "Portal access unlocks only after paid account setup.", 403);
  }
  const session = client.sessions[0];
  if (!session) throw new PortalEntitlementError("PAID_ENTITLEMENT_REQUIRED", "Portal access unlocks only after paid account setup.", 403);
  if (!client.emailVerifiedAt) {
    await prisma.assessmentClient.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  }
  return { clientId: client.id, sessionId: session.id, assessmentYear: session.assessmentYear };
}
