import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSetupClient } from "./account-setup-client";

const mocks = vi.hoisted(() => ({
  validateAccountInvite: vi.fn()
}));

vi.mock("@/services/assessment-api", () => ({
  AssessmentApiError: class AssessmentApiError extends Error {},
  claimExistingAccount: vi.fn(),
  confirmAccountSetup: vi.fn(),
  resendAccountVerificationCode: vi.fn(),
  startAccountSetup: vi.fn(),
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
  it("repeats payment success, explains return-later access, and shows only three onboarding steps", async () => {
    mocks.validateAccountInvite.mockResolvedValue({
      status: "INVITE_ACTIVE",
      accountExists: false,
      email: "client@example.com",
      clientName: "Jane Client",
      assessmentYear: 2026,
      expiresAt: "2026-08-02T12:00:00.000Z",
      nextUrl: null
    });

    render(<AccountSetupClient inviteToken={"a".repeat(43)} />);

    expect(await screen.findByText("Payment successful")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("text-emerald-900");
    expect(screen.getByText(/you can sign in and return at any time/i)).toBeInTheDocument();
    expect(screen.queryByText("Profile & documents")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
