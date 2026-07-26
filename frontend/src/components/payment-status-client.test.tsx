import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStatusClient } from "./payment-status-client";

const api = vi.hoisted(() => ({
  loadPaymentStatus: vi.fn(),
  refreshPaymentStatus: vi.fn(),
  requestPaymentSupport: vi.fn(),
  resendInvoiceEmail: vi.fn(),
  startPaidAccountSetup: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("@/services/assessment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assessment-api")>()),
  ...api
}));

beforeEach(() => {
  api.loadPaymentStatus.mockResolvedValue({
    status: "PAYMENT_PENDING",
    invoiceBalance: 2997,
    invoiceAmount: 2997,
    currency: "USD",
    accountCreationAllowed: false,
    invoiceResendAllowed: true,
    nextUrl: "/assessment/status/token"
  });
  api.resendInvoiceEmail.mockResolvedValue({ ok: true, retryAfterSeconds: 60 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PaymentStatusClient", () => {
  it("allows an eligible QuickBooks invoice resend when DocNumber is absent", async () => {
    render(<PaymentStatusClient token={"a".repeat(43)} />);

    const resend = await screen.findByRole("button", { name: "Resend invoice email" });
    expect(resend).toBeEnabled();

    fireEvent.click(resend);

    await waitFor(() => expect(api.resendInvoiceEmail).toHaveBeenCalledWith("a".repeat(43)));
    expect(await screen.findByText("Invoice email resent. Please check your inbox and spam folder.")).toBeInTheDocument();
  });
});
