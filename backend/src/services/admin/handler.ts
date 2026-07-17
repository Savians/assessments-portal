import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomBytes } from "node:crypto";
import { AdminDeleteUserCommand, AdminUpdateUserAttributesCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AssessmentStatus, DocumentCategory, DocumentStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { getApplicationSecrets } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { PrismaPortalProfileRepository } from "../portal/prisma-profile-repository";
import { PortalProfileService, savePortalProfileSchema } from "../portal/profile-service";
import { AdminAccessError, assertAssessmentAdmin, type AdminClaims, type AdminIdentity } from "./admin-auth";
import { buildClientSearchWhere } from "./admin-client-search";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body, (_key, value) => typeof value === "bigint" ? Number(value) : value)
});

class AdminRequestError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) { super(message); }
}

const parseBody = (body: string | undefined, base64: boolean) => {
  if (!body) throw new AdminRequestError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};
const optionalText = (max: number) => z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(max).nullable().optional());
const nullableNumber = z.number().finite().nullable().optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const identitySchema = z.object({
  firstName: z.string().trim().min(1).max(60), middleName: optionalText(60), lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()), phone: z.string().trim().min(7).max(32), dateOfBirth: dateOnly,
  clientType: z.enum(["INDIVIDUAL", "BUSINESS_OWNER", "REAL_ESTATE_INVESTOR", "W2_HIGH_EARNER", "OTHER"]), businessName: optionalText(255),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), incomeRange: optionalText(50), estimatedTaxPaidRange: optionalText(50)
});
const ownerSchema = z.object({ ownerName: z.string().trim().min(1).max(200), ownershipPercentage: z.number().min(0).max(100) });
const propertySchema = z.object({
  category: z.string().trim().min(1).max(50), propertyType: z.string().trim().min(1).max(50), label: z.string().trim().min(1).max(150), fullAddress: z.string().trim().min(1).max(300),
  acquiredYear: z.number().int().min(1900).max(new Date().getUTCFullYear() + 1), acquiredMethod: z.string().trim().min(1).max(40), purchaseBasis: nullableNumber, currentFmv: nullableNumber,
  landValue: nullableNumber, mortgageBalance: nullableNumber, monthlyPayment: nullableNumber, mortgageCompany: optionalText(150), interestRate: nullableNumber,
  mortgageTermYears: z.number().int().positive().max(100).nullable().optional(), taxYearUse: z.string().trim().min(1).max(50), rentalStartDate: z.union([dateOnly, z.literal("")]).nullable().optional(),
  daysRented: z.number().int().min(0).max(366).nullable().optional(), personalUseDays: z.number().int().min(0).max(366).nullable().optional(), projectedGrossRent: nullableNumber,
  priorInterestPaid: nullableNumber, priorTaxPaid: nullableNumber, totalExpenses: nullableNumber, owners: z.array(ownerSchema).max(10), notes: optionalText(2000)
});
const propertiesSchema = z.object({ properties: z.array(propertySchema).max(50) });
const businessSchema = z.object({
  entityName: z.string().trim().min(1).max(255), entityType: z.string().trim().min(1).max(60), ownershipPercent: z.number().min(0).max(100), taxClassification: z.string().trim().min(1).max(60),
  priorYearIncomeLoss: nullableNumber, priorYear: z.number().int().min(1900).max(new Date().getUTCFullYear()).nullable().optional(), incomeLossYearMinus3: nullableNumber,
  incomeLossYearMinus2: nullableNumber, incomeLossYearMinus1: nullableNumber, projectedCurrentYearIncomeLoss: nullableNumber, active: z.boolean().nullable().optional(), notes: optionalText(2000)
});
const businessesSchema = z.object({ businessInvestments: z.array(businessSchema).max(50) });
const statusSchema = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED"]), reason: z.string().trim().max(500).optional() });
const manualClientSchema = identitySchema.extend({
  assessmentYear: z.number().int().min(2000).max(new Date().getUTCFullYear() + 1),
  status: z.enum(["PENDING_UPLOADS", "READY_FOR_REVIEW", "IN_PROGRESS", "COMPLETED"]).default("COMPLETED")
});
const deleteClientSchema = z.object({ confirmationEmail: z.string().trim().email().transform((value) => value.toLowerCase()) });

const manualStatus = (status: z.infer<typeof manualClientSchema>["status"]): AssessmentStatus => ({
  PENDING_UPLOADS: AssessmentStatus.PROFILE_IN_PROGRESS,
  READY_FOR_REVIEW: AssessmentStatus.DOCUMENTS_SUBMITTED,
  IN_PROGRESS: AssessmentStatus.IN_PROGRESS,
  COMPLETED: AssessmentStatus.COMPLETED
})[status];

const sevenYearsFrom = (date: Date) => {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + 7);
  return result;
};

const publicLabel = (status: AssessmentStatus) => {
  const paymentStatuses: AssessmentStatus[] = [AssessmentStatus.PAYMENT_PENDING, AssessmentStatus.PAYMENT_VERIFYING, AssessmentStatus.INVOICE_CREATED, AssessmentStatus.INVOICE_SENT];
  if (paymentStatuses.includes(status)) return "Payment Pending";
  if (status === AssessmentStatus.DOCUMENTS_SUBMITTED) return "Ready for Review";
  if (status === AssessmentStatus.IN_PROGRESS) return "In Progress";
  if (status === AssessmentStatus.COMPLETED) return "Completed";
  return "Pending Uploads";
};
const statusFilter = (label?: string): AssessmentStatus[] | undefined => {
  if (label === "PAYMENT_PENDING") return [AssessmentStatus.INVOICE_CREATED, AssessmentStatus.INVOICE_SENT, AssessmentStatus.PAYMENT_PENDING, AssessmentStatus.PAYMENT_VERIFYING];
  if (label === "READY_FOR_REVIEW") return [AssessmentStatus.DOCUMENTS_SUBMITTED];
  if (label === "IN_PROGRESS") return [AssessmentStatus.IN_PROGRESS];
  if (label === "COMPLETED") return [AssessmentStatus.COMPLETED];
  if (label === "PENDING_UPLOADS") return [AssessmentStatus.PAID_VERIFIED, AssessmentStatus.ACCOUNT_INVITED, AssessmentStatus.ACCOUNT_CREATED, AssessmentStatus.PROFILE_IN_PROGRESS, AssessmentStatus.PROFILE_COMPLETED, AssessmentStatus.DOCUMENTS_IN_PROGRESS];
  return undefined;
};

async function listClients(prisma: PrismaClient, query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 25)), search = query.search?.trim(), statuses = statusFilter(query.status);
  const where: Prisma.AssessmentSessionWhereInput = { deletedAt: null, ...(query.year ? { assessmentYear: Number(query.year) } : {}), ...(statuses ? { status: { in: statuses } } : {}), ...(search ? buildClientSearchWhere(search) : {}) };
  const [total, rows] = await prisma.$transaction([prisma.assessmentSession.count({ where }), prisma.assessmentSession.findMany({ where, select: {
    id: true, clientId: true, firstName: true, middleName: true, lastName: true, normalizedEmail: true, phone: true, assessmentYear: true, status: true, qbInvoiceNumber: true,
    qbInvoiceBalance: true, paymentVerifiedAt: true, updatedAt: true, _count: { select: { documents: { where: { deletedAt: null, status: { in: [DocumentStatus.UPLOADED, DocumentStatus.CLEAN] } } } } }
  }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items: rows.map(({ _count, ...row }) => ({ ...row, statusLabel: publicLabel(row.status), qbInvoiceBalance: row.qbInvoiceBalance === null ? null : Number(row.qbInvoiceBalance), documentCount: _count.documents })) };
}

async function overview(prisma: PrismaClient) {
  const [sessions, documents] = await Promise.all([prisma.assessmentSession.findMany({ where: { deletedAt: null }, select: { status: true, assessmentYear: true } }), prisma.documentMetadata.aggregate({ where: { deletedAt: null, status: { in: [DocumentStatus.UPLOADED, DocumentStatus.CLEAN] } }, _count: true, _sum: { sizeBytes: true } })]);
  const counts = { paymentPending: 0, pendingUploads: 0, readyForReview: 0, inProgress: 0, completed: 0 };
  for (const session of sessions) { const label = publicLabel(session.status); if (label === "Payment Pending") counts.paymentPending++; else if (label === "Ready for Review") counts.readyForReview++; else if (label === "In Progress") counts.inProgress++; else if (label === "Completed") counts.completed++; else counts.pendingUploads++; }
  return { totalClients: sessions.length, ...counts, documentCount: documents._count, documentBytes: Number(documents._sum.sizeBytes ?? 0), years: [...new Set(sessions.map(({ assessmentYear }) => assessmentYear))].sort((a, b) => b - a) };
}

async function detail(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.assessmentSession.findFirst({ where: { id: sessionId, deletedAt: null }, include: {
    client: { select: { id: true, cognitoUserId: true, normalizedEmail: true, emailVerifiedAt: true } }, profile: { include: { householdMembers: { orderBy: { createdAt: "asc" } }, properties: { include: { owners: true }, orderBy: { createdAt: "asc" } }, businessInvestments: { orderBy: { createdAt: "asc" } } } },
    documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } }, statusHistory: { orderBy: { createdAt: "desc" }, take: 100 }, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 }
  } });
  if (!session) throw new AdminRequestError("CLIENT_NOT_FOUND", "Assessment client was not found.", 404);
  return { ...session, statusLabel: publicLabel(session.status) };
}

async function createManualClient(prisma: PrismaClient, admin: AdminIdentity, raw: unknown) {
  const input = manualClientSchema.parse(raw);
  const duplicate = await prisma.assessmentSession.findFirst({ where: { normalizedEmail: input.email, serviceCode: "TAX_ASSESSMENT", assessmentYear: input.assessmentYear }, select: { id: true, deletedAt: true } });
  if (duplicate) throw new AdminRequestError("CLIENT_YEAR_ALREADY_EXISTS", duplicate.deletedAt ? "A deleted assessment already exists for this email and year. Contact support to restore it." : "This client already has an assessment for that year.", 409);
  const existingClient = await prisma.assessmentClient.findUnique({ where: { normalizedEmail: input.email }, select: { id: true, deletedAt: true } });
  if (existingClient?.deletedAt) throw new AdminRequestError("CLIENT_DELETED", "This client was previously deleted and must be restored through the retention workflow.", 409);

  const now = new Date(), targetStatus = manualStatus(input.status), retentionUntil = sevenYearsFrom(now);
  const session = await prisma.$transaction(async (tx) => {
    const client = existingClient ?? await tx.assessmentClient.create({ data: { normalizedEmail: input.email, emailVerifiedAt: now }, select: { id: true } });
    const created = await tx.assessmentSession.create({ data: {
      clientId: client.id, normalizedEmail: input.email, phone: input.phone, firstName: input.firstName, middleName: input.middleName ?? null, lastName: input.lastName,
      dateOfBirth: new Date(input.dateOfBirth + "T00:00:00.000Z"), clientType: input.clientType, businessName: input.businessName ?? null, state: input.state,
      incomeRange: input.incomeRange ?? null, estimatedTaxPaidRange: input.estimatedTaxPaidRange ?? null, consentAcceptedAt: now, consentVersion: "admin-manual-import-v1",
      assessmentYear: input.assessmentYear, status: targetStatus, statusTokenHash: randomBytes(32).toString("hex"), statusTokenExpiresAt: now,
      accountCreationAllowed: false, documentUploadAllowed: false, retentionUntil
    } });
    await tx.assessmentStatusHistory.create({ data: { sessionId: created.id, oldStatus: null, newStatus: targetStatus, reason: "Historical client added manually by " + admin.email + ".", actorType: admin.role, actorId: admin.id } });
    await tx.auditLog.create({ data: { clientId: client.id, sessionId: created.id, action: "ADMIN_HISTORICAL_CLIENT_CREATED", entityType: "AssessmentSession", entityId: created.id, actorType: admin.role, actorId: admin.id, metadata: { assessmentYear: input.assessmentYear, importedStatus: input.status } } });
    return created;
  });
  return detail(prisma, session.id);
}

async function deleteClient(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const input = deleteClientSchema.parse(raw);
  const selected = await prisma.assessmentSession.findFirst({ where: { id: sessionId, deletedAt: null }, select: { id: true, clientId: true, normalizedEmail: true, legalHold: true, retentionUntil: true } });
  if (!selected) throw new AdminRequestError("CLIENT_NOT_FOUND", "Assessment client was not found.", 404);
  if (input.confirmationEmail !== selected.normalizedEmail) throw new AdminRequestError("DELETE_CONFIRMATION_MISMATCH", "Enter the client's exact email address to confirm deletion.", 400);
  const sessionWhere: Prisma.AssessmentSessionWhereInput = selected.clientId ? { clientId: selected.clientId, deletedAt: null } : { id: selected.id, deletedAt: null };
  const sessions = await prisma.assessmentSession.findMany({ where: sessionWhere, select: { id: true, legalHold: true, retentionUntil: true } });
  const sessionIds = sessions.map(({ id }) => id);
  const heldDocument = await prisma.documentMetadata.findFirst({ where: { sessionId: { in: sessionIds }, legalHold: true }, select: { id: true } });
  if (selected.legalHold || sessions.some(({ legalHold }) => legalHold) || heldDocument) throw new AdminRequestError("LEGAL_HOLD_ACTIVE", "This client cannot be deleted while a legal hold is active.", 409);

  if (selected.clientId) {
    const client = await prisma.assessmentClient.findUnique({ where: { id: selected.clientId }, select: { cognitoUserId: true } });
    if (client?.cognitoUserId) {
      try {
        await new CognitoIdentityProviderClient({}).send(new AdminDeleteUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID, Username: selected.normalizedEmail }));
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "UserNotFoundException") throw error;
      }
    }
  }

  const now = new Date();
  const documentCount = await prisma.$transaction(async (tx) => {
    const documents = await tx.documentMetadata.updateMany({ where: { sessionId: { in: sessionIds }, deletedAt: null }, data: { deletedAt: now, status: DocumentStatus.DELETED } });
    await tx.accountInvite.updateMany({ where: { sessionId: { in: sessionIds }, revokedAt: null }, data: { revokedAt: now } });
    await tx.recoveryToken.updateMany({ where: { sessionId: { in: sessionIds }, usedAt: null }, data: { usedAt: now } });
    await tx.assessmentSession.updateMany({ where: { id: { in: sessionIds } }, data: { deletedAt: now, accountCreationAllowed: false, documentUploadAllowed: false, statusTokenExpiresAt: now } });
    if (selected.clientId) await tx.assessmentClient.update({ where: { id: selected.clientId }, data: { deletedAt: now } });
    await tx.auditLog.create({ data: { clientId: selected.clientId, sessionId: selected.id, action: "ADMIN_CLIENT_DELETED", entityType: "AssessmentClient", entityId: selected.clientId ?? selected.id, actorType: admin.role, actorId: admin.id, metadata: { affectedSessionIds: sessionIds, documentCount: documents.count, retentionPolicy: "SEVEN_YEARS", portalAccessRevoked: true } } });
    return documents.count;
  });
  const retainedUntil = sessions.map(({ retentionUntil }) => retentionUntil).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? sevenYearsFrom(now);
  return { deleted: true, affectedSessions: sessionIds.length, documentCount, retainedUntil };
}

async function audit(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, action: string, metadata?: Prisma.InputJsonValue) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { clientId: true } });
  await prisma.auditLog.create({ data: { clientId: session.clientId, sessionId, action, entityType: "AssessmentSession", entityId: sessionId, actorType: admin.role, actorId: admin.id, metadata } });
}

async function updateIdentity(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const input = identitySchema.parse(raw), existing = await prisma.assessmentSession.findUnique({ where: { id: sessionId }, include: { client: { select: { id: true, cognitoUserId: true } } } });
  if (!existing) throw new AdminRequestError("CLIENT_NOT_FOUND", "Assessment client was not found.", 404);
  const emailChanged = input.email !== existing.normalizedEmail;
  if (emailChanged) {
    const [sessionConflict, clientConflict] = await Promise.all([
      prisma.assessmentSession.findFirst({ where: { id: { not: sessionId }, normalizedEmail: input.email, serviceCode: existing.serviceCode, assessmentYear: existing.assessmentYear }, select: { id: true } }),
      prisma.assessmentClient.findFirst({ where: { normalizedEmail: input.email, ...(existing.client ? { id: { not: existing.client.id } } : {}) }, select: { id: true } })
    ]);
    if (sessionConflict || clientConflict) throw new AdminRequestError("EMAIL_ALREADY_IN_USE", "That email address already belongs to another assessment client.", 409);
  }
  if (emailChanged && existing.client?.cognitoUserId) await new CognitoIdentityProviderClient({}).send(new AdminUpdateUserAttributesCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID, Username: existing.normalizedEmail, UserAttributes: [{ Name: "email", Value: input.email }, { Name: "email_verified", Value: "true" }] }));
  await prisma.$transaction(async (tx) => {
    await tx.assessmentSession.update({ where: { id: sessionId }, data: { ...input, middleName: input.middleName ?? null, businessName: input.businessName ?? null, incomeRange: input.incomeRange ?? null, estimatedTaxPaidRange: input.estimatedTaxPaidRange ?? null, dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`), normalizedEmail: input.email } });
    if (existing.client) await tx.assessmentClient.update({ where: { id: existing.client.id }, data: { normalizedEmail: input.email, emailVerifiedAt: emailChanged ? new Date() : undefined } });
  });
  await audit(prisma, admin, sessionId, "ADMIN_CLIENT_IDENTITY_UPDATED", { emailChanged }); return detail(prisma, sessionId);
}

async function saveProfile(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const input = savePortalProfileSchema.parse(raw), session = await prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { clientId: true, assessmentYear: true } });
  if (!session?.clientId) throw new AdminRequestError("CLIENT_ACCOUNT_REQUIRED", "This client has not created a paid portal account yet.", 409);
  await new PortalProfileService(new PrismaPortalProfileRepository(prisma)).save({ clientId: session.clientId, sessionId, assessmentYear: session.assessmentYear }, input);
  await audit(prisma, admin, sessionId, "ADMIN_CLIENT_PROFILE_UPDATED"); return detail(prisma, sessionId);
}

async function saveProperties(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const { properties } = propertiesSchema.parse(raw), profile = await prisma.clientProfile.findUnique({ where: { sessionId }, select: { id: true } });
  if (!profile) throw new AdminRequestError("PROFILE_REQUIRED", "Create the client profile before adding real estate.", 409);
  await prisma.$transaction(async (tx) => { await tx.property.deleteMany({ where: { profileId: profile.id } }); for (const { owners, rentalStartDate, ...property } of properties) { const created = await tx.property.create({ data: { profileId: profile.id, ...property, rentalStartDate: rentalStartDate ? new Date(`${rentalStartDate}T00:00:00.000Z`) : null }, select: { id: true } }); if (owners.length) await tx.propertyOwner.createMany({ data: owners.map((owner) => ({ propertyId: created.id, ...owner })) }); } });
  await audit(prisma, admin, sessionId, "ADMIN_REAL_ESTATE_UPDATED", { count: properties.length }); return detail(prisma, sessionId);
}

async function saveBusinesses(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const { businessInvestments } = businessesSchema.parse(raw), profile = await prisma.clientProfile.findUnique({ where: { sessionId }, select: { id: true } });
  if (!profile) throw new AdminRequestError("PROFILE_REQUIRED", "Create the client profile before adding business entities.", 409);
  await prisma.$transaction(async (tx) => { await tx.businessInvestment.deleteMany({ where: { profileId: profile.id } }); if (businessInvestments.length) await tx.businessInvestment.createMany({ data: businessInvestments.map((business) => ({ profileId: profile.id, ...business })) }); });
  await audit(prisma, admin, sessionId, "ADMIN_BUSINESS_ENTITIES_UPDATED", { count: businessInvestments.length }); return detail(prisma, sessionId);
}

async function updateStatus(prisma: PrismaClient, admin: AdminIdentity, sessionId: string, raw: unknown) {
  const input = statusSchema.parse(raw), session = await prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { status: true, clientId: true } });
  if (!session) throw new AdminRequestError("CLIENT_NOT_FOUND", "Assessment client was not found.", 404);
  const target = input.status === "IN_PROGRESS" ? AssessmentStatus.IN_PROGRESS : AssessmentStatus.COMPLETED;
  const adminStatuses: AssessmentStatus[] = [AssessmentStatus.DOCUMENTS_SUBMITTED, AssessmentStatus.IN_PROGRESS, AssessmentStatus.COMPLETED];
  if (!adminStatuses.includes(session.status)) throw new AdminRequestError("STATUS_TRANSITION_NOT_ALLOWED", "Only assessments submitted for review can be moved to In Progress or Completed.", 409);
  await prisma.$transaction([prisma.assessmentSession.update({ where: { id: sessionId }, data: { status: target } }), prisma.assessmentStatusHistory.create({ data: { sessionId, oldStatus: session.status, newStatus: target, reason: input.reason || `Changed by ${admin.email}.`, actorType: admin.role, actorId: admin.id } }), prisma.auditLog.create({ data: { clientId: session.clientId, sessionId, action: "ADMIN_ASSESSMENT_STATUS_CHANGED", entityType: "AssessmentSession", entityId: sessionId, actorType: admin.role, actorId: admin.id, metadata: { from: session.status, to: target, reason: input.reason ?? null } } })]);
  return detail(prisma, sessionId);
}

async function listDocuments(prisma: PrismaClient, query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 25)), search = query.search?.trim();
  const category = query.category && Object.values(DocumentCategory).includes(query.category as DocumentCategory) ? query.category as DocumentCategory : undefined;
  const where: Prisma.DocumentMetadataWhereInput = { deletedAt: null, ...(category ? { category } : {}), ...(search ? { OR: [{ originalName: { contains: search, mode: "insensitive" } }, { session: { normalizedEmail: { contains: search, mode: "insensitive" } } }, { session: { firstName: { contains: search, mode: "insensitive" } } }, { session: { lastName: { contains: search, mode: "insensitive" } } }] } : {}) };
  const [total, items] = await prisma.$transaction([prisma.documentMetadata.count({ where }), prisma.documentMetadata.findMany({ where, include: { session: { select: { id: true, firstName: true, middleName: true, lastName: true, normalizedEmail: true, assessmentYear: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items };
}

async function previewDocument(prisma: PrismaClient, admin: AdminIdentity, documentId: string) {
  const document = await prisma.documentMetadata.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!document) throw new AdminRequestError("DOCUMENT_NOT_FOUND", "Document was not found.", 404);
  const previewUrl = await getSignedUrl(new S3Client({}), new GetObjectCommand({ Bucket: document.s3Bucket, Key: document.s3Key, ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`, ResponseContentType: document.mimeType }), { expiresIn: 300 });
  await audit(prisma, admin, document.sessionId, "ADMIN_DOCUMENT_VIEWED", { documentId: document.id, category: document.category }); return { previewUrl, expiresInSeconds: 300 };
}

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const requestContext = event.requestContext as typeof event.requestContext & { authorizer?: { jwt?: { claims?: AdminClaims } } }, admin = assertAssessmentAdmin(requestContext.authorizer?.jwt?.claims ?? {});
    const secrets = await getApplicationSecrets(), prisma = getPrismaClient(secrets.DATABASE_URL), method = event.requestContext.http.method, path = event.rawPath, query = event.queryStringParameters ?? {};
    if (method === "GET" && path.endsWith("/admin/overview")) return json(200, await overview(prisma));
    if (method === "GET" && path.endsWith("/admin/clients")) return json(200, await listClients(prisma, query));
    if (method === "POST" && path.endsWith("/admin/clients")) return json(201, await createManualClient(prisma, admin, parseBody(event.body, event.isBase64Encoded)));
    if (method === "GET" && path.endsWith("/admin/documents")) return json(200, await listDocuments(prisma, query));
    if (method === "GET" && path.endsWith("/preview-url")) return json(200, await previewDocument(prisma, admin, event.pathParameters?.documentId ?? ""));
    const sessionId = event.pathParameters?.sessionId ?? "";
    if (method === "GET" && /\/admin\/clients\/[^/]+$/.test(path)) return json(200, await detail(prisma, sessionId));
    const raw = () => parseBody(event.body, event.isBase64Encoded);
    if (method === "DELETE" && /\/admin\/clients\/[^/]+$/.test(path)) return json(200, await deleteClient(prisma, admin, sessionId, raw()));
    if (method === "PUT" && path.endsWith("/identity")) return json(200, await updateIdentity(prisma, admin, sessionId, raw()));
    if (method === "PUT" && path.endsWith("/profile")) return json(200, await saveProfile(prisma, admin, sessionId, raw()));
    if (method === "PUT" && path.endsWith("/properties")) return json(200, await saveProperties(prisma, admin, sessionId, raw()));
    if (method === "PUT" && path.endsWith("/business-investments")) return json(200, await saveBusinesses(prisma, admin, sessionId, raw()));
    if (method === "PUT" && path.endsWith("/status")) return json(200, await updateStatus(prisma, admin, sessionId, raw()));
    return json(404, { error: "NOT_FOUND", message: "The requested admin endpoint does not exist." });
  } catch (error) {
    if (error instanceof AdminAccessError || error instanceof AdminRequestError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the highlighted admin fields.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "assessment admin request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not complete the admin request." });
  }
};
