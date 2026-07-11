import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { Prisma, WebhookStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { PaymentStatusService } from "../payment/payment-service";

const webhookPayloadSchema = z.object({
  eventNotifications: z.array(z.object({
    realmId: z.string(),
    dataChangeEvent: z.object({
      entities: z.array(z.object({
        name: z.string(),
        id: z.string(),
        operation: z.string(),
        lastUpdated: z.string().optional()
      }))
    })
  })).default([])
});

export class QuickBooksWebhookError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

export const verifyQuickBooksSignature = (rawBody: string, signature: string | undefined, verifierToken: string | undefined): void => {
  if (!verifierToken) throw new QuickBooksWebhookError("WEBHOOK_NOT_CONFIGURED", "QuickBooks webhook verifier token is not configured.", 503);
  if (!signature) throw new QuickBooksWebhookError("MISSING_SIGNATURE", "QuickBooks webhook signature is missing.", 401);
  const expected = createHmac("sha256", verifierToken).update(rawBody).digest("base64");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new QuickBooksWebhookError("INVALID_SIGNATURE", "QuickBooks webhook signature is invalid.", 401);
  }
};

export class QuickBooksWebhookProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentStatus: PaymentStatusService
  ) {}

  async process(rawBody: string): Promise<{ received: number; processed: number; ignored: number }> {
    const payload = webhookPayloadSchema.parse(JSON.parse(rawBody) as unknown);
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    let received = 0;
    let processed = 0;
    let ignored = 0;

    for (const notification of payload.eventNotifications) {
      for (const entity of notification.dataChangeEvent.entities) {
        received++;
        const providerEventId = `${notification.realmId}:${entity.name}:${entity.id}:${entity.operation}:${entity.lastUpdated ?? payloadSha256}`;
        const created = await this.storeEvent(providerEventId, notification.realmId, entity, payloadSha256);
        if (!created) {
          ignored++;
          continue;
        }
        try {
          if (entity.name === "Invoice") {
            const result = await this.paymentStatus.reconcileInvoiceId(entity.id);
            if (result) processed++;
            else ignored++;
          } else if (entity.name === "Payment") {
            const result = await this.paymentStatus.reconcileOpenInvoices(25);
            processed += result.checked;
          } else {
            ignored++;
          }
          await this.prisma.webhookEvent.update({
            where: { providerEventId },
            data: { status: WebhookStatus.PROCESSED, processedAt: new Date() }
          });
        } catch (error) {
          await this.prisma.webhookEvent.update({
            where: { providerEventId },
            data: { status: WebhookStatus.FAILED, processedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unknown webhook processing error" }
          });
        }
      }
    }
    return { received, processed, ignored };
  }

  private async storeEvent(
    providerEventId: string,
    realmId: string,
    entity: { name: string; id: string; operation: string },
    payloadSha256: string
  ): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          providerEventId,
          realmId,
          entityType: entity.name,
          entityId: entity.id,
          operation: entity.operation,
          payloadSha256,
          status: WebhookStatus.VERIFIED
        }
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
}
