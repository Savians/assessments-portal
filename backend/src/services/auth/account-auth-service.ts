import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { log } from "../../shared/logger";

export type AuthSessionStatus =
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

export interface PaidSession {
  id: string;
  normalizedEmail: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  assessmentYear: number;
  status: AuthSessionStatus;
  accountCreationAllowed: boolean;
  statusTokenExpiresAt: Date;
  clientId?: string | null;
}

export interface AccountInvite {
  id: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
  session: PaidSession;
}

export interface PasswordResetSubject {
  sessionId: string;
  normalizedEmail: string;
  firstName: string;
  assessmentYear: number;
}

export interface AccountAuthRepository {
  findSessionByStatusTokenHash(tokenHash: string): Promise<PaidSession | null>;
  createAccountInvite(input: { sessionId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  revokeUnusedInvitesExcept(sessionId: string, tokenHash: string, at: Date): Promise<void>;
  revokeUnusedInviteByTokenHash(tokenHash: string, at: Date): Promise<void>;
  markSessionInvited(sessionId: string): Promise<void>;
  findInviteByTokenHash(tokenHash: string): Promise<AccountInvite | null>;
  linkConfirmedAccount(input: {
    sessionId: string;
    normalizedEmail: string;
    cognitoUserId: string;
    inviteId: string;
    confirmedAt: Date;
    verificationTokenHash?: string;
    verificationType?: string;
  }): Promise<void>;
  linkRecoveredAccount(input: {
    sessionId: string;
    normalizedEmail: string;
    cognitoUserId: string;
    recoveredAt: Date;
  }): Promise<void>;
  recordInviteEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED" | "SKIPPED"; providerMessageId?: string; failureReason?: string; sentAt: Date }): Promise<void>;
  recordAccountVerificationEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED" | "SKIPPED"; providerMessageId?: string; failureReason?: string; sentAt: Date }): Promise<void>;
  recordPasswordResetEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED"; providerMessageId?: string; failureReason?: string; sentAt: Date }): Promise<void>;
  revokeAccountVerificationCodes(sessionId: string, verificationType: string, at: Date): Promise<void>;
  createAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; expiresAt: Date }): Promise<void>;
  findLatestAccountVerificationCodeCreatedAt(sessionId: string, verificationType: string): Promise<Date | null>;
  hasActiveAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; now: Date }): Promise<boolean>;
  markAccountVerificationCodeUsed(input: { sessionId: string; tokenHash: string; verificationType: string; usedAt: Date }): Promise<void>;
  findPasswordResetSubjectByEmail(normalizedEmail: string): Promise<PasswordResetSubject | null>;
  claimRecoveryCode(input: { sessionId: string; tokenHash: string; verificationType: string; now: Date }): Promise<boolean>;
  releaseRecoveryCodeClaim(input: { sessionId: string; tokenHash: string; verificationType: string; claimedAt: Date }): Promise<void>;
}

export interface AccountInviteNotifier {
  send(input: { email: string; firstName: string; setupUrl: string; assessmentYear: number }): Promise<{ providerMessageId?: string }>;
  sendVerificationCode(input: { email: string; firstName: string; code: string; assessmentYear: number }): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }>;
  sendPasswordResetCode(input: { email: string; firstName: string; code: string }): Promise<{ providerMessageId?: string }>;
}

export interface CognitoAccountGateway {
  accountExists(email: string): Promise<boolean>;
  prepareAccount(input: { email: string; password: string; fullName: string }): Promise<{ status: "PASSWORD_SET" | "EXISTING_ACCOUNT" }>;
  confirmSignUp(input: { email: string; confirmationCode: string }): Promise<{ userSub: string; emailVerified: boolean }>;
  setPermanentPassword(input: { email: string; password: string }): Promise<{ userSub: string; emailVerified: boolean }>;
}

export type CognitoMutationOperation = "CONFIRM_SIGN_UP" | "SET_PERMANENT_PASSWORD";
export type CognitoMutationStage = "BEFORE_MUTATION" | "MUTATION_ATTEMPTED";

export class CognitoMutationError extends Error {
  constructor(
    readonly operation: CognitoMutationOperation,
    readonly stage: CognitoMutationStage,
    readonly underlyingError: unknown
  ) {
    super(underlyingError instanceof Error ? underlyingError.message : "Cognito account mutation failed");
    this.name = "CognitoMutationError";
  }
}

export class AccountAuthError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

export const inviteRequestSchema = z.object({ token: z.string().min(32).max(256) });
export const inviteTokenSchema = z.object({ inviteToken: z.string().min(32).max(256) });
export const setupSchema = z.object({
  inviteToken: z.string().min(32).max(256),
  password: z.string().min(12).max(256)
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character")
});
export const confirmSchema = z.object({
  inviteToken: z.string().min(32).max(256),
  confirmationCode: z.string().trim().min(4).max(12)
});
export const existingAccountClaimSchema = z.object({ inviteToken: z.string().min(32).max(256) });
export const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(320) });
export const passwordResetConfirmSchema = z.object({
  email: z.string().trim().email().max(320),
  confirmationCode: z.string().trim().regex(/^\d{8}$/, "Enter the eight-digit reset code"),
  newPassword: z.string().min(12).max(256)
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character")
});
export const portalClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.union([z.literal(true), z.literal("true")])
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const generateToken = () => randomBytes(32).toString("base64url");
const generateVerificationCode = () => randomInt(100000, 1000000).toString();
const verificationType = "ACCOUNT_SETUP_EMAIL";
const passwordResetVerificationType = "PASSWORD_RESET_EMAIL";
const generatePasswordResetCode = () => randomInt(10_000_000, 100_000_000).toString();
const verificationHash = (inviteId: string, code: string) =>
  hash(`account-setup-email:${inviteId}:${code.trim()}`);
const passwordResetHash = (sessionId: string, email: string, code: string) =>
  hash(`assessment-password-reset:${sessionId}:${normalizeEmail(email)}:${code.trim()}`);
const fullName = (session: PaidSession) => [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" ");
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const definitelyFailedBeforeCognitoMutation = (error: unknown): boolean =>
  error instanceof CognitoMutationError && error.stage === "BEFORE_MUTATION";
const completedAccountStatuses: AuthSessionStatus[] = [
  "ACCOUNT_CREATED",
  "PROFILE_IN_PROGRESS",
  "PROFILE_COMPLETED",
  "DOCUMENTS_IN_PROGRESS",
  "DOCUMENTS_SUBMITTED",
  "IN_PROGRESS",
  "COMPLETED"
];

export class AccountAuthService {
  constructor(
    private readonly repository: AccountAuthRepository,
    private readonly cognito: CognitoAccountGateway,
    private readonly notifier: AccountInviteNotifier,
    private readonly frontendUrl: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async reissueInvite(raw: unknown): Promise<{ ok: true }> {
    const { session, inviteToken, tokenHash } = await this.issueInvite(raw, false);
    const setupUrl = `${this.frontendUrl.replace(/\/$/, "")}/assessment/account/setup/${inviteToken}`;
    const at = this.now();
    let delivery: Awaited<ReturnType<AccountInviteNotifier["send"]>>;
    try {
      delivery = await this.notifier.send({ email: session.normalizedEmail, firstName: session.firstName, setupUrl, assessmentYear: session.assessmentYear });
    } catch (error) {
      await this.repository.revokeUnusedInviteByTokenHash(tokenHash, at);
      await this.recordEmailAuditBestEffort(
        "account invite",
        session.id,
        () => this.repository.recordInviteEmail({
          sessionId: session.id,
          recipientEmail: session.normalizedEmail,
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : "Unknown account invite email error",
          sentAt: at
        })
      );
      throw new AccountAuthError("INVITE_EMAIL_FAILED", "The account invite could not be sent. Please try again.", 502);
    }

    // The replacement is usable as soon as the provider accepts the message.
    // Retire older invites before the non-critical audit write so an audit
    // outage cannot leave two replacement links active.
    await this.repository.revokeUnusedInvitesExcept(session.id, tokenHash, at);
    await this.recordEmailAuditBestEffort(
      "account invite",
      session.id,
      () => this.repository.recordInviteEmail({
        sessionId: session.id,
        recipientEmail: session.normalizedEmail,
        status: "SENT",
        providerMessageId: delivery.providerMessageId,
        sentAt: at
      })
    );
    return { ok: true };
  }

  async startBrowserInvite(raw: unknown): Promise<{ nextUrl: string; expiresAt: string }> {
    const { inviteToken, expiresAt } = await this.issueInvite(raw);
    return {
      nextUrl: `/assessment/account/setup/${inviteToken}`,
      expiresAt: expiresAt.toISOString()
    };
  }

  private async issueInvite(raw: unknown, replaceExisting = true): Promise<{
    session: PaidSession;
    inviteToken: string;
    tokenHash: string;
    expiresAt: Date;
  }> {
    const input = inviteRequestSchema.parse(raw);
    const session = await this.repository.findSessionByStatusTokenHash(hash(input.token));
    if (!session) throw new AccountAuthError("INVALID_TOKEN", "This account setup request is invalid.", 404);
    if (session.statusTokenExpiresAt.getTime() <= this.now().getTime()) throw new AccountAuthError("EXPIRED_TOKEN", "This account setup link has expired.", 410);
    if (!session.accountCreationAllowed || !["PAID_VERIFIED", "ACCOUNT_INVITED"].includes(session.status)) {
      throw new AccountAuthError("PAYMENT_REQUIRED", "Account setup unlocks only after full payment verification.", 402);
    }
    const inviteToken = generateToken();
    const tokenHash = hash(inviteToken);
    const at = this.now();
    const expiresAt = new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.repository.createAccountInvite({ sessionId: session.id, tokenHash, expiresAt });
    if (replaceExisting) {
      await this.repository.revokeUnusedInvitesExcept(session.id, tokenHash, at);
    }
    await this.repository.markSessionInvited(session.id);
    return { session, inviteToken, tokenHash, expiresAt };
  }

  async validateInvite(raw: unknown) {
    const input = inviteTokenSchema.parse(raw);
    const invite = await this.repository.findInviteByTokenHash(hash(input.inviteToken));
    if (!invite) throw new AccountAuthError("INVALID_INVITE", "This account setup invite is invalid.", 404);
    if (invite.usedAt && completedAccountStatuses.includes(invite.session.status)) {
      return {
        status: "ACCOUNT_CREATED" as const,
        accountExists: true,
        email: invite.session.normalizedEmail,
        clientName: fullName(invite.session),
        assessmentYear: invite.session.assessmentYear,
        expiresAt: invite.expiresAt.toISOString(),
        nextUrl: "/portal/dashboard"
      };
    }
    this.assertActiveInvite(invite);
    const accountExists = await this.cognito.accountExists(invite.session.normalizedEmail);
    return {
      status: "INVITE_ACTIVE" as const,
      accountExists,
      email: invite.session.normalizedEmail,
      clientName: fullName(invite.session),
      assessmentYear: invite.session.assessmentYear,
      expiresAt: invite.expiresAt.toISOString(),
      nextUrl: null
    };
  }

  async startSetup(raw: unknown): Promise<{ status: "CONFIRMATION_REQUIRED" | "EXISTING_ACCOUNT"; email: string }> {
    const input = setupSchema.parse(raw);
    const invite = await this.resolveInvite(input.inviteToken);
    const account = await this.cognito.prepareAccount({
      email: invite.session.normalizedEmail,
      password: input.password,
      fullName: fullName(invite.session)
    });
    if (account.status === "EXISTING_ACCOUNT") {
      return { status: "EXISTING_ACCOUNT", email: invite.session.normalizedEmail };
    }
    await this.issueVerificationCode(invite, false);
    return { status: "CONFIRMATION_REQUIRED", email: invite.session.normalizedEmail };
  }

  async resendVerificationCode(raw: unknown): Promise<{ ok: true; retryAfterSeconds: number }> {
    const input = inviteTokenSchema.parse(raw);
    const invite = await this.resolveInvite(input.inviteToken);
    await this.issueVerificationCode(invite, true);
    return { ok: true, retryAfterSeconds: 60 };
  }

  private async issueVerificationCode(invite: AccountInvite, enforceCooldown: boolean): Promise<void> {
    const now = this.now();
    if (enforceCooldown) {
      const latest = await this.repository.findLatestAccountVerificationCodeCreatedAt(invite.sessionId, verificationType);
      if (latest) {
        const retryAfterSeconds = Math.ceil((latest.getTime() + 60_000 - now.getTime()) / 1000);
        if (retryAfterSeconds > 0) {
          throw new AccountAuthError("VERIFICATION_RESEND_RATE_LIMITED", `Please wait ${retryAfterSeconds} seconds before requesting another code.`, 429);
        }
      }
    }
    const code = generateVerificationCode();
    await this.repository.revokeAccountVerificationCodes(invite.sessionId, verificationType, now);
    await this.repository.createAccountVerificationCode({
      sessionId: invite.sessionId,
      tokenHash: verificationHash(invite.id, code),
      verificationType,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000)
    });
    let delivery: Awaited<ReturnType<AccountInviteNotifier["sendVerificationCode"]>>;
    try {
      delivery = await this.notifier.sendVerificationCode({
        email: invite.session.normalizedEmail,
        firstName: invite.session.firstName,
        code,
        assessmentYear: invite.session.assessmentYear
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Unknown Resend delivery error";
      await this.repository.revokeAccountVerificationCodes(
        invite.sessionId,
        verificationType,
        now
      );
      await this.recordEmailAuditBestEffort(
        "account verification",
        invite.sessionId,
        () => this.repository.recordAccountVerificationEmail({
          sessionId: invite.sessionId,
          recipientEmail: invite.session.normalizedEmail,
          status: "FAILED",
          failureReason,
          sentAt: now
        })
      );
      log("error", "account verification email delivery failed", {
        sessionId: invite.sessionId,
        error: failureReason
      });
      throw new AccountAuthError(
        "VERIFICATION_EMAIL_FAILED",
        "We could not send the verification code. Please try again in a few minutes.",
        502
      );
    }

    if (delivery.status === "SKIPPED") {
      await this.repository.revokeAccountVerificationCodes(invite.sessionId, verificationType, now);
      await this.recordEmailAuditBestEffort(
        "account verification",
        invite.sessionId,
        () => this.repository.recordAccountVerificationEmail({
          sessionId: invite.sessionId,
          recipientEmail: invite.session.normalizedEmail,
          status: "SKIPPED",
          sentAt: now
        })
      );
      throw new AccountAuthError(
        "VERIFICATION_EMAIL_FAILED",
        "We could not send the verification code. Please try again in a few minutes.",
        502
      );
    }

    // Provider acceptance is the delivery boundary. Audit persistence is
    // observability-only and must not revoke a code that is already in email.
    await this.recordEmailAuditBestEffort(
      "account verification",
      invite.sessionId,
      () => this.repository.recordAccountVerificationEmail({
        sessionId: invite.sessionId,
        recipientEmail: invite.session.normalizedEmail,
        status: "SENT",
        providerMessageId: delivery.providerMessageId,
        sentAt: now
      })
    );
  }

  async confirm(raw: unknown): Promise<{ status: "ACCOUNT_CREATED"; nextUrl: string }> {
    const input = confirmSchema.parse(raw);
    const invite = await this.repository.findInviteByTokenHash(hash(input.inviteToken));
    if (!invite) throw new AccountAuthError("INVALID_INVITE", "This account setup invite is invalid.", 404);
    if (invite.usedAt && completedAccountStatuses.includes(invite.session.status)) {
      return { status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" };
    }
    this.assertActiveInvite(invite);
    const tokenHash = verificationHash(invite.id, input.confirmationCode);
    const claimedAt = this.now();
    const claimed = await this.repository.claimRecoveryCode({
      sessionId: invite.sessionId,
      tokenHash,
      verificationType,
      now: claimedAt
    });
    if (!claimed) throw new AccountAuthError("INVALID_VERIFICATION_CODE", "The verification code is invalid or expired.", 400);
    let confirmed: Awaited<ReturnType<CognitoAccountGateway["confirmSignUp"]>>;
    try {
      confirmed = await this.cognito.confirmSignUp({
        email: invite.session.normalizedEmail,
        confirmationCode: input.confirmationCode
      });
    } catch (error) {
      if (definitelyFailedBeforeCognitoMutation(error)) {
        await this.repository.releaseRecoveryCodeClaim({
          sessionId: invite.sessionId,
          tokenHash,
          verificationType,
          claimedAt
        });
      }
      throw error;
    }
    if (!confirmed.emailVerified) throw new AccountAuthError("EMAIL_NOT_VERIFIED", "Email verification was not completed.", 409);
    await this.repository.linkConfirmedAccount({
      sessionId: invite.sessionId,
      normalizedEmail: invite.session.normalizedEmail,
      cognitoUserId: confirmed.userSub,
      inviteId: invite.id,
      confirmedAt: this.now(),
      verificationTokenHash: tokenHash,
      verificationType
    });
    return { status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" };
  }

  async requestPasswordReset(raw: unknown): Promise<{ ok: true; retryAfterSeconds: number }> {
    const { email } = passwordResetRequestSchema.parse(raw);
    const normalizedEmail = normalizeEmail(email);
    const subject = await this.repository.findPasswordResetSubjectByEmail(normalizedEmail);

    // Always return the same response so this public endpoint cannot be used to enumerate accounts.
    if (!subject || !(await this.cognito.accountExists(normalizedEmail))) {
      return { ok: true, retryAfterSeconds: 60 };
    }

    const now = this.now();
    const latest = await this.repository.findLatestAccountVerificationCodeCreatedAt(
      subject.sessionId,
      passwordResetVerificationType
    );
    if (latest && latest.getTime() + 60_000 > now.getTime()) {
      return { ok: true, retryAfterSeconds: 60 };
    }

    const code = generatePasswordResetCode();
    await this.repository.revokeAccountVerificationCodes(subject.sessionId, passwordResetVerificationType, now);
    await this.repository.createAccountVerificationCode({
      sessionId: subject.sessionId,
      tokenHash: passwordResetHash(subject.sessionId, subject.normalizedEmail, code),
      verificationType: passwordResetVerificationType,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000)
    });

    let delivery: Awaited<ReturnType<AccountInviteNotifier["sendPasswordResetCode"]>>;
    try {
      delivery = await this.notifier.sendPasswordResetCode({
        email: subject.normalizedEmail,
        firstName: subject.firstName,
        code
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Unknown Resend delivery error";
      await this.repository.revokeAccountVerificationCodes(subject.sessionId, passwordResetVerificationType, now);
      await this.recordEmailAuditBestEffort(
        "password reset",
        subject.sessionId,
        () => this.repository.recordPasswordResetEmail({
          sessionId: subject.sessionId,
          recipientEmail: subject.normalizedEmail,
          status: "FAILED",
          failureReason,
          sentAt: now
        })
      );
      log("error", "password reset email delivery failed", {
        sessionId: subject.sessionId,
        error: failureReason
      });
      throw new AccountAuthError("PASSWORD_RESET_EMAIL_FAILED", "We could not send the password reset code. Please try again in a few minutes.", 502);
    }

    await this.recordEmailAuditBestEffort(
      "password reset",
      subject.sessionId,
      () => this.repository.recordPasswordResetEmail({
        sessionId: subject.sessionId,
        recipientEmail: subject.normalizedEmail,
        status: "SENT",
        providerMessageId: delivery.providerMessageId,
        sentAt: now
      })
    );
    return { ok: true, retryAfterSeconds: 60 };
  }

  private async recordEmailAuditBestEffort(
    emailKind: string,
    sessionId: string,
    persist: () => Promise<void>
  ): Promise<void> {
    try {
      await persist();
    } catch (error) {
      log("error", `${emailKind} email audit persistence failed`, {
        sessionId,
        error: error instanceof Error ? error.message : "Unknown email audit persistence error"
      });
    }
  }

  async confirmPasswordReset(raw: unknown): Promise<{ ok: true; nextUrl: "/portal/dashboard" }> {
    const input = passwordResetConfirmSchema.parse(raw);
    const normalizedEmail = normalizeEmail(input.email);
    const subject = await this.repository.findPasswordResetSubjectByEmail(normalizedEmail);
    if (!subject) {
      throw new AccountAuthError("INVALID_PASSWORD_RESET_CODE", "The reset code is invalid or expired.", 400);
    }

    const claimedAt = this.now();
    const tokenHash = passwordResetHash(subject.sessionId, normalizedEmail, input.confirmationCode);
    const claimed = await this.repository.claimRecoveryCode({
      sessionId: subject.sessionId,
      tokenHash,
      verificationType: passwordResetVerificationType,
      now: claimedAt
    });
    if (!claimed) {
      throw new AccountAuthError("INVALID_PASSWORD_RESET_CODE", "The reset code is invalid or expired.", 400);
    }

    let recovered: Awaited<ReturnType<CognitoAccountGateway["setPermanentPassword"]>>;
    try {
      recovered = await this.cognito.setPermanentPassword({
        email: normalizedEmail,
        password: input.newPassword
      });
    } catch (error) {
      if (definitelyFailedBeforeCognitoMutation(error)) {
        await this.repository.releaseRecoveryCodeClaim({
          sessionId: subject.sessionId,
          tokenHash,
          verificationType: passwordResetVerificationType,
          claimedAt
        });
      }
      throw error;
    }
    if (!recovered.emailVerified) {
      throw new AccountAuthError("EMAIL_NOT_VERIFIED", "Email verification was not completed.", 409);
    }
    await this.repository.linkRecoveredAccount({
      sessionId: subject.sessionId,
      normalizedEmail: subject.normalizedEmail,
      cognitoUserId: recovered.userSub,
      recoveredAt: this.now()
    });
    return { ok: true, nextUrl: "/portal/dashboard" };
  }

  async claimExistingAccount(raw: unknown, rawClaims: unknown): Promise<{ status: "ACCOUNT_CREATED"; nextUrl: string }> {
    const input = existingAccountClaimSchema.parse(raw);
    const claims = portalClaimsSchema.parse(rawClaims);
    const invite = await this.resolveInvite(input.inviteToken);
    if (normalizeEmail(claims.email) !== normalizeEmail(invite.session.normalizedEmail)) {
      throw new AccountAuthError("ACCOUNT_EMAIL_MISMATCH", "Sign in with the email address associated with this assessment.", 403);
    }
    await this.repository.linkConfirmedAccount({
      sessionId: invite.sessionId,
      normalizedEmail: invite.session.normalizedEmail,
      cognitoUserId: claims.sub,
      inviteId: invite.id,
      confirmedAt: this.now()
    });
    return { status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" };
  }

  private async resolveInvite(token: string): Promise<AccountInvite> {
    const invite = await this.repository.findInviteByTokenHash(hash(token));
    if (!invite) throw new AccountAuthError("INVALID_INVITE", "This account setup invite is invalid.", 404);
    this.assertActiveInvite(invite);
    return invite;
  }

  private assertActiveInvite(invite: AccountInvite): void {
    if (invite.usedAt) throw new AccountAuthError("INVITE_USED", "This account setup invite has already been used.", 409);
    if (invite.revokedAt) throw new AccountAuthError("INVITE_REVOKED", "This account setup invite has been replaced.", 409);
    if (invite.expiresAt.getTime() <= this.now().getTime()) throw new AccountAuthError("INVITE_EXPIRED", "This account setup invite has expired.", 410);
    if (!invite.session.accountCreationAllowed || !["PAID_VERIFIED", "ACCOUNT_INVITED"].includes(invite.session.status)) {
      throw new AccountAuthError("PAYMENT_REQUIRED", "Account setup unlocks only after full payment verification.", 402);
    }
  }
}
