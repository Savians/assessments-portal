import {
  AssessmentStatus,
  DeliveryStatus,
  type PrismaClient
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaPaymentRepository } from "./prisma-payment-repository";

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
