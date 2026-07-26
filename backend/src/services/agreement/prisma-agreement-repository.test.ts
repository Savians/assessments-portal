import { AssessmentStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { SignatureEvidence } from "./agreement-service";
import { PrismaAgreementRepository } from "./prisma-agreement-repository";

type SessionState = {
  id: string;
  status: AssessmentStatus;
  qbCustomerId?: string;
  qbCustomerRequestId?: string;
  qbInvoiceId?: string;
  qbInvoiceNumber?: string;
  qbInvoiceBalance?: number;
  qbInvoiceRequestId?: string;
  invoiceCreatedAt?: Date;
  invoiceSentAt?: Date;
};

const buildRepository = (
  initialStatus: AssessmentStatus,
  onFirstConditionalUpdate?: (state: SessionState) => boolean
) => {
  const state: SessionState = { id: "session-1", status: initialStatus };
  const history: Array<{ oldStatus: AssessmentStatus; newStatus: AssessmentStatus }> = [];
  let conditionalUpdates = 0;
  const tx = {
    assessmentSession: {
      findUniqueOrThrow: vi.fn(async () => ({ status: state.status })),
      updateMany: vi.fn(async ({ where, data }: {
        where: { status: AssessmentStatus };
        data: Partial<SessionState>;
      }) => {
        conditionalUpdates++;
        if (conditionalUpdates === 1 && onFirstConditionalUpdate?.(state)) {
          return { count: 0 };
        }
        if (where.status !== state.status) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      })
    },
    assessmentStatusHistory: {
      create: vi.fn(async ({ data }: {
        data: { oldStatus: AssessmentStatus; newStatus: AssessmentStatus };
      }) => {
        history.push({ oldStatus: data.oldStatus, newStatus: data.newStatus });
      })
    },
    auditLog: { create: vi.fn(async () => undefined) }
  };
  const prisma = {
    $transaction: vi.fn(async (
      operation: (client: typeof tx) => Promise<unknown>
    ) => operation(tx))
  } as unknown as PrismaClient;
  return {
    repository: new PrismaAgreementRepository(prisma),
    state,
    history,
    tx
  };
};

describe("PrismaAgreementRepository billing transitions", () => {
  it("advances only through allowed states and writes forward history", async () => {
    const { repository, state, history } = buildRepository(AssessmentStatus.AGREEMENT_SIGNED);

    await repository.saveQuickBooksCustomer("session-1", "customer-1", "customer-request");
    await repository.saveQuickBooksInvoice(
      "session-1",
      { id: "invoice-1", number: "1001", balance: 2997 },
      "invoice-request"
    );
    await repository.markInvoiceSent("session-1");

    expect(state.status).toBe(AssessmentStatus.PAYMENT_PENDING);
    expect(history).toEqual([
      {
        oldStatus: AssessmentStatus.AGREEMENT_SIGNED,
        newStatus: AssessmentStatus.QB_CUSTOMER_CREATED
      },
      {
        oldStatus: AssessmentStatus.QB_CUSTOMER_CREATED,
        newStatus: AssessmentStatus.INVOICE_CREATED
      },
      {
        oldStatus: AssessmentStatus.INVOICE_CREATED,
        newStatus: AssessmentStatus.PAYMENT_PENDING
      }
    ]);
  });

  it("preserves a later status and immutable billing data on a replay", async () => {
    const originalInvoiceSentAt = new Date("2026-07-01T00:00:00Z");
    const { repository, state, history, tx } = buildRepository(AssessmentStatus.COMPLETED);
    state.invoiceSentAt = originalInvoiceSentAt;

    await repository.markInvoiceSent("session-1");

    expect(state.status).toBe(AssessmentStatus.COMPLETED);
    expect(state.invoiceSentAt).toBe(originalInvoiceSentAt);
    expect(history).toEqual([]);
    expect(tx.assessmentSession.updateMany).not.toHaveBeenCalled();
  });

  it("preserves a concurrent paid transition instead of retrying backward", async () => {
    const { repository, state, history, tx } = buildRepository(
      AssessmentStatus.AGREEMENT_SIGNED,
      (current) => {
        current.status = AssessmentStatus.PAID_VERIFIED;
        return true;
      }
    );

    await repository.saveQuickBooksCustomer("session-1", "customer-1", "customer-request");

    expect(state.status).toBe(AssessmentStatus.PAID_VERIFIED);
    expect(state.qbCustomerId).toBeUndefined();
    expect(history).toEqual([]);
    expect(tx.assessmentSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it("treats a same-target retry as an idempotent no-op", async () => {
    const originalInvoiceSentAt = new Date("2026-07-01T00:00:00Z");
    const { repository, state, history, tx } = buildRepository(AssessmentStatus.PAYMENT_PENDING);
    state.invoiceSentAt = originalInvoiceSentAt;

    await repository.markInvoiceSent("session-1");

    expect(state.invoiceSentAt).toBe(originalInvoiceSentAt);
    expect(history).toEqual([]);
    expect(tx.assessmentSession.updateMany).not.toHaveBeenCalled();
  });
});

describe("PrismaAgreementRepository signature acceptance", () => {
  it("atomically preserves first-writer evidence and records one monotonic transition", async () => {
    const firstSignedAt = new Date("2026-07-05T12:00:00Z");
    const secondSignedAt = new Date("2026-07-05T12:00:01Z");
    const firstEvidence: SignatureEvidence = {
      sessionId: "session-1",
      templateId: "template-1",
      typedSignatureName: "Jane Q Client",
      agreementDisplayDate: new Date("2026-07-05T00:00:00Z"),
      signedAt: firstSignedAt,
      ipAddress: "203.0.113.1",
      userAgent: "first-agent",
      templateVersion: "2026-v1",
      templateTitle: "First agreement",
      docxSha256: "d".repeat(64),
      pdfSha256: "p".repeat(64),
      consentTextVersion: "agreement-v1",
      acknowledgementAcceptedAt: firstSignedAt,
      evidencePayloadSha256: "a".repeat(64)
    };
    const secondEvidence: SignatureEvidence = {
      ...firstEvidence,
      templateId: "template-2",
      signedAt: secondSignedAt,
      acknowledgementAcceptedAt: secondSignedAt,
      ipAddress: "203.0.113.2",
      userAgent: "second-agent",
      templateVersion: "2026-v2",
      templateTitle: "Losing agreement",
      evidencePayloadSha256: "b".repeat(64)
    };
    const firstTemplate = {
      id: "template-1",
      version: "2026-v1",
      title: "First agreement",
      docxS3Key: "legal/first.docx",
      pdfS3Key: "legal/first.pdf",
      docxSha256: "d".repeat(64),
      pdfSha256: "p".repeat(64),
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      deprecatedAt: null,
      isActive: true,
      sourceFileName: "first.docx",
      consentTextVersion: "agreement-v1",
      createdAt: new Date("2026-01-01T00:00:00Z")
    };
    let persistedEvidence: SignatureEvidence | undefined;
    let status: AssessmentStatus = AssessmentStatus.AGREEMENT_PENDING;
    const history: unknown[] = [];
    const audits: Array<{ data: Record<string, unknown> }> = [];
    const tx = {
      agreementSignature: {
        upsert: vi.fn(async ({ create }: { create: SignatureEvidence }) => {
          persistedEvidence ??= create;
          return {
            signedAt: persistedEvidence.signedAt,
            evidencePayloadSha256:
              persistedEvidence.evidencePayloadSha256,
            ipAddress: persistedEvidence.ipAddress ?? null,
            userAgent: persistedEvidence.userAgent ?? null,
            template: firstTemplate
          };
        })
      },
      assessmentSession: {
        updateMany: vi.fn(async () => {
          if (status !== AssessmentStatus.AGREEMENT_PENDING) {
            return { count: 0 };
          }
          status = AssessmentStatus.AGREEMENT_SIGNED;
          return { count: 1 };
        })
      },
      assessmentStatusHistory: {
        create: vi.fn(async (input: unknown) => {
          history.push(input);
        })
      },
      auditLog: {
        create: vi.fn(async (input: { data: Record<string, unknown> }) => {
          audits.push(input);
        })
      }
    };
    const prisma = {
      $transaction: vi.fn(async (
        operation: (client: typeof tx) => Promise<unknown>
      ) => operation(tx))
    } as unknown as PrismaClient;
    const repository = new PrismaAgreementRepository(prisma);

    const first = await repository.acceptSignature(firstEvidence);
    const second = await repository.acceptSignature(secondEvidence);

    expect(persistedEvidence).toEqual(firstEvidence);
    expect(first).toMatchObject({
      signedAt: firstSignedAt,
      evidencePayloadSha256: firstEvidence.evidencePayloadSha256,
      template: { id: "template-1", version: "2026-v1" }
    });
    expect(second).toEqual(first);
    expect(status).toBe(AssessmentStatus.AGREEMENT_SIGNED);
    expect(history).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.data).toMatchObject({
      ipAddress: firstEvidence.ipAddress,
      userAgent: firstEvidence.userAgent,
      metadata: {
        templateVersion: firstEvidence.templateVersion,
        evidencePayloadSha256: firstEvidence.evidencePayloadSha256
      }
    });
    expect(tx.agreementSignature.upsert).toHaveBeenCalledTimes(2);
  });

  it("refreshes an existing private download token expiry on every delivery attempt", async () => {
    const upsert = vi.fn(async () => undefined);
    const repository = new PrismaAgreementRepository({
      recoveryToken: { upsert }
    } as unknown as PrismaClient);
    const expiresAt = new Date("2026-08-05T00:00:00Z");

    await repository.ensureAgreementDownloadToken({
      sessionId: "session-1",
      tokenHash: "f".repeat(64),
      expiresAt
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: "f".repeat(64) },
      update: { expiresAt }
    }));
  });

  it("selects FAILED and SKIPPED confirmations for retry and treats only SENT as terminal", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaAgreementRepository({
      assessmentSession: { findMany }
    } as unknown as PrismaClient);

    await expect(
      repository.findAgreementConfirmationCandidates(10)
    ).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        signatures: { some: {} },
        emailEvents: {
          none: {
            templateKey: "AGREEMENT_SIGNED_CONFIRMATION",
            status: "SENT"
          }
        }
      }),
      take: 10
    }));
  });
});
