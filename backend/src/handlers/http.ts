import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { log } from "../shared/logger";
import { getRuntimeConfig } from "../shared/runtime-config";

const json = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  },
  body: JSON.stringify(body)
});

export const handler: APIGatewayProxyHandlerV2 = (event, context) => {
  const config = getRuntimeConfig();
  const path = event.rawPath || "/";
  const method = event.requestContext.http.method;

  log("info", "assessment request", {
    requestId: context.awsRequestId,
    service: config.SERVICE_NAME,
    method,
    path
  });

  if (method === "GET" && path.endsWith("/health")) {
    return Promise.resolve(json(200, {
      ok: true,
      service: config.SERVICE_NAME,
      environment: config.ENVIRONMENT,
      project: "savians-assessments"
    }));
  }

  return Promise.resolve(json(501, {
    error: "NOT_IMPLEMENTED",
    message: "This endpoint is reserved by the Phase 1 foundation."
  }));
};
