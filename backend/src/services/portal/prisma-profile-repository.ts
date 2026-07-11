import {
  AssessmentStatus,
  HouseholdMemberType,
  type Prisma,
  type PrismaClient
} from "@prisma/client";
import type {
  PortalEntitlement,
  PortalProfileRepository,
  PortalSessionSeed,
  SavePortalProfileInput,
  StoredClientProfile
} from "./profile-service";

const dateFromDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const profileInclude = {
  householdMembers: {
    where: { memberType: { in: [HouseholdMemberType.SPOUSE, HouseholdMemberType.DEPENDENT] } },
    orderBy: [{ memberType: "asc" }, { createdAt: "asc" }]
  }
} satisfies Prisma.ClientProfileInclude;

const profileCompletableStatuses: AssessmentStatus[] = [
  AssessmentStatus.ACCOUNT_CREATED,
  AssessmentStatus.PROFILE_IN_PROGRESS,
  AssessmentStatus.PROFILE_COMPLETED
];

type PrismaStoredProfile = Prisma.ClientProfileGetPayload<{ include: typeof profileInclude }>;

function toStoredProfile(profile: PrismaStoredProfile): StoredClientProfile {
  return {
    id: profile.id,
    householdName: profile.householdName,
    homeAddress: profile.homeAddress,
    city: profile.city,
    state: profile.state,
    zip: profile.zip,
    homeowner: profile.homeowner,
    maritalStatus: profile.maritalStatus,
    preferredContact: profile.preferredContact,
    residentStatus: profile.residentStatus,
    ownsRealEstate: profile.ownsRealEstate,
    ownsBusiness: profile.ownsBusiness,
    lastYearTaxableIncome: profile.lastYearTaxableIncome === null ? null : Number(profile.lastYearTaxableIncome),
    projectedTaxableIncome: profile.projectedTaxableIncome === null ? null : Number(profile.projectedTaxableIncome),
    lifeInsuranceInPlace: profile.lifeInsuranceInPlace,
    estatePlanningInPlace: profile.estatePlanningInPlace,
    majorPurchaseNotes: profile.majorPurchaseNotes,
    completedAt: profile.completedAt,
    householdMembers: profile.householdMembers.map((member) => ({
      id: member.id,
      memberType: member.memberType === HouseholdMemberType.SPOUSE ? "SPOUSE" : "DEPENDENT",
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth,
      residentStatus: member.residentStatus,
      sex: member.sex,
      fullTimeStudent: member.fullTimeStudent,
      livesWithTaxpayer: member.livesWithTaxpayer,
      notes: member.notes
    }))
  };
}

export class PrismaPortalProfileRepository implements PortalProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSession(entitlement: PortalEntitlement): Promise<PortalSessionSeed | null> {
    return this.prisma.assessmentSession.findFirst({
      where: {
        id: entitlement.sessionId,
        clientId: entitlement.clientId,
        assessmentYear: entitlement.assessmentYear,
        deletedAt: null
      },
      select: {
        id: true,
        clientId: true,
        normalizedEmail: true,
        phone: true,
        firstName: true,
        middleName: true,
        lastName: true,
        dateOfBirth: true,
        state: true,
        assessmentYear: true
      }
    });
  }

  async findProfile(sessionId: string): Promise<StoredClientProfile | null> {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { sessionId },
      include: profileInclude
    });
    return profile ? toStoredProfile(profile) : null;
  }

  async saveCompleteProfile(entitlement: PortalEntitlement, input: SavePortalProfileInput): Promise<StoredClientProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const currentSession = await tx.assessmentSession.findUnique({
        where: { id: entitlement.sessionId },
        select: { status: true }
      });
      if (!currentSession) throw new Error("Assessment session disappeared during profile save.");

      const savedProfile = await tx.clientProfile.upsert({
        where: { sessionId: entitlement.sessionId },
        create: {
          clientId: entitlement.clientId,
          sessionId: entitlement.sessionId,
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
          completedAt: new Date()
        },
        update: {
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
          completedAt: new Date()
        },
        select: { id: true }
      });

      await tx.householdMember.deleteMany({
        where: {
          profileId: savedProfile.id,
          memberType: { in: [HouseholdMemberType.SPOUSE, HouseholdMemberType.DEPENDENT] }
        }
      });

      const members = [
        ...(input.spouse
          ? [
              {
                profileId: savedProfile.id,
                memberType: HouseholdMemberType.SPOUSE,
                firstName: input.spouse.firstName,
                middleName: input.spouse.middleName ?? null,
                lastName: input.spouse.lastName,
                dateOfBirth: dateFromDateOnly(input.spouse.dateOfBirth),
                residentStatus: input.spouse.residentStatus ?? null,
                sex: input.spouse.sex ?? null,
                isDependent: false,
                fullTimeStudent: input.spouse.fullTimeStudent ?? null,
                livesWithTaxpayer: input.spouse.livesWithTaxpayer ?? null,
                notes: input.spouse.notes ?? null
              }
            ]
          : []),
        ...input.dependents.map((dependent) => ({
          profileId: savedProfile.id,
          memberType: HouseholdMemberType.DEPENDENT,
          firstName: dependent.firstName,
          middleName: dependent.middleName ?? null,
          lastName: dependent.lastName,
          dateOfBirth: dateFromDateOnly(dependent.dateOfBirth),
          residentStatus: dependent.residentStatus ?? null,
          sex: dependent.sex ?? null,
          isDependent: true,
          fullTimeStudent: dependent.fullTimeStudent ?? null,
          livesWithTaxpayer: dependent.livesWithTaxpayer ?? null,
          notes: dependent.notes ?? null
        }))
      ];

      if (members.length > 0) await tx.householdMember.createMany({ data: members });

      if (profileCompletableStatuses.includes(currentSession.status)) {
        await tx.assessmentSession.update({
          where: { id: entitlement.sessionId },
          data: { status: AssessmentStatus.PROFILE_COMPLETED, documentUploadAllowed: true }
        });
        if (currentSession.status !== AssessmentStatus.PROFILE_COMPLETED) {
          await tx.assessmentStatusHistory.create({
            data: {
              sessionId: entitlement.sessionId,
              oldStatus: currentSession.status,
              newStatus: AssessmentStatus.PROFILE_COMPLETED,
              reason: "Client completed protected profile and household intake.",
              actorType: "CLIENT",
              actorId: entitlement.clientId
            }
          });
        }
      }

      const reloaded = await tx.clientProfile.findUniqueOrThrow({
        where: { sessionId: entitlement.sessionId },
        include: profileInclude
      });
      return reloaded;
    });

    return toStoredProfile(profile);
  }
}
