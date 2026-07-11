import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";

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
  }): Promise<void>;
  recordInviteEmail(input: { sessionId: string; recipientEmail: string; status: "SENT" | "FAILED" | "SKIPPED"; failureReason?: string; sentAt: Date }): Promise<void>;
  revokeAccountVerificationCodes(sessionId: string, verificationType: string, at: Date): Promise<void>;
  createAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; expiresAt: Date }): Promise<void>;
  hasActiveAccountVerificationCode(input: { sessionId: string; tokenHash: string; verificationType: string; now: Date }): Promise<boolean>;
  markAccountVerificationCodeUsed(input: { sessionId: string; tokenHash: string; verificationType: string; usedAt: Date }): Promise<void>;
}

export interface AccountInviteNotifier {
  send(input: { email: string; firstName: string; setupUrl: string; assessmentYear: number }): Promise<void>;
  sendVerificationCode(input: { email: string; firstName: string; code: string; assessmentYear: number }): Promise<void>;
}

export interface CognitoAccountGateway {
  signUp(input: { email: string; password: string; fullName: string }): Promise<void>;
  confirmSignUp(input: { email: string; confirmationCode: string }): Promise<{ userSub: string; emailVerified: boolean }>;
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

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const generateToken = () => randomBytes(32).toString("base64url");
const generateVerificationCode = () => randomInt(100000, 1000000).toString();
const verificationType = "ACCOUNT_SETUP_EMAIL";
const verificationHash = (inviteId: string, code: string) =>
  hash(`account-setup-email:${inviteId}:${code.trim()}`);
const fullName = (session: PaidSession) => [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" ");

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
    const invite = await this.resolveInvite(input.inviteToken);
    return {
      email: invite.session.normalizedEmail,
      clientName: fullName(invite.session),
      assessmentYear: invite.session.assessmentYear,
      expiresAt: invite.expiresAt.toISOString()
    };
  }

  async startSetup(raw: unknown): Promise<{ status: "CONFIRMATION_REQUIRED"; email: string }> {
    const input = setupSchema.parse(raw);
    const invite = await this.resolveInvite(input.inviteToken);
    await this.cognito.signUp({ email: invite.session.normalizedEmail, password: input.password, fullName: fullName(invite.session) });
    const code = generateVerificationCode();
    const now = this.now();
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
    return { status: "CONFIRMATION_REQUIRED", email: invite.session.normalizedEmail };
  }

  async confirm(raw: unknown): Promise<{ status: "ACCOUNT_CREATED"; nextUrl: string }> {
    const input = confirmSchema.parse(raw);
    const invite = await this.resolveInvite(input.inviteToken);
    const verified = await this.repository.hasActiveAccountVerificationCode({
      sessionId: invite.sessionId,
      tokenHash: verificationHash(invite.id, input.confirmationCode),
      verificationType,
      now: this.now()
    });
    if (!verified) throw new AccountAuthError("INVALID_VERIFICATION_CODE", "The verification code is invalid or expired.", 400);
    await this.repository.markAccountVerificationCodeUsed({
      sessionId: invite.sessionId,
      tokenHash: verificationHash(invite.id, input.confirmationCode),
      verificationType,
      usedAt: this.now()
    });
    const confirmed = await this.cognito.confirmSignUp({ email: invite.session.normalizedEmail, confirmationCode: input.confirmationCode });
    if (!confirmed.emailVerified) throw new AccountAuthError("EMAIL_NOT_VERIFIED", "Email verification was not completed.", 409);
    await this.repository.linkConfirmedAccount({
      sessionId: invite.sessionId,
      normalizedEmail: invite.session.normalizedEmail,
      cognitoUserId: confirmed.userSub,
      inviteId: invite.id,
      confirmedAt: this.now()
    });
    return { status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" };
  }

  private async resolveInvite(token: string): Promise<AccountInvite> {
    const invite = await this.repository.findInviteByTokenHash(hash(token));
    if (!invite) throw new AccountAuthError("INVALID_INVITE", "This account setup invite is invalid.", 404);
    if (invite.usedAt) throw new AccountAuthError("INVITE_USED", "This account setup invite has already been used.", 409);
    if (invite.revokedAt) throw new AccountAuthError("INVITE_REVOKED", "This account setup invite has been replaced.", 409);
    if (invite.expiresAt.getTime() <= this.now().getTime()) throw new AccountAuthError("INVITE_EXPIRED", "This account setup invite has expired.", 410);
    if (!invite.session.accountCreationAllowed || !["PAID_VERIFIED", "ACCOUNT_INVITED"].includes(invite.session.status)) {
      throw new AccountAuthError("PAYMENT_REQUIRED", "Account setup unlocks only after full payment verification.", 402);
    }
    return invite;
  }
}
