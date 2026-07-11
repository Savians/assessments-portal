import { z } from "zod";

export interface PortalEntitlement {
  clientId: string;
  sessionId: string;
  assessmentYear: number;
}

const maritalStatuses = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"] as const;
const residentStatuses = ["US_CITIZEN", "GREEN_CARD_HOLDER", "VISA", "OTHER"] as const;
const preferredContactMethods = ["EMAIL", "PHONE", "EITHER"] as const;

export type MaritalStatusValue = (typeof maritalStatuses)[number];
export type ResidentStatusValue = (typeof residentStatuses)[number];
export type PreferredContactValue = (typeof preferredContactMethods)[number];

export class PortalProfileError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const requiredText = (max: number, label: string) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const dateOnly = z
  .string({ error: "Date of birth is required." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date.")
  .refine((value) => new Date(`${value}T00:00:00.000Z`) <= new Date(), "Date of birth cannot be in the future.");

const householdMemberSchema = z.object({
  firstName: requiredText(60, "First name"),
  middleName: optionalText(60),
  lastName: requiredText(60, "Last name"),
  dateOfBirth: dateOnly,
  residentStatus: z.enum(residentStatuses, { error: "Resident status is required." }),
  sex: requiredText(30, "Sex / gender marker"),
  fullTimeStudent: z.boolean({ error: "Full-time student status is required." }),
  livesWithTaxpayer: z.boolean({ error: "Lives-with-taxpayer status is required." }),
  notes: optionalText(1000)
});

const nullableMoney = z.number().optional().nullable();

export const savePortalProfileSchema = z
  .object({
    householdName: optionalText(200),
    homeAddress: requiredText(255, "Home address"),
    city: requiredText(100, "City"),
    state: z.string({ error: "State is required." }).trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter state code."),
    zip: z
      .string({ error: "ZIP code is required." })
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Use a valid ZIP code."),
    homeowner: z.boolean({ error: "Homeowner status is required." }),
    maritalStatus: z.enum(maritalStatuses, { error: "Marital status is required." }),
    preferredContact: z.enum(preferredContactMethods, { error: "Preferred contact is required." }),
    residentStatus: z.enum(residentStatuses, { error: "Resident status is required." }),
    ownsRealEstate: z.boolean({ error: "Real estate ownership status is required." }),
    ownsBusiness: z.boolean({ error: "Business ownership status is required." }),
    lastYearTaxableIncome: nullableMoney,
    projectedTaxableIncome: nullableMoney,
    lifeInsuranceInPlace: z.boolean({ error: "Life insurance status is required." }),
    estatePlanningInPlace: z.boolean({ error: "Estate planning status is required." }),
    majorPurchaseNotes: optionalText(2000),
    spouse: householdMemberSchema.optional().nullable(),
    dependents: z.array(householdMemberSchema).max(20, "Please contact Savians support for households with more than 20 dependents.").default([])
  })
  .superRefine((value, context) => {
    if (value.maritalStatus === "MARRIED" && !value.spouse) {
      context.addIssue({
        code: "custom",
        path: ["spouse"],
        message: "Spouse details, including spouse date of birth, are required when marital status is married."
      });
    }
    if (value.maritalStatus !== "MARRIED" && value.spouse) {
      context.addIssue({
        code: "custom",
        path: ["spouse"],
        message: "Spouse details should only be provided when marital status is married."
      });
    }
  });

export type SavePortalProfileInput = z.infer<typeof savePortalProfileSchema>;

export interface PortalSessionSeed {
  id: string;
  clientId: string | null;
  normalizedEmail: string;
  phone: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: Date;
  state: string;
  assessmentYear: number;
}

export interface StoredHouseholdMember {
  id: string;
  memberType: "SPOUSE" | "DEPENDENT";
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: Date;
  residentStatus: ResidentStatusValue | null;
  sex: string | null;
  fullTimeStudent: boolean | null;
  livesWithTaxpayer: boolean | null;
  notes: string | null;
}

export interface StoredClientProfile {
  id: string;
  householdName: string | null;
  homeAddress: string;
  city: string;
  state: string;
  zip: string;
  homeowner: boolean;
  maritalStatus: MaritalStatusValue;
  preferredContact: string | null;
  residentStatus: ResidentStatusValue;
  ownsRealEstate: boolean | null;
  ownsBusiness: boolean | null;
  lastYearTaxableIncome: number | null;
  projectedTaxableIncome: number | null;
  lifeInsuranceInPlace: boolean | null;
  estatePlanningInPlace: boolean | null;
  majorPurchaseNotes: string | null;
  completedAt: Date | null;
  householdMembers: StoredHouseholdMember[];
}

export interface PortalProfileRepository {
  findSession(entitlement: PortalEntitlement): Promise<PortalSessionSeed | null>;
  findProfile(sessionId: string): Promise<StoredClientProfile | null>;
  saveCompleteProfile(entitlement: PortalEntitlement, input: SavePortalProfileInput): Promise<StoredClientProfile>;
}

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const emptyProfile = (session: PortalSessionSeed): PortalProfilePayload => ({
  householdName: "",
  homeAddress: "",
  city: "",
  state: session.state,
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
});

export interface PortalProfilePayload {
  householdName: string;
  homeAddress: string;
  city: string;
  state: string;
  zip: string;
  homeowner: boolean | null;
  maritalStatus: MaritalStatusValue | "";
  preferredContact: string;
  residentStatus: ResidentStatusValue | "";
  ownsRealEstate: boolean | null;
  ownsBusiness: boolean | null;
  lastYearTaxableIncome: number | null;
  projectedTaxableIncome: number | null;
  lifeInsuranceInPlace: boolean | null;
  estatePlanningInPlace: boolean | null;
  majorPurchaseNotes: string;
  completedAt: string | null;
}

export interface PortalHouseholdMemberPayload {
  id?: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  residentStatus: ResidentStatusValue | "";
  sex: string;
  fullTimeStudent: boolean | null;
  livesWithTaxpayer: boolean | null;
  notes: string;
}

export interface PortalProfileResponse {
  clientId: string;
  sessionId: string;
  assessmentYear: number;
  primaryTaxpayer: {
    firstName: string;
    middleName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
  };
  profile: PortalProfilePayload;
  spouse: PortalHouseholdMemberPayload | null;
  dependents: PortalHouseholdMemberPayload[];
  completion: {
    status: "NOT_STARTED" | "COMPLETE";
    progressPercent: number;
    completedAt: string | null;
  };
}

function memberPayload(member: StoredHouseholdMember): PortalHouseholdMemberPayload {
  return {
    id: member.id,
    firstName: member.firstName,
    middleName: member.middleName ?? "",
    lastName: member.lastName,
    dateOfBirth: toDateOnly(member.dateOfBirth),
    residentStatus: member.residentStatus ?? "",
    sex: member.sex ?? "",
    fullTimeStudent: member.fullTimeStudent,
    livesWithTaxpayer: member.livesWithTaxpayer,
    notes: member.notes ?? ""
  };
}

function profilePayload(session: PortalSessionSeed, profile: StoredClientProfile | null): PortalProfilePayload {
  if (!profile) return emptyProfile(session);
  return {
    householdName: profile.householdName ?? "",
    homeAddress: profile.homeAddress,
    city: profile.city,
    state: profile.state,
    zip: profile.zip,
    homeowner: profile.homeowner,
    maritalStatus: profile.maritalStatus,
    preferredContact: profile.preferredContact ?? "",
    residentStatus: profile.residentStatus,
    ownsRealEstate: profile.ownsRealEstate,
    ownsBusiness: profile.ownsBusiness,
    lastYearTaxableIncome: profile.lastYearTaxableIncome,
    projectedTaxableIncome: profile.projectedTaxableIncome,
    lifeInsuranceInPlace: profile.lifeInsuranceInPlace,
    estatePlanningInPlace: profile.estatePlanningInPlace,
    majorPurchaseNotes: profile.majorPurchaseNotes ?? "",
    completedAt: profile.completedAt ? profile.completedAt.toISOString() : null
  };
}

export class PortalProfileService {
  constructor(private readonly repository: PortalProfileRepository) {}

  async load(entitlement: PortalEntitlement): Promise<PortalProfileResponse> {
    const session = await this.repository.findSession(entitlement);
    if (!session || session.clientId !== entitlement.clientId) {
      throw new PortalProfileError("PROFILE_SESSION_NOT_FOUND", "We could not find the entitled assessment session.", 404);
    }
    const profile = await this.repository.findProfile(entitlement.sessionId);
    return this.buildResponse(entitlement, session, profile);
  }

  async save(entitlement: PortalEntitlement, rawInput: unknown): Promise<PortalProfileResponse> {
    const session = await this.repository.findSession(entitlement);
    if (!session || session.clientId !== entitlement.clientId) {
      throw new PortalProfileError("PROFILE_SESSION_NOT_FOUND", "We could not find the entitled assessment session.", 404);
    }
    const input = savePortalProfileSchema.parse(rawInput);
    const profile = await this.repository.saveCompleteProfile(entitlement, input);
    return this.buildResponse(entitlement, session, profile);
  }

  private buildResponse(entitlement: PortalEntitlement, session: PortalSessionSeed, profile: StoredClientProfile | null): PortalProfileResponse {
    const householdMembers = profile?.householdMembers ?? [];
    const spouse = householdMembers.find((member) => member.memberType === "SPOUSE") ?? null;
    const dependents = householdMembers.filter((member) => member.memberType === "DEPENDENT");
    const completedAt = profile?.completedAt ? profile.completedAt.toISOString() : null;
    return {
      clientId: entitlement.clientId,
      sessionId: entitlement.sessionId,
      assessmentYear: entitlement.assessmentYear,
      primaryTaxpayer: {
        firstName: session.firstName,
        middleName: session.middleName ?? "",
        lastName: session.lastName,
        dateOfBirth: toDateOnly(session.dateOfBirth),
        email: session.normalizedEmail,
        phone: session.phone
      },
      profile: profilePayload(session, profile),
      spouse: spouse ? memberPayload(spouse) : null,
      dependents: dependents.map(memberPayload),
      completion: {
        status: completedAt ? "COMPLETE" : "NOT_STARTED",
        progressPercent: completedAt ? 100 : 0,
        completedAt
      }
    };
  }
}
