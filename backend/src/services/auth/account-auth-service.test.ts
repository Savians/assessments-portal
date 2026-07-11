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
  emails = 0; linked = 0; revoked = 0; invited = 0; verificationCodes = 0; verificationUsed = 0; verificationActive = true;
  async findSessionByStatusTokenHash() { return this.session; }
  async createAccountInvite(input: { sessionId: string; tokenHash: string; expiresAt: Date }) {
    this.invite = { id: "invite-1", sessionId: input.sessionId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, session: this.session };
  }
  async revokeUnusedInvites() { this.revoked++; }
  async markSessionInvited() { this.invited++; this.session.status = "ACCOUNT_INVITED"; }
  async findInviteByTokenHash() { return this.invite ?? null; }
  async linkConfirmedAccount() { this.linked++; this.session.status = "ACCOUNT_CREATED"; }
  async recordInviteEmail() { this.emails++; }
  async revokeAccountVerificationCodes() { this.verificationUsed++; }
  async createAccountVerificationCode() { this.verificationCodes++; }
  async hasActiveAccountVerificationCode() { return this.verificationCodes > 0 && this.verificationActive; }
  async markAccountVerificationCodeUsed() { this.verificationUsed++; }
}

class Cognito implements CognitoAccountGateway {
  signups = 0; confirms = 0; verified = true;
  async signUp() { this.signups++; }
  async confirmSignUp() { this.confirms++; return { userSub: "sub-1", emailVerified: this.verified }; }
}

class Notifier implements AccountInviteNotifier {
  sends = 0; codes = 0;
  async send() { this.sends++; }
  async sendVerificationCode() { this.codes++; }
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
});
