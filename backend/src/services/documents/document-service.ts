import { randomUUID } from "node:crypto";
import path from "node:path";
import { DocumentCategory, DocumentStatus, AssessmentStatus, type PrismaClient } from "@prisma/client";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import type { PortalEntitlement } from "../portal/profile-service";

const categories = Object.values(DocumentCategory) as [DocumentCategory, ...DocumentCategory[]];

export class DocumentServiceError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

const uploadRequestSchema = z.object({
  category: z.enum(categories, { error: "Document category is required." }),
  fileName: z.string().trim().min(1, "File name is required.").max(255, "File name is too long."),
  contentType: z.string().trim().min(1, "File type is required.").max(127, "File type is too long."),
  sizeBytes: z.number().int().positive("File cannot be empty.").max(25 * 1024 * 1024, "Each document must be 25 MB or smaller.")
});

const completeRequestSchema = z.object({
  documentId: z.string().uuid(),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024)
});

const documentIdSchema = z.string().uuid();

const safeFileName = (name: string) => {
  const parsed = path.parse(name.trim());
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16);
  return `${base}${ext}`;
};

const inlineDisposition = (name: string) => `inline; filename="${safeFileName(name).replace(/"/g, "")}"`;

const retentionDate = () => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 7);
  return date;
};

export class DocumentService {
  private readonly s3 = new S3Client({});

  constructor(
    private readonly prisma: PrismaClient,
    private readonly bucket: string,
    private readonly environmentName: string
  ) {}

  async list(entitlement: PortalEntitlement) {
    await this.assertDocumentsUnlocked(entitlement);
    const documents = await this.prisma.documentMetadata.findMany({
      where: { sessionId: entitlement.sessionId, clientId: entitlement.clientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, category: true, status: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true }
    });
    return {
      documents: documents.map((document) => ({
        ...document,
        sizeBytes: Number(document.sizeBytes),
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString()
      }))
    };
  }

  async createUploadUrl(entitlement: PortalEntitlement, raw: unknown) {
    const input = uploadRequestSchema.parse(raw);
    const session = await this.assertDocumentsUnlocked(entitlement);
    const profile = await this.prisma.clientProfile.findUnique({ where: { sessionId: entitlement.sessionId }, select: { id: true } });
    if (!profile?.id) throw new DocumentServiceError("PROFILE_REQUIRED", "Complete your profile before uploading documents.", 409);

    const objectKey = [
      "assessments",
      this.environmentName,
      "client-documents",
      entitlement.assessmentYear.toString(),
      entitlement.sessionId,
      input.category,
      `${randomUUID()}-${safeFileName(input.fileName)}`
    ].join("/");

    const document = await this.prisma.documentMetadata.create({
      data: {
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        profileId: profile.id,
        category: input.category,
        status: DocumentStatus.PENDING,
        originalName: input.fileName,
        s3Bucket: this.bucket,
        s3Key: objectKey,
        mimeType: input.contentType,
        sizeBytes: BigInt(input.sizeBytes),
        retentionUntil: retentionDate(),
        legalHold: session.legalHold
      },
      select: { id: true, s3Key: true }
    });

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType
      }),
      { expiresIn: 10 * 60 }
    );

    return { documentId: document.id, uploadUrl, expiresInSeconds: 600 };
  }

  async completeUpload(entitlement: PortalEntitlement, raw: unknown) {
    const input = completeRequestSchema.parse(raw);
    await this.assertDocumentsUnlocked(entitlement);
    const updated = await this.prisma.$transaction(async (tx) => {
      const document = await tx.documentMetadata.findFirst({
        where: { id: input.documentId, clientId: entitlement.clientId, sessionId: entitlement.sessionId, deletedAt: null }
      });
      if (!document) throw new DocumentServiceError("DOCUMENT_NOT_FOUND", "We could not find this document upload.", 404);
      const saved = await tx.documentMetadata.update({
        where: { id: document.id },
        data: { status: DocumentStatus.UPLOADED, sizeBytes: BigInt(input.sizeBytes) },
        select: { id: true, category: true, status: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true }
      });
      const session = await tx.assessmentSession.findUnique({ where: { id: entitlement.sessionId }, select: { status: true } });
      if (session?.status === AssessmentStatus.PROFILE_COMPLETED) {
        await tx.assessmentSession.update({
          where: { id: entitlement.sessionId },
          data: { status: AssessmentStatus.DOCUMENTS_IN_PROGRESS, documentUploadAllowed: true }
        });
        await tx.assessmentStatusHistory.create({
          data: {
            sessionId: entitlement.sessionId,
            oldStatus: AssessmentStatus.PROFILE_COMPLETED,
            newStatus: AssessmentStatus.DOCUMENTS_IN_PROGRESS,
            reason: "Client uploaded first assessment document.",
            actorType: "CLIENT",
            actorId: entitlement.clientId
          }
        });
      }
      return saved;
    });
    return {
      document: {
        ...updated,
        sizeBytes: Number(updated.sizeBytes),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString()
      }
    };
  }

  async createPreviewUrl(entitlement: PortalEntitlement, rawDocumentId: unknown) {
    const documentId = documentIdSchema.parse(rawDocumentId);
    await this.assertDocumentsUnlocked(entitlement);
    const document = await this.prisma.documentMetadata.findFirst({
      where: {
        id: documentId,
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        deletedAt: null,
        status: { in: [DocumentStatus.UPLOADED, DocumentStatus.CLEAN] }
      },
      select: { id: true, originalName: true, mimeType: true, s3Bucket: true, s3Key: true }
    });
    if (!document) throw new DocumentServiceError("DOCUMENT_NOT_FOUND", "We could not find this uploaded document.", 404);

    const previewUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: document.s3Bucket,
        Key: document.s3Key,
        ResponseContentType: document.mimeType,
        ResponseContentDisposition: inlineDisposition(document.originalName)
      }),
      { expiresIn: 10 * 60 }
    );

    return {
      documentId: document.id,
      previewUrl,
      expiresInSeconds: 600
    };
  }

  async removeDocument(entitlement: PortalEntitlement, rawDocumentId: unknown) {
    const documentId = documentIdSchema.parse(rawDocumentId);
    await this.assertDocumentsUnlocked(entitlement);
    const document = await this.prisma.documentMetadata.findFirst({
      where: {
        id: documentId,
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        deletedAt: null
      },
      select: { id: true, legalHold: true }
    });
    if (!document) throw new DocumentServiceError("DOCUMENT_NOT_FOUND", "We could not find this document.", 404);

    await this.prisma.documentMetadata.update({
      where: { id: document.id },
      data: { status: DocumentStatus.DELETED, deletedAt: new Date() }
    });

    await this.prisma.auditLog.create({
      data: {
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId,
        action: "DOCUMENT_REMOVED_BY_CLIENT",
        entityType: "DocumentMetadata",
        entityId: document.id,
        actorType: "CLIENT",
        actorId: entitlement.clientId,
        metadata: {
          retainedInS3: true,
          legalHold: document.legalHold
        }
      }
    });

    return { ok: true };
  }

  private async assertDocumentsUnlocked(entitlement: PortalEntitlement) {
    const session = await this.prisma.assessmentSession.findFirst({
      where: {
        id: entitlement.sessionId,
        clientId: entitlement.clientId,
        assessmentYear: entitlement.assessmentYear,
        status: { in: [AssessmentStatus.PROFILE_COMPLETED, AssessmentStatus.DOCUMENTS_IN_PROGRESS, AssessmentStatus.DOCUMENTS_SUBMITTED] }
      },
      select: { id: true, legalHold: true }
    });
    if (!session) throw new DocumentServiceError("DOCUMENTS_LOCKED", "Complete your profile before uploading documents.", 409);
    return session;
  }
}
