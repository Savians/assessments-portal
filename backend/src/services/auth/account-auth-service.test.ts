import { describe, expect, it } from "vitest";
import {
  AccountAuthError,
  AccountAuthService,
  CognitoMutationError,
  setupSchema,
  type AccountAuthRepository,
  type AccountInvite,
  type AccountInviteNotifier,
  type CognitoAccountGateway,
  type PaidSession
} from "./account-auth-service";

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
  invites = new Map<string, AccountInvite>();
  emails = 0; linked = 0; recoveredLinks = 0; revoked = 0; revokedCandidates = 0; invited = 0; verificationCodes = 0; verificationUsed = 0; verificationRevocations = 0; verificationActive = true; recoveryReleases = 0; passwordResetSubjectExists = true;
  failInviteEmailAudit = false;
  failAccountVerificationEmailAudit = false;
  failPasswordResetEmailAudit = false;
  inviteEmails: Array<Parameters<AccountAuthRepository["recordInviteEmail"]>[0]> = [];
  accountVerificationEmails: Array<Parameters<AccountAuthRepository["recordAccountVerificationEmail"]>[0]> = [];
  latestVerificationCreatedAt: Date | null = null;
  linkedInput?: Parameters<AccountAuthRepository["linkConfirmedAccount"]>[0];
  async findSessionByStatusTokenHash() { return this.session; }
  async createAccountInvite(input: { sessionId: string; tokenHash: string; expiresAt: Date }) {
    this.invite = { id: "invite-1", sessionId: input.sessionId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, session: this.session };
    this.invites.set(input.tokenHash, this.invite);
  }
  async revokeUnusedInvitesExcept(_sessionId: string, tokenHash: string, at: Date) {
    this.revoked++;
    for (const invite of this.invites.values()) {
      if (invite.tokenHash !== tokenHash && !invite.usedAt && !invite.revokedAt) invite.revokedAt = at;
    }
  }
  async revokeUnusedInviteByTokenHash(tokenHash: string, at: Date) {
    this.revokedCandidates++;
    const invite = this.invites.get(tokenHash);
    if (invite && !invite.usedAt && !invite.revokedAt) invite.revokedAt = at;
  }
  async markSessionInvited() { this.invited++; this.session.status = "ACCOUNT_INVITED"; }
  async findInviteByTokenHash(tokenHash: string) { return this.invites.get(tokenHash) ?? this.invite ?? null; }
  async linkConfirmedAccount(input: Parameters<AccountAuthRepository["linkConfirmedAccount"]>[0]) { this.linked++; this.linkedInput = input; this.session.status = "ACCOUNT_CREATED"; if (this.invite) this.invite.usedAt = input.confirmedAt; }
  async linkRecoveredAccount() { this.recoveredLinks++; this.session.status = "ACCOUNT_CREATED"; }
  async recordInviteEmail(input: Parameters<AccountAuthRepository["recordInviteEmail"]>[0]) {
    if (this.failInviteEmailAudit) throw new Error("Invite audit database unavailable");
    this.emails++;
    this.inviteEmails.push(input);
  }
  async recordAccountVerificationEmail(input: Parameters<AccountAuthRepository["recordAccountVerificationEmail"]>[0]) {
    if (this.failAccountVerificationEmailAudit) throw new Error("Verification audit database unavailable");
    this.accountVerificationEmails.push(input);
  }
  async recordPasswordResetEmail() {
    if (this.failPasswordResetEmailAudit) throw new Error("Password reset audit database unavailable");
    this.emails++;
  }
  async revokeAccountVerificationCodes() {
    this.verificationUsed++;
    this.verificationRevocations++;
    this.verificationActive = false;
  }
  async createAccountVerificationCode() {
    this.verificationCodes++;
    this.verificationActive = true;
    this.latestVerificationCreatedAt = new Date("2026-07-06T00:00:00Z");
  }
  async findLatestAccountVerificationCodeCreatedAt() { return this.latestVerificationCreatedAt; }
  async hasActiveAccountVerificationCode() { return this.verificationCodes > 0 && this.verificationActive; }
  async markAccountVerificationCodeUsed() { this.verificationUsed++; }
  async findPasswordResetSubjectByEmail() {
    return this.passwordResetSubjectExists
      ? { sessionId: this.session.id, normalizedEmail: this.session.normalizedEmail, firstName: this.session.firstName, assessmentYear: this.session.assessmentYear }
      : null;
  }
  async claimRecoveryCode() {
    if (!this.verificationActive) return false;
    this.verificationActive = false;
    this.verificationUsed++;
    return true;
  }
  async releaseRecoveryCodeClaim() {
    this.verificationActive = true;
    this.recoveryReleases++;
  }
}

class Cognito implements CognitoAccountGateway {
  signups = 0; confirms = 0; passwordSets = 0; verified = true; exists = true;
  confirmError?: Error;
  passwordError?: Error;
  accountStatus: "PASSWORD_SET" | "EXISTING_ACCOUNT" = "PASSWORD_SET";
  async accountExists() { return this.exists; }
  async prepareAccount() { this.signups++; return { status: this.accountStatus }; }
  async confirmSignUp() {
    this.confirms++;
    if (this.confirmError) throw this.confirmError;
    return { userSub: "sub-1", emailVerified: this.verified };
  }
  async setPermanentPassword() {
    this.passwordSets++;
    if (this.passwordError) throw this.passwordError;
    return { userSub: "sub-1", emailVerified: this.verified };
  }
}

class Notifier implements AccountInviteNotifier {
  sends = 0; codes = 0; passwordResetCodes = 0; failInvite = false; failVerification = false; skipVerification = false; failPasswordReset = false;
  async send() {
    this.sends++;
    if (this.failInvite) throw new Error("Resend rejected the invite");
    return { providerMessageId: "invite-email-1" };
  }
  async sendVerificationCode() {
    this.codes++;
    if (this.failVerification) throw new Error("Resend rejected the verification message");
    if (this.skipVerification) return { status: "SKIPPED" as const };
    return { status: "SENT" as const, providerMessageId: "verification-email-1" };
  }
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
    expect(repo.inviteEmails).toEqual([expect.objectContaining({
      status: "SENT",
      providerMessageId: "invite-email-1"
    })]);
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

  it("keeps a previously issued invite usable when replacement email delivery fails", async () => {
    const { repo, notifier, service } = build();
    const original = await service.startBrowserInvite({ token: statusToken });
    const originalToken = original.nextUrl.split("/").at(-1);
    notifier.failInvite = true;
    repo.failInviteEmailAudit = true;

    await expect(service.reissueInvite({ token: statusToken }))
      .rejects.toMatchObject({ code: "INVITE_EMAIL_FAILED", statusCode: 502 });

    await expect(service.validateInvite({ inviteToken: originalToken }))
      .resolves.toMatchObject({ status: "INVITE_ACTIVE", email: "client@example.com" });
    expect(repo.revokedCandidates).toBe(1);
  });

  it("accepts a delivered replacement invite and retires the old invite when audit persistence fails", async () => {
    const { repo, notifier, service } = build();
    const original = await service.startBrowserInvite({ token: statusToken });
    const originalToken = original.nextUrl.split("/").at(-1);
    repo.failInviteEmailAudit = true;

    await expect(service.reissueInvite({ token: statusToken }))
      .resolves.toEqual({ ok: true });

    expect(notifier.sends).toBe(1);
    expect(repo.invite?.revokedAt).toBeFalsy();
    await expect(service.validateInvite({ inviteToken: originalToken }))
      .rejects.toMatchObject({ code: "INVITE_REVOKED", statusCode: 409 });
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
    expect(repo.accountVerificationEmails).toEqual([expect.objectContaining({
      status: "SENT",
      providerMessageId: "verification-email-1",
      recipientEmail: "client@example.com"
    })]);
    expect(repo.verificationActive).toBe(false);
  });

  it("allows only one concurrent redemption of an account verification code", async () => {
    const { repo, cognito, service } = build();
    await service.reissueInvite({ token: statusToken });
    await service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    });
    const input = {
      inviteToken: "invite-token".repeat(4),
      confirmationCode: "123456"
    };

    const results = await Promise.allSettled([
      service.confirm(input),
      service.confirm(input)
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(cognito.confirms).toBe(1);
    expect(repo.linked).toBe(1);
    expect(repo.verificationActive).toBe(false);
  });

  it("releases an account verification claim after a definitely pre-mutation Cognito failure", async () => {
    const { repo, cognito, service } = build();
    await service.reissueInvite({ token: statusToken });
    await service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    });
    cognito.confirmError = new CognitoMutationError(
      "CONFIRM_SIGN_UP",
      "BEFORE_MUTATION",
      new Error("Cognito confirmation preflight failed")
    );
    const input = {
      inviteToken: "invite-token".repeat(4),
      confirmationCode: "123456"
    };

    await expect(service.confirm(input)).rejects.toThrow("Cognito confirmation preflight failed");
    expect(repo.recoveryReleases).toBe(1);
    expect(repo.verificationActive).toBe(true);

    cognito.confirmError = undefined;
    await expect(service.confirm(input)).resolves.toEqual({
      status: "ACCOUNT_CREATED",
      nextUrl: "/portal/dashboard"
    });
    expect(cognito.confirms).toBe(2);
    expect(repo.linked).toBe(1);
  });

  it("keeps an account verification claim consumed after a mutation-attempted failure", async () => {
    const { repo, cognito, service } = build();
    await service.reissueInvite({ token: statusToken });
    await service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    });
    cognito.confirmError = new CognitoMutationError(
      "CONFIRM_SIGN_UP",
      "MUTATION_ATTEMPTED",
      new Error("Cognito post-confirm operation failed")
    );
    const input = {
      inviteToken: "invite-token".repeat(4),
      confirmationCode: "123456"
    };

    await expect(service.confirm(input)).rejects.toThrow("Cognito post-confirm operation failed");
    expect(repo.recoveryReleases).toBe(0);
    expect(repo.verificationActive).toBe(false);

    cognito.confirmError = undefined;
    await expect(service.confirm(input))
      .rejects.toMatchObject({ code: "INVALID_VERIFICATION_CODE", statusCode: 400 });
    expect(cognito.confirms).toBe(1);
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

  it("reports account verification delivery failures instead of claiming a code was sent", async () => {
    const { repo, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    notifier.failVerification = true;
    repo.failAccountVerificationEmailAudit = true;
    await expect(service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    })).rejects.toMatchObject({ code: "VERIFICATION_EMAIL_FAILED", statusCode: 502 });
    expect(repo.verificationRevocations).toBe(2);
    expect(repo.verificationActive).toBe(false);
    expect(repo.accountVerificationEmails).toEqual([]);
  });

  it("keeps a provider-accepted verification code active when audit persistence fails", async () => {
    const { repo, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    repo.failAccountVerificationEmailAudit = true;

    await expect(service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    })).resolves.toEqual({
      status: "CONFIRMATION_REQUIRED",
      email: "client@example.com"
    });

    expect(notifier.codes).toBe(1);
    expect(repo.verificationRevocations).toBe(1);
    expect(repo.verificationActive).toBe(true);
    expect(repo.accountVerificationEmails).toEqual([]);
  });

  it("audits skipped account verification delivery and revokes the unusable code", async () => {
    const { repo, notifier, service } = build();
    await service.reissueInvite({ token: statusToken });
    notifier.skipVerification = true;
    await expect(service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    })).rejects.toMatchObject({ code: "VERIFICATION_EMAIL_FAILED", statusCode: 502 });
    expect(repo.verificationUsed).toBeGreaterThan(0);
    expect(repo.accountVerificationEmails).toEqual([expect.objectContaining({
      status: "SKIPPED",
      recipientEmail: "client@example.com"
    })]);
    expect(repo.verificationRevocations).toBe(2);
    expect(repo.verificationActive).toBe(false);
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
    await service.startSetup({
      inviteToken: "invite-token".repeat(4),
      password: "StrongPass123!"
    });
    cognito.verified = false;
    await expect(service.confirm({ inviteToken: "invite-token".repeat(4), confirmationCode: "123456" })).rejects.toBeInstanceOf(AccountAuthError);
    expect(repo.linked).toBe(0);
    expect(repo.verificationActive).toBe(false);
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
    repo.failPasswordResetEmailAudit = true;
    await expect(service.requestPasswordReset({ email: "client@example.com" }))
      .rejects.toMatchObject({ code: "PASSWORD_RESET_EMAIL_FAILED", statusCode: 502 });
    expect(repo.verificationRevocations).toBe(2);
    expect(repo.verificationActive).toBe(false);
  });

  it("keeps a provider-accepted password reset code active when audit persistence fails", async () => {
    const { repo, notifier, service } = build();
    repo.failPasswordResetEmailAudit = true;

    await expect(service.requestPasswordReset({ email: "client@example.com" }))
      .resolves.toEqual({ ok: true, retryAfterSeconds: 60 });

    expect(notifier.passwordResetCodes).toBe(1);
    expect(repo.verificationRevocations).toBe(1);
    expect(repo.verificationActive).toBe(true);
  });

  it("atomically claims a valid password reset code while changing the Cognito password", async () => {
    const { repo, cognito, service } = build();
    await expect(service.confirmPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).resolves.toEqual({ ok: true, nextUrl: "/portal/dashboard" });
    expect(cognito.passwordSets).toBe(1);
    expect(repo.recoveredLinks).toBe(1);
    expect(repo.verificationActive).toBe(false);
  });

  it("releases a password reset claim only when Cognito definitely failed before mutation", async () => {
    const { repo, cognito, service } = build();
    cognito.passwordError = new CognitoMutationError(
      "SET_PERMANENT_PASSWORD",
      "BEFORE_MUTATION",
      new Error("Cognito preflight failed")
    );
    const input = {
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    };

    await expect(service.confirmPasswordReset(input))
      .rejects.toThrow("Cognito preflight failed");
    expect(repo.recoveryReleases).toBe(1);
    expect(repo.verificationActive).toBe(true);

    cognito.passwordError = undefined;
    await expect(service.confirmPasswordReset(input))
      .resolves.toEqual({ ok: true, nextUrl: "/portal/dashboard" });
    expect(cognito.passwordSets).toBe(2);
    expect(repo.recoveredLinks).toBe(1);
    expect(repo.verificationActive).toBe(false);
  });

  it("keeps a password reset claim consumed after a mutation-attempted failure", async () => {
    const { repo, cognito, service } = build();
    cognito.passwordError = new CognitoMutationError(
      "SET_PERMANENT_PASSWORD",
      "MUTATION_ATTEMPTED",
      new Error("Cognito post-password operation failed")
    );
    const input = {
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    };

    await expect(service.confirmPasswordReset(input))
      .rejects.toThrow("Cognito post-password operation failed");
    expect(repo.recoveryReleases).toBe(0);
    expect(repo.verificationActive).toBe(false);

    cognito.passwordError = undefined;
    await expect(service.confirmPasswordReset(input))
      .rejects.toMatchObject({ code: "INVALID_PASSWORD_RESET_CODE", statusCode: 400 });
    expect(cognito.passwordSets).toBe(1);
  });

  it("does not treat an untyped Cognito reset failure as definitely pre-mutation", async () => {
    const { repo, cognito, service } = build();
    cognito.passwordError = new Error("Ambiguous Cognito transport failure");

    await expect(service.confirmPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).rejects.toThrow("Ambiguous Cognito transport failure");
    expect(repo.recoveryReleases).toBe(0);
    expect(repo.verificationActive).toBe(false);
  });

  it("rejects replay of a password reset code after a successful password update", async () => {
    const { cognito, service } = build();
    const input = {
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    };
    await service.confirmPasswordReset(input);
    await expect(service.confirmPasswordReset(input))
      .rejects.toMatchObject({ code: "INVALID_PASSWORD_RESET_CODE", statusCode: 400 });
    expect(cognito.passwordSets).toBe(1);
  });

  it("does not link a recovered account when Cognito email verification is incomplete", async () => {
    const { repo, cognito, service } = build();
    cognito.verified = false;
    await expect(service.confirmPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED", statusCode: 409 });
    expect(cognito.passwordSets).toBe(1);
    expect(repo.recoveredLinks).toBe(0);
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
    expect(repo.recoveredLinks).toBe(0);
  });
});

describe("setupSchema password feedback", () => {
  it("returns the exact missing-uppercase rule", () => {
    const result = setupSchema.safeParse({
      inviteToken: "a".repeat(43),
      password: "lowercase@1234"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["password"],
          message: "Password must include an uppercase letter."
        })
      );
    }
  });
});
