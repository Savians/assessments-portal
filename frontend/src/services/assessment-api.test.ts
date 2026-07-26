import { afterEach, describe, expect, it, vi } from "vitest";
import { resendInvoiceEmail, startAccountSetup } from "./assessment-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resendInvoiceEmail", () => {
  it("preserves cooldown details from a 429 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "RESEND_RATE_LIMITED",
      message: "Please wait 27 seconds before resending the invoice email.",
      retryAfterSeconds: 27
    }), { status: 429, headers: { "content-type": "application/json" } })));

    const request = resendInvoiceEmail("a".repeat(43));
    await expect(request).rejects.toMatchObject({
      code: "RESEND_RATE_LIMITED",
      statusCode: 429,
      retryAfterSeconds: 27
    });
  });

  it("returns the cooldown started by a successful resend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      retryAfterSeconds: 60
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(resendInvoiceEmail("a".repeat(43))).resolves.toEqual({
      ok: true,
      retryAfterSeconds: 60
    });
  });
});

describe("startAccountSetup", () => {
  it("uses the exact validation issue instead of the generic summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "VALIDATION_ERROR",
      message: "Please correct the account setup fields.",
      issues: [{
        path: "password",
        message: "Password must include an uppercase letter."
      }]
    }), { status: 400, headers: { "content-type": "application/json" } })));

    const request = startAccountSetup({
      inviteToken: "a".repeat(43),
      password: "lowercase@1234"
    });

    await expect(request).rejects.toMatchObject({
      message: "Password must include an uppercase letter.",
      issues: [{
        path: "password",
        message: "Password must include an uppercase letter."
      }],
      code: "VALIDATION_ERROR",
      statusCode: 400
    });
  });
});
