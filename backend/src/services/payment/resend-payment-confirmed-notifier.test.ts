import { describe, expect, it } from "vitest";
import {
  buildPaymentConfirmedEmailContent,
  paymentConfirmedIdempotencyKey
} from "./resend-payment-confirmed-notifier";

describe("payment confirmation email", () => {
  it("states what was verified without claiming an account was auto-created", () => {
    const content = buildPaymentConfirmedEmailContent({
      assessmentYear: 2026,
      invoiceNumber: "1001"
    });

    expect(content.subject).toBe(
      "Payment confirmed - continue your 2026 Savians account setup"
    );
    expect(content.confirmation).toContain("invoice 1001");
    expect(content.confirmation).toContain("paid in full");
    expect(content.confirmation).toContain("no account has been created automatically");
  });

  it("gives clear proceed-now and proceed-later choices", () => {
    const content = buildPaymentConfirmedEmailContent({
      assessmentYear: 2026
    });

    expect(content.proceedNow).toContain("fresh secure status link");
    expect(content.proceedLater).toContain("no action is required now");
    expect(content.ctaLabel).toBe("Proceed to Account Setup");
  });

  it("uses one stable Resend idempotency key per assessment session", () => {
    expect(paymentConfirmedIdempotencyKey("session-1")).toBe(
      "payment-confirmed-session-1"
    );
    expect(paymentConfirmedIdempotencyKey("session-1")).toBe(
      paymentConfirmedIdempotencyKey("session-1")
    );
    expect(paymentConfirmedIdempotencyKey("session-2")).not.toBe(
      paymentConfirmedIdempotencyKey("session-1")
    );
  });
});
