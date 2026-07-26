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

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn()
}));

const auth = vi.hoisted(() => ({
  signOutFromPortal: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation
}));

vi.mock("@/services/assessment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assessment-api")>()),
  ...api
}));

vi.mock("@/services/portal-auth", () => auth);

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

  it("waits for the user to proceed after payment is verified", async () => {
    api.loadPaymentStatus.mockResolvedValue({
      status: "PAID_VERIFIED",
      invoiceBalance: 0,
      invoiceAmount: 2997,
      currency: "USD",
      accountCreationAllowed: true,
      invoiceResendAllowed: false,
      nextUrl: "/assessment/status/token"
    });
    api.startPaidAccountSetup.mockResolvedValue({
      nextUrl: "/assessment/account/setup/invite-token"
    });

    render(<PaymentStatusClient token={"a".repeat(43)} />);

    const proceed = await screen.findByRole("button", { name: "Proceed to Account Setup" });
    expect(screen.getByRole("button", { name: "I'll do this later" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("text-emerald-900");
    expect(screen.getByText("Not provided by QuickBooks")).toBeInTheDocument();
    expect(screen.queryByText(/automatically continue/i)).not.toBeInTheDocument();
    expect(api.startPaidAccountSetup).not.toHaveBeenCalled();

    fireEvent.click(proceed);

    await waitFor(() =>
      expect(api.startPaidAccountSetup).toHaveBeenCalledWith("a".repeat(43))
    );
    expect(navigation.push).toHaveBeenCalledWith("/assessment/account/setup/invite-token");
  });

  it("signs out and returns home when account setup is deferred", async () => {
    api.loadPaymentStatus.mockResolvedValue({
      status: "ACCOUNT_INVITED",
      invoiceBalance: 0,
      invoiceAmount: 2997,
      currency: "USD",
      accountCreationAllowed: true,
      invoiceResendAllowed: false,
      nextUrl: "/assessment/status/token"
    });

    render(<PaymentStatusClient token={"a".repeat(43)} />);

    fireEvent.click(await screen.findByRole("button", { name: "I'll do this later" }));

    expect(auth.signOutFromPortal).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("/");
    expect(api.startPaidAccountSetup).not.toHaveBeenCalled();
  });

  it.each([
    ["ACCOUNT_CREATED", "Account ready", "Your account is ready"],
    ["PROFILE_IN_PROGRESS", "Account ready", "Your account is ready"],
    ["PROFILE_COMPLETED", "Account ready", "Your account is ready"],
    ["DOCUMENTS_IN_PROGRESS", "Account ready", "Your account is ready"],
    ["DOCUMENTS_SUBMITTED", "Account ready", "Your account is ready"],
    ["IN_PROGRESS", "Account ready", "Your account is ready"],
    ["COMPLETED", "Assessment complete", "Assessment complete"]
  ])(
    "shows dashboard actions instead of payment controls for %s",
    async (status, badgeLabel, messageTitle) => {
      api.loadPaymentStatus.mockResolvedValue({
        status,
        invoiceBalance: 0,
        invoiceAmount: 2997,
        currency: "USD",
        accountCreationAllowed: true,
        invoiceResendAllowed: false,
        nextUrl: "/assessment/status/token"
      });

      render(<PaymentStatusClient token={"a".repeat(43)} />);

      expect(await screen.findByText(messageTitle, { selector: "p" })).toBeInTheDocument();
      expect(screen.getAllByText(badgeLabel)[0]).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: status === "COMPLETED" ? "Assessment complete" : "Your Savians account is ready"
        })
      ).toBeInTheDocument();
      expect(screen.queryByText(status)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Refresh payment status" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resend invoice email" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Sign In / Go to Dashboard" }));

      expect(navigation.push).toHaveBeenCalledWith("/login");
      expect(api.startPaidAccountSetup).not.toHaveBeenCalled();
    }
  );

  it("signs out and returns home from an account-ready status", async () => {
    api.loadPaymentStatus.mockResolvedValue({
      status: "ACCOUNT_CREATED",
      invoiceBalance: 0,
      invoiceAmount: 2997,
      currency: "USD",
      accountCreationAllowed: true,
      invoiceResendAllowed: false,
      nextUrl: "/assessment/status/token"
    });

    render(<PaymentStatusClient token={"a".repeat(43)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out and return home" }));

    expect(auth.signOutFromPortal).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("/");
  });
});
