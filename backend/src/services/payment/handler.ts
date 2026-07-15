import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { z, ZodError } from "zod";
import { getApplicationSecrets, persistQuickBooksRefreshToken } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { IntuitQuickBooksGateway } from "../agreement/quickbooks-client";
import { ResendInvoiceStatusNotifier } from "../agreement/resend-invoice-status-notifier";
import { PaymentFlowError, PaymentStatusService } from "./payment-service";
import { PrismaPaymentRepository } from "./prisma-payment-repository";

const tokenBody = z.object({ token: z.string().min(32).max(256) });
const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body)
});
const parseBody = (body: string | undefined, base64: boolean): unknown => {
  if (!body) throw new PaymentFlowError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const repository = new PrismaPaymentRepository(getPrismaClient(secrets.DATABASE_URL));
    const quickBooks = new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken);
    const service = new PaymentStatusService(repository, quickBooks, new ResendInvoiceStatusNotifier(secrets), process.env.FRONTEND_URL ?? "http://localhost:3000");
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === "GET") {
      const token = event.pathParameters?.token;
      if (!token) throw new PaymentFlowError("INVALID_TOKEN", "Status token is required.", 400);
      return json(200, await service.load(token));
    }
    if (method === "POST" && path.endsWith("/refresh-payment-status")) {
      const input = tokenBody.parse(parseBody(event.body, event.isBase64Encoded));
      return json(200, await service.refresh(input.token));
    }
    if (method === "POST" && path.endsWith("/resend-invoice-email")) {
      const input = tokenBody.parse(parseBody(event.body, event.isBase64Encoded));
      return json(200, await service.resendInvoiceEmail(input.token));
    }
    return json(404, { error: "NOT_FOUND", message: "The requested payment endpoint does not exist." });
  } catch (error) {
    if (error instanceof PaymentFlowError) return json(error.statusCode, {
      error: error.code,
      message: error.message,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
    });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the payment request.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "payment request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not process payment status. Please try again." });
  }
};
