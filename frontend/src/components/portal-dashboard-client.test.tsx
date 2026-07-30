import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PortalBusinessInvestment,
  PortalDashboardResponse,
  PortalProperty
} from "@/services/assessment-api";
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
    homeowner: false,
    maritalStatus: "SINGLE",
    preferredContact: "",
    residentStatus: "US_CITIZEN",
    ownsRealEstate: false,
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
    uploadedCount: 2,
    uploadedBytes: 2048,
    uploadedCategories: ["TAX_RETURNS", "W2_INCOME"],
    recentDocuments: []
  }
};

const legacyProperty: PortalProperty = {
  id: "property-1",
  category: "Rental",
  propertyType: "Rental",
  label: "Property 1",
  fullAddress: "10 Main Street, Austin, TX 78701",
  acquiredYear: 2020,
  acquiredMethod: "Legacy Transfer",
  purchaseBasis: 250000,
  currentFmv: 300000,
  landValue: null,
  mortgageBalance: null,
  monthlyPayment: null,
  mortgageCompany: null,
  interestRate: null,
  mortgageTermYears: null,
  taxYearUse: "Rental",
  rentalStartDate: null,
  daysRented: null,
  personalUseDays: null,
  projectedGrossRent: null,
  priorInterestPaid: null,
  priorTaxPaid: null,
  totalExpenses: null,
  owners: [],
  notes: null
};

const legacyBusiness: PortalBusinessInvestment = {
  id: "business-1",
  entityName: "Legacy Cooperative",
  entityType: "Cooperative",
  ownershipPercent: 50,
  taxClassification: "Tax Exempt",
  priorYearIncomeLoss: null,
  priorYear: 2025,
  incomeLossYearMinus3: null,
  incomeLossYearMinus2: null,
  incomeLossYearMinus1: null,
  projectedCurrentYearIncomeLoss: null,
  active: true,
  notes: null
};

beforeEach(() => {
  auth.getCurrentPortalAccessToken.mockResolvedValue("portal-token");
  auth.getPortalIdentity.mockReturnValue({ role: "CLIENT" });
  api.loadPortalDashboard.mockResolvedValue(dashboard);
  api.markAssessmentReadyForReview.mockResolvedValue({
    ok: true,
    status: "Ready for Review",
    emailStatus: "SENT"
  });
  api.savePortalProperties.mockImplementation(
    async (_token: string, properties: PortalProperty[]) => ({
      ...dashboard,
      properties
    })
  );
  api.savePortalBusinessInvestments.mockResolvedValue(dashboard);
  api.savePortalProfile.mockResolvedValue(dashboard);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalDashboardClient", () => {
  it("removes retired controls and uses one required property-category workflow", async () => {
    render(<PortalDashboardClient />);

    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Client Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Estimated Annual Income")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Estimated Annual Tax Paid")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preferred Contact")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Property" }));

    expect(screen.queryByLabelText("Property ID / Label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Property Type")).not.toBeInTheDocument();
    const propertyCategory = screen.getByLabelText("Property Category");
    expect(propertyCategory.closest("label")).toHaveTextContent("*Property Category");
    expect(propertyCategory).toBeRequired();
    expect(
      within(propertyCategory)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Primary Residence",
      "Secondary / Vacation Residence",
      "Rental",
      "Short-Term Rental / Airbnb",
      "Leased Apartment / Temporary Housing",
      "Other"
    ]);
    expect(propertyCategory).toHaveValue("Primary Residence");
    fireEvent.change(propertyCategory, { target: { value: "Rental" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.submit(saveButton.closest("form")!);

    await waitFor(() => expect(api.savePortalProperties).toHaveBeenCalledTimes(1));
    expect(api.savePortalProperties).toHaveBeenCalledWith(
      "portal-token",
      expect.arrayContaining([
        expect.objectContaining({ label: "Property 1", category: "Rental", propertyType: "Rental" })
      ])
    );
  });

  it("uses fixed dropdowns while preserving legacy values", async () => {
    const legacyDashboard: PortalDashboardResponse = {
      ...dashboard,
      dependents: [
        {
          id: "dependent-1",
          firstName: "Ari",
          middleName: "",
          lastName: "Savians",
          dateOfBirth: "2015-04-12",
          residentStatus: "US_CITIZEN",
          sex: "Legacy Marker",
          fullTimeStudent: true,
          livesWithTaxpayer: true,
          notes: ""
        }
      ],
      properties: [legacyProperty],
      businessInvestments: [legacyBusiness]
    };
    api.loadPortalDashboard.mockResolvedValue(legacyDashboard);
    api.savePortalProfile.mockResolvedValue(legacyDashboard);
    api.savePortalProperties.mockResolvedValue(legacyDashboard);
    api.savePortalBusinessInvestments.mockResolvedValue(legacyDashboard);

    render(<PortalDashboardClient />);

    const sexMarker = await screen.findByLabelText("Sex / Gender Marker");
    expect(sexMarker.tagName).toBe("SELECT");
    expect(sexMarker).toHaveValue("Legacy Marker");
    expect(
      within(sexMarker)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Select",
      "Legacy Marker",
      "Male",
      "Female",
      "Non-Binary",
      "Other",
      "Prefer Not to Say"
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));
    const acquiredMethod = await screen.findByLabelText("Acquired Method");
    expect(acquiredMethod.tagName).toBe("SELECT");
    expect(acquiredMethod).toHaveValue("Legacy Transfer");
    expect(
      within(acquiredMethod)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Select",
      "Legacy Transfer",
      "Purchase",
      "Inheritance",
      "Gift",
      "1031 Exchange",
      "Other"
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Business And Entity Intake/ }));
    const entityType = await screen.findByLabelText("Entity Type");
    const taxClassification = screen.getByLabelText("Tax Classification");
    expect(entityType).toHaveValue("Cooperative");
    expect(
      within(entityType)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Select",
      "Cooperative",
      "LLC",
      "Corporation",
      "Partnership",
      "Sole Proprietorship",
      "Trust",
      "Other"
    ]);
    expect(taxClassification).toHaveValue("Tax Exempt");
    expect(
      within(taxClassification)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual([
      "Select",
      "Tax Exempt",
      "Disregarded Entity",
      "Partnership",
      "S Corporation",
      "C Corporation",
      "Sole Proprietorship",
      "Other"
    ]);
  });

  it("autosaves each editable section before switching tabs", async () => {
    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));
    expect(await screen.findByRole("button", { name: "Add Property" })).toBeInTheDocument();
    expect(api.savePortalProfile).toHaveBeenCalledWith(
      "portal-token",
      expect.objectContaining({ homeAddress: "1 Main Street" })
    );

    fireEvent.click(screen.getByRole("button", { name: /Business And Entity Intake/ }));
    expect(await screen.findByRole("button", { name: "Add Entity" })).toBeInTheDocument();
    expect(api.savePortalProperties).toHaveBeenCalledWith("portal-token", []);

    fireEvent.click(screen.getByRole("button", { name: /Document Upload Requirements/ }));
    expect(await screen.findByText("Document uploader")).toBeInTheDocument();
    expect(api.savePortalBusinessInvestments).toHaveBeenCalledWith("portal-token", []);
  });

  it.each([
    {
      ownershipField: "Homeowner?",
      profile: { homeowner: true, ownsRealEstate: false }
    },
    {
      ownershipField: "Own Real Estate?",
      profile: { homeowner: false, ownsRealEstate: true }
    }
  ])(
    "blocks Business and Entity Intake when $ownershipField is Yes and no property exists",
    async ({ profile }) => {
      const ownershipDashboard: PortalDashboardResponse = {
        ...dashboard,
        profile: { ...dashboard.profile, ...profile }
      };
      api.loadPortalDashboard.mockResolvedValue(ownershipDashboard);
      api.savePortalProfile.mockResolvedValue(ownershipDashboard);

      render(<PortalDashboardClient />);
      expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Business And Entity Intake/ }));

      expect(
        await screen.findByText(
          "Add at least one real estate record because Homeowner? or Own Real Estate? is set to Yes."
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Entity" })).not.toBeInTheDocument();
    }
  );

  it("blocks Document Upload Requirements when business ownership is Yes and no entity exists", async () => {
    const businessOwnerDashboard: PortalDashboardResponse = {
      ...dashboard,
      profile: { ...dashboard.profile, ownsBusiness: true }
    };
    api.loadPortalDashboard.mockResolvedValue(businessOwnerDashboard);
    api.savePortalProfile.mockResolvedValue(businessOwnerDashboard);

    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Document Upload Requirements/ }));

    expect(
      await screen.findByText(
        "Add at least one business or entity record because Own A Business? is set to Yes."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Document uploader")).not.toBeInTheDocument();
  });

  it("uses the freshly saved dashboard when checking forward navigation", async () => {
    const updatedDashboard: PortalDashboardResponse = {
      ...dashboard,
      profile: { ...dashboard.profile, homeowner: true }
    };
    api.loadPortalDashboard
      .mockResolvedValueOnce(dashboard)
      .mockResolvedValueOnce(updatedDashboard);
    api.savePortalProfile.mockResolvedValue(updatedDashboard);

    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Business And Entity Intake/ }));

    expect(
      await screen.findByText(
        "Add at least one real estate record because Homeowner? or Own Real Estate? is set to Yes."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Entity" })).not.toBeInTheDocument();
  });

  it("autosaves edits when switching to an earlier tab", async () => {
    const propertyDashboard: PortalDashboardResponse = {
      ...dashboard,
      properties: [legacyProperty]
    };
    api.loadPortalDashboard.mockResolvedValue(propertyDashboard);
    api.savePortalProfile.mockResolvedValue(propertyDashboard);
    api.savePortalProperties.mockResolvedValue(propertyDashboard);

    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));
    const acquiredMethod = await screen.findByLabelText("Acquired Method");
    fireEvent.change(acquiredMethod, { target: { value: "Gift" } });
    fireEvent.click(screen.getByRole("button", { name: /Personal And Family Information/ }));

    await waitFor(() =>
      expect(api.savePortalProperties).toHaveBeenCalledWith(
        "portal-token",
        expect.arrayContaining([expect.objectContaining({ acquiredMethod: "Gift" })])
      )
    );
    expect(await screen.findByLabelText("Home Address")).toBeInTheDocument();
  });

  it("keeps the current tab open when required fields are missing", async () => {
    api.loadPortalDashboard.mockResolvedValue({
      ...dashboard,
      profile: { ...dashboard.profile, homeAddress: "" }
    });
    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));

    expect(
      await screen.findByText("Please complete all required fields before continuing.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Home Address")).toBeInvalid();
    expect(screen.queryByRole("button", { name: "Add Property" })).not.toBeInTheDocument();
    expect(api.savePortalProfile).not.toHaveBeenCalled();
  });

  it("keeps the current tab open when autosave fails", async () => {
    api.savePortalProfile.mockRejectedValue(new Error("Profile autosave failed."));
    render(<PortalDashboardClient />);
    expect(await screen.findByRole("heading", { name: "Kiro Savians" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Real Estate Intake/ }));

    expect(await screen.findByText("Profile autosave failed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Property" })).not.toBeInTheDocument();
  });

  it("requires confirmation before marking the assessment ready", async () => {
    render(<PortalDashboardClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Submit for Review" }));
    await waitFor(() =>
      expect(api.savePortalProfile).toHaveBeenCalledWith(
        "portal-token",
        expect.objectContaining({ homeAddress: "1 Main Street" })
      )
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Submit this assessment for review?"
    });
    expect(api.markAssessmentReadyForReview).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.markAssessmentReadyForReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(api.markAssessmentReadyForReview).toHaveBeenCalledWith("portal-token")
    );
    expect(
      await screen.findByText(
        "Assessment is Ready for Tax Advisor's Review. Savian's Team will reach out to you in case any additional information required."
      )
    ).toBeInTheDocument();
  });

  it("blocks review submission and lists every missing record and document requirement", async () => {
    const incompleteDashboard: PortalDashboardResponse = {
      ...dashboard,
      profile: {
        ...dashboard.profile,
        homeowner: true,
        ownsRealEstate: false,
        ownsBusiness: true
      },
      documentSummary: {
        uploadedCount: 0,
        uploadedBytes: 0,
        uploadedCategories: [],
        recentDocuments: []
      }
    };
    api.loadPortalDashboard.mockResolvedValue(incompleteDashboard);
    api.savePortalProfile.mockResolvedValue(incompleteDashboard);

    render(<PortalDashboardClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Submit for Review" }));

    expect(
      await screen.findByText(
        "Complete the following requirements before submitting for review."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Add at least one real estate record/)).toBeInTheDocument();
    expect(screen.getByText(/Add at least one business or entity record/)).toBeInTheDocument();
    expect(screen.getByText(/Upload at least one Prior Tax Returns document/)).toBeInTheDocument();
    expect(screen.getByText(/Upload at least one W-2 Income document/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.markAssessmentReadyForReview).not.toHaveBeenCalled();
  });
});
