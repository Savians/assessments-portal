import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ZodError } from "zod";
import { getApplicationSecrets, persistQuickBooksRefreshToken } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { AgreementFlowError, AgreementService } from "./agreement-service";
import { PrismaAgreementRepository } from "./prisma-agreement-repository";
import { IntuitQuickBooksGateway, type QuickBooksGateway } from "./quickbooks-client";
import { ResendInvoiceStatusNotifier } from "./resend-invoice-status-notifier";
import { S3AgreementPdfProvider } from "./s3-agreement-pdf-provider";

const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, body: JSON.stringify(body) });
const parseBody = (body: string | undefined, base64: boolean): unknown => {
  if (!body) throw new AgreementFlowError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const repository = new PrismaAgreementRepository(getPrismaClient(secrets.DATABASE_URL));
    let gateway: QuickBooksGateway | undefined;
    const quickBooks: QuickBooksGateway = {
      findOrCreateCustomer: (input) => (gateway ??= new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken)).findOrCreateCustomer(input),
      createInvoice: (input) => (gateway ??= new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken)).createInvoice(input),
      sendInvoice: (id, email, requestId) => (gateway ??= new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken)).sendInvoice(id, email, requestId)
    };
    const service = new AgreementService(repository, new S3AgreementPdfProvider(process.env.S3_DOCUMENTS_BUCKET ?? ""), quickBooks, new ResendInvoiceStatusNotifier(secrets), process.env.FRONTEND_URL ?? "http://localhost:3000");
    const method = event.requestContext.http.method;
    if (method === "GET") {
      const token = event.pathParameters?.token;
      if (!token) throw new AgreementFlowError("INVALID_TOKEN", "Agreement token is required.", 400);
      return json(200, await service.load(token));
    }
    if (method === "POST" && event.rawPath.endsWith("/agreement/sign")) {
      return json(200, await service.accept(parseBody(event.body, event.isBase64Encoded), { ipAddress: event.requestContext.http.sourceIp, userAgent: event.headers["user-agent"] }));
    }
    return json(404, { error: "NOT_FOUND", message: "The requested agreement endpoint does not exist." });
  } catch (error) {
    if (error instanceof AgreementFlowError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the agreement fields.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "agreement request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not process the agreement. Please try again." });
  }
};