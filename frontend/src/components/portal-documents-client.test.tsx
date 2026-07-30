import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDocument } from "@/services/assessment-api";
import { PortalDocumentsClient } from "./portal-documents-client";

const api = vi.hoisted(() => ({
  completeDocumentUpload: vi.fn(),
  createDocumentPreviewUrl: vi.fn(),
  createDocumentUploadUrl: vi.fn(),
  loadDocuments: vi.fn(),
  removeDocument: vi.fn(),
  uploadDocumentFile: vi.fn()
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
  api.createDocumentPreviewUrl.mockResolvedValue({
    documentId: "document-1",
    previewUrl: "https://documents.example/preview",
    expiresInSeconds: 300
  });
  api.createDocumentUploadUrl.mockResolvedValue({
    documentId: "document-1",
    uploadUrl: "https://documents.example/upload",
    expiresInSeconds: 300
  });
  api.loadDocuments.mockResolvedValue({ documents: [] });
  api.removeDocument.mockResolvedValue({ ok: true });
  api.uploadDocumentFile.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    expect(sequence.querySelector(".document-sequence-detail")).not.toBeInTheDocument();
    expect(sequence.querySelector("[data-tone]")).not.toBeInTheDocument();
    expect(sequence).not.toHaveTextContent("0 files");
    expect(sequence).not.toHaveTextContent("Last year and any prior returns we should review.");
    expect(sequence.querySelector(".lucide-folder")).not.toBeInTheDocument();
    expect(sequence.querySelector(".lucide-folder-open")).not.toBeInTheDocument();
    expect(sequence.querySelector(".lucide-arrow-down")).not.toBeInTheDocument();
    expect(within(sequence).getAllByText("Required")).toHaveLength(2);
    expect(screen.queryByText("Files", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Uploaded", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Limit", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upload Documents" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Securely upload, preview, and manage your assessment files by category.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Add Files", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Max 25 MB per file")).toBeInTheDocument();
    expect(screen.getByText("0 files")).toBeInTheDocument();
    const browseInput = screen.getByLabelText("Browse Files");
    expect(browseInput).toHaveAttribute("type", "file");
    expect(browseInput).toHaveClass("sr-only");
    expect(categoriesPanel?.parentElement).toHaveClass("gap-5");
    expect(categoriesPanel?.parentElement).not.toHaveClass("mt-4");

    const firstCategory = within(sequence).getByRole("button", { name: /Step 1 of 10: Prior Tax Returns Documents/ });
    expect(firstCategory).toHaveAttribute("aria-current", "step");
    expect(firstCategory).toHaveAttribute("data-required", "true");
    expect(firstCategory).toHaveAccessibleName("Step 1 of 10: Prior Tax Returns Documents (Required)");
    expect(screen.getByText("Required for review")).toBeInTheDocument();

    fireEvent.click(within(sequence).getByRole("button", { name: /Step 2 of 10: W-2 Income Documents/ }));
    expect(screen.getByRole("heading", { name: "W-2 Income Documents" })).toBeInTheDocument();
    expect(within(sequence).getByRole("button", { name: /Step 2 of 10: W-2 Income Documents/ })).toHaveAttribute("aria-current", "step");
    expect(within(sequence).getByRole("button", { name: /Step 3 of 10: Other Income Documents/ })).toHaveAttribute("data-required", "false");
    expect(sequence.querySelectorAll("[aria-current='step']")).toHaveLength(1);
    expect(container.querySelector("[aria-label='Refresh document categories']")).toBeInTheDocument();
  });

  it("keeps the parent dashboard in sync when documents load or are removed", async () => {
    const taxReturnDocument: AssessmentDocument = {
      id: "document-1",
      category: "TAX_RETURNS",
      status: "UPLOADED",
      originalName: "tax-return.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      createdAt: "2026-07-30T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z"
    };
    const onDocumentsChanged = vi.fn();
    api.loadDocuments.mockResolvedValue({ documents: [taxReturnDocument] });

    render(
      <PortalDocumentsClient
        embedded
        onDocumentsChanged={onDocumentsChanged}
      />
    );

    await waitFor(() =>
      expect(onDocumentsChanged).toHaveBeenCalledWith([taxReturnDocument])
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove tax-return.pdf" }));

    await waitFor(() =>
      expect(api.removeDocument).toHaveBeenCalledWith("portal-token", "document-1")
    );
    expect(onDocumentsChanged).toHaveBeenLastCalledWith([]);
  });

  it("keeps an uploaded document in the list without automatically opening its preview", async () => {
    const uploadedDocument: AssessmentDocument = {
      id: "document-1",
      category: "TAX_RETURNS",
      status: "UPLOADED",
      originalName: "tax-return.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      createdAt: "2026-07-30T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z"
    };
    api.completeDocumentUpload.mockResolvedValue({ document: uploadedDocument });
    const { container } = render(<PortalDocumentsClient embedded />);

    await waitFor(() => expect(api.loadDocuments).toHaveBeenCalledWith("portal-token"));
    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: {
        files: [new File(["tax return"], "tax-return.pdf", { type: "application/pdf" })]
      }
    });

    expect(await screen.findByText("1 document uploaded to Prior Tax Returns Documents.")).toBeInTheDocument();
    expect(screen.getByText("tax-return.pdf")).toBeInTheDocument();
    expect(api.createDocumentPreviewUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview tax-return.pdf" }));

    await waitFor(() =>
      expect(api.createDocumentPreviewUrl).toHaveBeenCalledWith("portal-token", "document-1")
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses document success notifications after two seconds", async () => {
    render(<PortalDocumentsClient embedded />);

    await waitFor(() => expect(api.loadDocuments).toHaveBeenCalledWith("portal-token"));
    let resolveRefresh!: (value: { documents: AssessmentDocument[] }) => void;
    api.loadDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh document categories" }));
    await waitFor(() => expect(api.loadDocuments).toHaveBeenCalledTimes(2));

    vi.useFakeTimers();
    await act(async () => {
      resolveRefresh({ documents: [] });
    });

    expect(screen.getByText("Documents refreshed.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByText("Documents refreshed.")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Documents refreshed.")).not.toBeInTheDocument();
  });
});
