import { z } from "zod";

export const assessmentStartSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  middleName: z.string().trim().max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  email: z.string().trim().email("Enter a valid email address").max(320),
  phone: z
    .string()
    .trim()
    .refine((value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
    }, "Enter a valid US phone number"),
  consentAccepted: z.boolean().refine((value) => value, "Consent is required")
});

export type AssessmentStartFormValues = z.infer<typeof assessmentStartSchema>;
