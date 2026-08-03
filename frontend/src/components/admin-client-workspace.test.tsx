import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClientDetail, AdminClientSummary } from "@/services/admin-api";
import { AssessmentApiError } from "@/services/assessment-api";
import { AdminClientWorkspace } from "./admin-client-workspace";

const api = vi.hoisted(() => ({
  abortAdminDocumentUpload: vi.fn(),
  completeAdminDocumentUpload: vi.fn(),
  createAdminDocumentUploadUrl: vi.fn(),
  loadAdminClient: vi.fn(),
  loadAdminClients: vi.fn(),
  loadAdminDocumentPreview: vi.fn(),
  removeAdminDocument: vi.fn(),
  updateAdminBusinesses: vi.fn(),
  updateAdminIdentity: vi.fn(),
  updateAdminProfile: vi.fn(),
  updateAdminProperties: vi.fn(),
  updateAdminStatus: vi.fn()
}));

const assessmentApi = vi.hoisted(() => ({
  uploadDocumentFile: vi.fn()
}));

const auth = vi.hoisted(() => ({
  getCurrentPortalAccessToken: vi.fn(),
  getPortalIdentity: vi.fn()
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: {
    get: vi.fn()
  }
}));

const popup = vi.hoisted(() => ({
  replace: vi.fn(),
  close: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.searchParams
}));

vi.mock("@/services/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin-api")>()),
  ...api
}));

vi.mock("@/services/assessment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assessment-api")>()),
  ...assessmentApi
}));

vi.mock("@/services/portal-auth", () => auth);

const detail: AdminClientDetail = {
  id: "session-current",
  clientId: "client-current",
  normalizedEmail: "current@example.com",
  phone: "+15555550123",
  firstName: "Current",
  middleName: null,
  lastName: "Client",
  dateOfBirth: "1985-05-20T00:00:00.000Z",
  clientType: "INDIVIDUAL",
  businessName: null,
  state: "TX",
  incomeRange: "$250K-$500K",
  estimatedTaxPaidRange: "$50K-$100K",
  assessmentYear: 2026,
  status: "DOCUMENTS_SUBMITTED",
  statusLabel: "Ready for Review",
  serviceAmount: "4999.00",
  currency: "USD",
  qbCustomerId: "qb-customer-1",
  qbInvoiceId: "qb-invoice-1",
  qbInvoiceNumber: null,
  qbInvoiceBalance: "0.00",
  paymentVerifiedAt: "2026-07-29T18:00:00.000Z",
  agreementSignedAt: "2026-07-28T18:00:00.000Z",
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z",
  client: {
    id: "client-current",
    cognitoUserId: "cognito-current",
    normalizedEmail: "current@example.com",
    emailVerifiedAt: "2026-07-28T19:00:00.000Z"
  },
  profile: null,
  documents: [
    {
      id: "document-1",
      category: "TAX_RETURNS",
      status: "CLEAN",
      originalName: "tax-return.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z"
    }
  ],
  navigation: {
    previous: {
      id: "session-previous",
      firstName: "Previous",
      middleName: null,
      lastName: "Client",
      assessmentYear: 2026
    },
    next: {
      id: "session-next",
      firstName: "Next",
      middleName: null,
      lastName: "Client",
      assessmentYear: 2026
    }
  },
  statusHistory: [],
  auditLogs: []
};

const searchResult: AdminClientSummary = {
  id: "session-search-result",
  clientId: "client-search-result",
  firstName: "Search",
  middleName: null,
  lastName: "Result",
  normalizedEmail: "result@example.com",
  phone: "+15555550124",
  assessmentYear: 2025,
  status: "IN_PROGRESS",
  statusLabel: "In Progress",
  qbInvoiceId: null,
  qbInvoiceNumber: null,
  qbInvoiceBalance: null,
  paymentVerifiedAt: null,
  updatedAt: "2026-07-30T10:00:00.000Z",
  documentCount: 0
};

beforeEach(() => {
  auth.getCurrentPortalAccessToken.mockResolvedValue("admin-token");
  auth.getPortalIdentity.mockReturnValue({ role: "ADMIN" });
  navigation.searchParams.get.mockReturnValue(null);
  api.loadAdminClient.mockResolvedValue(detail);
  api.loadAdminClients.mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    items: [searchResult]
  });
  api.updateAdminStatus.mockResolvedValue({
    ...detail,
    status: "COMPLETED",
    statusLabel: "Completed"
  });
  api.loadAdminDocumentPreview.mockResolvedValue({
    previewUrl: "https://documents.example/preview",
    expiresInSeconds: 300
  });
  api.createAdminDocumentUploadUrl.mockResolvedValue({
    documentId: "document-new",
    uploadUrl: "https://documents.example/upload",
    expiresInSeconds: 300
  });
  assessmentApi.uploadDocumentFile.mockResolvedValue(undefined);
  api.completeAdminDocumentUpload.mockResolvedValue({ document: detail.documents[0] });
  api.removeAdminDocument.mockResolvedValue({ ok: true });
  api.abortAdminDocumentUpload.mockResolvedValue({ ok: true });
  vi.spyOn(window, "open").mockImplementation(
    () =>
      ({
        opener: window,
        location: { replace: popup.replace },
        close: popup.close
      }) as unknown as Window
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("AdminClientWorkspace", () => {
  it("renders client search, previous/next navigation, and the status dropdown", async () => {
    render(<AdminClientWorkspace sessionId="session-current" />);

    expect(await screen.findByRole("heading", { name: "Current Client" })).toBeInTheDocument();
    expect(api.loadAdminClient).toHaveBeenCalledWith("admin-token", "session-current");

    fireEvent.click(screen.getByRole("button", { name: "Previous client: Previous Client" }));
    fireEvent.click(screen.getByRole("button", { name: "Next client: Next Client" }));
    expect(navigation.push).toHaveBeenCalledWith("/admin/clients/session-previous");
    expect(navigation.push).toHaveBeenCalledWith("/admin/clients/session-next");

    const statusSelect = screen.getByLabelText("Change Status");
    expect(statusSelect).toBeEnabled();
    expect(
      within(statusSelect)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Select status", "In Progress", "Completed"]);

    fireEvent.change(screen.getByLabelText("Search Clients"), {
      target: { value: "Search Result" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(api.loadAdminClients).toHaveBeenCalledWith("admin-token", {
        search: "Search Result",
        page: 1,
        pageSize: 10
      })
    );
    fireEvent.click(
      within(await screen.findByLabelText("Client search results")).getByRole("button", {
        name: /Search Result/
      })
    );
    expect(navigation.push).toHaveBeenCalledWith("/admin/clients/session-search-result");

    fireEvent.change(statusSelect, { target: { value: "COMPLETED" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Status" }));
    await waitFor(() =>
      expect(api.updateAdminStatus).toHaveBeenCalledWith(
        "admin-token",
        "session-current",
        "COMPLETED",
        ""
      )
    );
  });

  it("uses client-scoped preview, upload, and remove document controls", async () => {
    render(<AdminClientWorkspace sessionId="session-current" />);
    expect(await screen.findByRole("heading", { name: "Current Client" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByRole("heading", { name: "Documents (1)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload Category")).toHaveValue("OTHER_ASSESSMENT_DETAILS");

    fireEvent.click(screen.getByRole("button", { name: "Preview tax-return.pdf" }));
    await waitFor(() =>
      expect(api.loadAdminDocumentPreview).toHaveBeenCalledWith("admin-token", "document-1")
    );
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.replace).toHaveBeenCalledWith("https://documents.example/preview");

    const upload = screen.getByLabelText("Upload Document");
    const file = new File(["pdf"], "new-document.pdf", { type: "application/pdf" });
    fireEvent.change(upload, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.createAdminDocumentUploadUrl).toHaveBeenCalledWith(
        "admin-token",
        "session-current",
        {
          category: "OTHER_ASSESSMENT_DETAILS",
          fileName: "new-document.pdf",
          contentType: "application/pdf",
          sizeBytes: 3
        }
      )
    );
    expect(assessmentApi.uploadDocumentFile).toHaveBeenCalledWith(
      "https://documents.example/upload",
      file
    );
    expect(api.completeAdminDocumentUpload).toHaveBeenCalledWith("admin-token", "session-current", {
      documentId: "document-new",
      sizeBytes: 3
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove tax-return.pdf" }));
    await waitFor(() =>
      expect(api.removeAdminDocument).toHaveBeenCalledWith(
        "admin-token",
        "session-current",
        "document-1"
      )
    );
    expect(window.confirm).toHaveBeenCalledWith("Remove tax-return.pdf from this client?");
  });

  it("aborts a failed pending upload with accurate S3 retention metadata", async () => {
    assessmentApi.uploadDocumentFile.mockRejectedValueOnce(
      new AssessmentApiError("The file upload failed. Please try again.")
    );
    render(<AdminClientWorkspace sessionId="session-current" />);
    expect(await screen.findByRole("heading", { name: "Current Client" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    const failedFile = new File(["pdf"], "failed-document.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Upload Document"), {
      target: { files: [failedFile] }
    });

    await waitFor(() =>
      expect(api.abortAdminDocumentUpload).toHaveBeenCalledWith(
        "admin-token",
        "session-current",
        "document-new",
        false
      )
    );
    expect(api.completeAdminDocumentUpload).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/failed-document\.pdf could not be uploaded/)
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          screen.queryByText(/failed-document\.pdf could not be uploaded/)
        ).not.toBeInTheDocument(),
      { timeout: 3_000 }
    );
  });
});
