"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, CheckCircle2, ChevronRight, FileUp, LogOut, Plus, Save, Send, Trash2, UserRound } from "lucide-react";
import {
  AssessmentApiError,
  loadPortalDashboard,
  markAssessmentReadyForReview,
  savePortalBusinessInvestments,
  savePortalProfile,
  savePortalProperties,
  type MaritalStatus,
  type PortalBusinessInvestment,
  type PortalDashboardResponse,
  type PortalHouseholdMember,
  type PortalProfilePayload,
  type PortalProperty,
  type PreferredContact,
  type ResidentStatus,
  type SavePortalProfileRequest
} from "@/services/assessment-api";
import { clearStoredPortalAccessToken, getCurrentPortalAccessToken, signInToPortal, signOutFromPortal } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, Select, StatusBadge, cn } from "@/components/ui";
import { PortalDocumentsClient } from "@/components/portal-documents-client";

type DashboardTab = "personal" | "realEstate" | "business" | "documents";

const tabs: Array<{ id: DashboardTab; label: string; helper: string; icon: typeof UserRound }> = [
  { id: "personal", label: "Personal And Family Information", helper: "Household, spouse, and dependent details.", icon: UserRound },
  { id: "realEstate", label: "Real Estate Intake", helper: "Owned, rental, and investment properties.", icon: Building2 },
  { id: "business", label: "Business And Entity Intake", helper: "LLCs, S-Corps, partnerships, and other entities.", icon: BriefcaseBusiness },
  { id: "documents", label: "Document Upload Requirements", helper: "Secure document folders and upload history.", icon: FileUp }
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

interface ProfileDraft {
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
  category: "PRIMARY_HOME",
  propertyType: "Residential",
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
    <Select label={label} value={booleanSelectValue(value)} onChange={(event) => onChange(booleanFromSelect(event.target.value))} required={required}>
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
          <button className="focus-ring grid size-9 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50" type="button" onClick={onRemove} aria-label={`Remove ${title}`}>
            <Trash2 aria-hidden size={15} />
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="First Name" value={member.firstName} onChange={(event) => onChange({ ...member, firstName: event.target.value })} required />
        <Input label="Last Name" value={member.lastName} onChange={(event) => onChange({ ...member, lastName: event.target.value })} required />
        <Input label="Date Of Birth" type="date" value={member.dateOfBirth} onChange={(event) => onChange({ ...member, dateOfBirth: event.target.value })} required />
        <Select label="Resident Status" value={member.residentStatus} onChange={(event) => onChange({ ...member, residentStatus: event.target.value as ResidentStatus | "" })} required>
          <option value="">Select</option>
          {Object.entries(residentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Input label="Sex / Gender Marker" value={member.sex} onChange={(event) => onChange({ ...member, sex: event.target.value })} required />
        <BooleanSelect label="Full-Time Student?" value={member.fullTimeStudent} onChange={(next) => onChange({ ...member, fullTimeStudent: next })} required />
        <BooleanSelect label="Lives With Taxpayer?" value={member.livesWithTaxpayer} onChange={(next) => onChange({ ...member, livesWithTaxpayer: next })} required />
      </div>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  const status = label === "Ready for Review" ? "complete" : label === "Payment Pending" ? "pending" : "active";
  return <StatusBadge status={status}>{label}</StatusBadge>;
}

export function PortalDashboardClient({ initialEmail = "" }: { initialEmail?: string }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("personal");
  const [accessToken, setAccessToken] = useState("");
  const [dashboard, setDashboard] = useState<PortalDashboardResponse | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [properties, setProperties] = useState<PortalProperty[]>([]);
  const [businessInvestments, setBusinessInvestments] = useState<PortalBusinessInvestment[]>([]);
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState<number | null>(null);
  const [selectedBusinessIndex, setSelectedBusinessIndex] = useState<number | null>(null);
  const [loginEmail, setLoginEmail] = useState(initialEmail.trim().toLowerCase());
  const [loginPassword, setLoginPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readySubmitting, setReadySubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);

  const clientName = dashboard ? fullName(dashboard.primaryTaxpayer) : "Client";
  const assessmentYear = dashboard?.assessmentYear ?? new Date().getFullYear();
  const incomeHistoryYears = [assessmentYear - 3, assessmentYear - 2, assessmentYear - 1];
  const isMarried = profileDraft.profile.maritalStatus === "MARRIED";
  const canMarkReady = dashboard?.assessmentStatus.label !== "Ready for Review";
  const selectedProperty = selectedPropertyIndex === null ? null : properties[selectedPropertyIndex] ?? null;
  const selectedBusiness = selectedBusinessIndex === null ? null : businessInvestments[selectedBusinessIndex] ?? null;

  const syncDashboard = useCallback((response: PortalDashboardResponse) => {
    setDashboard(response);
    setProfileDraft(draftFromDashboard(response));
    setProperties(response.properties);
    setBusinessInvestments(response.businessInvestments);
    setSelectedPropertyIndex((current) => response.properties.length === 0 ? null : Math.min(current ?? 0, response.properties.length - 1));
    setSelectedBusinessIndex((current) => response.businessInvestments.length === 0 ? null : Math.min(current ?? 0, response.businessInvestments.length - 1));
  }, []);

  const loadDashboard = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    setIssues([]);
    try {
      const response = await loadPortalDashboard(token);
      syncDashboard(response);
      setAccessToken(token);
    } catch (caught) {
      clearStoredPortalAccessToken();
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [syncDashboard]);

  useEffect(() => {
    getCurrentPortalAccessToken().then((token) => {
      if (token) void loadDashboard(token);
      else {
        setMessage("Sign in with the Savians account created after payment to open your dashboard.");
        setLoading(false);
      }
    });
  }, [loadDashboard]);

  const tabCompletion = useMemo(() => ({
    personal: dashboard?.completion.status === "COMPLETE",
    realEstate: properties.length > 0 || profileDraft.profile.ownsRealEstate === false,
    business: businessInvestments.length > 0 || profileDraft.profile.ownsBusiness === false,
    documents: (dashboard?.documentSummary.uploadedCount ?? 0) > 0
  }), [businessInvestments.length, dashboard?.completion.status, dashboard?.documentSummary.uploadedCount, profileDraft.profile.ownsBusiness, profileDraft.profile.ownsRealEstate, properties.length]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const session = await signInToPortal({ email: loginEmail, password: loginPassword });
      await loadDashboard(session.accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not sign you in.");
      setLoading(false);
    }
  }

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      await savePortalProfile(accessToken, buildSaveRequest(profileDraft));
      const response = await loadPortalDashboard(accessToken);
      syncDashboard(response);
      setMessage("Personal and family information saved.");
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Personal and Family Information.");
      setIssues(apiError.issues ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function handlePropertiesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      syncDashboard(await savePortalProperties(accessToken, properties));
      setMessage("Real Estate Intake saved.");
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Real Estate Intake.");
      setIssues(apiError.issues ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function handleBusinessSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      syncDashboard(await savePortalBusinessInvestments(accessToken, businessInvestments));
      setMessage("Business and Entity Intake saved.");
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save Business and Entity Intake.");
      setIssues(apiError.issues ?? []);
    } finally {
      setSaving(false);
    }
  }

  async function handleReadyForReview() {
    setReadySubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await markAssessmentReadyForReview(accessToken);
      syncDashboard(await loadPortalDashboard(accessToken));
      setMessage(`Assessment marked Ready for Review. Notification email status: ${result.emailStatus}.`);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not mark this assessment ready for review.");
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
    setLoginPassword("");
    setError(null);
    setIssues([]);
    setMessage("You have been signed out.");
  }

  const updateProfile = (next: Partial<PortalProfilePayload>) => setProfileDraft((current) => ({ ...current, profile: { ...current.profile, ...next } }));
  const updateProperty = (index: number, next: Partial<PortalProperty>) =>
    setProperties((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  const updateBusiness = (index: number, next: Partial<PortalBusinessInvestment>) =>
    setBusinessInvestments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));

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
          <p className="mt-3 text-slate-600">Use the email and password created after payment verification.</p>
          {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}
          {message ? <p className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">{message}</p> : null}
          <form className="mt-6 grid gap-4" onSubmit={handleSignIn}>
            <Input label="Email" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
            <Input label="Password" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
            <Button type="submit">Sign In & Open Dashboard</Button>
            <Link className="text-center text-sm font-semibold text-navy-700 underline underline-offset-4" href={`/assessment/forgot-password?email=${encodeURIComponent(loginEmail)}`}>
              Forgot Password?
            </Link>
          </form>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto min-h-[75vh] w-full max-w-[1500px] px-5 py-10 sm:px-8">
      {(saving || readySubmitting) && <LoadingOverlay label={readySubmitting ? "Marking ready for review" : "Saving intake"} />}
      <Card className="overflow-hidden bg-gradient-to-r from-white via-white to-navy-50/80 p-0">
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <StatusBadge status="active">Client Dashboard</StatusBadge>
            <h1 className="mt-3 text-3xl font-bold text-navy-800">{clientName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {dashboard.assessmentYear} assessment · {dashboard.primaryTaxpayer.email} · {dashboard.primaryTaxpayer.phone}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill label={dashboard.assessmentStatus.label} />
              <Button type="button" onClick={handleReadyForReview} disabled={readySubmitting || !canMarkReady}>
                <Send aria-hidden size={16} />
                {dashboard.assessmentStatus.label === "Ready for Review" ? "Ready For Review" : "Mark The Assessment Ready For Review"}
              </Button>
              <Button type="button" variant="outline" onClick={handleSignOut} disabled={saving || readySubmitting}>
                <LogOut aria-hidden size={16} />
                Logout
              </Button>
            </div>
            {dashboard.assessmentStatus.label !== "Ready for Review" ? (
              <p className="max-w-md text-left text-xs leading-5 text-slate-500 sm:text-right">
                Once you&apos;re done uploading all required documents, click <span className="font-semibold text-navy-800">Mark The Assessment Ready For Review</span>.
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
                {issues.map((issue) => <li key={`${issue.path}-${issue.message}`}>{issue.path}: {issue.message}</li>)}
              </ul>
            ) : null}
          </ErrorAlert>
        ) : null}
        {message ? <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 aria-hidden size={18} />{message}</div> : null}
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Assessment Intake</p>
            <h2 className="mt-2 text-xl font-bold text-navy-800">Sections</h2>
          </div>
          <p className="text-sm text-slate-500">Switch between sections and save each intake area as you complete it.</p>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} className={cn("focus-ring flex min-h-28 w-full items-start gap-3 rounded-2xl border p-4 text-left transition", active ? "border-navy-800 bg-navy-800 text-white shadow-card" : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50")} type="button" onClick={() => setActiveTab(tab.id)}>
                <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800")}><Icon aria-hidden size={22} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{tab.label}</span>
                  <span className={cn("mt-2 block text-xs leading-5", active ? "text-white/75" : "text-slate-500")}>{tab.helper}</span>
                </span>
                {tabCompletion[tab.id] ? <CheckCircle2 aria-hidden className={active ? "text-emerald-200" : "text-emerald-600"} size={18} /> : null}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="mt-6 min-w-0">
          {activeTab === "personal" ? (
            <form className="grid gap-6" onSubmit={handleProfileSave}>
              <Card>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Personal And Family Information</p>
                  </div>
                  <Button type="submit" disabled={saving}><Save aria-hidden size={16} />Save</Button>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <Input label="Full Name" value={clientName} disabled className="bg-slate-50" />
                  <Input label="Date Of Birth" type="date" value={dashboard.primaryTaxpayer.dateOfBirth} disabled className="bg-slate-50" />
                  <Input label="Email" type="email" value={dashboard.primaryTaxpayer.email} disabled className="bg-slate-50" />
                  <Input label="Phone" value={dashboard.primaryTaxpayer.phone} disabled className="bg-slate-50" />
                  <Select label="Preferred Contact" value={profileDraft.profile.preferredContact} onChange={(event) => updateProfile({ preferredContact: event.target.value as PreferredContact | "" })} required>
                    <option value="">Select</option><option value="EMAIL">Email</option><option value="PHONE">Phone</option><option value="EITHER">Either</option>
                  </Select>
                  <Input label="Home Address" value={profileDraft.profile.homeAddress} onChange={(event) => updateProfile({ homeAddress: event.target.value })} required />
                  <Input label="City" value={profileDraft.profile.city} onChange={(event) => updateProfile({ city: event.target.value })} required />
                  <Input label="State" maxLength={2} value={profileDraft.profile.state} onChange={(event) => updateProfile({ state: event.target.value.toUpperCase() })} required />
                  <Input label="ZIP Code" value={profileDraft.profile.zip} onChange={(event) => updateProfile({ zip: event.target.value })} required />
                  <BooleanSelect label="Homeowner?" value={profileDraft.profile.homeowner} onChange={(next) => updateProfile({ homeowner: next })} required />
                  <Select label="Marital Status" value={profileDraft.profile.maritalStatus} onChange={(event) => updateProfile({ maritalStatus: event.target.value as MaritalStatus | "" })} required>
                    <option value="">Select</option>{Object.entries(maritalStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                  <Select label="Primary Resident Status" value={profileDraft.profile.residentStatus} onChange={(event) => updateProfile({ residentStatus: event.target.value as ResidentStatus | "" })} required>
                    <option value="">Select</option>{Object.entries(residentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                  <BooleanSelect label="Own Real Estate?" value={profileDraft.profile.ownsRealEstate} onChange={(next) => updateProfile({ ownsRealEstate: next })} required />
                  <BooleanSelect label="Own A Business?" value={profileDraft.profile.ownsBusiness} onChange={(next) => updateProfile({ ownsBusiness: next })} required />
                  <Input label={`${assessmentYear - 1} Taxable Income`} type="number" value={numberInputValue(profileDraft.profile.lastYearTaxableIncome)} onChange={(event) => updateProfile({ lastYearTaxableIncome: numberFromInput(event.target.value) })} />
                  <Input label={`${assessmentYear} Projected Taxable Income`} type="number" value={numberInputValue(profileDraft.profile.projectedTaxableIncome)} onChange={(event) => updateProfile({ projectedTaxableIncome: numberFromInput(event.target.value) })} />
                  <BooleanSelect label="Life Insurance In Place?" value={profileDraft.profile.lifeInsuranceInPlace} onChange={(next) => updateProfile({ lifeInsuranceInPlace: next })} required />
                  <BooleanSelect label="Estate Planning In Place?" value={profileDraft.profile.estatePlanningInPlace} onChange={(next) => updateProfile({ estatePlanningInPlace: next })} required />
                  <Input label="Planning Any Major Purchase This Year? Add Notes" className="md:col-span-2" value={profileDraft.profile.majorPurchaseNotes} onChange={(event) => updateProfile({ majorPurchaseNotes: event.target.value })} />
                </div>
              </Card>
              {isMarried ? <Card><h2 className="mb-5 text-xl font-bold text-navy-800">Spouse Details</h2><MemberFields title="Spouse" member={profileDraft.spouse} onChange={(spouse) => setProfileDraft((current) => ({ ...current, spouse }))} /></Card> : null}
              <Card>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><h2 className="text-xl font-bold text-navy-800">Dependents</h2><p className="mt-1 text-sm text-slate-600">Add each dependent separately.</p></div>
                  <Button type="button" variant="outline" onClick={() => setProfileDraft((current) => ({ ...current, dependents: [...current.dependents, emptyMember()] }))}><Plus aria-hidden size={16} />Add Dependent</Button>
                </div>
                <div className="mt-5 grid gap-4">
                  {profileDraft.dependents.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No dependents added yet.</p> : null}
                  {profileDraft.dependents.map((dependent, index) => (
                    <MemberFields key={dependent.id ?? index} title={`Dependent ${index + 1}`} member={dependent} onChange={(next) => setProfileDraft((current) => ({ ...current, dependents: current.dependents.map((item, itemIndex) => itemIndex === index ? next : item) }))} onRemove={() => setProfileDraft((current) => ({ ...current, dependents: current.dependents.filter((_, itemIndex) => itemIndex !== index) }))} />
                  ))}
                </div>
              </Card>
            </form>
          ) : null}

          {activeTab === "realEstate" ? (
            <form className="grid gap-5" onSubmit={handlePropertiesSave}>
              <Card>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Real Estate Intake</p><h2 className="mt-2 text-2xl font-bold text-navy-800">Properties</h2></div>
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={addProperty}><Plus aria-hidden size={16} />Add Property</Button><Button type="submit" disabled={saving}><Save aria-hidden size={16} />Save</Button></div>
                </div>
              </Card>
              <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                <Card className="self-start">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Property List</p>
                      <h3 className="mt-2 text-xl font-bold text-navy-800">{properties.length} Added</h3>
                    </div>
                  </div>
                  <div className="mt-5 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
                    {properties.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No properties added yet. If this does not apply, leave this section empty and save your personal real estate ownership answer as No.</p> : null}
                    {properties.map((property, index) => {
                      const active = selectedPropertyIndex === index;
                      return (
                        <button key={property.id ?? index} type="button" onClick={() => setSelectedPropertyIndex(index)} className={cn("focus-ring flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition", active ? "border-navy-800 bg-navy-800 text-white shadow-card" : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50")}>
                          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800")}><Building2 aria-hidden size={20} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{property.label || `Property ${index + 1}`}</span>
                            <span className={cn("mt-1 block truncate text-xs", active ? "text-white/75" : "text-slate-500")}>{property.fullAddress || property.category || "Add property details"}</span>
                          </span>
                          <ChevronRight aria-hidden size={18} className={active ? "text-white" : "text-slate-400"} />
                        </button>
                      );
                    })}
                  </div>
                </Card>
                {selectedProperty && selectedPropertyIndex !== null ? (
                  <Card>
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Selected Property</p><h3 className="mt-2 text-xl font-bold text-navy-800">{selectedProperty.label || `Property ${selectedPropertyIndex + 1}`}</h3></div>
                      <button type="button" className="focus-ring grid size-10 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50" onClick={() => removeProperty(selectedPropertyIndex)} aria-label={`Remove property ${selectedPropertyIndex + 1}`}><Trash2 aria-hidden size={16} /></button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Property ID / Label" value={selectedProperty.label} onChange={(event) => updateProperty(selectedPropertyIndex, { label: event.target.value })} required />
                      <Input label="Property Category" value={selectedProperty.category} onChange={(event) => updateProperty(selectedPropertyIndex, { category: event.target.value })} required />
                      <Input label="Use During Tax Year" value={selectedProperty.taxYearUse} onChange={(event) => updateProperty(selectedPropertyIndex, { taxYearUse: event.target.value })} required />
                      <Input label="Property Type" value={selectedProperty.propertyType} onChange={(event) => updateProperty(selectedPropertyIndex, { propertyType: event.target.value })} required />
                      <Input label="Full Address" className="md:col-span-2" value={selectedProperty.fullAddress} onChange={(event) => updateProperty(selectedPropertyIndex, { fullAddress: event.target.value })} required />
                      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="font-semibold text-navy-800">Owner(s) & Ownership %</h4>
                          <Button type="button" variant="outline" onClick={() => updateProperty(selectedPropertyIndex, { owners: [...selectedProperty.owners, { ownerName: "", ownershipPercentage: 100 }] })}><Plus aria-hidden size={15} />Add Owner</Button>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {selectedProperty.owners.length === 0 ? <p className="text-sm text-slate-500">Add at least one owner if ownership differs from the primary taxpayer.</p> : null}
                          {selectedProperty.owners.map((owner, ownerIndex) => (
                            <div key={owner.id ?? ownerIndex} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_44px]">
                              <Input label="Owner Name" value={owner.ownerName} onChange={(event) => updateProperty(selectedPropertyIndex, { owners: selectedProperty.owners.map((item, itemIndex) => itemIndex === ownerIndex ? { ...item, ownerName: event.target.value } : item) })} required />
                              <Input label="Ownership %" type="number" value={numberInputValue(owner.ownershipPercentage)} onChange={(event) => updateProperty(selectedPropertyIndex, { owners: selectedProperty.owners.map((item, itemIndex) => itemIndex === ownerIndex ? { ...item, ownershipPercentage: numberFromInput(event.target.value) ?? 0 } : item) })} required />
                              <button type="button" className="focus-ring mt-7 grid size-11 place-items-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50" onClick={() => updateProperty(selectedPropertyIndex, { owners: selectedProperty.owners.filter((_, itemIndex) => itemIndex !== ownerIndex) })} aria-label={`Remove owner ${ownerIndex + 1}`}><Trash2 aria-hidden size={15} /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <Input label="Acquired Year" type="number" value={numberInputValue(selectedProperty.acquiredYear)} onChange={(event) => updateProperty(selectedPropertyIndex, { acquiredYear: numberFromInput(event.target.value) ?? new Date().getFullYear() })} required />
                      <Input label="Acquired Method" value={selectedProperty.acquiredMethod} onChange={(event) => updateProperty(selectedPropertyIndex, { acquiredMethod: event.target.value })} required />
                      <Input label="Purchase Price / Basis" type="number" value={numberInputValue(selectedProperty.purchaseBasis)} onChange={(event) => updateProperty(selectedPropertyIndex, { purchaseBasis: numberFromInput(event.target.value) })} />
                      <Input label="Current FMV" type="number" value={numberInputValue(selectedProperty.currentFmv)} onChange={(event) => updateProperty(selectedPropertyIndex, { currentFmv: numberFromInput(event.target.value) })} />
                      <Input label="Land Value" type="number" value={numberInputValue(selectedProperty.landValue)} onChange={(event) => updateProperty(selectedPropertyIndex, { landValue: numberFromInput(event.target.value) })} />
                      <Input label="Mortgage / Loan Balance (If Any)" type="number" value={numberInputValue(selectedProperty.mortgageBalance)} onChange={(event) => updateProperty(selectedPropertyIndex, { mortgageBalance: numberFromInput(event.target.value) })} />
                      <Input label="Monthly Payment" type="number" value={numberInputValue(selectedProperty.monthlyPayment)} onChange={(event) => updateProperty(selectedPropertyIndex, { monthlyPayment: numberFromInput(event.target.value) })} />
                      <Input label="Mortgage Company" value={selectedProperty.mortgageCompany ?? ""} onChange={(event) => updateProperty(selectedPropertyIndex, { mortgageCompany: event.target.value })} />
                      <Input label="Interest Rate" type="number" value={numberInputValue(selectedProperty.interestRate)} onChange={(event) => updateProperty(selectedPropertyIndex, { interestRate: numberFromInput(event.target.value) })} />
                      <Input label="Total Interest Paid Last Year (Refer 1098)" type="number" value={numberInputValue(selectedProperty.priorInterestPaid)} onChange={(event) => updateProperty(selectedPropertyIndex, { priorInterestPaid: numberFromInput(event.target.value) })} />
                      <Input label="Total Property Tax Paid Last Year (Refer 1098)" type="number" value={numberInputValue(selectedProperty.priorTaxPaid)} onChange={(event) => updateProperty(selectedPropertyIndex, { priorTaxPaid: numberFromInput(event.target.value) })} />
                      <Input label="Rental Start Date (If Rented)" type="date" value={selectedProperty.rentalStartDate ?? ""} onChange={(event) => updateProperty(selectedPropertyIndex, { rentalStartDate: event.target.value || null })} />
                      <Input label="Days Rented (If Rented)" type="number" value={numberInputValue(selectedProperty.daysRented)} onChange={(event) => updateProperty(selectedPropertyIndex, { daysRented: numberFromInput(event.target.value) })} />
                      <Input label="Personal Use Days" type="number" value={numberInputValue(selectedProperty.personalUseDays)} onChange={(event) => updateProperty(selectedPropertyIndex, { personalUseDays: numberFromInput(event.target.value) })} />
                      <Input label="Gross Rent / STR Income" type="number" value={numberInputValue(selectedProperty.projectedGrossRent)} onChange={(event) => updateProperty(selectedPropertyIndex, { projectedGrossRent: numberFromInput(event.target.value) })} />
                      <Input label="Total Annual Expenses (Approx Is Fine)" type="number" value={numberInputValue(selectedProperty.totalExpenses)} onChange={(event) => updateProperty(selectedPropertyIndex, { totalExpenses: numberFromInput(event.target.value) })} />
                      <Input label="Notes / Comments" className="md:col-span-2" value={selectedProperty.notes ?? ""} onChange={(event) => updateProperty(selectedPropertyIndex, { notes: event.target.value })} />
                    </div>
                  </Card>
                ) : (
                  <Card className="grid min-h-[260px] place-items-center text-center">
                    <div><h3 className="text-xl font-bold text-navy-800">Select A Property</h3><p className="mt-2 text-sm text-slate-600">Choose a row from the property list or add a new property to open its detailed intake.</p></div>
                  </Card>
                )}
              </div>
            </form>
          ) : null}

          {activeTab === "business" ? (
            <form className="grid gap-5" onSubmit={handleBusinessSave}>
              <Card>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Business And Entity Intake</p><h2 className="mt-2 text-2xl font-bold text-navy-800">Entities</h2></div>
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={addBusiness}><Plus aria-hidden size={16} />Add Entity</Button><Button type="submit" disabled={saving}><Save aria-hidden size={16} />Save</Button></div>
                </div>
              </Card>
              <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                <Card className="self-start">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Entity List</p>
                    <h3 className="mt-2 text-xl font-bold text-navy-800">{businessInvestments.length} Added</h3>
                  </div>
                  <div className="mt-5 grid max-h-[560px] gap-3 overflow-y-auto pr-1">
                    {businessInvestments.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No business or entity records added yet. If this does not apply, leave this section empty and save your business ownership answer as No.</p> : null}
                    {businessInvestments.map((business, index) => {
                      const active = selectedBusinessIndex === index;
                      return (
                        <button key={business.id ?? index} type="button" onClick={() => setSelectedBusinessIndex(index)} className={cn("focus-ring flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition", active ? "border-navy-800 bg-navy-800 text-white shadow-card" : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50")}>
                          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", active ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800")}><BriefcaseBusiness aria-hidden size={20} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{business.entityName || `Entity ${index + 1}`}</span>
                            <span className={cn("mt-1 block truncate text-xs", active ? "text-white/75" : "text-slate-500")}>{business.entityType || "Entity"} · {business.taxClassification || "Tax classification"}</span>
                          </span>
                          <ChevronRight aria-hidden size={18} className={active ? "text-white" : "text-slate-400"} />
                        </button>
                      );
                    })}
                  </div>
                </Card>
                {selectedBusiness && selectedBusinessIndex !== null ? (
                  <Card>
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Selected Entity</p><h3 className="mt-2 text-xl font-bold text-navy-800">{selectedBusiness.entityName || `Entity ${selectedBusinessIndex + 1}`}</h3></div>
                      <button type="button" className="focus-ring grid size-10 place-items-center rounded-full border border-red-200 text-red-700 hover:bg-red-50" onClick={() => removeBusiness(selectedBusinessIndex)} aria-label={`Remove entity ${selectedBusinessIndex + 1}`}><Trash2 aria-hidden size={16} /></button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Entity Name" value={selectedBusiness.entityName} onChange={(event) => updateBusiness(selectedBusinessIndex, { entityName: event.target.value })} required />
                      <Input label="Entity Type" value={selectedBusiness.entityType} onChange={(event) => updateBusiness(selectedBusinessIndex, { entityType: event.target.value })} required />
                      <Input label="Ownership %" type="number" value={numberInputValue(selectedBusiness.ownershipPercent)} onChange={(event) => updateBusiness(selectedBusinessIndex, { ownershipPercent: numberFromInput(event.target.value) ?? 0 })} required />
                      <Input label="Tax Classification" value={selectedBusiness.taxClassification} onChange={(event) => updateBusiness(selectedBusinessIndex, { taxClassification: event.target.value })} required />
                      <BooleanSelect label="Active?" value={selectedBusiness.active} onChange={(next) => updateBusiness(selectedBusinessIndex, { active: next })} required />
                      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <h4 className="font-semibold text-navy-800">Income / Loss History</h4>
                        <p className="mt-1 text-sm text-slate-500">Enter losses as negative numbers. Years update automatically from the assessment year.</p>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <Input label={`${incomeHistoryYears[0]} Income / Loss`} type="number" value={numberInputValue(selectedBusiness.incomeLossYearMinus3 ?? selectedBusiness.priorYearIncomeLoss)} onChange={(event) => updateBusiness(selectedBusinessIndex, { incomeLossYearMinus3: numberFromInput(event.target.value), priorYearIncomeLoss: numberFromInput(event.target.value), priorYear: incomeHistoryYears[0] })} />
                          <Input label={`${incomeHistoryYears[1]} Income / Loss`} type="number" value={numberInputValue(selectedBusiness.incomeLossYearMinus2)} onChange={(event) => updateBusiness(selectedBusinessIndex, { incomeLossYearMinus2: numberFromInput(event.target.value) })} />
                          <Input label={`${incomeHistoryYears[2]} Income / Loss`} type="number" value={numberInputValue(selectedBusiness.incomeLossYearMinus1)} onChange={(event) => updateBusiness(selectedBusinessIndex, { incomeLossYearMinus1: numberFromInput(event.target.value) })} />
                          <Input label={`${assessmentYear} Projected Income / Loss`} type="number" value={numberInputValue(selectedBusiness.projectedCurrentYearIncomeLoss)} onChange={(event) => updateBusiness(selectedBusinessIndex, { projectedCurrentYearIncomeLoss: numberFromInput(event.target.value) })} />
                        </div>
                      </div>
                      <Input label="Additional Notes / Comments" className="md:col-span-2" value={selectedBusiness.notes ?? ""} onChange={(event) => updateBusiness(selectedBusinessIndex, { notes: event.target.value })} />
                    </div>
                  </Card>
                ) : (
                  <Card className="grid min-h-[260px] place-items-center text-center">
                    <div><h3 className="text-xl font-bold text-navy-800">Select An Entity</h3><p className="mt-2 text-sm text-slate-600">Choose a row from the entity list or add a new entity to open its detailed intake.</p></div>
                  </Card>
                )}
              </div>
            </form>
          ) : null}

          {activeTab === "documents" ? <PortalDocumentsClient embedded /> : null}
      </div>
    </section>
  );
}
