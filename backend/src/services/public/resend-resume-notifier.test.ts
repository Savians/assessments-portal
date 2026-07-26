import { describe, expect, it } from "vitest";
import {
  buildResumeEmailContent,
  buildResumeEmailSubject
} from "./resend-resume-notifier";

describe("resume assessment email", () => {
  it("uses a per-request subject reference so Gmail keeps requested links separate", () => {
    const first = buildResumeEmailSubject(2026, "ABC12345");
    const second = buildResumeEmailSubject(2026, "XYZ67890");

    expect(first).toBe("Resume your 2026 Savians legal agreement - link ABC12345");
    expect(second).not.toBe(first);
  });

  it.each([
    {
      label: "initial start",
      assessmentStatus: "AGREEMENT_PENDING" as const,
      emailPurpose: "START" as const,
      subject: "Start your 2026 Savians Tax Assessment - link ABC12345",
      ctaLabel: "Review Legal Agreement",
      note: "No QuickBooks invoice has been created yet."
    },
    {
      label: "agreement resume",
      assessmentStatus: "AGREEMENT_PENDING" as const,
      emailPurpose: "RESUME" as const,
      subject: "Resume your 2026 Savians legal agreement - link ABC12345",
      ctaLabel: "Review and Sign Agreement",
      note: "No QuickBooks invoice has been created yet."
    },
    {
      label: "payment pending",
      assessmentStatus: "PAYMENT_PENDING" as const,
      emailPurpose: "RESUME" as const,
      subject: "View payment status for your 2026 Savians assessment - link ABC12345",
      ctaLabel: "View Invoice and Payment Status",
      note: "Account setup unlocks only after QuickBooks verifies payment in full."
    },
    {
      label: "paid account setup",
      assessmentStatus: "PAID_VERIFIED" as const,
      emailPurpose: "RESUME" as const,
      subject: "Payment confirmed - continue your 2026 Savians account setup - link ABC12345",
      ctaLabel: "Continue Account Setup",
      note: "Proceed now, or keep this secure link and return when you are ready."
    },
    {
      label: "created account",
      assessmentStatus: "ACCOUNT_CREATED" as const,
      emailPurpose: "RESUME" as const,
      subject: "Open your 2026 Savians client dashboard - link ABC12345",
      ctaLabel: "Open Client Dashboard",
      note: "Use the password already associated with your Savians account."
    }
  ])("uses truthful copy for $label", (expected) => {
    expect(buildResumeEmailContent({
      assessmentYear: 2026,
      assessmentStatus: expected.assessmentStatus,
      emailPurpose: expected.emailPurpose,
      requestReference: "ABC12345"
    })).toMatchObject({
      subject: expected.subject,
      ctaLabel: expected.ctaLabel,
      note: expected.note
    });
  });
});
