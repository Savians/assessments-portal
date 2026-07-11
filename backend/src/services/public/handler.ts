import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ZodError } from "zod";
import { getApplicationSecrets } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { getRuntimeConfig } from "../../shared/runtime-config";
import { PrismaAssessmentSessionRepository } from "./prisma-session-repository";
import { ResendResumeAgreementNotifier } from "./resend-resume-notifier";
import { ResumeEmailDeliveryError, StartAssessmentService } from "./start-assessment";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  },
  body: JSON.stringify(body)
});

const parseBody = (body: string | undefined, isBase64Encoded: boolean): unknown => {
  if (!body) throw new Error("Request body is required");
  const decoded = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  return JSON.parse(decoded) as unknown;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  const config = getRuntimeConfig();
  const path = event.rawPath || "/";
  const method = event.requestContext.http.method;

  log("info", "public assessment request", {
    requestId: context.awsRequestId,
    service: config.SERVICE_NAME,
    method,
    path
  });

  if (method === "GET" && path.endsWith("/health")) {
    return json(200, {
      ok: true,
      service: "public",
      environment: config.ENVIRONMENT,
      project: "savians-assessments"
    });
  }

  if (method === "POST" && path.endsWith("/api/assessment/start")) {
    try {
      const secrets = await getApplicationSecrets();
      const repository = new PrismaAssessmentSessionRepository(
        getPrismaClient(secrets.DATABASE_URL)
      );
      const service = new StartAssessmentService(
        repository,
        new ResendResumeAgreementNotifier(secrets),
        process.env.FRONTEND_URL ?? "http://localhost:3000"
      );
      const result = await service.execute(
        parseBody(event.body, event.isBase64Encoded),
        {
          ipAddress: event.requestContext.http.sourceIp,
          userAgent: event.headers["user-agent"]
        }
      );
      return json(result.resumed ? 200 : 201, result);
    } catch (error) {
      if (error instanceof ZodError) {
        return json(400, {
          error: "VALIDATION_ERROR",
          message: "Please correct the highlighted assessment fields.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        });
      }
      if (
        error instanceof SyntaxError ||
        (error instanceof Error &&
          ["Request body is required", "Phone must be a valid US number"].includes(error.message))
      ) {
        return json(400, {
          error: "INVALID_REQUEST",
          message: error.message
        });
      }
      if (error instanceof ResumeEmailDeliveryError) {
        return json(502, {
          error: "RESUME_EMAIL_DELIVERY_FAILED",
          message: error.message
        });
      }

      log("error", "start assessment failed", {
        requestId: context.awsRequestId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return json(500, {
        error: "INTERNAL_ERROR",
        message: "We could not start your assessment. Please try again."
      });
    }
  }

  if (method === "POST" && path.endsWith("/api/assessment/recover")) {
    try {
      const secrets = await getApplicationSecrets();
      const repository = new PrismaAssessmentSessionRepository(
        getPrismaClient(secrets.DATABASE_URL)
      );
      const service = new StartAssessmentService(
        repository,
        new ResendResumeAgreementNotifier(secrets),
        process.env.FRONTEND_URL ?? "http://localhost:3000"
      );
      return json(200, await service.recover(parseBody(event.body, event.isBase64Encoded), {
        ipAddress: event.requestContext.http.sourceIp,
        userAgent: event.headers["user-agent"]
      }));
    } catch (error) {
      if (error instanceof ZodError) {
        return json(400, {
          error: "VALIDATION_ERROR",
          message: "Please enter a valid email address.",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        });
      }
      if (error instanceof ResumeEmailDeliveryError) {
        return json(502, {
          error: "RESUME_EMAIL_DELIVERY_FAILED",
          message: error.message
        });
      }
      log("error", "recover assessment failed", {
        requestId: context.awsRequestId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return json(500, {
        error: "INTERNAL_ERROR",
        message: "We could not recover your assessment. Please try again."
      });
    }
  }

  return json(404, {
    error: "NOT_FOUND",
    message: "The requested assessment endpoint does not exist."
  });
};
