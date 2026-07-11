import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ZodError } from "zod";
import { getApplicationSecrets, persistQuickBooksRefreshToken } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { IntuitQuickBooksGateway } from "../agreement/quickbooks-client";
import { ResendInvoiceStatusNotifier } from "../agreement/resend-invoice-status-notifier";
import { PaymentStatusService } from "../payment/payment-service";
import { PrismaPaymentRepository } from "../payment/prisma-payment-repository";
import { QuickBooksWebhookError, QuickBooksWebhookProcessor, verifyQuickBooksSignature } from "./quickbooks-webhook";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body)
});
const rawBody = (body: string | undefined, base64: boolean): string => Buffer.from(body ?? "", base64 ? "base64" : "utf8").toString("utf8");

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const body = rawBody(event.body, event.isBase64Encoded);
    const signature = event.headers["intuit-signature"] ?? event.headers["Intuit-Signature"];
    verifyQuickBooksSignature(body, signature, secrets.QB_WEBHOOK_VERIFIER_TOKEN);

    const prisma = getPrismaClient(secrets.DATABASE_URL);
    const repository = new PrismaPaymentRepository(prisma);
    const quickBooks = new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken);
    const paymentStatus = new PaymentStatusService(repository, quickBooks, new ResendInvoiceStatusNotifier(secrets), process.env.FRONTEND_URL ?? "http://localhost:3000");
    const processor = new QuickBooksWebhookProcessor(prisma, paymentStatus);
    return json(200, await processor.process(body));
  } catch (error) {
    if (error instanceof QuickBooksWebhookError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError || error instanceof SyntaxError) return json(400, { error: "INVALID_WEBHOOK_PAYLOAD", message: "The QuickBooks webhook payload is invalid." });
    log("error", "quickbooks webhook failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "The QuickBooks webhook could not be processed." });
  }
};
