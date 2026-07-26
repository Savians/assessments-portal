import { AssessmentStatus, DocumentStatus, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DocumentService } from "./document-service";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn()
}));

const entitlement = {
  clientId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  assessmentYear: 2026
};

const unlockedSession = (input: { where: { status: { in: AssessmentStatus[] } } }) =>
  input.where.status.in.includes(AssessmentStatus.ACCOUNT_CREATED)
    ? { id: entitlement.sessionId, legalHold: false }
    : null;

describe("DocumentService independent post-payment access", () => {
  beforeEach(() => {
    vi.mocked(getSignedUrl).mockReset();
    vi.mocked(getSignedUrl).mockResolvedValue("https://uploads.example.com/document");
  });

  it("lists documents immediately after paid account setup without a completed profile", async () => {
    const findFirst = vi.fn(unlockedSession);
    const prisma = {
      assessmentSession: { findFirst },
      documentMetadata: { findMany: vi.fn().mockResolvedValue([]) }
    } as unknown as PrismaClient;

    await expect(new DocumentService(prisma, "documents-bucket", "production").list(entitlement))
      .resolves.toEqual({ documents: [] });
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("creates an upload record with no profile relation when profile setup is deferred", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      s3Key: "document-key"
    });
    const prisma = {
      assessmentSession: { findFirst: vi.fn(unlockedSession) },
      clientProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      documentMetadata: { create }
    } as unknown as PrismaClient;

    await expect(new DocumentService(prisma, "documents-bucket", "production").createUploadUrl(
      entitlement,
      {
        category: "TAX_RETURNS",
        fileName: "passport.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024
      }
    )).resolves.toMatchObject({
      documentId: "33333333-3333-4333-8333-333333333333",
      uploadUrl: "https://uploads.example.com/document"
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        profileId: null,
        clientId: entitlement.clientId,
        sessionId: entitlement.sessionId
      })
    }));
  });

  it("moves an account-created session into document progress after its first upload", async () => {
    const updateSession = vi.fn().mockResolvedValue({});
    const createHistory = vi.fn().mockResolvedValue({});
    const uploadedAt = new Date("2026-07-26T12:00:00.000Z");
    const tx = {
      documentMetadata: {
        findFirst: vi.fn().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" }),
        update: vi.fn().mockResolvedValue({
          id: "33333333-3333-4333-8333-333333333333",
          category: "TAX_RETURNS",
          status: DocumentStatus.UPLOADED,
          originalName: "passport.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024n,
          createdAt: uploadedAt,
          updatedAt: uploadedAt
        })
      },
      assessmentSession: {
        findUnique: vi.fn().mockResolvedValue({ status: AssessmentStatus.ACCOUNT_CREATED }),
        update: updateSession
      },
      assessmentStatusHistory: { create: createHistory }
    };
    const prisma = {
      assessmentSession: { findFirst: vi.fn(unlockedSession) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaClient;

    await new DocumentService(prisma, "documents-bucket", "production").completeUpload(
      entitlement,
      {
        documentId: "33333333-3333-4333-8333-333333333333",
        sizeBytes: 1024
      }
    );

    expect(updateSession).toHaveBeenCalledWith({
      where: { id: entitlement.sessionId },
      data: {
        status: AssessmentStatus.DOCUMENTS_IN_PROGRESS,
        documentUploadAllowed: true
      }
    });
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldStatus: AssessmentStatus.ACCOUNT_CREATED,
        newStatus: AssessmentStatus.DOCUMENTS_IN_PROGRESS
      })
    });
  });
});
