import { afterEach, describe, expect, it, vi } from "vitest";
import { resendInvoiceEmail } from "./assessment-api";

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
