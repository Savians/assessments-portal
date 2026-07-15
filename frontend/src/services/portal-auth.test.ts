import { beforeEach, describe, expect, it, vi } from "vitest";

const cognito = vi.hoisted(() => ({
  forgot: vi.fn<(callbacks: Record<string, (value?: unknown) => void>) => void>(),
  confirm: vi.fn<(code: string, password: string, callbacks: Record<string, (value?: unknown) => void>) => void>(),
  authenticate: vi.fn<(details: unknown, callbacks: Record<string, (value?: unknown) => void>) => void>()
}));

vi.mock("amazon-cognito-identity-js", () => ({
  AuthenticationDetails: class AuthenticationDetails {},
  CognitoUserPool: class CognitoUserPool {
    getCurrentUser() { return null; }
  },
  CognitoUser: class CognitoUser {
    forgotPassword(callbacks: Record<string, (value?: unknown) => void>) { cognito.forgot(callbacks); }
    confirmPassword(code: string, password: string, callbacks: Record<string, (value?: unknown) => void>) { cognito.confirm(code, password, callbacks); }
    authenticateUser(details: unknown, callbacks: Record<string, (value?: unknown) => void>) { cognito.authenticate(details, callbacks); }
  }
}));

import { confirmPortalPasswordReset, requestPortalPasswordReset } from "./portal-auth";

describe("portal password recovery", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_test";
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = "client-id";
    cognito.forgot.mockReset();
    cognito.confirm.mockReset();
  });

  it("resolves after Cognito sends the single-use reset code", async () => {
    cognito.forgot.mockImplementation((callbacks) => callbacks.inputVerificationCode?.({}));
    await expect(requestPortalPasswordReset("Client@Example.com")).resolves.toBeUndefined();
  });

  it("conceals unknown accounts to prevent email enumeration", async () => {
    cognito.forgot.mockImplementation((callbacks) => callbacks.onFailure?.({ name: "UserNotFoundException" }));
    await expect(requestPortalPasswordReset("missing@example.com")).resolves.toBeUndefined();
  });

  it("surfaces Cognito abuse-rate limits with a safe message", async () => {
    cognito.forgot.mockImplementation((callbacks) => callbacks.onFailure?.({ name: "LimitExceededException" }));
    await expect(requestPortalPasswordReset("client@example.com")).rejects.toThrow("Too many attempts");
  });

  it("confirms a reset using the code and new password", async () => {
    cognito.confirm.mockImplementation((...args) => args[2].onSuccess?.());
    await expect(confirmPortalPasswordReset({
      email: "client@example.com",
      confirmationCode: "123456",
      newPassword: "SecurePassword123!"
    })).resolves.toBeUndefined();
  });

  it("returns a clear error for an incorrect reset code", async () => {
    cognito.confirm.mockImplementation((...args) => args[2].onFailure?.({ name: "CodeMismatchException" }));
    await expect(confirmPortalPasswordReset({
      email: "client@example.com",
      confirmationCode: "000000",
      newPassword: "SecurePassword123!"
    })).rejects.toThrow("verification code is incorrect");
  });
});
