import { DeliveryStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaAccountAuthRepository } from "./prisma-account-auth-repository";

describe("PrismaAccountAuthRepository account verification email audit", () => {
  it.each([
    {
      status: "SENT" as const,
      providerMessageId: "resend-message-1",
      failureReason: undefined
    },
    {
      status: "FAILED" as const,
      providerMessageId: undefined,
      failureReason: "Resend rejected the message"
    },
    {
      status: "SKIPPED" as const,
      providerMessageId: undefined,
      failureReason: undefined
    }
  ])("persists matching EmailEvent and AuditLog rows for $status delivery", async ({
    status,
    providerMessageId,
    failureReason
  }) => {
    const emailEventCreate = vi.fn().mockResolvedValue({ id: "email-event-1" });
    const auditLogCreate = vi.fn().mockResolvedValue({ id: "audit-log-1" });
    const transactionClient = {
      emailEvent: { create: emailEventCreate },
      auditLog: { create: auditLogCreate }
    };
    const transaction = vi.fn(async (
      operation: (tx: typeof transactionClient) => Promise<unknown>
    ) => operation(transactionClient));
    const repository = new PrismaAccountAuthRepository({
      $transaction: transaction
    } as unknown as PrismaClient);
    const sentAt = new Date("2026-07-06T00:00:00Z");

    await repository.recordAccountVerificationEmail({
      sessionId: "session-1",
      recipientEmail: "client@example.com",
      status,
      providerMessageId,
      failureReason,
      sentAt
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(emailEventCreate).toHaveBeenCalledWith({
      data: {
        sessionId: "session-1",
        templateKey: "ACCOUNT_VERIFICATION_CODE",
        recipientEmail: "client@example.com",
        providerMessageId,
        status: DeliveryStatus[status],
        failureReason,
        sentAt: status === "SENT" ? sentAt : undefined
      }
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        sessionId: "session-1",
        action: `ACCOUNT_VERIFICATION_EMAIL_${status}`,
        entityType: "EMAIL_EVENT",
        entityId: "email-event-1",
        actorType: "SYSTEM",
        metadata: {
          templateKey: "ACCOUNT_VERIFICATION_CODE",
          recipientEmail: "client@example.com",
          status,
          providerMessageId: providerMessageId ?? null,
          failureReason: failureReason ?? null
        }
      }
    });
  });
});
