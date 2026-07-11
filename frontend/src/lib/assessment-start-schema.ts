import { z } from "zod";

export const clientTypeOptions = [
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "BUSINESS_OWNER", label: "Business Owner" },
  { value: "REAL_ESTATE_INVESTOR", label: "Real Estate Investor" },
  { value: "W2_HIGH_EARNER", label: "W-2 High Earner" },
  { value: "OTHER", label: "Other" }
] as const;

export const incomeRangeOptions = [
  "$150K-$250K",
  "$250K-$500K",
  "$500K-$1M",
  "$1M+"
] as const;

export const taxPaidRangeOptions = [
  { value: "UNDER_$25K", label: "Under $25K" },
  { value: "$25K-$50K", label: "$25K-$50K" },
  { value: "$50K-$100K", label: "$50K-$100K" },
  { value: "$100K+", label: "$100K+" }
] as const;

const validDob = (value: string): boolean => {
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date <= new Date();
};

export const assessmentStartSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(60),
    middleName: z.string().trim().max(60),
    lastName: z.string().trim().min(1, "Last name is required").max(60),
    dateOfBirth: z
      .string()
      .min(1, "Date of birth is required")
      .refine(validDob, "Enter a valid non-future date of birth"),
    email: z.string().trim().email("Enter a valid email address").max(320),
    phone: z
      .string()
      .trim()
      .refine((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
      }, "Enter a valid US phone number"),
    clientType: z.enum([
      "INDIVIDUAL",
      "BUSINESS_OWNER",
      "REAL_ESTATE_INVESTOR",
      "W2_HIGH_EARNER",
      "OTHER"
    ]),
    businessName: z.string().trim().max(255),
    state: z.string().length(2, "Select a state"),
    incomeRange: z.enum(["", ...incomeRangeOptions]),
    estimatedTaxPaidRange: z.enum([
      "",
      "UNDER_$25K",
      "$25K-$50K",
      "$50K-$100K",
      "$100K+"
    ]),
    consentAccepted: z.boolean().refine((value) => value, "Consent is required")
  })
  .superRefine((value, context) => {
    if (
      (value.clientType === "BUSINESS_OWNER" || value.clientType === "OTHER") &&
      !value.businessName
    ) {
      context.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "Business name is required for this client type"
      });
    }
  });

export type AssessmentStartFormValues = z.infer<typeof assessmentStartSchema>;

