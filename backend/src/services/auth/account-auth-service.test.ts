import { describe, expect, it } from "vitest";
import { AccountAuthError, AccountAuthService, type AccountAuthRepository, type AccountInvite, type AccountInviteNotifier, type CognitoAccountGateway, type PaidSession } from "./account-auth-service";

class Repo implements AccountAuthRepository {
  session: PaidSession = {
    id: "session-1",
    normalizedEmail: "client@example.com",
    firstName: "Jane",
    middleName: "Q",
    lastName: "Client",
    assessmentYear: 2026,
    status: "PAID_VERIFIED",
    accountCreationAllowed: true,
    statusTokenExpiresAt: new Date("2026-08-01T00:00:00Z")
  };
  invite?: AccountInvite;
  emails = 0; linked = 0; revoked = 0; invited = 0; verificationCodes = 0; verificationUsed = 0; verificationActive = true; passwordResetSubjectExists = true;
  latestVerificationCreatedAt: Date | null = null;
  linkedInput?: Parameters<AccountAuthRepository["linkConfirmedAccount"]>[0];
  async findSessionByStatusTokenHash() { return this.session; }
  async createAccountInvite(input: { sessionId: string; tokenHash: string; expiresAt: Date }) {
    this.invite = { id: "invite-1", sessionId: input.sessionId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, session: this.session };
  }
  async revokeUnusedInvites() { this.revoked++; }
  async markSessionInvited() { this.invited++; this.session.status = "ACCOUNT_INVITED"; }
  async findInviteByTokenHash() { return this.invite ?? null; }
  async linkConfirmedAccount(input: Parameters<AccountAuthRepository["linkConfirmedAccount"]>[0]) { this.linked++; this.linkedInput = input; this.session.status = "ACCOUNT_CREATED"; if (this.invite) this.invite.usedAt = input.confirmedAt; }
  async recordInviteEmail() { this.emails++; }
  async recordPasswordResetEmail() { this.emails++; }
  async revokeAccountVerificationCodes() { this.verificationUsed++; }
  async createAccountVerificationCode() { this.verificationCodes++; this.latestVerificationCreatedAt = new Date("2026-07-06T00:00:00Z"); }
  async findLatestAccountVerificationCodeCreatedAt() { return this.latestVerificationCreatedAt; }
  async hasActiveAccountVerificationCode() { return this.verificationCodes > 0 && this.verificationActive; }
  async markAccountVerificationCodeUsed() { this.verificationUsed++; }
  async findPasswordResetSubjectByEmail() {
    return this.passwordResetSubjectExists
      ? { sessionId: this.session.id, normalizedEmail: this.session.normalizedEmail, firstName: this.session.firstName, assessmentYear: this.session.assessmentYear }
      : null;
  }
  async consumeRecoveryCode() { if (this.verificationActive) this.verificationUsed++; return this.verificationActive; }
}

class Cognito implements CognitoAccountGateway {
  signups = 0; confirms = 0; passwordSets = 0; verified = true; exists = true; accountStatus: "PASSWORD_SET" | "EXISTING_ACCOUNT" = "PASSWORD_SET";
  async accountExists() { return this.exists; }
  async prepareAccount() { this.signups++; return { status: this.accountStatus }; }
  async confirmSignUp() { this.confirms++; return { userSub: "sub-1", emailVerified: this.verified }; }
  async setPermanentPassword() { this.passwordSets++; }
}

class Notifier implements AccountInviteNotifier {
  sends = 0; codes = 0; passwordResetCodes = 0; failPasswordReset = false;
  async send() { this.sends++; }
  async sendVerificationCode() { this.codes++; }
  async sendPasswordResetCode() {
    this.passwordResetCodes++;
    if (this.failPasswordReset) throw new Error("Resend rejected the request");
    return { providerMessageId: "reset-email-1" };
  }
}

const statusToken = "a".repeat(43);
const build = () => {
  const repo = new Repo();
  const cognito = new Cognito();
  const notifier = new Notifier();
  const service = new AccountAuthService(repo, cognito, notifier, "https://assessments.savians.com", () => new Date("2026-07-06T00:00:00Z"));
  return { repo, cognito, notifier, service };
};

describe("AccountAuthService", () => {
  it("issues a seven-day account invite only after paid verification", async () => {
    const { repo, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    expect(repo.revoked).toBe(1);
    expect(repo.invited).toBe(1);
    expect(notifier.sends).toBe(1);
    expect(repo.invite?.expiresAt.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("starts browser-based setup without sending an account setup email", async () => {
    const { repo, notifier, service } = build();
    const result = await service.startBrowserInvite({ token: statusToken });
    expect(result.nextUrl).toMatch(/^\/assessment\/account\/setup\/[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBe("2026-07-13T00:00:00.000Z");
    expect(repo.revoked).toBe(1);
    expect(repo.invited).toBe(1);
    expect(notifier.sends).toBe(0);
    expect(repo.emails).toBe(0);
  });

  it("rejects invite creation for unpaid sessions", async () => {
    const { repo, service } = build();
    repo.session.status = "PAYMENT_PENDING";
    repo.session.accountCreationAllowed = false;
    await expect(service.reissueInvite({ token: statusToken })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });

  it("starts Cognito signup and confirms only after email verification", async () => {
    const { repo, cognito, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    const inviteToken = "invite-token".repeat(4);
    await expect(service.validateInvite({ inviteToken })).resolves.toMatchObject({ email: "client@example.com", clientName: "Jane Q Client" });
    await expect(service.startSetup({ inviteToken, password: "StrongPass123!" })).resolves.toMatchObject({ status: "CONFIRMATION_REQUIRED" });
    await expect(service.confirm({ inviteToken, confirmationCode: "123456" })).resolves.toMatchObject({ status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" });
    expect(cognito.signups).toBe(1);
    expect(notifier.codes).toBe(1);
    expect(repo.verificationCodes).toBe(1);
    expect(cognito.confirms).toBe(1);
    expect(repo.linked).toBe(1);
    expect(repo.linkedInput?.verificationTokenHash).toBeTruthy();
  });

  it("returns existing confirmed users to sign-in without resetting their password or sending a new-account code", async () => {
    const { repo, cognito, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    cognito.accountStatus = "EXISTING_ACCOUNT";
    await expect(service.startSetup({ inviteToken: "invite-token".repeat(4), password: "StrongPass123!" }))
      .resolves.toEqual({ status: "EXISTING_ACCOUNT", email: "client@example.com" });
    expect(notifier.codes).toBe(0);
    expect(repo.verificationCodes).toBe(0);
  });

  it("resends a replacement verification code after the cooldown", async () => {
    const { repo, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    repo.latestVerificationCreatedAt = new Date("2026-07-05T23:58:00Z");
    await expect(service.resendVerificationCode({ inviteToken: "invite-token".repeat(4) }))
      .resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(notifier.codes).toBe(1);
  });

  it("rate-limits verification-code resend attempts", async () => {
    const { repo, service } = build();
    await service.reissueInvite({ token: statusToken });
    repo.latestVerificationCreatedAt = new Date("2026-07-05T23:59:30Z");
    await expect(service.resendVerificationCode({ inviteToken: "invite-token".repeat(4) }))
      .rejects.toMatchObject({ code: "VERIFICATION_RESEND_RATE_LIMITED", statusCode: 429 });
  });

  it("links an existing confirmed account only when authenticated claims match the assessment email", async () => {
    const { repo, service } = build();
    await service.reissueInvite({ token: statusToken });
    await expect(service.claimExistingAccount(
      { inviteToken: "invite-token".repeat(4) },
      { sub: "existing-sub", email: "client@example.com", email_verified: "true" }
    )).resolves.toEqual({ status: "ACCOUNT_CREATED", nextUrl: "/portal/dashboard" });
    expect(repo.linkedInput?.cognitoUserId).toBe("existing-sub");
  });

  it("rejects an existing-account claim made with a different email", async () => {
    const { service } = build();
    await service.reissueInvite({ token: statusToken });
    await expect(service.claimExistingAccount(
      { inviteToken: "invite-token".repeat(4) },
      { sub: "other-sub", email: "other@example.com", email_verified: true }
    )).rejects.toMatchObject({ code: "ACCOUNT_EMAIL_MISMATCH", statusCode: 403 });
  });

  it("does not link an account when Cognito email verification is incomplete", async () => {
    const { repo, cognito, service } = build();
    await service.reissueInvite({ token: statusToken });
    cognito.verified = false;
    await expect(service.confirm({ inviteToken: "invite-token".repeat(4), confirmationCode: "123456" })).rejects.toBeInstanceOf(AccountAuthError);
    expect(repo.linked).toBe(0);
  });

  it("does not link an account when the emailed verification code is invalid", async () => {
    const { repo, cognito, service } = build();
    await service.reissueInvite({ token: statusToken });
    await service.startSetup({ inviteToken: "invite-token".repeat(4), password: "StrongPass123!" });
    repo.verificationActive = false;
    await expect(service.confirm({ inviteToken: "invite-token".repeat(4), confirmationCode: "000000" })).rejects.toMatchObject({ code: "INVALID_VERIFICATION_CODE" });
    expect(cognito.confirms).toBe(0);
    expect(repo.linked).toBe(0);
  });

  it("sends an assessment-scoped password reset code through the notifier", async () => {
    const { repo, notifier, service } = build();
    await expect(service.requestPasswordReset({ email: "Client@Example.com" }))
      .resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(repo.verificationCodes).toBe(1);
    expect(notifier.passwordResetCodes).toBe(1);
  });

  it("conceals unknown password reset accounts", async () => {
    const { repo, notifier, service } = build();
    repo.passwordResetSubjectExists = false;
    await expect(service.requestPasswordReset({ email: "missing@example.com" }))
      .resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(repo.verificationCodes).toBe(0);
    expect(notifier.passwordResetCodes).toBe(0);
  });

  it("does not issue a reset code when the assessment email is not a Cognito account", async () => {
    const { repo, cognito, notifier, service } = build();
    cognito.exists = false;
    await expect(service.requestPasswordReset({ email: "client@example.com" }))
      .resolves.toEqual({ ok: true, retryAfterSeconds: 60 });
    expect(repo.verificationCodes).toBe(0);
    expect(notifier.passwordResetCodes).toBe(0);
  });

  it("reports Resend delivery failures instead of claiming a reset code was sent", async () => {
    const { repo, notifier, service } = build();
    notifier.failPasswordReset = true;
    await expect(service.requestPasswordReset({ email: "client@example.com" }))
      .rejects.toMatchObject({ code: "PASSWORD_RESET_EMAIL_FAILED", statusCode: 502 });
    expect(repo.verificationUsed).toBeGreaterThan(0);
  });

  it("consumes a valid password reset code before changing the Cognito password", async () => {
    const { cognito, service } = build();
    await expect(service.confirmPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).resolves.toEqual({ ok: true });
    expect(cognito.passwordSets).toBe(1);
  });

  it("rejects invalid or expired password reset codes", async () => {
    const { repo, cognito, service } = build();
    repo.verificationActive = false;
    await expect(service.confirmPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).rejects.toMatchObject({ code: "INVALID_PASSWORD_RESET_CODE", statusCode: 400 });
    expect(cognito.passwordSets).toBe(0);
  });
});
