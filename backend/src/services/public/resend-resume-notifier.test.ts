import { describe, expect, it } from "vitest";
import { buildResumeEmailSubject } from "./resend-resume-notifier";

describe("resume assessment email", () => {
  it("uses a per-request subject reference so Gmail keeps requested links separate", () => {
    const first = buildResumeEmailSubject(2026, "ABC12345");
    const second = buildResumeEmailSubject(2026, "XYZ67890");

    expect(first).toBe("Continue your 2026 Savians Tax Assessment - link ABC12345");
    expect(second).not.toBe(first);
  });
});
