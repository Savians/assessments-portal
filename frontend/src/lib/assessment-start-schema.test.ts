import { describe, expect, it } from "vitest";
import { assessmentStartSchema } from "./assessment-start-schema";

const valid = {
  firstName: "John",
  middleName: "",
  lastName: "Smith",
  dateOfBirth: "1980-03-15",
  email: "john@example.com",
  phone: "(832) 555-1212",
  clientType: "BUSINESS_OWNER",
  businessName: "Smith Consulting LLC",
  state: "TX",
  incomeRange: "$250K-$500K",
  estimatedTaxPaidRange: "$50K-$100K",
  consentAccepted: true
} as const;

describe("assessmentStartSchema", () => {
  it("accepts the build-spec example", () => {
    expect(assessmentStartSchema.parse(valid)).toEqual(valid);
  });

  it("makes DOB and consent mandatory", () => {
    expect(
      assessmentStartSchema.safeParse({
        ...valid,
        dateOfBirth: "",
        consentAccepted: false
      }).success
    ).toBe(false);
  });

  it("requires business name for business-owner context", () => {
    expect(
      assessmentStartSchema.safeParse({
        ...valid,
        businessName: ""
      }).success
    ).toBe(false);
  });

  it("allows business name to remain empty for an individual", () => {
    expect(
      assessmentStartSchema.safeParse({
        ...valid,
        clientType: "INDIVIDUAL",
        businessName: ""
      }).success
    ).toBe(true);
  });
});
