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
          status: { in: [AssessmentStatus.ACCOUNT_CREATED, AssessmentStatus.PROFILE_IN_PROGRESS, AssessmentStatus.PROFILE_COMPLETED, AssessmentStatus.DOCUMENTS_IN_PROGRESS, AssessmentStatus.DOCUMENTS_SUBMITTED, AssessmentStatus.IN_PROGRESS, AssessmentStatus.COMPLETED] }
        },
        orderBy: { assessmentYear: "desc" },
        take: 1
      }
    }
  });
  if (!client || normalizeEmail(client.normalizedEmail) !== normalizeEmail(claims.email) || client.sessions.length === 0) {
    throw new PortalEntitlementError("PAID_ENTITLEMENT_REQUIRED", "Portal access unlocks only after paid account setup.", 403);
  }
  const session = client.sessions[0];
  if (!session) throw new PortalEntitlementError("PAID_ENTITLEMENT_REQUIRED", "Portal access unlocks only after paid account setup.", 403);
  if (!client.emailVerifiedAt) {
    await prisma.assessmentClient.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  }
  return { clientId: client.id, sessionId: session.id, assessmentYear: session.assessmentYear };
}
