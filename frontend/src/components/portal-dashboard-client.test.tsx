import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalDashboardResponse, PortalProperty } from "@/services/assessment-api";
import { PortalDashboardClient } from "./portal-dashboard-client";

const api = vi.hoisted(() => ({
  loadPortalDashboard: vi.fn(),
  markAssessmentReadyForReview: vi.fn(),
  savePortalBusinessInvestments: vi.fn(),
  savePortalProfile: vi.fn(),
  savePortalProperties: vi.fn()
}));

const auth = vi.hoisted(() => ({
  clearStoredPortalAccessToken: vi.fn(),
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

vi.mock("@/services/assessment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assessment-api")>()),
  ...api
}));

vi.mock("@/services/portal-auth", () => auth);
vi.mock("@/components/portal-documents-client", () => ({
  PortalDocumentsClient: () => <div>Document uploader</div>
}));

const dashboard: PortalDashboardResponse = {
  clientId: "client-1",
  sessionId: "session-1",
  assessmentYear: 2026,
  primaryTaxpayer: {
    firstName: "Kiro",
    middleName: "",
    lastName: "Savians",
    dateOfBirth: "1990-01-01",
    clientType: "",
    businessName: "",
    incomeRange: "",
    estimatedTaxPaidRange: "",
    email: "kiro@example.com",
    phone: "+15555550123"
  },
  profile: {
    homeAddress: "1 Main Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    homeowner: true,
    maritalStatus: "SINGLE",
    preferredContact: "",
    residentStatus: "US_CITIZEN",
    ownsRealEstate: true,
    ownsBusiness: false,
    lastYearTaxableIncome: null,
    projectedTaxableIncome: null,
    lifeInsuranceInPlace: false,
    estatePlanningInPlace: false,
    majorPurchaseNotes: "",
    completedAt: "2026-07-28T00:00:00.000Z"
  },
  spouse: null,
  dependents: [],
  completion: {
    status: "COMPLETE",
    progressPercent: 100,
    completedAt: "2026-07-28T00:00:00.000Z"
  },
  assessmentStatus: {
    raw: "DOCUMENTS_IN_PROGRESS",
    label: "Pending Uploads"
  },
  properties: [],
  businessInvestments: [],
  documentSummary: {
    uploadedCount: 1,
    uploadedBytes: 1024,
    recentDocuments: []
  }
};

beforeEach(() => {
  auth.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
  auth.getPortalIdentity.mockReturnValue({ role: "CLIENT" });
  api.loadPortalDashboard.mockResolvedValue(dashboard);
  api.markAssessmentReadyForReview.mockResolvedValue({ ok: true, status: "Ready for Review", emailStatus: "SENT" });
  api.savePortalProperties.mockImplementation(async (_token: string, properties: PortalProperty[]) => ({
    ...dashboard,
    properties
  }));
  api.savePortalBusinessInvestments.mockResolvedValue(dashboard);
  api.savePortalProfile.mockResolvedValue(dashboard);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalDashboardClient", () => {
  it("removes retired profile controls and uses the exact property-type workflow", async () => {
    render(<PortalDashboardClient />);

    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Client Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Estimated Annual Income")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Estimated Annual Tax Paid")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preferred Contact")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Property" }));

    expect(screen.queryByLabelText("Property ID / Label")).not.toBeInTheDocument();
    const propertyType = screen.getByLabelText("Property Type");
    expect(within(propertyType).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Primary Residence",
      "Secondary / Vacation Residence",
      "Rental",
      "Short-Term Rental / Airbnb",
      "Leased Apartment / Temporary Housing",
      "Other"
    ]);
    expect(propertyType).toHaveValue("Primary Residence");

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.submit(saveButton.closest("form")!);

    await waitFor(() => expect(api.savePortalProperties).toHaveBeenCalledTimes(1));
    expect(api.savePortalProperties).toHaveBeenCalledWith(
      "portal-token",
      expect.arrayContaining([expect.objectContaining({ label: "Property 1", propertyType: "Primary Residence" })])
    );
  });

  it("requires confirmation before marking the assessment ready", async () => {
    render(<PortalDashboardClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Mark The Assessment Ready For Review" }));
    const dialog = screen.getByRole("dialog", { name: "Mark this assessment ready for review?" });
    expect(api.markAssessmentReadyForReview).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.markAssessmentReadyForReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark The Assessment Ready For Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Mark Ready" }));

    await waitFor(() => expect(api.markAssessmentReadyForReview).toHaveBeenCalledWith("portal-token"));
  });
});
