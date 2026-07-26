import type { AssessmentSession, PrismaClient } from "@prisma/client";

export const ASSESSMENT_RESUME_VERIFICATION_TYPE = "ASSESSMENT_RESUME";

export async function findAssessmentSessionByAccessTokenHash(
  prisma: PrismaClient,
  tokenHash: string
): Promise<AssessmentSession | null> {
  const primarySession = await prisma.assessmentSession.findUnique({
    where: { statusTokenHash: tokenHash }
  });
  if (primarySession) return primarySession;

  const resumeGrant = await prisma.recoveryToken.findFirst({
    where: {
      tokenHash,
      verificationType: ASSESSMENT_RESUME_VERIFICATION_TYPE,
      usedAt: null
    },
    select: {
      expiresAt: true,
      session: true
    }
  });
  if (!resumeGrant) return null;

  return {
    ...resumeGrant.session,
    statusTokenExpiresAt: resumeGrant.expiresAt
  };
}
