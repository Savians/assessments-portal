import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentApiError } from "@/services/assessment-api";
import { AccountSetupClient } from "./account-setup-client";

const mocks = vi.hoisted(() => ({
  startAccountSetup: vi.fn(),
  validateAccountInvite: vi.fn()
}));

vi.mock("@/services/assessment-api", () => ({
  AssessmentApiError: class AssessmentApiError extends Error {
    readonly issues: Array<{ path: string; message: string }>;

    constructor(message: string, issues: Array<{ path: string; message: string }> = []) {
      super(message);
      this.issues = issues;
    }
  },
  claimExistingAccount: vi.fn(),
  confirmAccountSetup: vi.fn(),
  resendAccountVerificationCode: vi.fn(),
  startAccountSetup: mocks.startAccountSetup,
  validateAccountInvite: mocks.validateAccountInvite
}));

vi.mock("@/services/portal-auth", () => ({
  signInToPortal: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountSetupClient", () => {
  const inviteToken = "a".repeat(43);

  const activeInvite = () => {
    mocks.validateAccountInvite.mockResolvedValue({
      status: "INVITE_ACTIVE",
      accountExists: false,
      email: "client@example.com",
      clientName: "Jane Client",
      assessmentYear: 2026,
      expiresAt: "2026-08-02T12:00:00.000Z",
      nextUrl: null
    });
  };

  it("repeats payment success, explains return-later access, and shows only three onboarding steps", async () => {
    activeInvite();

    render(<AccountSetupClient inviteToken={inviteToken} />);

    expect(await screen.findByText("Payment successful")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("text-emerald-900");
    expect(screen.getByText(/you can sign in and return at any time/i)).toBeInTheDocument();
    expect(screen.queryByText("Profile & documents")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the exact failed password rule and does not call the API", async () => {
    activeInvite();
    render(<AccountSetupClient inviteToken={inviteToken} />);

    fireEvent.change(await screen.findByLabelText("Create password"), {
      target: { value: "lowercase@1234" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "lowercase@1234" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    expect(screen.getAllByText("Password must include an uppercase letter.")).toHaveLength(2);
    expect(screen.getByLabelText("Create password")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.startAccountSetup).not.toHaveBeenCalled();
  });

  it("requires the confirmation password to match", async () => {
    activeInvite();
    render(<AccountSetupClient inviteToken={inviteToken} />);

    fireEvent.change(await screen.findByLabelText("Create password"), {
      target: { value: "StrongPassword@1" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPassword@2" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    expect(screen.getAllByText("Passwords do not match.")).toHaveLength(2);
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.startAccountSetup).not.toHaveBeenCalled();
  });

  it("shows and hides each password independently", async () => {
    activeInvite();
    render(<AccountSetupClient inviteToken={inviteToken} />);

    const createPassword = await screen.findByLabelText("Create password");
    const confirmPassword = screen.getByLabelText("Confirm password");
    expect(createPassword).toHaveAttribute("type", "password");
    expect(confirmPassword).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show create password" }));
    expect(createPassword).toHaveAttribute("type", "text");
    expect(confirmPassword).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Hide create password" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show confirm password" }));
    expect(confirmPassword).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide confirm password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the exact API issue instead of the generic validation summary", async () => {
    activeInvite();
    mocks.startAccountSetup.mockRejectedValue(
      new AssessmentApiError("Please correct the account setup fields.", [
        { path: "password", message: "Password was rejected by the account provider." }
      ])
    );
    render(<AccountSetupClient inviteToken={inviteToken} />);

    fireEvent.change(await screen.findByLabelText("Create password"), {
      target: { value: "StrongPassword@1" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPassword@1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    expect(await screen.findAllByText("Password was rejected by the account provider.")).toHaveLength(2);
    expect(screen.queryByText("Please correct the account setup fields.")).not.toBeInTheDocument();
  });

  it("submits only the matching password and advances to email verification", async () => {
    activeInvite();
    mocks.startAccountSetup.mockResolvedValue({
      status: "CONFIRMATION_REQUIRED",
      email: "client@example.com"
    });
    render(<AccountSetupClient inviteToken={inviteToken} />);

    fireEvent.change(await screen.findByLabelText("Create password"), {
      target: { value: "StrongPassword@1" }
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPassword@1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));

    await waitFor(() => {
      expect(mocks.startAccountSetup).toHaveBeenCalledWith({
        inviteToken,
        password: "StrongPassword@1"
      });
    });
    expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();
    expect(screen.getByText("A fresh verification code was sent to your email.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Create password")).not.toBeInTheDocument();
  });
});
