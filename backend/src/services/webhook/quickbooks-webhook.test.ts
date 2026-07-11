import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QuickBooksWebhookError, verifyQuickBooksSignature } from "./quickbooks-webhook";

describe("QuickBooks webhook verification", () => {
  it("accepts the Intuit HMAC signature for the raw body", () => {
    const body = JSON.stringify({ eventNotifications: [] });
    const signature = createHmac("sha256", "verifier-token").update(body).digest("base64");
    expect(() => verifyQuickBooksSignature(body, signature, "verifier-token")).not.toThrow();
  });

  it("rejects a mismatched signature", () => {
    const body = JSON.stringify({ eventNotifications: [] });
    expect(() => verifyQuickBooksSignature(body, "bad-signature", "verifier-token")).toThrow(QuickBooksWebhookError);
  });
});
