import type { AssessmentSession, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_RESUME_VERIFICATION_TYPE,
  findAssessmentSessionByAccessTokenHash
} from "./assessment-access-token";

const session = (statusTokenExpiresAt: Date) => ({
  id: "session-1",
  statusTokenExpiresAt
}) as unknown as AssessmentSession;

describe("findAssessmentSessionByAccessTokenHash", () => {
  it("prefers the primary status-token record", async () => {
    const primary = session(new Date("2026-08-01T00:00:00.000Z"));
    const findUnique = vi.fn().mockResolvedValue(primary);
    const findFirst = vi.fn();
    const prisma = {
      assessmentSession: { findUnique },
      recoveryToken: { findFirst }
    } as unknown as PrismaClient;

    await expect(
      findAssessmentSessionByAccessTokenHash(prisma, "primary-hash")
    ).resolves.toBe(primary);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("accepts only an unused ASSESSMENT_RESUME grant and uses the grant expiry", async () => {
    const primaryExpiry = new Date("2026-07-01T00:00:00.000Z");
    const grantExpiry = new Date("2026-08-04T00:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({
      expiresAt: grantExpiry,
      session: session(primaryExpiry)
    });
    const prisma = {
      assessmentSession: { findUnique: vi.fn().mockResolvedValue(null) },
      recoveryToken: { findFirst }
    } as unknown as PrismaClient;

    const resolved = await findAssessmentSessionByAccessTokenHash(
      prisma,
      "resume-hash"
    );

    expect(resolved?.statusTokenExpiresAt).toEqual(grantExpiry);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: "resume-hash",
        verificationType: ASSESSMENT_RESUME_VERIFICATION_TYPE,
        usedAt: null
      },
      select: {
        expiresAt: true,
        session: true
      }
    });
  });

  it("does not fall back to used or wrong-purpose recovery tokens", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      assessmentSession: { findUnique: vi.fn().mockResolvedValue(null) },
      recoveryToken: { findFirst }
    } as unknown as PrismaClient;

    await expect(
      findAssessmentSessionByAccessTokenHash(prisma, "other-purpose-hash")
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tokenHash: "other-purpose-hash",
        verificationType: ASSESSMENT_RESUME_VERIFICATION_TYPE,
        usedAt: null
      }
    }));
  });

  it("preserves an expired grant expiry for the service-level expiry check", async () => {
    const expiredAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      assessmentSession: { findUnique: vi.fn().mockResolvedValue(null) },
      recoveryToken: {
        findFirst: vi.fn().mockResolvedValue({
          expiresAt: expiredAt,
          session: session(new Date("2026-08-01T00:00:00.000Z"))
        })
      }
    } as unknown as PrismaClient;

    const resolved = await findAssessmentSessionByAccessTokenHash(
      prisma,
      "expired-resume-hash"
    );
    expect(resolved?.statusTokenExpiresAt).toEqual(expiredAt);
  });
});
