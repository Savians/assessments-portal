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
  failEmailPersistence = false;
  resumeGrants: Array<{
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
  }> = [];
  emailEvents: Array<{
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    failureReason?: string;
  }> = [];

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
      firstName: input.firstName,
      lastName: input.lastName,
      assessmentYear: input.assessmentYear,
      status: "AGREEMENT_PENDING"
    };
    this.sessions.push(session);
    this.tokenHashes.set(session.id, input.statusTokenHash);
    return Promise.resolve(session);
  }

  createAssessmentResumeGrant(
    sessionId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    this.resumeGrants.push({ sessionId, tokenHash, expiresAt });
    return Promise.resolve();
  }

  recordResumeEmail(
    _sessionId: string,
    recipientEmail: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    _providerMessageId?: string,
    failureReason?: string
  ): Promise<void> {
    if (this.failEmailPersistence) {
      return Promise.reject(new Error("Email audit database unavailable"));
    }
    this.emailEvents.push({ recipientEmail, status, failureReason });
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
  inputs: Array<Parameters<ResumeAgreementNotifier["send"]>[0]> = [];
  send(input: Parameters<ResumeAgreementNotifier["send"]>[0]): Promise<{ status: "SENT"; providerMessageId: string }> {
    this.inputs.push(input);
    return Promise.resolve({ status: "SENT", providerMessageId: "email-" + this.inputs.length });
  }
}

class ThrowingNotifier implements ResumeAgreementNotifier {
  send(): Promise<never> {
    return Promise.reject(new Error("Resend unavailable"));
  }
}

const validInput = {
  firstName: " John ",
  middleName: "",
  lastName: "Smith",
  email: "JOHN@EXAMPLE.COM ",
  phone: "(832) 555-1212",
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
    expect(repository.createInputs[0]).not.toHaveProperty("dateOfBirth");
    expect(repository.createInputs[0]).not.toHaveProperty("clientType");

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

  it("keeps a provider-accepted execute resume successful when email audit persistence fails", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "PAYMENT_PENDING"
    });
    repository.failEmailPersistence = true;
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    await expect(service.execute(validInput, {
      now: new Date("2026-07-05T00:00:00.000Z")
    })).resolves.toMatchObject({
      resumed: true,
      nextUrl: "/assessment/check-email"
    });

    const rawToken = notifier.inputs[0]?.resumeUrl.split("/").at(-1) ?? "";
    expect(repository.resumeGrants).toEqual([
      expect.objectContaining({ tokenHash: hashStatusToken(rawToken) })
    ]);
    expect(repository.emailEvents).toEqual([]);
  });

  it("keeps a provider-accepted recovery successful when email audit persistence fails", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "AGREEMENT_PENDING"
    });
    repository.failEmailPersistence = true;
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    await expect(service.recover(
      { email: "john@example.com" },
      { now: new Date("2026-07-05T00:00:00.000Z") }
    )).resolves.toEqual({
      ok: true,
      nextUrl: "/assessment/check-email",
      message: "If an assessment exists for this email, a secure resume link has been sent."
    });

    const rawToken = notifier.inputs[0]?.resumeUrl.split("/").at(-1) ?? "";
    expect(repository.resumeGrants).toEqual([
      expect.objectContaining({ tokenHash: hashStatusToken(rawToken) })
    ]);
    expect(repository.emailEvents).toEqual([]);
  });

  it("sends saved-signature billing retries back to the agreement page", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "AGREEMENT_SIGNED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.inputs[0]).toMatchObject({
      assessmentStatus: "AGREEMENT_SIGNED",
      emailPurpose: "RESUME"
    });
    expect(notifier.inputs[0]?.resumeUrl).toMatch(/^https:\/\/assessments\.savians\.com\/assessment\/agreement\/[A-Za-z0-9_-]{43}$/);
  });

  it("sends paid-account resumes back to the status page where account setup can continue", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "PAID_VERIFIED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.inputs[0]).toMatchObject({
      assessmentStatus: "PAID_VERIFIED",
      emailPurpose: "RESUME"
    });
    expect(notifier.inputs[0]?.resumeUrl).toMatch(/^https:\/\/assessments\.savians\.com\/assessment\/status\/[A-Za-z0-9_-]{43}$/);
  });

  it("sends account-created and profile-in-progress resumes to the protected dashboard page", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "ACCOUNT_CREATED"
    });
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(repository, notifier, "https://assessments.savians.com");

    const result = await service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") });

    expect(result.nextUrl).toBe("/assessment/check-email");
    expect(notifier.inputs[0]).toMatchObject({
      resumeUrl: "https://assessments.savians.com/portal/dashboard",
      assessmentStatus: "ACCOUNT_CREATED",
      emailPurpose: "RESUME"
    });
    expect(repository.resumeGrants).toHaveLength(0);
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

  it("returns the resume delivery error when the provider fails and failure-audit persistence also fails", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "PAYMENT_PENDING"
    });
    repository.failEmailPersistence = true;
    const service = new StartAssessmentService(
      repository,
      new ThrowingNotifier(),
      "https://assessments.savians.com"
    );

    await expect(service.execute(validInput, {
      now: new Date("2026-07-05T00:00:00.000Z")
    })).rejects.toBeInstanceOf(ResumeEmailDeliveryError);
    expect(repository.emailEvents).toEqual([]);
  });

  it("returns the recovery delivery error when the provider skips and failure-audit persistence also fails", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "AGREEMENT_PENDING"
    });
    repository.failEmailPersistence = true;
    const service = new StartAssessmentService(
      repository,
      new SkippedNotifier(),
      "https://assessments.savians.com"
    );

    await expect(service.recover(
      { email: "john@example.com" },
      { now: new Date("2026-07-05T00:00:00.000Z") }
    )).rejects.toBeInstanceOf(ResumeEmailDeliveryError);
    expect(repository.emailEvents).toEqual([]);
  });

  it("records one failed event while preserving both the previous link and the pre-issued resume grant", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "PAYMENT_PENDING"
    });
    repository.tokenHashes.set("session-1", "working-token-hash");
    const service = new StartAssessmentService(
      repository,
      new ThrowingNotifier(),
      "https://assessments.savians.com"
    );

    await expect(
      service.execute(validInput, { now: new Date("2026-07-05T00:00:00.000Z") })
    ).rejects.toBeInstanceOf(ResumeEmailDeliveryError);

    expect(repository.tokenHashes.get("session-1")).toBe("working-token-hash");
    expect(repository.resumeGrants).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        expiresAt: new Date("2026-08-04T00:00:00.000Z")
      })
    ]);
    expect(repository.emailEvents).toEqual([
      {
        recipientEmail: "john@example.com",
        status: "FAILED",
        failureReason: "Resend unavailable"
      }
    ]);
  });

  it("keeps simultaneous recovery-email tokens independently valid without rotating the primary token", async () => {
    const repository = new InMemoryRepository();
    repository.sessions.push({
      id: "session-1",
      normalizedEmail: "john@example.com",
      firstName: "John",
      lastName: "Smith",
      assessmentYear: 2026,
      status: "PAYMENT_PENDING"
    });
    repository.tokenHashes.set("session-1", "working-primary-token-hash");
    const notifier = new CapturingNotifier();
    const service = new StartAssessmentService(
      repository,
      notifier,
      "https://assessments.savians.com"
    );
    const context = { now: new Date("2026-07-05T00:00:00.000Z") };

    await Promise.all([
      service.recover({ email: "john@example.com" }, context),
      service.recover({ email: "john@example.com" }, context)
    ]);

    const rawTokens = notifier.inputs.map((input) => input.resumeUrl.split("/").at(-1) ?? "");
    expect(new Set(rawTokens).size).toBe(2);
    expect(repository.resumeGrants.map(({ tokenHash }) => tokenHash)).toEqual(
      expect.arrayContaining(rawTokens.map(hashStatusToken))
    );
    expect(repository.resumeGrants).toHaveLength(2);
    expect(repository.tokenHashes.get("session-1")).toBe("working-primary-token-hash");
  });

  it("records a start-mail failure only once while keeping the new browser link usable", async () => {
    const repository = new InMemoryRepository();
    const service = new StartAssessmentService(
      repository,
      new ThrowingNotifier(),
      "https://assessments.savians.com"
    );

    const result = await service.execute(validInput, {
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    expect(result.resumed).toBe(false);
    expect(result.nextUrl).toMatch(/^\/assessment\/agreement\//);
    expect(repository.emailEvents.map((event) => event.status)).toEqual(["FAILED"]);
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

  it("rejects invalid contact information and missing consent", () => {
    expect(() =>
      startAssessmentSchema.parse({
        ...validInput,
        email: "invalid",
        phone: "123",
        consentAccepted: false,
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
