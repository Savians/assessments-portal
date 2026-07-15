"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  AssessmentApiError,
  loadPortalProfile,
  savePortalProfile,
  type MaritalStatus,
  type PortalHouseholdMember,
  type PortalProfilePayload,
  type PortalProfileResponse,
  type PreferredContact,
  type ResidentStatus,
  type SavePortalProfileRequest
} from "@/services/assessment-api";
import { clearStoredPortalAccessToken, getStoredPortalAccessToken, signInToPortal } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, Select, StatusBadge, Stepper } from "@/components/ui";

const draftStorageKey = "saviansAssessmentProfileDraft";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;
const residentStatusLabels: Record<ResidentStatus, string> = {
  US_CITIZEN: "U.S. citizen",
  GREEN_CARD_HOLDER: "Green card holder",
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

const emptyProfile = (): ProfileDraft => ({
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

function draftFromResponse(response: PortalProfileResponse): ProfileDraft {
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

function ageFromDate(dateOfBirth: string) {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
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

function fullName(person: { firstName: string; middleName?: string; lastName: string }) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
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
  onRemove,
  removable = false
}: {
  title: string;
  member: PortalHouseholdMember;
  onChange: (next: PortalHouseholdMember) => void;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const age = ageFromDate(member.dateOfBirth);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-navy-800">{title}</h3>
          {age !== null ? <p className="text-sm text-slate-600">Derived age: {age}</p> : null}
        </div>
        {removable && onRemove ? (
          <Button type="button" variant="outline" className="min-h-9 px-3" onClick={onRemove}>
            <Trash2 aria-hidden size={16} />
            Remove
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="First name" value={member.firstName} onChange={(event) => onChange({ ...member, firstName: event.target.value })} required />
        <Input label="Last name" value={member.lastName} onChange={(event) => onChange({ ...member, lastName: event.target.value })} required />
        <Input label="Date of birth" type="date" value={member.dateOfBirth} onChange={(event) => onChange({ ...member, dateOfBirth: event.target.value })} required />
        <Select label="Resident status" value={member.residentStatus} onChange={(event) => onChange({ ...member, residentStatus: event.target.value as ResidentStatus | "" })} required>
          <option value="">Select</option>
          {Object.entries(residentStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input label="Sex / gender marker" value={member.sex} onChange={(event) => onChange({ ...member, sex: event.target.value })} required />
        <BooleanSelect label="Full-time student?" value={member.fullTimeStudent} onChange={(next) => onChange({ ...member, fullTimeStudent: next })} required />
        <BooleanSelect label="Lives with taxpayer?" value={member.livesWithTaxpayer} onChange={(next) => onChange({ ...member, livesWithTaxpayer: next })} required />
      </div>
    </div>
  );
}

export function PortalProfileClient() {
  const [accessToken, setAccessToken] = useState("");
  const [serverProfile, setServerProfile] = useState<PortalProfileResponse | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfile);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);

  useEffect(() => {
    const savedDraft = window.localStorage.getItem(draftStorageKey);
    if (savedDraft) {
      try {
        setDraft(JSON.parse(savedDraft) as ProfileDraft);
      } catch {
        window.localStorage.removeItem(draftStorageKey);
      }
    }

    const savedToken = getStoredPortalAccessToken();
    if (!savedToken) {
      setMessage("Sign in with the Savians account you created after payment to continue profile setup.");
      return;
    }

    setAccessToken(savedToken);
    void loadProtectedProfile(savedToken);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft]);

  const completionLabel = useMemo(() => {
    if (!serverProfile) return "Draft";
    return serverProfile.completion.status === "COMPLETE" ? "Profile complete" : "Not started";
  }, [serverProfile]);

  async function loadProtectedProfile(token: string) {
    setLoading(true);
    setError(null);
    setIssues([]);
    try {
      const response = await loadPortalProfile(token);
      setServerProfile(response);
      setDraft(draftFromResponse(response));
      setMessage("Profile loaded. Local autosave is active while you edit.");
    } catch (caught) {
      clearStoredPortalAccessToken();
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not load your profile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const session = await signInToPortal({ email: loginEmail, password: loginPassword });
      setAccessToken(session.accessToken);
      await loadProtectedProfile(session.accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not sign you in.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setIssues([]);
    setMessage(null);
    try {
      const response = await savePortalProfile(accessToken, buildSaveRequest(draft));
      setServerProfile(response);
      setDraft(draftFromResponse(response));
      window.localStorage.removeItem(draftStorageKey);
      setMessage("Profile saved. Taking you to secure document upload...");
      window.setTimeout(() => window.location.assign("/portal/documents"), 500);
    } catch (caught) {
      const apiError = caught as AssessmentApiError;
      setError(apiError.message ?? "We could not save your profile.");
      setIssues(apiError.issues ?? []);
    } finally {
      setSaving(false);
    }
  }

  const updateProfile = (next: Partial<PortalProfilePayload>) => setDraft((current) => ({ ...current, profile: { ...current.profile, ...next } }));
  const isMarried = draft.profile.maritalStatus === "MARRIED";

  return (
    <section className="page-shell min-h-[75vh] py-12 sm:py-16">
      {(loading || saving) && <LoadingOverlay label={saving ? "Saving profile" : "Loading profile"} />}
      <Stepper current={3} steps={steps} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <Card className="h-fit">
          <StatusBadge status={serverProfile?.completion.status === "COMPLETE" ? "complete" : "active"}>{completionLabel}</StatusBadge>
          <h1 className="mt-5 text-3xl font-bold text-navy-800">Client profile</h1>
          <p className="mt-3 leading-7 text-slate-600">
            Complete the primary household profile for the {serverProfile?.assessmentYear ?? 2026} tax assessment. Spouse and dependent
            details are mandatory when those sections apply.
          </p>
          {serverProfile ? (
            <div className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-navy-800">Captured client details</p>
              <dl className="grid gap-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</dt>
                  <dd>{fullName(serverProfile.primaryTaxpayer)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
                  <dd>{serverProfile.primaryTaxpayer.email}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
                  <dd>{serverProfile.primaryTaxpayer.phone}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date of birth</dt>
                  <dd>{serverProfile.primaryTaxpayer.dateOfBirth}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assessment year</dt>
                  <dd>{serverProfile.assessmentYear}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profile status</dt>
                  <dd>{serverProfile.completion.status === "COMPLETE" ? "Complete" : "Needs completion"}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <form className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" onSubmit={handleSignIn}>
              <div>
                <p className="font-semibold text-navy-800">Sign in to load profile</p>
                <p className="mt-1">Use the email and password from paid account setup. No raw Cognito token is needed.</p>
              </div>
              <Input label="Email" type="email" autoComplete="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
              <Input label="Password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
              <Button type="submit" disabled={loading || !loginEmail || !loginPassword}>
                Sign in & load profile
              </Button>
              <Link className="text-center font-semibold text-navy-700 underline underline-offset-4" href={`/assessment/forgot-password?email=${encodeURIComponent(loginEmail)}`}>
                Forgot Password?
              </Link>
            </form>
          )}
        </Card>

        {serverProfile ? (
        <form className="grid gap-6" onSubmit={handleSubmit}>
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
          {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

          <Card>
            <h2 className="text-xl font-bold text-navy-800">Household basics</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Select label="Preferred contact" value={draft.profile.preferredContact} onChange={(event) => updateProfile({ preferredContact: event.target.value as PreferredContact | "" })} required>
                <option value="">Select</option>
                <option value="EMAIL">Email</option>
                <option value="PHONE">Phone</option>
                <option value="EITHER">Either</option>
              </Select>
              <Input label="Home address" value={draft.profile.homeAddress} onChange={(event) => updateProfile({ homeAddress: event.target.value })} required />
              <Input label="City" value={draft.profile.city} onChange={(event) => updateProfile({ city: event.target.value })} required />
              <Input label="State" maxLength={2} value={draft.profile.state} onChange={(event) => updateProfile({ state: event.target.value.toUpperCase() })} required />
              <Input label="ZIP code" value={draft.profile.zip} onChange={(event) => updateProfile({ zip: event.target.value })} required />
              <BooleanSelect label="Homeowner?" value={draft.profile.homeowner} onChange={(next) => updateProfile({ homeowner: next })} required />
              <Select label="Marital status" value={draft.profile.maritalStatus} onChange={(event) => updateProfile({ maritalStatus: event.target.value as MaritalStatus | "" })} required>
                <option value="">Select</option>
                {Object.entries(maritalStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select label="Primary resident status" value={draft.profile.residentStatus} onChange={(event) => updateProfile({ residentStatus: event.target.value as ResidentStatus | "" })} required>
                <option value="">Select</option>
                {Object.entries(residentStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <BooleanSelect label="Own real estate?" value={draft.profile.ownsRealEstate} onChange={(next) => updateProfile({ ownsRealEstate: next })} required />
              <BooleanSelect label="Own a business?" value={draft.profile.ownsBusiness} onChange={(next) => updateProfile({ ownsBusiness: next })} required />
            </div>
          </Card>

          {isMarried ? (
            <Card>
              <h2 className="mb-5 text-xl font-bold text-navy-800">Spouse details</h2>
              <MemberFields title="Spouse" member={draft.spouse} onChange={(spouse) => setDraft((current) => ({ ...current, spouse }))} />
            </Card>
          ) : null}

          <Card>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-xl font-bold text-navy-800">Dependents</h2>
                <p className="mt-1 text-sm text-slate-600">Add each dependent separately. Date of birth is required for every dependent.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, dependents: [...current.dependents, emptyMember()] }))}>
                <Plus aria-hidden size={16} />
                Add dependent
              </Button>
            </div>
            <div className="mt-5 grid gap-4">
              {draft.dependents.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No dependents added yet.</p>
              ) : null}
              {draft.dependents.map((dependent, index) => (
                <MemberFields
                  key={dependent.id ?? index}
                  title={`Dependent ${index + 1}`}
                  member={dependent}
                  removable
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      dependents: current.dependents.map((item, itemIndex) => (itemIndex === index ? next : item))
                    }))
                  }
                  onRemove={() =>
                    setDraft((current) => ({
                      ...current,
                      dependents: current.dependents.filter((_, itemIndex) => itemIndex !== index)
                    }))
                  }
                />
              ))}
            </div>
          </Card>

          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:flex-row sm:items-center">
            <p className="text-sm text-slate-600">
              Drafts autosave locally in this browser. Saving completes profile intake and prepares the account for document upload.
            </p>
            <Button type="submit" disabled={!accessToken || saving || !serverProfile}>
              <Save aria-hidden size={16} />
              Save profile
            </Button>
          </div>
        </form>
        ) : (
          <div className="grid gap-6">
            {error ? (
              <ErrorAlert>
                <p>{error}</p>
              </ErrorAlert>
            ) : null}
            {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}
            <Card>
              <h2 className="text-xl font-bold text-navy-800">Sign in required</h2>
              <p className="mt-3 leading-7 text-slate-600">
                Profile intake unlocks only after payment verification and paid account setup. Sign in with the client email and password created from the account setup link to load this protected page.
              </p>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
