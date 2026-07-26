import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { log } from "../../shared/logger";

export const startAssessmentSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  middleName: z.string().trim().max(60).optional().or(z.literal("")),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(10).max(32),
  consentAccepted: z.literal(true)
});

export type StartAssessmentInput = z.infer<typeof startAssessmentSchema>;

export const recoverAssessmentSchema = z.object({
  email: z.string().trim().email().max(320)
});

export type AssessmentStatus =
  | "AGREEMENT_PENDING"
  | "AGREEMENT_SIGNED"
  | "QB_CUSTOMER_CREATED"
  | "INVOICE_CREATED"
  | "INVOICE_SENT"
  | "PAYMENT_PENDING"
  | "PAYMENT_VERIFYING"
  | "PAID_VERIFIED"
  | "ACCOUNT_INVITED"
  | "ACCOUNT_CREATED"
  | "PROFILE_IN_PROGRESS"
  | "PROFILE_COMPLETED"
  | "DOCUMENTS_IN_PROGRESS"
  | "DOCUMENTS_SUBMITTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ERROR";

export interface AssessmentSessionRecord {
  id: string;
  normalizedEmail: string;
  firstName: string;
  lastName: string;
  assessmentYear: number;
  status: AssessmentStatus;
}

export interface CreateAssessmentRecord {
  normalizedEmail: string;
  phone: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  assessmentYear: number;
  statusTokenHash: string;
  statusTokenExpiresAt: Date;
  consentAcceptedAt: Date;
  actorIp?: string;
  actorUserAgent?: string;
}

export interface AssessmentSessionRepository {
  findAnnualSession(normalizedEmail: string, assessmentYear: number): Promise<AssessmentSessionRecord | null>;
  createAnnualSession(input: CreateAssessmentRecord): Promise<AssessmentSessionRecord>;
  createAssessmentResumeGrant(
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    actorIp?: string,
    actorUserAgent?: string
  ): Promise<void>;
  recordResumeEmail(
    sessionId: string,
    recipientEmail: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    providerMessageId?: string,
    failureReason?: string
  ): Promise<void>;
}

export interface ResumeAgreementNotifier {
  send(input: {
    recipientEmail: string;
    recipientName: string;
    resumeUrl: string;
    assessmentYear: number;
    assessmentStatus: AssessmentStatus;
    emailPurpose: "START" | "RESUME";
  }): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }>;
}

export interface AssessmentAccountDirectory {
  accountExists(email: string): Promise<boolean>;
}

export interface StartAssessmentContext {
  ipAddress?: string;
  userAgent?: string;
  now?: Date;
}

export interface StartAssessmentResult {
  status: AssessmentStatus;
  nextUrl: string;
  resumed: boolean;
  accountExists: boolean;
  assessmentYear: number;
  message: string;
}

export class ResumeEmailDeliveryError extends Error {
  constructor(message = "We found your assessment, but could not send the secure resume email. Please try again in a few minutes or contact Savians support.") {
    super(message);
    this.name = "ResumeEmailDeliveryError";
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const normalizeUsPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  throw new Error("Phone must be a valid US number");
};

export const hashStatusToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const generateStatusToken = (): string => randomBytes(32).toString("base64url");

const nextUrlForStatus = (status: AssessmentStatus, token: string): string => {
  if (status === "AGREEMENT_PENDING" || status === "AGREEMENT_SIGNED" || status === "QB_CUSTOMER_CREATED") {
    return "/assessment/agreement/" + token;
  }
  if (
    [
      "INVOICE_CREATED",
      "INVOICE_SENT",
      "PAYMENT_PENDING",
      "PAYMENT_VERIFYING"
    ].includes(status)
  ) {
    return "/assessment/status/" + token;
  }
  if (status === "PAID_VERIFIED" || status === "ACCOUNT_INVITED") {
    return "/assessment/status/" + token;
  }
  if (status === "ACCOUNT_CREATED" || status === "PROFILE_IN_PROGRESS") {
    return "/portal/dashboard";
  }
  if (
    status === "PROFILE_COMPLETED" ||
    status === "DOCUMENTS_IN_PROGRESS" ||
    status === "DOCUMENTS_SUBMITTED" ||
    status === "IN_PROGRESS" ||
    status === "COMPLETED"
  ) {
    return "/portal/dashboard";
  }
  return "/assessment/recover";
};

const nextUrlUsesStatusToken = (nextUrl: string): boolean =>
  nextUrl.startsWith("/assessment/agreement/") || nextUrl.startsWith("/assessment/status/");

export class StartAssessmentService {
  constructor(
    private readonly repository: AssessmentSessionRepository,
    private readonly notifier: ResumeAgreementNotifier,
    private readonly frontendUrl: string,
    private readonly accountDirectory?: AssessmentAccountDirectory
  ) {}

  async execute(
    rawInput: unknown,
    context: StartAssessmentContext = {}
  ): Promise<StartAssessmentResult> {
    const input = startAssessmentSchema.parse(rawInput);
    const now = context.now ?? new Date();
    const assessmentYear = now.getUTCFullYear();
    const normalizedEmail = normalizeEmail(input.email);
    const accountExists = await this.accountDirectory?.accountExists(normalizedEmail) ?? false;
    const normalizedPhone = normalizeUsPhone(input.phone);
    const statusToken = generateStatusToken();
    const statusTokenHash = hashStatusToken(statusToken);
    const statusTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    let session = await this.repository.findAnnualSession(normalizedEmail, assessmentYear);
    let resumed = Boolean(session);

    if (!session) {
      try {
        session = await this.repository.createAnnualSession({
          normalizedEmail,
          phone: normalizedPhone,
          firstName: input.firstName,
          middleName: input.middleName || undefined,
          lastName: input.lastName,
          assessmentYear,
          statusTokenHash,
          statusTokenExpiresAt,
          consentAcceptedAt: now,
          actorIp: context.ipAddress,
          actorUserAgent: context.userAgent
        });
      } catch (error) {
        const concurrent = await this.repository.findAnnualSession(normalizedEmail, assessmentYear);
        if (!concurrent) throw error;
        resumed = true;
        session = concurrent;
      }
    }

    const nextUrl = nextUrlForStatus(session.status, statusToken);
    const resumeUrl = new URL(nextUrl, this.frontendUrl).toString();

    if (resumed && nextUrlUsesStatusToken(nextUrl)) {
      await this.repository.createAssessmentResumeGrant(
        session.id,
        statusTokenHash,
        statusTokenExpiresAt,
        context.ipAddress,
        context.userAgent
      );
    }

    let delivery: { status: "SENT" | "SKIPPED" | "FAILED"; providerMessageId?: string };
    let failureReason: string | undefined;
    try {
      delivery = await this.notifier.send({
        recipientEmail: normalizedEmail,
        recipientName: session.firstName + " " + session.lastName,
        resumeUrl,
        assessmentYear,
        assessmentStatus: session.status,
        emailPurpose: resumed ? "RESUME" : "START"
      });
    } catch (error) {
      failureReason = error instanceof Error ? error.message : "Unknown email error";
      log("error", "assessment access email failed", {
        sessionId: session.id,
        error: failureReason
      });
      delivery = { status: "FAILED" };
    }

    await this.recordResumeEmailBestEffort(
      session.id,
      normalizedEmail,
      delivery.status,
      delivery.providerMessageId,
      failureReason
    );
    if (resumed && delivery.status !== "SENT") {
      throw new ResumeEmailDeliveryError();
    }

    return {
      status: session.status,
      nextUrl: resumed ? "/assessment/check-email" : nextUrl,
      resumed,
      accountExists,
      assessmentYear,
      message: resumed
        ? "Your existing annual assessment has been found. Check your email for a secure resume link."
        : accountExists
          ? "An existing Savians account was found. Your current password will remain unchanged; after payment, sign in to connect this assessment."
          : "Your assessment has been started. Please review the legal agreement."
    };
  }

  async recover(
    rawInput: unknown,
    context: StartAssessmentContext = {}
  ): Promise<{ ok: true; nextUrl: "/assessment/check-email"; message: string }> {
    const input = recoverAssessmentSchema.parse(rawInput);
    const now = context.now ?? new Date();
    const assessmentYear = now.getUTCFullYear();
    const normalizedEmail = normalizeEmail(input.email);
    const session = await this.repository.findAnnualSession(normalizedEmail, assessmentYear);
    if (session) {
      const statusToken = generateStatusToken();
      const statusTokenHash = hashStatusToken(statusToken);
      const statusTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const nextUrl = nextUrlForStatus(session.status, statusToken);
      const resumeUrl = new URL(nextUrl, this.frontendUrl).toString();
      if (nextUrlUsesStatusToken(nextUrl)) {
        await this.repository.createAssessmentResumeGrant(
          session.id,
          statusTokenHash,
          statusTokenExpiresAt,
          context.ipAddress,
          context.userAgent
        );
      }
      let delivery: { status: "SENT" | "SKIPPED" | "FAILED"; providerMessageId?: string };
      let failureReason: string | undefined;
      try {
        delivery = await this.notifier.send({
          recipientEmail: normalizedEmail,
          recipientName: session.firstName + " " + session.lastName,
          resumeUrl,
          assessmentYear,
          assessmentStatus: session.status,
          emailPurpose: "RESUME"
        });
      } catch (error) {
        failureReason = error instanceof Error ? error.message : "Unknown email error";
        delivery = { status: "FAILED" };
      }
      await this.recordResumeEmailBestEffort(
        session.id,
        normalizedEmail,
        delivery.status,
        delivery.providerMessageId,
        failureReason
      );
      if (delivery.status !== "SENT") {
        throw new ResumeEmailDeliveryError();
      }
    }
    return {
      ok: true,
      nextUrl: "/assessment/check-email",
      message: "If an assessment exists for this email, a secure resume link has been sent."
    };
  }

  private async recordResumeEmailBestEffort(
    sessionId: string,
    recipientEmail: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    providerMessageId?: string,
    failureReason?: string
  ): Promise<void> {
    try {
      await this.repository.recordResumeEmail(
        sessionId,
        recipientEmail,
        status,
        providerMessageId,
        failureReason
      );
    } catch (error) {
      log("error", "assessment access email audit persistence failed", {
        sessionId,
        deliveryStatus: status,
        error: error instanceof Error ? error.message : "Unknown email audit persistence error"
      });
    }
  }
}
