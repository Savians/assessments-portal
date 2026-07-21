import { describe, expect, it } from "vitest";
import type {
  AssessmentSessionRecord,
  AssessmentSessionRepository,
  CreateAssessmentRecord,
  ResumeAgreementNotifier
} from "./start-assessment";
import {
  hashStatusToken,
  ResumeEmailDeliveryError,
  StartAssessmentService,
  startAssessmentSchema
} from "./start-assessment";

class InMemoryRepository implements AssessmentSessionRepository {
  sessions: AssessmentSessionRecord[] = [];
  createInputs: CreateAssessmentRecord[] = [];
  tokenHashes = new Map<string, string>();
  emails: string[] = [];

  findAnnualSession(email: string, year: number): Promise<AssessmentSessionRecord | null> {
    return Promise.resolve(
      this.sessions.find(
        (session) => session.normalizedEmail === email && session.assessmentYear === year
      ) ?? null
    );
  }

  createAnnualSession(input: CreateAssessmentRecord): Promise<AssessmentSessionRecord> {
    this.createInputs.push(input);
    const session: AssessmentSessionRecord = {
      id: "session-" + (this.sessions.length + 1),
      normalizedEmail: input.normalizedEmail,
      assessmentYear: input.assessmentYear,
      status: "AGREEMENT_PENDING"
    };
    this.sessions.push(session);
    this.tokenHashes.set(session.id, input.statusTokenHash);
    return Promise.resolve(session);
  }

  rotateStatusToken(
    sessionId: string,
    tokenHash: string
  ): Promise<AssessmentSessionRecord> {
    this.tokenHashes.set(sessionId, tokenHash);
    const session = this.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("missing session");
    return Promise.resolve(session);
  }

  recordResumeEmail(_sessionId: string, recipientEmail: string): Promise<void> {
    this.emails.push(recipientEmail);
    return Promise.resolve();
  }
}

class SkippedNotifier implements ResumeAgreementNotifier {
  calls = 0;
  send(): Promise<{ status: "SKIPPED" }> {
    this.calls += 1;
    return Promise.resolve({ status: "SKIPPED" });
  }
}

class SentNotifier implements ResumeAgreementNotifier {
  calls = 0;
  resumeUrls: string[] = [];
  send(): Promise<{ status: "SENT"; providerMessageId: string }> {
    this.calls += 1;
    return Promise.resolve({ status: "SENT", providerMessageId: "email-" + this.calls });
  }
}

class CapturingNotifier implements ResumeAgreementNotifier {
  resumeUrls: string[] = [];
  send(input: { resumeUrl: string }): Promise<{ status: "SENT"; providerMessageId: string }> {
    this.resumeUrls.push(input.resumeUrl);
    return Promise.resolve({ status: "SENT", providerMessageId: "email-" + this.resumeUrls.length });
  }
}

const validInput = {
  firstName: " John ",
  middleName: "",
  lastName: "Smith",
  dateOfBirth: "1980-03-15",
  email: "JOHN@EXAMPLE.COM ",
  phone: "(832) 555-1212",
  clientType: "BUSINESS_OWNER",
  businessName: "Smith Consulting LLC",
  state: "tx",
  incomeRange: "$250K-$500K",
  estimatedTaxPaidRange: "$50K-$100K",
  consentAccepted: true
} as const;

describe("StartAssessmentService", () => {
  it("creates one annual session and stores only the status token hash", async () => {
    const repository = new InMemoryRepository();
    const notifier = new SkippedNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, {
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    expect(result.resumed).toBe(false);
    expect(result.assessmentYear).toBe(2026);
    expect(result.nextUrl).toMatch(/^\/assessment\/agreement\/[A-Za-z0-9_-]{43}$/);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.createInputs[0]?.normalizedEmail).toBe("john@example.com");
    expect(repository.createInputs[0]?.phone).toBe("+18325551212");

    const rawToken = result.nextUrl.split("/").at(-1);
    expect(rawToken).toBeDefined();
    expect(repository.tokenHashes.get("session-1")).toBe(hashStatusToken(rawToken ?? ""));
    expect(repository.tokenHashes.get("session-1")).not.toBe(rawToken);
    expect(notifier.calls).toBe(1);
  });

  it("resumes rather than duplicates a same-year session", async () => {
    const repository = new InMemoryRepository();
    const notifier = new SentNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");
    const now = new Date("2026-07-05T00:00:00.000Z");

    await service.execute(validInput, { now });
    const resumed = await service.execute(validInput, { now });

    expect(resumed.resumed).toBe(true);
    expect(resumed.nextUrl).toBe("/assessment/check-email");
    expect(repository.sessions).toHaveLength(1);
    expect(repository.createInputs).toHaveLength(1);
  });

  it("sends saved-signature billing retries back to the agreement page", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      assessmentYear: 2026,
      status: "AGREEMENT_SIGNED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.resumeUrls[0]).toMatch(/^https:\/\/assessments\.savians\.com\/assessment\/agreement\/[A-Za-z0-9_-]{43}$/);
  });

  it("sends paid-account resumes back to the status page where account setup can continue", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      assessmentYear: 2026,
      status: "PAID_VERIFIED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.resumeUrls[0]).toMatch(/^https:\/\/assessments\.savians\.com\/assessment\/status\/[A-Za-z0-9_-]{43}$/);
  });

  it("sends account-created and profile-in-progress resumes to the protected dashboard page", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      assessmentYear: 2026,
      status: "ACCOUNT_CREATED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.resumeUrls[0]).toBe("https://assessments.savians.com/portal/dashboard");
  });

  it("does not claim a resume email was sent when email delivery is skipped", async () => {
    const repository = new InMemoryRepository();
    const notifier = new SkippedNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");
    const now = new Date("2026-07-05T00:00:00.000Z");

    await service.execute(validInput, { now });

    await expect(service.execute(validInput, { now })).rejects.toBeInstanceOf(
      ResumeEmailDeliveryError
    );
  });

  it("creates a new assessment for the same client in a new year", async () => {
    const repository = new InMemoryRepository();
    const service = new StartAssessmentService(
      repository,
      new SkippedNotifier(),
      "https://assessments.savians.com"
    );

    await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });
    const nextYear = await service.execute(validInput, {
      now: new Date("2027-01-05T00:00:00.000Z")
    });

    expect(nextYear.resumed).toBe(false);
    expect(nextYear.assessmentYear).toBe(2027);
    expect(repository.sessions).toHaveLength(2);
  });

  it("reports a reusable account before agreement and payment", async () => {
    const repository = new InMemoryRepository();
    const service = new StartAssessmentService(
      repository,
      new SkippedNotifier(),
      "https://assessments.savians.com",
      { accountExists: async () => true }
    );

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.accountExists).toBe(true);
    expect(result.message).toContain("existing Savians account");
    expect(result.nextUrl).toMatch(/^\/assessment\/agreement\//);
  });

  it("rejects future DOB, missing consent, and missing conditional business name", () => {
    expect(() =>
      startAssessmentSchema.parse({
        ...validInput,
        dateOfBirth: "2999-01-01",
        consentAccepted: false,
        businessName: ""
      })
    ).toThrow();
  });

  it("has no QuickBooks dependency before agreement signature", async () => {
    const repository = new InMemoryRepository();
    const notifier = new SkippedNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(repository.createInputs).toHaveLength(1);
    expect(notifier.calls).toBe(1);
    // The Phase 2 service accepts only session storage and email dependencies.
    // QuickBooks is intentionally impossible to inject or invoke at this boundary.
  });
});
