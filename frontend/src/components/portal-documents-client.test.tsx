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
    const categoriesPanel = screen.getByRole("heading", { name: "Categories" }).closest("section");
    expect(categoriesPanel).toHaveClass("flex", "min-h-0", "flex-col", "lg:[contain:size]");
    expect(categoriesPanel).not.toHaveClass("h-fit");
    expect(sequence).toHaveClass("lg:min-h-0", "lg:flex-1", "lg:content-start", "lg:overflow-y-auto");
    expect(sequence).not.toHaveClass("lg:max-h-[calc(100vh-300px)]");
    expect(within(sequence).getAllByRole("listitem")).toHaveLength(10);
    expect(sequence.querySelectorAll("[data-upload-sequence-connector]")).toHaveLength(9);
    expect(sequence.querySelectorAll(".document-sequence-marker")).toHaveLength(10);
    expect(sequence.querySelector(".document-sequence-marker")).toHaveTextContent("01");
    expect(sequence.querySelector(".lucide-folder")).not.toBeInTheDocument();
    expect(sequence.querySelector(".lucide-folder-open")).not.toBeInTheDocument();
    expect(sequence.querySelector(".lucide-arrow-down")).not.toBeInTheDocument();

    const firstCategory = within(sequence).getByRole("button", { name: /Step 1 of 10: Prior Tax Returns Documents/ });
    expect(firstCategory).toHaveAttribute("aria-current", "step");

    fireEvent.click(within(sequence).getByRole("button", { name: /Step 2 of 10: W-2 Income Documents/ }));
    expect(screen.getByRole("heading", { name: "W-2 Income Documents" })).toBeInTheDocument();
    expect(within(sequence).getByRole("button", { name: /Step 2 of 10: W-2 Income Documents/ })).toHaveAttribute("aria-current", "step");
    expect(sequence.querySelectorAll("[aria-current='step']")).toHaveLength(1);
    expect(container.querySelector("[aria-label='Refresh document categories']")).toBeInTheDocument();
  });
});
