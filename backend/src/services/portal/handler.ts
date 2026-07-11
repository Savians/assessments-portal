import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { AssessmentStatus, DocumentStatus, DeliveryStatus, type PrismaClient } from "@prisma/client";
import { Resend } from "resend";
import { z, ZodError } from "zod";
import { getApplicationSecrets } from "../../shared/application-secrets";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { assertPaidPortalEntitlement, PortalEntitlementError, type PortalClaims } from "./portal-entitlement";
import { PortalProfileError, PortalProfileService, type PortalEntitlement } from "./profile-service";
import { PrismaPortalProfileRepository } from "./prisma-profile-repository";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body)
});
const parseBody = (body: string | undefined, base64: boolean): unknown => {
  if (!body) throw new PortalProfileError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const propertyOwnerSchema = z.object({
  ownerName: z.string().trim().min(1, "Owner name is required.").max(200),
  ownershipPercentage: z.number().nonnegative().max(100)
});

const propertySchema = z.object({
  id: z.string().uuid().optional(),
  category: z.string().trim().min(1, "Property category is required.").max(50),
  propertyType: z.string().trim().min(1, "Property type is required.").max(50),
  label: z.string().trim().min(1, "Property label is required.").max(150),
  fullAddress: z.string().trim().min(1, "Property address is required.").max(300),
  acquiredYear: z.number().int().min(1900).max(new Date().getUTCFullYear() + 1),
  acquiredMethod: z.string().trim().min(1, "Acquired method is required.").max(40),
  purchaseBasis: z.number().nonnegative().optional().nullable(),
  currentFmv: z.number().nonnegative().optional().nullable(),
  landValue: z.number().nonnegative().optional().nullable(),
  mortgageBalance: z.number().nonnegative().optional().nullable(),
  monthlyPayment: z.number().nonnegative().optional().nullable(),
  mortgageCompany: optionalText(150).nullable(),
  interestRate: z.number().nonnegative().max(100).optional().nullable(),
  mortgageTermYears: z.number().int().positive().max(100).optional().nullable(),
  taxYearUse: z.string().trim().min(1, "Tax-year use is required.").max(50),
  rentalStartDate: optionalText(10).nullable(),
  daysRented: z.number().int().nonnegative().max(366).optional().nullable(),
  personalUseDays: z.number().int().nonnegative().max(366).optional().nullable(),
  projectedGrossRent: z.number().nonnegative().optional().nullable(),
  priorInterestPaid: z.number().nonnegative().optional().nullable(),
  priorTaxPaid: z.number().nonnegative().optional().nullable(),
  totalExpenses: z.number().nonnegative().optional().nullable(),
  owners: z.array(propertyOwnerSchema).max(10).default([]),
  notes: optionalText(1000).nullable()
});

const businessInvestmentSchema = z.object({
  id: z.string().uuid().optional(),
  entityName: z.string().trim().min(1, "Entity name is required.").max(255),
  entityType: z.string().trim().min(1, "Entity type is required.").max(60),
  ownershipPercent: z.number().nonnegative().max(100),
  taxClassification: z.string().trim().min(1, "Tax classification is required.").max(60),
  priorYearIncomeLoss: z.number().optional().nullable(),
  priorYear: z.number().int().min(1900).max(new Date().getUTCFullYear()).optional().nullable(),
  incomeLossYearMinus3: z.number().optional().nullable(),
  incomeLossYearMinus2: z.number().optional().nullable(),
  incomeLossYearMinus1: z.number().optional().nullable(),
  projectedCurrentYearIncomeLoss: z.number().optional().nullable(),
  active: z.boolean().optional().nullable(),
  notes: optionalText(1000).nullable()
});

const propertiesRequestSchema = z.object({ properties: z.array(propertySchema).max(30) });
const businessInvestmentsRequestSchema = z.object({ businessInvestments: z.array(businessInvestmentSchema).max(30) });

function publicAssessmentStatus(status: AssessmentStatus) {
  if (status === AssessmentStatus.PAYMENT_PENDING || status === AssessmentStatus.PAYMENT_VERIFYING) return "Payment Pending";
  if (status === AssessmentStatus.DOCUMENTS_SUBMITTED) return "Ready for Review";
  return "Pending Uploads";
}

async function loadDashboard(prisma: PrismaClient, entitlement: PortalEntitlement, service: PortalProfileService) {
  const [profileResponse, session, properties, businessInvestments, documents] = await Promise.all([
    service.load(entitlement),
    prisma.assessmentSession.findUniqueOrThrow({
      where: { id: entitlement.sessionId },
      select: { status: true, firstName: true, middleName: true, lastName: true, normalizedEmail: true, phone: true, assessmentYear: true }
    }),
    prisma.property.findMany({ where: { profile: { sessionId: entitlement.sessionId } }, include: { owners: { orderBy: { ownerName: "asc" } } }, orderBy: { createdAt: "asc" } }),
    prisma.businessInvestment.findMany({ where: { profile: { sessionId: entitlement.sessionId } }, orderBy: { createdAt: "asc" } }),
    prisma.documentMetadata.findMany({
      where: { sessionId: entitlement.sessionId, clientId: entitlement.clientId, deletedAt: null, status: { in: [DocumentStatus.UPLOADED, DocumentStatus.CLEAN] } },
      select: { id: true, category: true, originalName: true, sizeBytes: true, createdAt: true }
    })
  ]);
  return {
    ...profileResponse,
    assessmentStatus: {
      raw: session.status,
      label: publicAssessmentStatus(session.status)
    },
    properties: properties.map((property) => ({
      ...property,
      purchaseBasis: property.purchaseBasis === null ? null : Number(property.purchaseBasis),
      currentFmv: property.currentFmv === null ? null : Number(property.currentFmv),
      landValue: property.landValue === null ? null : Number(property.landValue),
      mortgageBalance: property.mortgageBalance === null ? null : Number(property.mortgageBalance),
      monthlyPayment: property.monthlyPayment === null ? null : Number(property.monthlyPayment),
      interestRate: property.interestRate === null ? null : Number(property.interestRate),
      projectedGrossRent: property.projectedGrossRent === null ? null : Number(property.projectedGrossRent),
      priorInterestPaid: property.priorInterestPaid === null ? null : Number(property.priorInterestPaid),
      priorTaxPaid: property.priorTaxPaid === null ? null : Number(property.priorTaxPaid),
      totalExpenses: property.totalExpenses === null ? null : Number(property.totalExpenses),
      owners: property.owners.map((owner) => ({
        id: owner.id,
        ownerName: owner.ownerName,
        ownershipPercentage: Number(owner.ownershipPercentage)
      })),
      rentalStartDate: property.rentalStartDate?.toISOString().slice(0, 10) ?? null,
      createdAt: property.createdAt.toISOString(),
      updatedAt: property.updatedAt.toISOString()
    })),
    businessInvestments: businessInvestments.map((business) => ({
      ...business,
      ownershipPercent: Number(business.ownershipPercent),
      priorYearIncomeLoss: business.priorYearIncomeLoss === null ? null : Number(business.priorYearIncomeLoss),
      incomeLossYearMinus3: business.incomeLossYearMinus3 === null ? null : Number(business.incomeLossYearMinus3),
      incomeLossYearMinus2: business.incomeLossYearMinus2 === null ? null : Number(business.incomeLossYearMinus2),
      incomeLossYearMinus1: business.incomeLossYearMinus1 === null ? null : Number(business.incomeLossYearMinus1),
      projectedCurrentYearIncomeLoss: business.projectedCurrentYearIncomeLoss === null ? null : Number(business.projectedCurrentYearIncomeLoss),
      createdAt: business.createdAt.toISOString(),
      updatedAt: business.updatedAt.toISOString()
    })),
    documentSummary: {
      uploadedCount: documents.length,
      uploadedBytes: documents.reduce((total, document) => total + Number(document.sizeBytes), 0),
      recentDocuments: documents
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 10)
        .map((document) => ({
          ...document,
          sizeBytes: Number(document.sizeBytes),
          createdAt: document.createdAt.toISOString()
        }))
    }
  };
}

async function ensureProfileId(prisma: PrismaClient, entitlement: PortalEntitlement) {
  const profile = await prisma.clientProfile.findUnique({ where: { sessionId: entitlement.sessionId }, select: { id: true } });
  if (!profile) throw new PortalProfileError("PROFILE_REQUIRED", "Save Personal and Family Information before this intake section.", 409);
  return profile.id;
}

const nullableNumber = (value: number | null | undefined) => value === undefined ? null : value;
const nullableText = (value: string | null | undefined) => value?.trim() || null;
const nullableDate = (value: string | null | undefined) => value ? new Date(`${value}T00:00:00.000Z`) : null;

async function saveProperties(prisma: PrismaClient, entitlement: PortalEntitlement, raw: unknown) {
  const input = propertiesRequestSchema.parse(raw);
  const profileId = await ensureProfileId(prisma, entitlement);
  await prisma.$transaction(async (tx) => {
    await tx.property.deleteMany({ where: { profileId } });
    for (const property of input.properties) {
      const savedProperty = await tx.property.create({
        data: {
          profileId,
          category: property.category,
          propertyType: property.propertyType,
          label: property.label,
          fullAddress: property.fullAddress,
          acquiredYear: property.acquiredYear,
          acquiredMethod: property.acquiredMethod,
          purchaseBasis: nullableNumber(property.purchaseBasis),
          currentFmv: nullableNumber(property.currentFmv),
          landValue: nullableNumber(property.landValue),
          mortgageBalance: nullableNumber(property.mortgageBalance),
          monthlyPayment: nullableNumber(property.monthlyPayment),
          mortgageCompany: nullableText(property.mortgageCompany),
          interestRate: nullableNumber(property.interestRate),
          mortgageTermYears: nullableNumber(property.mortgageTermYears),
          taxYearUse: property.taxYearUse,
          rentalStartDate: nullableDate(property.rentalStartDate),
          daysRented: nullableNumber(property.daysRented),
          personalUseDays: nullableNumber(property.personalUseDays),
          projectedGrossRent: nullableNumber(property.projectedGrossRent),
          priorInterestPaid: nullableNumber(property.priorInterestPaid),
          priorTaxPaid: nullableNumber(property.priorTaxPaid),
          totalExpenses: nullableNumber(property.totalExpenses),
          notes: nullableText(property.notes)
        },
        select: { id: true }
      });
      if (property.owners.length > 0) {
        await tx.propertyOwner.createMany({
          data: property.owners.map((owner) => ({
            propertyId: savedProperty.id,
            ownerName: owner.ownerName,
            ownershipPercentage: owner.ownershipPercentage
          }))
        });
      }
    }
    await tx.auditLog.create({
      data: {
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        action: "REAL_ESTATE_INTAKE_SAVED",
        entityType: "Property",
        actorType: "CLIENT",
        actorId: entitlement.clientId,
        metadata: { count: input.properties.length }
      }
    });
  });
  return { ok: true };
}

async function saveBusinessInvestments(prisma: PrismaClient, entitlement: PortalEntitlement, raw: unknown) {
  const input = businessInvestmentsRequestSchema.parse(raw);
  const profileId = await ensureProfileId(prisma, entitlement);
  await prisma.$transaction(async (tx) => {
    await tx.businessInvestment.deleteMany({ where: { profileId } });
    if (input.businessInvestments.length > 0) {
      await tx.businessInvestment.createMany({
        data: input.businessInvestments.map((business) => ({
          profileId,
          entityName: business.entityName,
          entityType: business.entityType,
          ownershipPercent: business.ownershipPercent,
          taxClassification: business.taxClassification,
          priorYearIncomeLoss: nullableNumber(business.priorYearIncomeLoss),
          priorYear: nullableNumber(business.priorYear),
          incomeLossYearMinus3: nullableNumber(business.incomeLossYearMinus3),
          incomeLossYearMinus2: nullableNumber(business.incomeLossYearMinus2),
          incomeLossYearMinus1: nullableNumber(business.incomeLossYearMinus1),
          projectedCurrentYearIncomeLoss: nullableNumber(business.projectedCurrentYearIncomeLoss),
          active: business.active ?? true,
          notes: nullableText(business.notes)
        }))
      });
    }
    await tx.auditLog.create({
      data: {
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        action: "BUSINESS_ENTITY_INTAKE_SAVED",
        entityType: "BusinessInvestment",
        actorType: "CLIENT",
        actorId: entitlement.clientId,
        metadata: { count: input.businessInvestments.length }
      }
    });
  });
  return { ok: true };
}

async function sendReadyForReviewEmail(secrets: ApplicationSecrets, input: {
  clientName: string;
  clientEmail: string;
  phone: string;
  assessmentYear: number;
  profileComplete: boolean;
  uploadedCount: number;
  uploadedBytes: number;
  propertyCount: number;
  businessCount: number;
}) {
  if (!secrets.EMAIL_ENABLED || !secrets.RESEND_API_KEY) return { status: DeliveryStatus.SKIPPED, providerMessageId: null, failureReason: "Email disabled" };
  const resend = new Resend(secrets.RESEND_API_KEY);
  const from = "awsadmin@savians.com";
  const to = "contactus@savians.com";
  const escapeHtml = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const text = [
    "Hey, this client has uploaded their docs and is ready for review.",
    "",
    `Client: ${input.clientName}`,
    `Email: ${input.clientEmail}`,
    `Phone: ${input.phone}`,
    `Assessment year: ${input.assessmentYear}`,
    `Profile complete: ${input.profileComplete ? "Yes" : "No"}`,
    `Uploaded documents: ${input.uploadedCount}`,
    `Uploaded bytes: ${input.uploadedBytes}`,
    `Real estate entries: ${input.propertyCount}`,
    `Business/entity entries: ${input.businessCount}`
  ].join("\n");
  const result = await resend.emails.send({
    from,
    replyTo: input.clientEmail,
    to,
    subject: `Assessment ready for review: ${input.clientName} (${input.assessmentYear})`,
    text,
    html: `<p>Hey, this client has uploaded their docs and is ready for review.</p><ul><li><strong>Client:</strong> ${escapeHtml(input.clientName)}</li><li><strong>Email:</strong> ${escapeHtml(input.clientEmail)}</li><li><strong>Phone:</strong> ${escapeHtml(input.phone)}</li><li><strong>Assessment year:</strong> ${escapeHtml(input.assessmentYear)}</li><li><strong>Profile complete:</strong> ${input.profileComplete ? "Yes" : "No"}</li><li><strong>Uploaded documents:</strong> ${escapeHtml(input.uploadedCount)}</li><li><strong>Uploaded bytes:</strong> ${escapeHtml(input.uploadedBytes)}</li><li><strong>Real estate entries:</strong> ${escapeHtml(input.propertyCount)}</li><li><strong>Business/entity entries:</strong> ${escapeHtml(input.businessCount)}</li></ul>`
  });
  if (result.error) return { status: DeliveryStatus.FAILED, providerMessageId: null, failureReason: result.error.message };
  return { status: DeliveryStatus.SENT, providerMessageId: result.data?.id ?? null, failureReason: null };
}

async function markReadyForReview(prisma: PrismaClient, secrets: ApplicationSecrets, entitlement: PortalEntitlement) {
  const dashboard = await loadDashboard(prisma, entitlement, new PortalProfileService(new PrismaPortalProfileRepository(prisma)));
  if (dashboard.completion.status !== "COMPLETE") {
    throw new PortalProfileError("PROFILE_REQUIRED", "Save Personal and Family Information before marking ready for review.", 409);
  }
  if (dashboard.documentSummary.uploadedCount === 0) {
    throw new PortalProfileError("DOCUMENTS_REQUIRED", "Upload at least one document before marking ready for review.", 409);
  }

  const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: entitlement.sessionId }, select: { status: true } });
  const readyEligibleStatuses: AssessmentStatus[] = [
    AssessmentStatus.PROFILE_COMPLETED,
    AssessmentStatus.DOCUMENTS_IN_PROGRESS,
    AssessmentStatus.DOCUMENTS_SUBMITTED
  ];
  if (!readyEligibleStatuses.includes(session.status)) {
    throw new PortalProfileError("STATUS_NOT_READY", "This assessment is not ready for review submission yet.", 409);
  }

  const clientName = [dashboard.primaryTaxpayer.firstName, dashboard.primaryTaxpayer.middleName, dashboard.primaryTaxpayer.lastName].filter(Boolean).join(" ");
  const emailResult = await sendReadyForReviewEmail(secrets, {
    clientName,
    clientEmail: dashboard.primaryTaxpayer.email,
    phone: dashboard.primaryTaxpayer.phone,
    assessmentYear: dashboard.assessmentYear,
    profileComplete: dashboard.completion.status === "COMPLETE",
    uploadedCount: dashboard.documentSummary.uploadedCount,
    uploadedBytes: dashboard.documentSummary.uploadedBytes,
    propertyCount: dashboard.properties.length,
    businessCount: dashboard.businessInvestments.length
  });

  await prisma.$transaction(async (tx) => {
    if (session.status !== AssessmentStatus.DOCUMENTS_SUBMITTED) {
      await tx.assessmentSession.update({
        where: { id: entitlement.sessionId },
        data: { status: AssessmentStatus.DOCUMENTS_SUBMITTED, documentUploadAllowed: true }
      });
      await tx.assessmentStatusHistory.create({
        data: {
          sessionId: entitlement.sessionId,
          oldStatus: session.status,
          newStatus: AssessmentStatus.DOCUMENTS_SUBMITTED,
          reason: "Client marked assessment ready for review.",
          actorType: "CLIENT",
          actorId: entitlement.clientId
        }
      });
    }
    await tx.emailEvent.create({
      data: {
        sessionId: entitlement.sessionId,
        templateKey: "ASSESSMENT_READY_FOR_REVIEW",
        recipientEmail: "contactus@savians.com",
        providerMessageId: emailResult.providerMessageId,
        status: emailResult.status,
        failureReason: emailResult.failureReason,
        sentAt: emailResult.status === DeliveryStatus.SENT ? new Date() : null
      }
    });
    await tx.auditLog.create({
      data: {
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        action: "ASSESSMENT_READY_FOR_REVIEW",
        entityType: "AssessmentSession",
        entityId: entitlement.sessionId,
        actorType: "CLIENT",
        actorId: entitlement.clientId,
        metadata: {
          emailStatus: emailResult.status,
          uploadedCount: dashboard.documentSummary.uploadedCount
        }
      }
    });
  });

  return { ok: true, status: "Ready for Review", emailStatus: emailResult.status };
}

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const prisma = getPrismaClient(secrets.DATABASE_URL);
    const requestContext = event.requestContext as typeof event.requestContext & { authorizer?: { jwt?: { claims?: PortalClaims } } };
    const claims = requestContext.authorizer?.jwt?.claims;
    const entitlement = await assertPaidPortalEntitlement(prisma, claims ?? {});
    const service = new PortalProfileService(new PrismaPortalProfileRepository(prisma));
    const method = event.requestContext.http.method;
    if (method === "GET" && event.rawPath.endsWith("/portal/dashboard")) {
      return json(200, await loadDashboard(prisma, entitlement, service));
    }
    if (method === "GET" && event.rawPath.endsWith("/portal/profile")) {
      return json(200, await service.load(entitlement));
    }
    if (method === "POST" && event.rawPath.endsWith("/portal/profile")) {
      return json(200, await service.save(entitlement, parseBody(event.body, event.isBase64Encoded)));
    }
    if (method === "POST" && event.rawPath.endsWith("/portal/properties")) {
      await saveProperties(prisma, entitlement, parseBody(event.body, event.isBase64Encoded));
      return json(200, await loadDashboard(prisma, entitlement, service));
    }
    if (method === "POST" && event.rawPath.endsWith("/portal/business-investments")) {
      await saveBusinessInvestments(prisma, entitlement, parseBody(event.body, event.isBase64Encoded));
      return json(200, await loadDashboard(prisma, entitlement, service));
    }
    if (method === "POST" && event.rawPath.endsWith("/portal/ready-for-review")) {
      return json(200, await markReadyForReview(prisma, secrets, entitlement));
    }
    return json(501, { error: "NOT_IMPLEMENTED", message: "This protected portal endpoint is reserved for a later intake phase.", ...entitlement });
  } catch (error) {
    if (error instanceof PortalEntitlementError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof PortalProfileError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the profile fields.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "portal entitlement request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not verify portal access. Please try again." });
  }
};
