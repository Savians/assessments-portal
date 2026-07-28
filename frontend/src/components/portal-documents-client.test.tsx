import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalDocumentsClient } from "./portal-documents-client";

const api = vi.hoisted(() => ({
  loadDocuments: vi.fn()
}));

const auth = vi.hoisted(() => ({
  getCurrentPortalAccessToken: vi.fn()
}));

vi.mock("@/services/assessment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assessment-api")>()),
  ...api
}));

vi.mock("@/services/portal-auth", () => auth);

beforeEach(() => {
  auth.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
  api.loadDocuments.mockResolvedValue({ documents: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalDocumentsClient category sequence", () => {
  it("renders a compact ordered path without folder icons inside its tiles", async () => {
    const { container } = render(<PortalDocumentsClient embedded />);

    await waitFor(() => expect(api.loadDocuments).toHaveBeenCalledWith("portal-token"));
    const sequence = screen.getByRole("list", { name: "Suggested document upload order" });
    expect(within(sequence).getAllByRole("listitem")).toHaveLength(10);
    expect(sequence.querySelectorAll("[data-upload-sequence-connector]")).toHaveLength(9);
    expect(sequence.querySelector(".lucide-folder")).not.toBeInTheDocument();
    expect(sequence.querySelector(".lucide-folder-open")).not.toBeInTheDocument();

    const firstCategory = within(sequence).getByRole("button", { name: /Prior Tax Returns Documents/ });
    expect(firstCategory).toHaveAttribute("aria-current", "step");

    fireEvent.click(within(sequence).getByRole("button", { name: /W-2 Income Documents/ }));
    expect(screen.getByRole("heading", { name: "W-2 Income Documents" })).toBeInTheDocument();
    expect(within(sequence).getByRole("button", { name: /W-2 Income Documents/ })).toHaveAttribute("aria-current", "step");
    expect(container.querySelector("[aria-label='Refresh document categories']")).toBeInTheDocument();
  });
});
