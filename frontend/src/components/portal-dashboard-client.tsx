"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  FileUp,
  LogOut,
  Plus,
  Save,
  Send,
  Trash2,
  UserRound
} from "lucide-react";
import {
  AssessmentApiError,
  loadPortalDashboard,
  markAssessmentReadyForReview,
  savePortalBusinessInvestments,
  savePortalProfile,
  savePortalProperties,
  type AssessmentDocument,
  type ClientType,
  type IncomeRange,
  type MaritalStatus,
  type PortalBusinessInvestment,
  type PortalDashboardResponse,
  type PortalHouseholdMember,
  type PortalProfilePayload,
  type PortalProperty,
  type ResidentStatus,
  type SavePortalProfileRequest,
  type TaxPaidRange
} from "@/services/assessment-api";
import {
  clearStoredPortalAccessToken,
  getCurrentPortalAccessToken,
  getPortalIdentity,
  signOutFromPortal
} from "@/services/portal-auth";
import {
  Button,
  Card,
  ErrorAlert,
  Input,
  LoadingOverlay,
  Select,
  StatusBadge,
  cn
} from "@/components/ui";
import { PortalDocumentsClient } from "@/components/portal-documents-client";
import {
  generatedPropertyLabel,
  normalizePortalPropertyCategory,
  portalPropertyCategoryOptions,
  preparePortalPropertiesForSave
} from "@/lib/portal-properties";
import {
  getNavigationRequirementIssue,
  getReviewSubmissionIssues,
  requiredReviewDocuments,
  type ReviewReadinessState
} from "@/lib/review-readiness";

type DashboardTab = "personal" | "realEstate" | "business" | "documents";

const tabs: Array<{ id: DashboardTab; label: string; helper: string; icon: typeof UserRound }> = [
  {
    id: "personal",
    label: "Personal And Family Information",
    helper: "Household, spouse, and dependent details.",
    icon: UserRound
  },
  {
    id: "realEstate",
    label: "Real Estate Intake",
    helper: "Owned, rental, and investment properties.",
    icon: Building2
  },
  {
    id: "business",
    label: "Business And Entity Intake",
    helper: "LLCs, S-Corps, partnerships, and other entities.",
    icon: BriefcaseBusiness
  },
  {
    id: "documents",
    label: "Document Upload Requirements",
    helper: "Secure document folders and upload history.",
    icon: FileUp
  }
];

const residentStatusLabels: Record<ResidentStatus, string> = {
  US_CITIZEN: "U.S. Citizen",
  GREEN_CARD_HOLDER: "Green Card Holder",
  VISA: "Visa",
  OTHER: "Other"
};
const maritalStatusLabels: Record<MaritalStatus, string> = {
  SINGLE: "Single",
  MARRIED: "Married",
  DIVORCED: "Divorced",
  WIDOWED: "Widowed"
};
const sexGenderMarkerOptions = [
  "Male",
  "Female",
  "Non-Binary",
  "Other",
  "Prefer Not to Say"
] as const;
const acquiredMethodOptions = [
  "Purchase",
  "Inheritance",
  "Gift",
  "1031 Exchange",
  "Other"
] as const;
const entityTypeOptions = [
  "LLC",
  "Corporation",
  "Partnership",
  "Sole Proprietorship",
  "Trust",
  "Other"
] as const;
const taxClassificationOptions = [
  "Disregarded Entity",
  "Partnership",
  "S Corporation",
  "C Corporation",
  "Sole Proprietorship",
  "Other"
] as const;

function optionsWithLegacyValue(options: readonly string[], currentValue: string) {
  return currentValue && !options.includes(currentValue) ? [currentValue, ...options] : options;
}

interface ProfileDraft {
  assessmentContext: {
    primaryDateOfBirth: string;
    clientType: ClientType | "";
    businessName: string;
    incomeRange: IncomeRange | "";
    estimatedTaxPaidRange: TaxPaidRange | "";
  };
  profile: PortalProfilePayload;
  spouse: PortalHouseholdMember;
  dependents: PortalHouseholdMember[];
}

const emptyMember = (): PortalHouseholdMember => ({
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  residentStatus: "",
  sex: "",
  fullTimeStudent: null,
  livesWithTaxpayer: null,
  notes: ""
});

const emptyProfileDraft = (): ProfileDraft => ({
  assessmentContext: {
    primaryDateOfBirth: "",
    clientType: "",
    businessName: "",
    incomeRange: "",
    estimatedTaxPaidRange: ""
  },
  profile: {
    homeAddress: "",
    city: "",
    state: "",
    zip: "",
    homeowner: null,
    maritalStatus: "",
    preferredContact: "",
    residentStatus: "US_CITIZEN",
    ownsRealEstate: null,
    ownsBusiness: null,
    lastYearTaxableIncome: null,
    projectedTaxableIncome: null,
    lifeInsuranceInPlace: null,
    estatePlanningInPlace: null,
    majorPurchaseNotes: "",
    completedAt: null
  },
  spouse: emptyMember(),
  dependents: []
});

const emptyProperty = (): PortalProperty => ({
  category: "Primary Residence",
  propertyType: "Primary Residence",
  label: "",
  fullAddress: "",
  acquiredYear: new Date().getFullYear(),
  acquiredMethod: "Purchase",
  purchaseBasis: null,
  currentFmv: null,
  landValue: null,
  mortgageBalance: null,
  monthlyPayment: null,
  mortgageCompany: null,
  interestRate: null,
  mortgageTermYears: null,
  taxYearUse: "Personal",
  rentalStartDate: null,
  daysRented: null,
  personalUseDays: null,
  projectedGrossRent: null,
  priorInterestPaid: null,
  priorTaxPaid: null,
  totalExpenses: null,
  owners: [],
  notes: null
});

const emptyBusiness = (): PortalBusinessInvestment => ({
  entityName: "",
  entityType: "LLC",
  ownershipPercent: 100,
  taxClassification: "Partnership",
  priorYearIncomeLoss: null,
  priorYear: new Date().getFullYear() - 1,
  incomeLossYearMinus3: null,
  incomeLossYearMinus2: null,
  incomeLossYearMinus1: null,
  projectedCurrentYearIncomeLoss: null,
  active: true,
  notes: null
});

function draftFromDashboard(response: PortalDashboardResponse): ProfileDraft {
  return {
    assessmentContext: {
      primaryDateOfBirth: response.primaryTaxpayer.dateOfBirth,
      clientType: response.primaryTaxpayer.clientType,
      businessName: response.primaryTaxpayer.businessName,
      incomeRange: response.primaryTaxpayer.incomeRange,
      estimatedTaxPaidRange: response.primaryTaxpayer.estimatedTaxPaidRange
    },
    profile: response.profile,
    spouse: response.spouse ?? emptyMember(),
    dependents: response.dependents
  };
}

function booleanFromSelect(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function booleanSelectValue(value: boolean | null) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

function numberFromInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberInputValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function memberForSave(member: PortalHouseholdMember): Omit<PortalHouseholdMember, "id"> {
  return {
    firstName: member.firstName,
    middleName: member.middleName,
    lastName: member.lastName,
    dateOfBirth: member.dateOfBirth,
    residentStatus: member.residentStatus,
    sex: member.sex,
    fullTimeStudent: member.fullTimeStudent,
    livesWithTaxpayer: member.livesWithTaxpayer,
    notes: member.notes
  };
}

function buildSaveRequest(draft: ProfileDraft): SavePortalProfileRequest {
  return {
    primaryDateOfBirth: draft.assessmentContext.primaryDateOfBirth,
    clientType: draft.assessmentContext.clientType,
    businessName: draft.assessmentContext.businessName,
    incomeRange: draft.assessmentContext.incomeRange,
    estimatedTaxPaidRange: draft.assessmentContext.estimatedTaxPaidRange,
    homeAddress: draft.profile.homeAddress,
    city: draft.profile.city,
    state: draft.profile.state,
    zip: draft.profile.zip,
    homeowner: draft.profile.homeowner,
    maritalStatus: draft.profile.maritalStatus,
    preferredContact: draft.profile.preferredContact,
    residentStatus: draft.profile.residentStatus,
    ownsRealEstate: draft.profile.ownsRealEstate,
    ownsBusiness: draft.profile.ownsBusiness,
    lastYearTaxableIncome: draft.profile.lastYearTaxableIncome,
    projectedTaxableIncome: draft.profile.projectedTaxableIncome,
    lifeInsuranceInPlace: draft.profile.lifeInsuranceInPlace,
    estatePlanningInPlace: draft.profile.estatePlanningInPlace,
    majorPurchaseNotes: draft.profile.majorPurchaseNotes,
    spouse: draft.profile.maritalStatus === "MARRIED" ? memberForSave(draft.spouse) : null,
    dependents: draft.dependents.map(memberForSave)
  };
}

function fullName(person: { firstName: string; middleName?: string; lastName: string }) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

function readinessStateFromDashboard(
  response: PortalDashboardResponse
): ReviewReadinessState {
  return {
    homeowner: response.profile.homeowner,
    ownsRealEstate: response.profile.ownsRealEstate,
    ownsBusiness: response.profile.ownsBusiness,
    propertyCount: response.properties.length,
    businessCount: response.businessInvestments.length,
    uploadedCategories: response.documentSummary.uploadedCategories
  };
}

function BooleanSelect({
  label,
  value,
  onChange,
  required = false
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
  required?: boolean;
}) {
  return (
    <Select
      label={label}
      value={booleanSelectValue(value)}
      onChange={(event) => onChange(booleanFromSelect(event.target.value))}
      required={required}
    >
      <option value="">Select</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </Select>
  );
}

function MemberFields({
  title,
  member,
  onChange,
  onRemove
}: {
  title: string;
  member: PortalHouseholdMember;
  onChange: (next: PortalHouseholdMember) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-navy-800">{title}</h3>
        {onRemove ? (
          <button
            className="focus-ring grid size-9 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50"
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${title}`}
          >
            <Trash2 aria-hidden size={15} />
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input
          label="First Name"
          value={member.firstName}
          onChange={(event) => onChange({ ...member, firstName: event.target.value })}
          required
        />
        <Input
          label="Last Name"
          value={member.lastName}
          onChange={(event) => onChange({ ...member, lastName: event.target.value })}
          required
        />
        <Input
          label="Date Of Birth"
          type="date"
          value={member.dateOfBirth}
          onChange={(event) => onChange({ ...member, dateOfBirth: event.target.value })}
          required
        />
        <Select
          label="Resident Status"
          value={member.residentStatus}
          onChange={(event) =>
            onChange({ ...member, residentStatus: event.target.value as ResidentStatus | "" })
          }
          required
        >
          <option value="">Select</option>
          {Object.entries(residentStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Sex / Gender Marker"
          value={member.sex}
          onChange={(event) => onChange({ ...member, sex: event.target.value })}
          required
        >
          <option value="">Select</option>
          {optionsWithLegacyValue(sexGenderMarkerOptions, member.sex).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <BooleanSelect
          label="Full-Time Student?"
          value={member.fullTimeStudent}
          onChange={(next) => onChange({ ...member, fullTimeStudent: next })}
          required
        />
        <BooleanSelect
          label="Lives With Taxpayer?"
          value={member.livesWithTaxpayer}
          onChange={(next) => onChange({ ...member, livesWithTaxpayer: next })}
          required
        />
      </div>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  const status =
    label === "Ready for Review" ? "complete" : label === "Payment Pending" ? "pending" : "active";
  return <StatusBadge status={status}>{label}</StatusBadge>;
}

export function PortalDashboardClient() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>("personal");
  const [accessToken, setAccessToken] = useState("");
  const [dashboard, setDashboard] = useState<PortalDashboardResponse | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [properties, setProperties] = useState<PortalProperty[]>([]);
  const [businessInvestments, setBusinessInvestments] = useState<PortalBusinessInvestment[]>([]);
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState<number | null>(null);
  const [selectedBusinessIndex, setSelectedBusinessIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readySubmitting, setReadySubmitting] = useState(false);
  const [readyConfirmationOpen, setReadyConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const personalFormRef = useRef<HTMLFormElement>(null);
  const realEstateFormRef = useRef<HTMLFormElement>(null);
  const businessFormRef = useRef<HTMLFormElement>(null);

  const clientName = dashboard ? fullName(dashboard.primaryTaxpayer) : "Client";
  const assessmentYear = dashboard?.assessmentYear ?? new Date().getFullYear();
  const incomeHistoryYears = [assessmentYear - 3, assessmentYear - 2, assessmentYear - 1];
  const isMarried = profileDraft.profile.maritalStatus === "MARRIED";
  const showBusinessName =
    profileDraft.assessmentContext.clientType === "BUSINESS_OWNER" ||
    profileDraft.assessmentContext.clientType === "OTHER";
  const canMarkReady = !["Ready for Review", "In Progress", "Completed"].includes(
    dashboard?.assessmentStatus.label ?? ""
  );
  const selectedProperty =
    selectedPropertyIndex === null ? null : (properties[selectedPropertyIndex] ?? null);
  const selectedBusiness =
    selectedBusinessIndex === null ? null : (businessInvestments[selectedBusinessIndex] ?? null);
  const uploadedCategorySet = new Set(dashboard?.documentSummary.uploadedCategories ?? []);

  const syncDashboard = useCallback((response: PortalDashboardResponse) => {
    setDashboard(response);
    setProfileDraft(draftFromDashboard(response));
    setProperties(
      response.properties.map((property) => {
        const category = normalizePortalPropertyCategory(property.category, property.propertyType);
        return { ...property, category, propertyType: category };
      })
    );
    setBusinessInvestments(response.businessInvestments);
    setSelectedPropertyIndex((current) =>
      response.properties.length === 0
        ? null
        : Math.min(current ?? 0, response.properties.length - 1)
    );
    setSelectedBusinessIndex((current) =>
      response.businessInvestments.length === 0
        ? null
        : Math.min(current ?? 0, response.businessInvestments.length - 1)
    );
  }, []);

  const loadDashboard = useCallback(
    async (token: string) => {
      setLoading(true);
      setError(null);
      setIssues([]);
      try {
        const response = await loadPortalDashboard(token);
        syncDashboard(response);
        setAccessToken(token);
      } catch (caught) {
        clearStoredPortalAccessToken();
        setError(
          caught instanceof AssessmentApiError
            ? caught.message
            : "We could not load your dashboard."
        );
      } finally {
        setLoading(false);
      }
    },
    [syncDashboard]
  );

  const handleDocumentsChanged = useCallback((nextDocuments: AssessmentDocument[]) => {
    const uploadedDocuments = nextDocuments.filter(
      (document) => document.status === "UPLOADED" || document.status === "CLEAN"
    );
    setDashboard((current) =>
      current
        ? {
            ...current,
            documentSummary: {
              uploadedCount: uploadedDocuments.length,
              uploadedBytes: uploadedDocuments.reduce(
                (total, document) => total + document.sizeBytes,
                0
              ),
              uploadedCategories: Array.from(
                new Set(uploadedDocuments.map((document) => document.category))
              ),
              recentDocuments: [...uploadedDocuments]
                .sort(
                  (left, right) =>
                    new Date(right.createdAt).getTime() -
                    new Date(left.createdAt).getTime()
                )
                .slice(0, 10)
                .map(({ id, category, originalName, sizeBytes, createdAt }) => ({
                  id,
                  category,
                  originalName,
                  sizeBytes,
                  createdAt
                }))
            }
          }
        : current
    );
  }, []);

  useEffect(() => {
    getCurrentPortalAccessToken().then((token) => {
      if (token && ["ADMIN", "SUPER_ADMIN"].includes(getPortalIdentity(token).role))
        router.replace("/admin/dashboard");
      else if (token) void loadDashboard(token);
      else {
        setMessage(
          "Sign in with the Savians account created after payment to open your dashboard."
        );
        setLoading(false);
      }
    });
  }, [loadDashboard, router]);

  useEffect(() => {
    if (!readyConfirmationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !readySubmitting) setReadyConfirmationOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [readyConfirmationOpen, readySubmitting]);

  const tabCompletion = {
    personal: dashboard?.completion.status === "COMPLETE",
    realEstate:
      properties.some((property) => Boolean(property.id)) ||
      (profileDraft.profile.homeowner === false &&
        profileDraft.profile.ownsRealEstate === false),
    business:
      businessInvestments.some((business) => Boolean(business.id)) ||
      profileDraft.profile.ownsBusiness === false,
    documents: requiredReviewDocuments.every((document) =>
      uploadedCategorySet.has(document.category)
    )
  };

  async function saveProfileSection(): Promise<PortalDashboardResponse | null> {
    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      await savePortalProfile(accessToken, buildSaveRequest(profileDraft));
      const response = await loadPortalDashboard(accessToken);
      syncDashboard(response);
      setMessage("Personal and family information saved.");
      return response;
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Personal and Family Information.");
      setIssues(apiError.issues ?? []);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveProfileSection();
  }

  async function savePropertiesSection(): Promise<PortalDashboardResponse | null> {
    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await savePortalProperties(
        accessToken,
        preparePortalPropertiesForSave(properties)
      );
      syncDashboard(response);
      setMessage("Real Estate Intake saved.");
      return response;
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Real Estate Intake.");
      setIssues(apiError.issues ?? []);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handlePropertiesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await savePropertiesSection();
  }

  async function saveBusinessSection(): Promise<PortalDashboardResponse | null> {
    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await savePortalBusinessInvestments(accessToken, businessInvestments);
      syncDashboard(response);
      setMessage("Business and Entity Intake saved.");
      return response;
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Business and Entity Intake.");
      setIssues(apiError.issues ?? []);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleBusinessSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveBusinessSection();
  }

  async function saveActiveSection(): Promise<PortalDashboardResponse | null> {
    const activeForm =
      activeTab === "personal"
        ? personalFormRef.current
        : activeTab === "realEstate"
          ? realEstateFormRef.current
          : activeTab === "business"
            ? businessFormRef.current
            : null;

    if (activeForm && !activeForm.reportValidity()) {
      setError("Please complete all required fields before continuing.");
      setIssues([]);
      setMessage(null);
      return null;
    }

    return activeTab === "personal"
      ? saveProfileSection()
      : activeTab === "realEstate"
        ? savePropertiesSection()
        : activeTab === "business"
          ? saveBusinessSection()
          : dashboard;
  }

  async function handleTabChange(nextTab: DashboardTab) {
    if (nextTab === activeTab || saving || readySubmitting) return;
    const savedDashboard = await saveActiveSection();
    if (!savedDashboard) return;

    const requirementIssue = getNavigationRequirementIssue(
      nextTab,
      readinessStateFromDashboard(savedDashboard)
    );
    if (requirementIssue) {
      setError(requirementIssue.message);
      setIssues([]);
      setMessage(null);
      return;
    }

    setActiveTab(nextTab);
  }

  async function openReadyConfirmation() {
    if (saving || readySubmitting) return;
    const savedDashboard = await saveActiveSection();
    if (!savedDashboard) return;

    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await loadPortalDashboard(accessToken);
      syncDashboard(response);
      const submissionIssues = getReviewSubmissionIssues(
        readinessStateFromDashboard(response)
      );
      if (submissionIssues.length > 0) {
        setError("Complete the following requirements before submitting for review.");
        setIssues(
          submissionIssues.map(({ path, message: issueMessage }) => ({
            path,
            message: issueMessage
          }))
        );
        return;
      }
      setReadyConfirmationOpen(true);
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not verify that this assessment is ready for review.");
      setIssues(apiError.issues ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function handleReadyForReview() {
    setReadySubmitting(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      await markAssessmentReadyForReview(accessToken);
      syncDashboard(await loadPortalDashboard(accessToken));
      setMessage(
        "Assessment is Ready for Tax Advisor's Review. Savian's Team will reach out to you in case any additional information required."
      );
    } catch (caught) {
      if (caught instanceof AssessmentApiError) {
        setError(caught.message);
        setIssues(caught.issues ?? []);
      } else {
        setError("We could not submit this assessment for review.");
      }
    } finally {
      setReadySubmitting(false);
    }
  }

  function handleSignOut() {
    signOutFromPortal();
    setAccessToken("");
    setDashboard(null);
    setProfileDraft(emptyProfileDraft());
    setProperties([]);
    setBusinessInvestments([]);
    setSelectedPropertyIndex(null);
    setSelectedBusinessIndex(null);
    setError(null);
    setIssues([]);
    setMessage("You have been signed out.");
  }

  const updateProfile = (next: Partial<PortalProfilePayload>) =>
    setProfileDraft((current) => ({ ...current, profile: { ...current.profile, ...next } }));
  const updateAssessmentContext = (next: Partial<ProfileDraft["assessmentContext"]>) =>
    setProfileDraft((current) => ({
      ...current,
      assessmentContext: { ...current.assessmentContext, ...next }
    }));
  const updateProperty = (index: number, next: Partial<PortalProperty>) =>
    setProperties((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item))
    );
  const updateBusiness = (index: number, next: Partial<PortalBusinessInvestment>) =>
    setBusinessInvestments((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item))
    );

  function addProperty() {
    const nextIndex = properties.length;
    setProperties((current) => [...current, emptyProperty()]);
    setSelectedPropertyIndex(nextIndex);
  }

  function removeProperty(index: number) {
    setProperties((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSelectedPropertyIndex((current) => {
      const nextLength = properties.length - 1;
      if (nextLength <= 0) return null;
      if (current === null) return 0;
      if (current > index) return current - 1;
      if (current === index) return Math.min(index, nextLength - 1);
      return current;
    });
  }

  function addBusiness() {
    const nextIndex = businessInvestments.length;
    setBusinessInvestments((current) => [...current, emptyBusiness()]);
    setSelectedBusinessIndex(nextIndex);
  }

  function removeBusiness(index: number) {
    setBusinessInvestments((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSelectedBusinessIndex((current) => {
      const nextLength = businessInvestments.length - 1;
      if (nextLength <= 0) return null;
      if (current === null) return 0;
      if (current > index) return current - 1;
      if (current === index) return Math.min(index, nextLength - 1);
      return current;
    });
  }

  if (loading) return <LoadingOverlay label="Loading dashboard" />;

  if (!dashboard) {
    return (
      <section className="page-shell min-h-[75vh] py-12">
        <Card className="mx-auto max-w-xl">
          <StatusBadge status="active">Secure Dashboard</StatusBadge>
          <h1 className="mt-4 text-3xl font-bold text-navy-800">Sign In To Dashboard</h1>
          <p className="mt-3 text-slate-600">
            Use the email and password created after payment verification.
          </p>
          {error ? (
            <div className="mt-5">
              <ErrorAlert>{error}</ErrorAlert>
            </div>
          ) : null}
          {message ? (
            <p className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">{message}</p>
          ) : null}
          <Link
            className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-navy-800 px-5 py-3 font-bold text-white"
            href="/login"
          >
            Open Secure Sign In
          </Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto min-h-[75vh] w-full max-w-[1500px] px-5 py-10 sm:px-8">
      {(saving || readySubmitting) && (
        <LoadingOverlay label={readySubmitting ? "Submitting for review" : "Saving intake"} />
      )}
      <Card className="overflow-hidden bg-gradient-to-r from-white via-white to-navy-50/80 p-0">
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <StatusBadge status="active">Client Dashboard</StatusBadge>
            <h1 className="mt-3 text-3xl font-bold text-navy-800">{clientName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {dashboard.assessmentYear} assessment · {dashboard.primaryTaxpayer.email} ·{" "}
              {dashboard.primaryTaxpayer.phone}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill label={dashboard.assessmentStatus.label} />
              <Button
                type="button"
                onClick={() => void openReadyConfirmation()}
                disabled={readySubmitting || !canMarkReady}
              >
                <Send aria-hidden size={16} />
                {canMarkReady ? "Submit for Review" : dashboard.assessmentStatus.label}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSignOut}
                disabled={saving || readySubmitting}
              >
                <LogOut aria-hidden size={16} />
                Logout
              </Button>
            </div>
            {canMarkReady ? (
              <p className="max-w-md text-left text-xs leading-5 text-slate-500 sm:text-right">
                Once you&apos;re done uploading all required documents, click{" "}
                <span className="font-semibold text-navy-800">Submit for Review</span>.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-4">
        {error ? (
          <ErrorAlert>
            <p>{error}</p>
            {issues.length > 0 ? (
              <ul className="mt-3 list-disc pl-5">
                {issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </ErrorAlert>
        ) : null}
        {message ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 aria-hidden size={18} />
            {message}
          </div>
        ) : null}
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
              Assessment Intake
            </p>
            <h2 className="mt-2 text-xl font-bold text-navy-800">Sections</h2>
          </div>
          <p className="text-sm text-slate-500">
            Switch between sections and save each intake area as you complete it.
          </p>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={cn(
                  "focus-ring flex min-h-28 w-full items-start gap-3 rounded-2xl border p-4 text-left transition",
                  active
                    ? "border-navy-800 bg-navy-800 text-white shadow-card"
                    : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50"
                )}
                type="button"
                onClick={() => void handleTabChange(tab.id)}
                disabled={saving || readySubmitting}
              >
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-xl",
                    active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800"
                  )}
                >
                  <Icon aria-hidden size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{tab.label}</span>
                  <span
                    className={cn(
                      "mt-2 block text-xs leading-5",
                      active ? "text-white/75" : "text-slate-500"
                    )}
                  >
                    {tab.helper}
                  </span>
                </span>
                {tabCompletion[tab.id] ? (
                  <CheckCircle2
                    aria-hidden
                    className={active ? "text-emerald-200" : "text-emerald-600"}
                    size={18}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="mt-6 min-w-0">
        {activeTab === "personal" ? (
          <form ref={personalFormRef} className="grid gap-6" onSubmit={handleProfileSave}>
            <Card>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                    Personal And Family Information
                  </p>
                </div>
                <Button type="submit" disabled={saving}>
                  <Save aria-hidden size={16} />
                  Save
                </Button>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Input label="Full Name" value={clientName} disabled className="bg-slate-50" />
                <Input
                  label="Date Of Birth"
                  type="date"
                  value={profileDraft.assessmentContext.primaryDateOfBirth}
                  onChange={(event) =>
                    updateAssessmentContext({ primaryDateOfBirth: event.target.value })
                  }
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={dashboard.primaryTaxpayer.email}
                  disabled
                  className="bg-slate-50"
                />
                <Input
                  label="Phone"
                  value={dashboard.primaryTaxpayer.phone}
                  disabled
                  className="bg-slate-50"
                />
                {showBusinessName ? (
                  <Input
                    label="Business Name"
                    autoComplete="organization"
                    value={profileDraft.assessmentContext.businessName}
                    onChange={(event) =>
                      updateAssessmentContext({ businessName: event.target.value })
                    }
                    required
                  />
                ) : null}
                <Input
                  label="Home Address"
                  value={profileDraft.profile.homeAddress}
                  onChange={(event) => updateProfile({ homeAddress: event.target.value })}
                  required
                />
                <Input
                  label="City"
                  value={profileDraft.profile.city}
                  onChange={(event) => updateProfile({ city: event.target.value })}
                  required
                />
                <Input
                  label="State"
                  maxLength={2}
                  value={profileDraft.profile.state}
                  onChange={(event) => updateProfile({ state: event.target.value.toUpperCase() })}
                  required
                />
                <Input
                  label="ZIP Code"
                  value={profileDraft.profile.zip}
                  onChange={(event) => updateProfile({ zip: event.target.value })}
                  required
                />
                <BooleanSelect
                  label="Homeowner?"
                  value={profileDraft.profile.homeowner}
                  onChange={(next) => updateProfile({ homeowner: next })}
                  required
                />
                <Select
                  label="Marital Status"
                  value={profileDraft.profile.maritalStatus}
                  onChange={(event) =>
                    updateProfile({ maritalStatus: event.target.value as MaritalStatus | "" })
                  }
                  required
                >
                  <option value="">Select</option>
                  {Object.entries(maritalStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Primary Resident Status"
                  value={profileDraft.profile.residentStatus}
                  onChange={(event) =>
                    updateProfile({ residentStatus: event.target.value as ResidentStatus | "" })
                  }
                  required
                >
                  <option value="">Select</option>
                  {Object.entries(residentStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <BooleanSelect
                  label="Own Real Estate?"
                  value={profileDraft.profile.ownsRealEstate}
                  onChange={(next) => updateProfile({ ownsRealEstate: next })}
                  required
                />
                <BooleanSelect
                  label="Own A Business?"
                  value={profileDraft.profile.ownsBusiness}
                  onChange={(next) => updateProfile({ ownsBusiness: next })}
                  required
                />
                <Input
                  label={`${assessmentYear - 1} Taxable Income`}
                  type="number"
                  value={numberInputValue(profileDraft.profile.lastYearTaxableIncome)}
                  onChange={(event) =>
                    updateProfile({ lastYearTaxableIncome: numberFromInput(event.target.value) })
                  }
                />
                <Input
                  label={`${assessmentYear} Projected Taxable Income`}
                  type="number"
                  value={numberInputValue(profileDraft.profile.projectedTaxableIncome)}
                  onChange={(event) =>
                    updateProfile({ projectedTaxableIncome: numberFromInput(event.target.value) })
                  }
                />
                <BooleanSelect
                  label="Life Insurance In Place?"
                  value={profileDraft.profile.lifeInsuranceInPlace}
                  onChange={(next) => updateProfile({ lifeInsuranceInPlace: next })}
                  required
                />
                <BooleanSelect
                  label="Estate Planning In Place?"
                  value={profileDraft.profile.estatePlanningInPlace}
                  onChange={(next) => updateProfile({ estatePlanningInPlace: next })}
                  required
                />
                <Input
                  label="Planning Any Major Purchase This Year? Add Notes"
                  className="md:col-span-2"
                  value={profileDraft.profile.majorPurchaseNotes}
                  onChange={(event) => updateProfile({ majorPurchaseNotes: event.target.value })}
                />
              </div>
            </Card>
            {isMarried ? (
              <Card>
                <h2 className="mb-5 text-xl font-bold text-navy-800">Spouse Details</h2>
                <MemberFields
                  title="Spouse"
                  member={profileDraft.spouse}
                  onChange={(spouse) => setProfileDraft((current) => ({ ...current, spouse }))}
                />
              </Card>
            ) : null}
            <Card>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-xl font-bold text-navy-800">Dependents</h2>
                  <p className="mt-1 text-sm text-slate-600">Add each dependent separately.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setProfileDraft((current) => ({
                      ...current,
                      dependents: [...current.dependents, emptyMember()]
                    }))
                  }
                >
                  <Plus aria-hidden size={16} />
                  Add Dependent
                </Button>
              </div>
              <div className="mt-5 grid gap-4">
                {profileDraft.dependents.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    No dependents added yet.
                  </p>
                ) : null}
                {profileDraft.dependents.map((dependent, index) => (
                  <MemberFields
                    key={dependent.id ?? index}
                    title={`Dependent ${index + 1}`}
                    member={dependent}
                    onChange={(next) =>
                      setProfileDraft((current) => ({
                        ...current,
                        dependents: current.dependents.map((item, itemIndex) =>
                          itemIndex === index ? next : item
                        )
                      }))
                    }
                    onRemove={() =>
                      setProfileDraft((current) => ({
                        ...current,
                        dependents: current.dependents.filter((_, itemIndex) => itemIndex !== index)
                      }))
                    }
                  />
                ))}
              </div>
            </Card>
          </form>
        ) : null}

        {activeTab === "realEstate" ? (
          <form ref={realEstateFormRef} className="grid gap-5" onSubmit={handlePropertiesSave}>
            <Card>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                    Real Estate Intake
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-navy-800">Properties</h2>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={addProperty}>
                    <Plus aria-hidden size={16} />
                    Add Property
                  </Button>
                  <Button type="submit" disabled={saving}>
                    <Save aria-hidden size={16} />
                    Save
                  </Button>
                </div>
              </div>
            </Card>
            <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
              <Card className="self-start">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                      Property List
                    </p>
                    <h3 className="mt-2 text-xl font-bold text-navy-800">
                      {properties.length} Added
                    </h3>
                  </div>
                </div>
                <div className="mt-5 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
                  {properties.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                      No properties added yet. If this does not apply, leave this section empty and
                      save your personal real estate ownership answer as No.
                    </p>
                  ) : null}
                  {properties.map((property, index) => {
                    const active = selectedPropertyIndex === index;
                    return (
                      <button
                        key={property.id ?? index}
                        type="button"
                        onClick={() => setSelectedPropertyIndex(index)}
                        className={cn(
                          "focus-ring flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition",
                          active
                            ? "border-navy-800 bg-navy-800 text-white shadow-card"
                            : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-11 shrink-0 place-items-center rounded-xl",
                            active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800"
                          )}
                        >
                          <Building2 aria-hidden size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">
                            {generatedPropertyLabel(index)}
                          </span>
                          <span
                            className={cn(
                              "mt-1 block truncate text-xs",
                              active ? "text-white/75" : "text-slate-500"
                            )}
                          >
                            {property.fullAddress || property.category || "Add property details"}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden
                          size={18}
                          className={active ? "text-white" : "text-slate-400"}
                        />
                      </button>
                    );
                  })}
                </div>
              </Card>
              {selectedProperty && selectedPropertyIndex !== null ? (
                <Card>
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                        Selected Property
                      </p>
                      <h3 className="mt-2 text-xl font-bold text-navy-800">
                        {generatedPropertyLabel(selectedPropertyIndex)}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="focus-ring grid size-10 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => removeProperty(selectedPropertyIndex)}
                      aria-label={`Remove property ${selectedPropertyIndex + 1}`}
                    >
                      <Trash2 aria-hidden size={16} />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select
                      label="Property Category"
                      value={selectedProperty.category}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          category: event.target.value,
                          propertyType: event.target.value
                        })
                      }
                      required
                    >
                      {portalPropertyCategoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </Select>
                    <Input
                      label="Use During Tax Year"
                      value={selectedProperty.taxYearUse}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, { taxYearUse: event.target.value })
                      }
                      required
                    />
                    <Input
                      label="Full Address"
                      className="md:col-span-2"
                      value={selectedProperty.fullAddress}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, { fullAddress: event.target.value })
                      }
                      required
                    />
                    <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-semibold text-navy-800">Owner(s) & Ownership %</h4>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            updateProperty(selectedPropertyIndex, {
                              owners: [
                                ...selectedProperty.owners,
                                { ownerName: "", ownershipPercentage: 100 }
                              ]
                            })
                          }
                        >
                          <Plus aria-hidden size={15} />
                          Add Owner
                        </Button>
                      </div>
                      <div className="mt-4 grid gap-3">
                        {selectedProperty.owners.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            Add at least one owner if ownership differs from the primary taxpayer.
                          </p>
                        ) : null}
                        {selectedProperty.owners.map((owner, ownerIndex) => (
                          <div
                            key={owner.id ?? ownerIndex}
                            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_44px]"
                          >
                            <Input
                              label="Owner Name"
                              value={owner.ownerName}
                              onChange={(event) =>
                                updateProperty(selectedPropertyIndex, {
                                  owners: selectedProperty.owners.map((item, itemIndex) =>
                                    itemIndex === ownerIndex
                                      ? { ...item, ownerName: event.target.value }
                                      : item
                                  )
                                })
                              }
                              required
                            />
                            <Input
                              label="Ownership %"
                              type="number"
                              value={numberInputValue(owner.ownershipPercentage)}
                              onChange={(event) =>
                                updateProperty(selectedPropertyIndex, {
                                  owners: selectedProperty.owners.map((item, itemIndex) =>
                                    itemIndex === ownerIndex
                                      ? {
                                          ...item,
                                          ownershipPercentage:
                                            numberFromInput(event.target.value) ?? 0
                                        }
                                      : item
                                  )
                                })
                              }
                              required
                            />
                            <button
                              type="button"
                              className="focus-ring mt-7 grid size-11 place-items-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() =>
                                updateProperty(selectedPropertyIndex, {
                                  owners: selectedProperty.owners.filter(
                                    (_, itemIndex) => itemIndex !== ownerIndex
                                  )
                                })
                              }
                              aria-label={`Remove owner ${ownerIndex + 1}`}
                            >
                              <Trash2 aria-hidden size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Input
                      label="Acquired Year"
                      type="number"
                      value={numberInputValue(selectedProperty.acquiredYear)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          acquiredYear:
                            numberFromInput(event.target.value) ?? new Date().getFullYear()
                        })
                      }
                      required
                    />
                    <Select
                      label="Acquired Method"
                      value={selectedProperty.acquiredMethod}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          acquiredMethod: event.target.value
                        })
                      }
                      required
                    >
                      <option value="">Select</option>
                      {optionsWithLegacyValue(
                        acquiredMethodOptions,
                        selectedProperty.acquiredMethod
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                    <Input
                      label="Purchase Price / Basis"
                      type="number"
                      value={numberInputValue(selectedProperty.purchaseBasis)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          purchaseBasis: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Current FMV"
                      type="number"
                      value={numberInputValue(selectedProperty.currentFmv)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          currentFmv: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Land Value"
                      type="number"
                      value={numberInputValue(selectedProperty.landValue)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          landValue: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Mortgage / Loan Balance (If Any)"
                      type="number"
                      value={numberInputValue(selectedProperty.mortgageBalance)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          mortgageBalance: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Monthly Payment"
                      type="number"
                      value={numberInputValue(selectedProperty.monthlyPayment)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          monthlyPayment: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Mortgage Company"
                      value={selectedProperty.mortgageCompany ?? ""}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          mortgageCompany: event.target.value
                        })
                      }
                    />
                    <Input
                      label="Interest Rate"
                      type="number"
                      value={numberInputValue(selectedProperty.interestRate)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          interestRate: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Total Interest Paid Last Year (Refer 1098)"
                      type="number"
                      value={numberInputValue(selectedProperty.priorInterestPaid)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          priorInterestPaid: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Total Property Tax Paid Last Year (Refer 1098)"
                      type="number"
                      value={numberInputValue(selectedProperty.priorTaxPaid)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          priorTaxPaid: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Rental Start Date (If Rented)"
                      type="date"
                      value={selectedProperty.rentalStartDate ?? ""}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          rentalStartDate: event.target.value || null
                        })
                      }
                    />
                    <Input
                      label="Days Rented (If Rented)"
                      type="number"
                      value={numberInputValue(selectedProperty.daysRented)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          daysRented: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Personal Use Days"
                      type="number"
                      value={numberInputValue(selectedProperty.personalUseDays)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          personalUseDays: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Gross Rent / STR Income"
                      type="number"
                      value={numberInputValue(selectedProperty.projectedGrossRent)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          projectedGrossRent: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Total Annual Expenses (Approx Is Fine)"
                      type="number"
                      value={numberInputValue(selectedProperty.totalExpenses)}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, {
                          totalExpenses: numberFromInput(event.target.value)
                        })
                      }
                    />
                    <Input
                      label="Notes / Comments"
                      className="md:col-span-2"
                      value={selectedProperty.notes ?? ""}
                      onChange={(event) =>
                        updateProperty(selectedPropertyIndex, { notes: event.target.value })
                      }
                    />
                  </div>
                </Card>
              ) : (
                <Card className="grid min-h-[260px] place-items-center text-center">
                  <div>
                    <h3 className="text-xl font-bold text-navy-800">Select A Property</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Choose a row from the property list or add a new property to open its detailed
                      intake.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </form>
        ) : null}

        {activeTab === "business" ? (
          <form ref={businessFormRef} className="grid gap-5" onSubmit={handleBusinessSave}>
            <Card>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                    Business And Entity Intake
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-navy-800">Entities</h2>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={addBusiness}>
                    <Plus aria-hidden size={16} />
                    Add Entity
                  </Button>
                  <Button type="submit" disabled={saving}>
                    <Save aria-hidden size={16} />
                    Save
                  </Button>
                </div>
              </div>
            </Card>
            <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
              <Card className="self-start">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                    Entity List
                  </p>
                  <h3 className="mt-2 text-xl font-bold text-navy-800">
                    {businessInvestments.length} Added
                  </h3>
                </div>
                <div className="mt-5 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
                  {businessInvestments.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                      No business or entity records added yet. If this does not apply, leave this
                      section empty and save your business ownership answer as No.
                    </p>
                  ) : null}
                  {businessInvestments.map((business, index) => {
                    const active = selectedBusinessIndex === index;
                    return (
                      <button
                        key={business.id ?? index}
                        type="button"
                        onClick={() => setSelectedBusinessIndex(index)}
                        className={cn(
                          "focus-ring flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition",
                          active
                            ? "border-navy-800 bg-navy-800 text-white shadow-card"
                            : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-11 shrink-0 place-items-center rounded-xl",
                            active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800"
                          )}
                        >
                          <BriefcaseBusiness aria-hidden size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">
                            {business.entityName || `Entity ${index + 1}`}
                          </span>
                          <span
                            className={cn(
                              "mt-1 block truncate text-xs",
                              active ? "text-white/75" : "text-slate-500"
                            )}
                          >
                            {business.entityType || "Entity"} ·{" "}
                            {business.taxClassification || "Tax classification"}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden
                          size={18}
                          className={active ? "text-white" : "text-slate-400"}
                        />
                      </button>
                    );
                  })}
                </div>
              </Card>
              {selectedBusiness && selectedBusinessIndex !== null ? (
                <Card>
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
                        Selected Entity
                      </p>
                      <h3 className="mt-2 text-xl font-bold text-navy-800">
                        {selectedBusiness.entityName || `Entity ${selectedBusinessIndex + 1}`}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="focus-ring grid size-10 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => removeBusiness(selectedBusinessIndex)}
                      aria-label={`Remove entity ${selectedBusinessIndex + 1}`}
                    >
                      <Trash2 aria-hidden size={16} />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input
                      label="Entity Name"
                      value={selectedBusiness.entityName}
                      onChange={(event) =>
                        updateBusiness(selectedBusinessIndex, { entityName: event.target.value })
                      }
                      required
                    />
                    <Select
                      label="Entity Type"
                      value={selectedBusiness.entityType}
                      onChange={(event) =>
                        updateBusiness(selectedBusinessIndex, { entityType: event.target.value })
                      }
                      required
                    >
                      <option value="">Select</option>
                      {optionsWithLegacyValue(entityTypeOptions, selectedBusiness.entityType).map(
                        (option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        )
                      )}
                    </Select>
                    <Input
                      label="Ownership %"
                      type="number"
                      value={numberInputValue(selectedBusiness.ownershipPercent)}
                      onChange={(event) =>
                        updateBusiness(selectedBusinessIndex, {
                          ownershipPercent: numberFromInput(event.target.value) ?? 0
                        })
                      }
                      required
                    />
                    <Select
                      label="Tax Classification"
                      value={selectedBusiness.taxClassification}
                      onChange={(event) =>
                        updateBusiness(selectedBusinessIndex, {
                          taxClassification: event.target.value
                        })
                      }
                      required
                    >
                      <option value="">Select</option>
                      {optionsWithLegacyValue(
                        taxClassificationOptions,
                        selectedBusiness.taxClassification
                      ).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                    <BooleanSelect
                      label="Active?"
                      value={selectedBusiness.active}
                      onChange={(next) => updateBusiness(selectedBusinessIndex, { active: next })}
                      required
                    />
                    <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="font-semibold text-navy-800">Income / Loss History</h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Enter losses as negative numbers. Years update automatically from the
                        assessment year.
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <Input
                          label={`${incomeHistoryYears[0]} Income / Loss`}
                          type="number"
                          value={numberInputValue(
                            selectedBusiness.incomeLossYearMinus3 ??
                              selectedBusiness.priorYearIncomeLoss
                          )}
                          onChange={(event) =>
                            updateBusiness(selectedBusinessIndex, {
                              incomeLossYearMinus3: numberFromInput(event.target.value),
                              priorYearIncomeLoss: numberFromInput(event.target.value),
                              priorYear: incomeHistoryYears[0]
                            })
                          }
                        />
                        <Input
                          label={`${incomeHistoryYears[1]} Income / Loss`}
                          type="number"
                          value={numberInputValue(selectedBusiness.incomeLossYearMinus2)}
                          onChange={(event) =>
                            updateBusiness(selectedBusinessIndex, {
                              incomeLossYearMinus2: numberFromInput(event.target.value)
                            })
                          }
                        />
                        <Input
                          label={`${incomeHistoryYears[2]} Income / Loss`}
                          type="number"
                          value={numberInputValue(selectedBusiness.incomeLossYearMinus1)}
                          onChange={(event) =>
                            updateBusiness(selectedBusinessIndex, {
                              incomeLossYearMinus1: numberFromInput(event.target.value)
                            })
                          }
                        />
                        <Input
                          label={`${assessmentYear} Projected Income / Loss`}
                          type="number"
                          value={numberInputValue(selectedBusiness.projectedCurrentYearIncomeLoss)}
                          onChange={(event) =>
                            updateBusiness(selectedBusinessIndex, {
                              projectedCurrentYearIncomeLoss: numberFromInput(event.target.value)
                            })
                          }
                        />
                      </div>
                    </div>
                    <Input
                      label="Additional Notes / Comments"
                      className="md:col-span-2"
                      value={selectedBusiness.notes ?? ""}
                      onChange={(event) =>
                        updateBusiness(selectedBusinessIndex, { notes: event.target.value })
                      }
                    />
                  </div>
                </Card>
              ) : (
                <Card className="grid min-h-[260px] place-items-center text-center">
                  <div>
                    <h3 className="text-xl font-bold text-navy-800">Select An Entity</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Choose a row from the entity list or add a new entity to open its detailed
                      intake.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </form>
        ) : null}

        {activeTab === "documents" ? (
          <PortalDocumentsClient embedded onDocumentsChanged={handleDocumentsChanged} />
        ) : null}
      </div>

      {readyConfirmationOpen ? (
        <div
          className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-navy-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !readySubmitting)
              setReadyConfirmationOpen(false);
          }}
        >
          <section
            className="my-6 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ready-review-title"
            aria-describedby="ready-review-description"
          >
            <StatusBadge status="active">Final confirmation</StatusBadge>
            <h2 id="ready-review-title" className="mt-4 text-2xl font-bold text-navy-800">
              Submit this assessment for review?
            </h2>
            <p id="ready-review-description" className="mt-3 text-sm leading-6 text-slate-600">
              Submit your saved Personal and Family Information and all uploaded documents to
              Savians for review.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                autoFocus
                onClick={() => setReadyConfirmationOpen(false)}
                disabled={readySubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setReadyConfirmationOpen(false);
                  void handleReadyForReview();
                }}
                disabled={readySubmitting}
              >
                <Send aria-hidden size={16} />
                Submit
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
