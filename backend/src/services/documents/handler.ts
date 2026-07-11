import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ZodError } from "zod";
import { getApplicationSecrets } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { assertPaidPortalEntitlement, PortalEntitlementError, type PortalClaims } from "../portal/portal-entitlement";
import { DocumentService, DocumentServiceError } from "./document-service";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body)
});

const parseBody = (body: string | undefined, base64: boolean): unknown => {
  if (!body) throw new DocumentServiceError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const prisma = getPrismaClient(secrets.DATABASE_URL);
    const requestContext = event.requestContext as typeof event.requestContext & { authorizer?: { jwt?: { claims?: PortalClaims } } };
    const entitlement = await assertPaidPortalEntitlement(prisma, requestContext.authorizer?.jwt?.claims ?? {});
    const service = new DocumentService(prisma, process.env.S3_DOCUMENTS_BUCKET ?? "", process.env.ENVIRONMENT ?? "staging");
    const method = event.requestContext.http.method;
    if (method === "GET" && event.rawPath.endsWith("/documents")) {
      return json(200, await service.list(entitlement));
    }
    if (method === "GET" && event.rawPath.includes("/documents/") && event.rawPath.endsWith("/preview-url")) {
      return json(200, await service.createPreviewUrl(entitlement, event.pathParameters?.documentId));
    }
    if (method === "POST" && event.rawPath.endsWith("/documents/upload-url")) {
      return json(200, await service.createUploadUrl(entitlement, parseBody(event.body, event.isBase64Encoded)));
    }
    if (method === "POST" && event.rawPath.endsWith("/documents/complete")) {
      return json(200, await service.completeUpload(entitlement, parseBody(event.body, event.isBase64Encoded)));
    }
    if (method === "DELETE" && event.rawPath.includes("/documents/")) {
      return json(200, await service.removeDocument(entitlement, event.pathParameters?.documentId));
    }
    return json(404, { error: "NOT_FOUND", message: "The requested document endpoint does not exist." });
  } catch (error) {
    if (error instanceof PortalEntitlementError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof DocumentServiceError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the document fields.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "document request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not process the document request. Please try again." });
  }
};
