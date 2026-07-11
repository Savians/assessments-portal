import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type {
  PortalEntitlement,
  PortalProfileRepository,
  PortalSessionSeed,
  SavePortalProfileInput,
  StoredClientProfile
} from "./profile-service";
import { PortalProfileService } from "./profile-service";

const entitlement: PortalEntitlement = {
  clientId: "client-1",
  sessionId: "session-1",
  assessmentYear: 2026
};

const session: PortalSessionSeed = {
  id: "session-1",
  clientId: "client-1",
  normalizedEmail: "client@example.com",
  phone: "+15555550123",
  firstName: "Priya",
  middleName: null,
  lastName: "Shah",
  dateOfBirth: new Date("1988-03-14T00:00:00.000Z"),
  state: "CA",
  assessmentYear: 2026
};

const completeInput: SavePortalProfileInput = {
  householdName: "Shah Household",
  homeAddress: "10 Market Street",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  homeowner: true,
  maritalStatus: "MARRIED",
  preferredContact: "EMAIL",
  residentStatus: "US_CITIZEN",
  ownsRealEstate: true,
  ownsBusiness: false,
  lastYearTaxableIncome: 250000,
  projectedTaxableIncome: 300000,
  lifeInsuranceInPlace: true,
  estatePlanningInPlace: false,
  majorPurchaseNotes: "Planning a vehicle purchase.",
  spouse: {
    firstName: "Amit",
    lastName: "Shah",
    dateOfBirth: "1987-09-20",
    residentStatus: "GREEN_CARD_HOLDER",
    sex: "Male",
    fullTimeStudent: false,
    livesWithTaxpayer: true
  },
  dependents: [
    {
      firstName: "Mira",
      lastName: "Shah",
      dateOfBirth: "2018-11-05",
      residentStatus: "US_CITIZEN",
      sex: "Female",
      fullTimeStudent: true,
      livesWithTaxpayer: true
    }
  ]
};

class InMemoryProfileRepository implements PortalProfileRepository {
  savedInput: SavePortalProfileInput | null = null;

  constructor(private profile: StoredClientProfile | null = null) {}

  async findSession(): Promise<PortalSessionSeed | null> {
    return session;
  }

  async findProfile(): Promise<StoredClientProfile | null> {
    return this.profile;
  }

  async saveCompleteProfile(_entitlement: PortalEntitlement, input: SavePortalProfileInput): Promise<StoredClientProfile> {
    this.savedInput = input;
    this.profile = {
      id: "profile-1",
      householdName: input.householdName ?? null,
      homeAddress: input.homeAddress,
      city: input.city,
      state: input.state,
      zip: input.zip,
      homeowner: input.homeowner,
      maritalStatus: input.maritalStatus,
      preferredContact: input.preferredContact ?? null,
      residentStatus: input.residentStatus,
      ownsRealEstate: input.ownsRealEstate ?? null,
      ownsBusiness: input.ownsBusiness ?? null,
      lastYearTaxableIncome: input.lastYearTaxableIncome ?? null,
      projectedTaxableIncome: input.projectedTaxableIncome ?? null,
      lifeInsuranceInPlace: input.lifeInsuranceInPlace ?? null,
      estatePlanningInPlace: input.estatePlanningInPlace ?? null,
      majorPurchaseNotes: input.majorPurchaseNotes ?? null,
      completedAt: new Date("2026-07-06T12:00:00.000Z"),
      householdMembers: [
        ...(input.spouse
          ? [
              {
                id: "spouse-1",
                memberType: "SPOUSE" as const,
                firstName: input.spouse.firstName,
                middleName: input.spouse.middleName ?? null,
                lastName: input.spouse.lastName,
                dateOfBirth: new Date(`${input.spouse.dateOfBirth}T00:00:00.000Z`),
                residentStatus: input.spouse.residentStatus ?? null,
                sex: input.spouse.sex ?? null,
                fullTimeStudent: input.spouse.fullTimeStudent ?? null,
                livesWithTaxpayer: input.spouse.livesWithTaxpayer ?? null,
                notes: input.spouse.notes ?? null
              }
            ]
          : []),
        ...input.dependents.map((dependent, index) => ({
          id: `dependent-${index + 1}`,
          memberType: "DEPENDENT" as const,
          firstName: dependent.firstName,
          middleName: dependent.middleName ?? null,
          lastName: dependent.lastName,
          dateOfBirth: new Date(`${dependent.dateOfBirth}T00:00:00.000Z`),
          residentStatus: dependent.residentStatus ?? null,
          sex: dependent.sex ?? null,
          fullTimeStudent: dependent.fullTimeStudent ?? null,
          livesWithTaxpayer: dependent.livesWithTaxpayer ?? null,
          notes: dependent.notes ?? null
        }))
      ]
    };
    return this.profile as StoredClientProfile;
  }
}

describe("portal profile service", () => {
  it("loads a not-started profile seeded from the paid assessment session", async () => {
    const service = new PortalProfileService(new InMemoryProfileRepository());
    await expect(service.load(entitlement)).resolves.toMatchObject({
      clientId: "client-1",
      primaryTaxpayer: {
        firstName: "Priya",
        dateOfBirth: "1988-03-14"
      },
      profile: {
        state: "CA",
        maritalStatus: "",
        completedAt: null
      },
      completion: {
        status: "NOT_STARTED",
        progressPercent: 0
      }
    });
  });

  it("requires spouse details when marital status is married", async () => {
    const service = new PortalProfileService(new InMemoryProfileRepository());
    await expect(service.save(entitlement, { ...completeInput, spouse: null })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["spouse"] })]
    });
  });

  it("requires dependent dates of birth", async () => {
    const service = new PortalProfileService(new InMemoryProfileRepository());
    const rawInput = {
      ...completeInput,
      dependents: [{ firstName: "Mira", lastName: "Shah" }]
    };
    await expect(service.save(entitlement, rawInput)).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects spouse details for non-married profiles", async () => {
    const service = new PortalProfileService(new InMemoryProfileRepository());
    await expect(service.save(entitlement, { ...completeInput, maritalStatus: "SINGLE" })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["spouse"] })]
    });
  });

  it("saves a complete household profile and marks completion", async () => {
    const repository = new InMemoryProfileRepository();
    const service = new PortalProfileService(repository);
    await expect(service.save(entitlement, completeInput)).resolves.toMatchObject({
      profile: {
        householdName: "Shah Household",
        maritalStatus: "MARRIED"
      },
      spouse: {
        firstName: "Amit",
        dateOfBirth: "1987-09-20"
      },
      dependents: [
        {
          firstName: "Mira",
          dateOfBirth: "2018-11-05"
        }
      ],
      completion: {
        status: "COMPLETE",
        progressPercent: 100
      }
    });
    expect(repository.savedInput?.state).toBe("CA");
  });
});
