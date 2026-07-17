import { describe, expect, it } from "vitest";
import { AdminAccessError, assertAssessmentAdmin } from "./admin-auth";

describe("assessment admin authorization", () => {
  it("accepts the referral Admin group from the shared user pool", () => {
    expect(assertAssessmentAdmin({ sub: "admin-1", email: "admin@savians.com", "cognito:groups": "[Admin]" })).toEqual({ id: "admin-1", email: "admin@savians.com", role: "ADMIN" });
  });

  it("preserves referral superadmin precedence", () => {
    expect(assertAssessmentAdmin({ sub: "super-1", email: "super@savians.com", "cognito:groups": ["Admin", "superadmin"] }).role).toBe("SUPER_ADMIN");
  });

  it.each(["SUPERADMIN", "SUPER_ADMIN", "SuperAdmin", "superadmin"])("accepts shared-pool superadmin spelling %s", (group) => {
    expect(assertAssessmentAdmin({ sub: "super-1", email: "super@savians.com", "cognito:groups": [group] }).role).toBe("SUPER_ADMIN");
  });

  it.each(["[superadmin Admin]", "[\"superadmin\",\"Admin\"]", "superadmin Admin"])("accepts API Gateway multi-group serialization %s", (groups) => {
    expect(assertAssessmentAdmin({ sub: "super-1", email: "super@savians.com", "cognito:groups": groups }).role).toBe("SUPER_ADMIN");
  });

  it.each(["ADMIN", "Admin", "Finance"])("accepts shared-pool admin spelling %s", (group) => {
    expect(assertAssessmentAdmin({ sub: "admin-1", email: "admin@savians.com", "cognito:groups": [group] }).role).toBe("ADMIN");
  });

  it("rejects assessment clients even though their JWT is valid", () => {
    expect(() => assertAssessmentAdmin({ sub: "client-1", email: "client@example.com", "cognito:groups": ["ASSESSMENT_CLIENT"] })).toThrow(AdminAccessError);
  });
});
