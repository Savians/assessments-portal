import { beforeEach, describe, expect, it, vi } from "vitest";

const cognito = vi.hoisted(() => ({
  authenticate: vi.fn<(details: unknown, callbacks: Record<string, (value?: unknown) => void>) => void>()
}));

vi.mock("amazon-cognito-identity-js", () => ({
  AuthenticationDetails: class AuthenticationDetails {},
  CognitoUserPool: class CognitoUserPool {
    getCurrentUser() { return null; }
  },
  CognitoUser: class CognitoUser {
    authenticateUser(details: unknown, callbacks: Record<string, (value?: unknown) => void>) { cognito.authenticate(details, callbacks); }
  }
}));

import { confirmPortalPasswordReset, requestPortalPasswordReset } from "./portal-auth";

describe("portal password recovery", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_test";
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = "client-id";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";
    vi.unstubAllGlobals();
  });

  it("requests a Resend-delivered single-use reset code from the assessment backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, retryAfterSeconds: 60 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestPortalPasswordReset("Client@Example.com")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/assessment/account/password-reset/request",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "client@example.com" }) })
    );
  });

  it("confirms a reset through the assessment backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(confirmPortalPasswordReset({
      email: "client@example.com",
      confirmationCode: "12345678",
      newPassword: "SecurePassword123!"
    })).resolves.toBeUndefined();
  });

  it("returns a clear backend error for an incorrect reset code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "The reset code is invalid or expired." }), { status: 400 })));
    await expect(confirmPortalPasswordReset({
      email: "client@example.com",
      confirmationCode: "00000000",
      newPassword: "SecurePassword123!"
    })).rejects.toThrow("invalid or expired");
  });
});
