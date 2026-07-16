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
  revokeUnusedInvites(sessionId: string, at: Date): Promise<void>;
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
  recordInviteEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED" | "SKIPPED"; failureReason?: string; sentAt: Date }): Promise<void>;
  revokeAccountVerificationCodes(sessionId: string, verificationType: string, at: Date): Promise<void>;
  createAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; expiresAt: Date }): Promise<void>;
  findLatestAccountVerificationCodeCreatedAt(sessionId: string, verificationType: string): Promise<Date | null>;
  hasActiveAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; now: Date }): Promise<boolean>;
  markAccountVerificationCodeUsed(input: { sessionId: string; tokenHash: string; verificationType: string; usedAt: Date }): Promise<void>;
  findPasswordResetSubjectByEmail(normalizedEmail: string): Promise<PasswordResetSubject | null>;
  consumeRecoveryCode(input: { sessionId: string; tokenHash: string; verificationType: string; now: Date }): Promise<boolean>;
}

export interface AccountInviteNotifier {
  send(input: { email: string; firstName: string; setupUrl: string; assessmentYear: number }): Promise<void>;
  sendVerificationCode(input: { email: string; firstName: string; code: string; assessmentYear: number }): Promise<void>;
  sendPasswordResetCode(input: { email: string; firstName: string; code: string }): Promise<void>;
}

export interface CognitoAccountGateway {
  prepareAccount(input: { email: string; password: string; fullName: string }): Promise<{ status: "PASSWORD_SET" | "EXISTING_CONFIRMED" }>;
  confirmSignUp(input: { email: string; confirmationCode: string }): Promise<{ userSub: string; emailVerified: boolean }>;
  setPermanentPassword(input: { email: string; password: string }): Promise<void>;
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
    const { session, inviteToken } = await this.issueInvite(raw);
    const setupUrl = `${this.frontendUrl.replace(/\/$/, "")}/assessment/account/setup/${inviteToken}`;
    const at = this.now();
    try {
      await this.notifier.send({ email: session.normalizedEmail, firstName: session.firstName, setupUrl, assessmentYear: session.assessmentYear });
      await this.repository.recordInviteEmail({ sessionId: session.id, recipientEmail: session.normalizedEmail, status: "SENT", sentAt: at });
    } catch (error) {
      await this.repository.recordInviteEmail({
        sessionId: session.id,
        recipientEmail: session.normalizedEmail,
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Unknown account invite email error",
        sentAt: at
      });
      throw new AccountAuthError("INVITE_EMAIL_FAILED", "The account invite could not be sent. Please try again.", 502);
    }
    return { ok: true };
  }

  async startBrowserInvite(raw: unknown): Promise<{ nextUrl: string; expiresAt: string }> {
    const { inviteToken, expiresAt } = await this.issueInvite(raw);
    return {
      nextUrl: `/assessment/account/setup/${inviteToken}`,
      expiresAt: expiresAt.toISOString()
    };
  }

  private async issueInvite(raw: unknown): Promise<{
    session: PaidSession;
    inviteToken: string;
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
    const at = this.now();
    const expiresAt = new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.repository.revokeUnusedInvites(session.id, at);
    await this.repository.createAccountInvite({ sessionId: session.id, tokenHash: hash(inviteToken), expiresAt });
    await this.repository.markSessionInvited(session.id);
    return { session, inviteToken, expiresAt };
  }

  async validateInvite(raw: unknown) {
    const input = inviteTokenSchema.parse(raw);
    const invite = await this.repository.findInviteByTokenHash(hash(input.inviteToken));
    if (!invite) throw new AccountAuthError("INVALID_INVITE", "This account setup invite is invalid.", 404);
    if (invite.usedAt && completedAccountStatuses.includes(invite.session.status)) {
      return {
        status: "ACCOUNT_CREATED" as const,
        email: invite.session.normalizedEmail,
        clientName: fullName(invite.session),
        assessmentYear: invite.session.assessmentYear,
        expiresAt: invite.expiresAt.toISOString(),
        nextUrl: "/portal/dashboard"
      };
    }
    this.assertActiveInvite(invite);
    return {
      status: "INVITE_ACTIVE" as const,
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
    if (account.status === "EXISTING_CONFIRMED") {
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
    await this.notifier.sendVerificationCode({
      email: invite.session.normalizedEmail,
      firstName: invite.session.firstName,
      code,
      assessmentYear: invite.session.assessmentYear
    });
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
    const verified = await this.repository.hasActiveAccountVerificationCode({
      sessionId: invite.sessionId,
      tokenHash,
      verificationType,
      now: this.now()
    });
    if (!verified) throw new AccountAuthError("INVALID_VERIFICATION_CODE", "The verification code is invalid or expired.", 400);
    const confirmed = await this.cognito.confirmSignUp({ email: invite.session.normalizedEmail, confirmationCode: input.confirmationCode });
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
    const subject = await this.repository.findPasswordResetSubjectByEmail(normalizeEmail(email));

    // Always return the same response so this public endpoint cannot be used to enumerate accounts.
    if (!subject) return { ok: true, retryAfterSeconds: 60 };

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

    try {
      await this.notifier.sendPasswordResetCode({
        email: subject.normalizedEmail,
        firstName: subject.firstName,
        code
      });
    } catch (error) {
      // Keep the response indistinguishable from an unknown account. Provider failures are
      // logged without recipient details and remain indistinguishable to the public caller.
      log("error", "password reset email delivery failed", {
        error: error instanceof Error ? error.message : "Unknown Resend delivery error"
      });
    }
    return { ok: true, retryAfterSeconds: 60 };
  }

  async confirmPasswordReset(raw: unknown): Promise<{ ok: true }> {
    const input = passwordResetConfirmSchema.parse(raw);
    const normalizedEmail = normalizeEmail(input.email);
    const subject = await this.repository.findPasswordResetSubjectByEmail(normalizedEmail);
    if (!subject) {
      throw new AccountAuthError("INVALID_PASSWORD_RESET_CODE", "The reset code is invalid or expired.", 400);
    }

    const consumed = await this.repository.consumeRecoveryCode({
      sessionId: subject.sessionId,
      tokenHash: passwordResetHash(subject.sessionId, normalizedEmail, input.confirmationCode),
      verificationType: passwordResetVerificationType,
      now: this.now()
    });
    if (!consumed) {
      throw new AccountAuthError("INVALID_PASSWORD_RESET_CODE", "The reset code is invalid or expired.", 400);
    }

    await this.cognito.setPermanentPassword({ email: normalizedEmail, password: input.newPassword });
    return { ok: true };
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
