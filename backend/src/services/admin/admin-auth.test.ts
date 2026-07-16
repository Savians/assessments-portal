import { describe, expect, it } from "vitest";
import { AdminAccessError, assertAssessmentAdmin } from "./admin-auth";

describe("assessment admin authorization", () => {
  it("accepts the referral Admin group from the shared user pool", () => {
    expect(assertAssessmentAdmin({ sub: "admin-1", email: "admin@savians.com", "cognito:groups": "[Admin]" })).toEqual({ id: "admin-1", email: "admin@savians.com", role: "ADMIN" });
  });

  it("preserves referral superadmin precedence", () => {
    expect(assertAssessmentAdmin({ sub: "super-1", email: "super@savians.com", "cognito:groups": ["Admin", "superadmin"] }).role).toBe("SUPER_ADMIN");
  });

  it("rejects assessment clients even though their JWT is valid", () => {
    expect(() => assertAssessmentAdmin({ sub: "client-1", email: "client@example.com", "cognito:groups": ["ASSESSMENT_CLIENT"] })).toThrow(AdminAccessError);
  });
});
