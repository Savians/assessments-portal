import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClientSummary, AdminOverview, Paginated } from "@/services/admin-api";
import { AdminDashboardClient } from "./admin-dashboard-client";

const api = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  deleteAdminClient: vi.fn(),
  loadAdminClients: vi.fn(),
  loadAdminInvoicePreview: vi.fn(),
  loadAdminOverview: vi.fn()
}));

const auth = vi.hoisted(() => ({
  getCurrentPortalAccessToken: vi.fn(),
  getPortalIdentity: vi.fn(),
  signOutFromPortal: vi.fn()
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation
}));

vi.mock("@/services/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin-api")>()),
  ...api
}));

vi.mock("@/services/portal-auth", () => auth);

const overview: AdminOverview = {
  totalClients: 2,
  paymentPending: 0,
  pendingUploads: 0,
  readyForReview: 2,
  inProgress: 0,
  completed: 0,
  documentCount: 3,
  documentBytes: 4096,
  years: [2026]
};

function client(overrides: Partial<AdminClientSummary>): AdminClientSummary {
  return {
    id: "session-1",
    clientId: "client-1",
    firstName: "Invoice",
    middleName: null,
    lastName: "Client",
    normalizedEmail: "invoice@example.com",
    phone: "+15555550111",
    assessmentYear: 2026,
    status: "DOCUMENTS_SUBMITTED",
    statusLabel: "Ready for Review",
    qbInvoiceId: null,
    qbInvoiceNumber: null,
    qbInvoiceBalance: 0,
    paymentVerifiedAt: null,
    updatedAt: "2026-07-30T12:00:00.000Z",
    documentCount: 1,
    ...overrides
  };
}

const clients: Paginated<AdminClientSummary> = {
  page: 1,
  pageSize: 25,
  total: 2,
  totalPages: 1,
  items: [
    client({
      id: "session-invoice-id",
      firstName: "Invoice",
      lastName: "Identifier",
      normalizedEmail: "identifier@example.com",
      qbInvoiceId: "qb-invoice-456"
    }),
    client({
      id: "session-paid",
      firstName: "Payment",
      lastName: "Verified",
      normalizedEmail: "paid@example.com",
      paymentVerifiedAt: "2026-07-29T18:00:00.000Z"
    })
  ]
};

beforeEach(() => {
  auth.getCurrentPortalAccessToken.mockResolvedValue("admin-token");
  auth.getPortalIdentity.mockReturnValue({ role: "ADMIN" });
  api.loadAdminOverview.mockResolvedValue(overview);
  api.loadAdminClients.mockResolvedValue(clients);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminDashboardClient", () => {
  it("shows only Overview and Clients navigation and uses invoice/payment fallbacks", async () => {
    render(<AdminDashboardClient />);

    expect(await screen.findByRole("heading", { name: "Client Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();

    const overviewTab = screen.getByRole("button", { name: "Overview" });
    const dashboardNavigation = overviewTab.parentElement!;
    expect(
      within(dashboardNavigation)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim())
    ).toEqual(["Overview", "Clients"]);
    expect(screen.queryByText("All Documents")).not.toBeInTheDocument();

    const invoiceIdRow = screen.getByRole("link", { name: "Open Invoice Identifier" });
    expect(within(invoiceIdRow).getByText("qb-invoice-456")).toBeInTheDocument();
    expect(
      within(invoiceIdRow).getByRole("button", {
        name: "Preview QuickBooks invoice qb-invoice-456"
      })
    ).toBeEnabled();

    const paidRow = screen.getByRole("link", { name: "Open Payment Verified" });
    expect(within(paidRow).getByText("Paid")).toBeInTheDocument();
    expect(
      within(paidRow).getByRole("button", { name: "No QuickBooks invoice is available" })
    ).toBeDisabled();
  });

  it("automatically dismisses admin errors after two seconds", async () => {
    api.loadAdminOverview.mockRejectedValueOnce(new Error("We could not load client operations."));

    render(<AdminDashboardClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not load client operations."
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), {
      timeout: 3_000
    });
  });
});
