import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgreementClient } from "./agreement-client";

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    loadAgreement: vi.fn(),
    push,
    replace,
    router: { push, replace },
    signAgreement: vi.fn()
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockAgreementPdfViewer({
    onReadyChange
  }: {
    onReadyChange: (ready: boolean) => void;
  }) {
    return <button onClick={() => onReadyChange(true)} type="button">Finish loading agreement pages</button>;
  }
}));

vi.mock("@/services/assessment-api", () => ({
  AssessmentApiError: class AssessmentApiError extends Error {},
  loadAgreement: mocks.loadAgreement,
  signAgreement: mocks.signAgreement
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgreementClient", () => {
  it("does not allow signing until the complete PDF viewer reports every page ready", async () => {
    mocks.loadAgreement.mockResolvedValue({
      status: "AGREEMENT_PENDING",
      clientName: "Jane Q Client",
      assessmentYear: 2026,
      agreement: {
        title: "Tax Assessment Plan Legal Service Agreement",
        version: "2026-v1.4",
        displayDate: "2026-07-26",
        pdfUrl: "https://documents.example.com/agreement.pdf",
        pdfSha256: "a".repeat(64),
        acknowledgementText: "I have read and agree to the complete agreement."
      }
    });
    mocks.signAgreement.mockResolvedValue({
      status: "PAYMENT_PENDING",
      nextUrl: "/assessment/status/token"
    });

    render(<AgreementClient token={"a".repeat(43)} />);

    expect(await screen.findByText("Tax Assessment Plan Legal Service Agreement")).toBeInTheDocument();
    const acknowledgement = screen.getByRole("checkbox");
    const signButton = screen.getByRole("button", { name: "Sign Agreement & Create Invoice" });
    expect(acknowledgement).toBeDisabled();
    expect(signButton).toBeDisabled();
    expect(screen.queryByText("Profile & documents")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Type your full legal name" }), {
      target: { value: "Jane Q Client" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish loading agreement pages" }));

    await waitFor(() => expect(acknowledgement).toBeEnabled());
    fireEvent.click(acknowledgement);
    expect(signButton).toBeEnabled();
    fireEvent.click(signButton);

    await waitFor(() => expect(mocks.signAgreement).toHaveBeenCalledWith({
      token: "a".repeat(43),
      typedSignatureName: "Jane Q Client",
      acknowledgementAccepted: true
    }));
  });
});
