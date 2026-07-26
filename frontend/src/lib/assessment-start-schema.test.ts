import { describe, expect, it } from "vitest";
import { assessmentStartSchema } from "./assessment-start-schema";

const valid = {
  firstName: "John",
  middleName: "",
  lastName: "Smith",
  email: "john@example.com",
  phone: "(832) 555-1212",
  consentAccepted: true
} as const;

describe("assessmentStartSchema", () => {
  it("accepts the streamlined contact-only start payload", () => {
    expect(assessmentStartSchema.parse(valid)).toEqual(valid);
  });

  it("requires valid contact information and consent", () => {
    expect(
      assessmentStartSchema.safeParse({
        ...valid,
        email: "not-an-email",
        phone: "123",
        consentAccepted: false
      }).success
    ).toBe(false);
  });

  it("does not require identity or assessment context before payment", () => {
    expect(
      assessmentStartSchema.safeParse(valid).success
    ).toBe(true);
  });
});
