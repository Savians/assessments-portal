import {
  AssessmentStatus,
  DeliveryStatus,
  type PrismaClient
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaPaymentRepository } from "./prisma-payment-repository";

describe("PrismaPaymentRepository invoice reconciliation metadata", () => {
  it.each([
    { label: "persists a recovered invoice number", invoiceNumber: "1001" },
    { label: "does not clear an invoice number when none is supplied", invoiceNumber: undefined }
  ])("$label while recording a still-open invoice", async ({ invoiceNumber }) => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      assessmentSession: { update },
      paymentReconciliation: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockResolvedValue([])
    } as unknown as PrismaClient;
    const repository = new PrismaPaymentRepository(prisma);
    const checkedAt = new Date("2026-07-05T12:00:00.000Z");

    await repository.recordStillOpen(
      "session-1",
      2997,
      checkedAt,
      invoiceNumber
    );

    const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({
      qbInvoiceBalance: 2997,
      lastStatusCheckedAt: checkedAt
    });
    if (invoiceNumber) {
      expect(data.qbInvoiceNumber).toBe(invoiceNumber);
    } else {
      expect(data).not.toHaveProperty("qbInvoiceNumber");
    }
  });

  it.each([
    {
      label: "the initial paid transition",
      status: AssessmentStatus.PAYMENT_PENDING,
      transitionCount: 1
    },
    {
      label: "a later account status",
      status: AssessmentStatus.ACCOUNT_INVITED,
      transitionCount: 0
    }
  ])("persists a recovered invoice number during $label", async ({
    status,
    transitionCount
  }) => {
    const checkedAt = new Date("2026-07-05T12:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: transitionCount });
    const transaction = {
      assessmentSession: {
        findUniqueOrThrow: vi.fn()
          .mockResolvedValueOnce({ status })
          .mockResolvedValueOnce({
            id: "session-1",
            normalizedEmail: "client@example.com",
            firstName: "Jane",
            phone: "+19185550123",
            assessmentYear: 2026,
            serviceAmount: { toNumber: () => 2997 },
            currency: "USD",
            status: transitionCount === 1
              ? AssessmentStatus.PAID_VERIFIED
              : status,
            statusTokenExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
            qbInvoiceId: "invoice-1",
            qbInvoiceNumber: "1001",
            qbInvoiceBalance: { toNumber: () => 0 },
            invoiceSentAt: new Date("2026-07-05T11:00:00.000Z"),
            lastStatusCheckedAt: checkedAt,
            paymentVerifiedAt: checkedAt,
            accountCreationAllowed: true
          }),
        updateMany,
        update
      },
      paymentReconciliation: { create: vi.fn().mockResolvedValue({}) },
      assessmentStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (client: typeof transaction) => Promise<unknown>
      ) => callback(transaction))
    } as unknown as PrismaClient;
    const repository = new PrismaPaymentRepository(prisma);

    await expect(repository.recordPaidVerified(
      "session-1",
      0,
      checkedAt,
      "1001"
    )).resolves.toMatchObject({
      session: { qbInvoiceNumber: "1001" }
    });

    const persistenceCall = transitionCount === 1
      ? updateMany.mock.calls[0]?.[0]
      : update.mock.calls[0]?.[0];
    expect(persistenceCall).toEqual(expect.objectContaining({
      data: expect.objectContaining({ qbInvoiceNumber: "1001" })
    }));
  });
});

describe("PrismaPaymentRepository payment-confirmation retries", () => {
  it("selects every paid forward status that has no SENT confirmation", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      assessmentSession: { findMany }
    } as unknown as PrismaClient;
    const repository = new PrismaPaymentRepository(prisma);

    await repository.findOpenInvoiceSessions(25);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        qbInvoiceId: { not: null },
        OR: [
          {
            status: {
              in: [
                AssessmentStatus.PAYMENT_PENDING,
                AssessmentStatus.PAYMENT_VERIFYING
              ]
            }
          },
          {
            status: {
              in: [
                AssessmentStatus.PAID_VERIFIED,
                AssessmentStatus.ACCOUNT_INVITED,
                AssessmentStatus.ACCOUNT_CREATED,
                AssessmentStatus.PROFILE_IN_PROGRESS,
                AssessmentStatus.PROFILE_COMPLETED,
                AssessmentStatus.DOCUMENTS_IN_PROGRESS,
                AssessmentStatus.DOCUMENTS_SUBMITTED,
                AssessmentStatus.IN_PROGRESS,
                AssessmentStatus.COMPLETED
              ]
            },
            accountCreationAllowed: true,
            emailEvents: {
              none: {
                templateKey: "PAYMENT_CONFIRMED",
                status: DeliveryStatus.SENT
              }
            }
          }
        ]
      },
      take: 25
    }));
  });

  it("treats only SENT as terminal when checking retry eligibility", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "event-1" });
    const prisma = {
      emailEvent: { findFirst }
    } as unknown as PrismaClient;
    const repository = new PrismaPaymentRepository(prisma);

    await expect(repository.shouldSendPaymentConfirmation("session-1"))
      .resolves.toBe(true);
    await expect(repository.shouldSendPaymentConfirmation("session-1"))
      .resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        templateKey: "PAYMENT_CONFIRMED",
        status: DeliveryStatus.SENT
      },
      select: { id: true }
    });
  });

  it.each([DeliveryStatus.FAILED, DeliveryStatus.SKIPPED])(
    "updates a prior %s row to SENT under the session lock",
    async (priorStatus) => {
      const update = vi.fn().mockResolvedValue({});
      const create = vi.fn();
      const transaction = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "session-1" }]),
        emailEvent: {
          findFirst: vi.fn().mockResolvedValue({
            id: "event-1",
            status: priorStatus
          }),
          update,
          create
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) }
      };
      const prisma = {
        $transaction: vi.fn(async (
          callback: (client: typeof transaction) => Promise<void>
        ) => callback(transaction))
      } as unknown as PrismaClient;
      const repository = new PrismaPaymentRepository(prisma);
      const sentAt = new Date("2026-07-05T12:00:00.000Z");

      await repository.recordPaymentConfirmationEmail({
        sessionId: "session-1",
        recipientEmail: "client@example.com",
        status: "SENT",
        providerMessageId: "resend-payment-1",
        sentAt
      });

      expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: "event-1" },
        data: {
          recipientEmail: "client@example.com",
          providerMessageId: "resend-payment-1",
          status: DeliveryStatus.SENT,
          failureReason: null,
          sentAt
        }
      });
      expect(create).not.toHaveBeenCalled();
    }
  );

  it("does not overwrite an existing SENT row", async () => {
    const update = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "session-1" }]),
      emailEvent: {
        findFirst: vi.fn().mockResolvedValue({
          id: "event-1",
          status: DeliveryStatus.SENT
        }),
        update,
        create: vi.fn()
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (client: typeof transaction) => Promise<void>
      ) => callback(transaction))
    } as unknown as PrismaClient;
    const repository = new PrismaPaymentRepository(prisma);

    await repository.recordPaymentConfirmationEmail({
      sessionId: "session-1",
      recipientEmail: "client@example.com",
      status: "FAILED",
      failureReason: "late timeout",
      sentAt: new Date("2026-07-05T12:00:00.000Z")
    });

    expect(update).not.toHaveBeenCalled();
  });
});
