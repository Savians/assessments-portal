import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { assertPaidPortalEntitlement, PortalEntitlementError, type PortalClaims } from "./portal-entitlement";

const claims: PortalClaims = {
  sub: "sub-1",
  email: "client@example.com",
  email_verified: "true",
  "cognito:groups": "ASSESSMENT_CLIENT"
};

const prisma = (client: unknown): PrismaClient => ({
  assessmentClient: {
    findUnique: async () => client,
    update: async () => client
  }
}) as unknown as PrismaClient;

describe("portal entitlement", () => {
  it("requires Cognito email verification", async () => {
    await expect(assertPaidPortalEntitlement(prisma(null), { ...claims, email_verified: "false" })).rejects.toBeInstanceOf(PortalEntitlementError);
  });

  it("requires a paid linked DB entitlement in addition to Cognito claims", async () => {
    await expect(assertPaidPortalEntitlement(prisma(null), claims)).rejects.toMatchObject({ code: "PAID_ENTITLEMENT_REQUIRED" });
  });

  it("allows a paid linked DB entitlement even when the fresh Cognito group claim is missing", async () => {
    await expect(assertPaidPortalEntitlement(prisma({
      id: "client-1",
      normalizedEmail: "client@example.com",
      emailVerifiedAt: new Date("2026-07-06T00:00:00Z"),
      sessions: [{ id: "session-1", assessmentYear: 2026 }]
    }), { ...claims, "cognito:groups": "" })).resolves.toEqual({ clientId: "client-1", sessionId: "session-1", assessmentYear: 2026 });
  });

  it("allows a verified Cognito user linked to a paid assessment session", async () => {
    await expect(assertPaidPortalEntitlement(prisma({
      id: "client-1",
      normalizedEmail: "client@example.com",
      emailVerifiedAt: new Date("2026-07-06T00:00:00Z"),
      sessions: [{ id: "session-1", assessmentYear: 2026 }]
    }), claims)).resolves.toEqual({ clientId: "client-1", sessionId: "session-1", assessmentYear: 2026 });
  });
});
