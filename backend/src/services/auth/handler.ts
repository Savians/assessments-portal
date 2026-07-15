import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ZodError } from "zod";
import { getApplicationSecrets } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { AccountAuthError, AccountAuthService } from "./account-auth-service";
import { AwsCognitoAccountGateway } from "./cognito-account-gateway";
import { PrismaAccountAuthRepository } from "./prisma-account-auth-repository";
import { ResendAccountInviteNotifier } from "./resend-account-invite-notifier";

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  body: JSON.stringify(body)
});
const parseBody = (body: string | undefined, base64: boolean): unknown => {
  if (!body) throw new AccountAuthError("INVALID_REQUEST", "Request body is required.", 400);
  return JSON.parse(base64 ? Buffer.from(body, "base64").toString("utf8") : body) as unknown;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  try {
    const secrets = await getApplicationSecrets();
    const repository = new PrismaAccountAuthRepository(getPrismaClient(secrets.DATABASE_URL));
    const service = new AccountAuthService(repository, new AwsCognitoAccountGateway(), new ResendAccountInviteNotifier(secrets), process.env.FRONTEND_URL ?? "http://localhost:3000");
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const body = parseBody(event.body, event.isBase64Encoded);

    if (method === "POST" && path.endsWith("/account/invite/reissue")) return json(200, await service.reissueInvite(body));
    if (method === "POST" && path.endsWith("/account/invite/start")) return json(200, await service.startBrowserInvite(body));
    if (method === "POST" && path.endsWith("/account/invite/validate")) return json(200, await service.validateInvite(body));
    if (method === "POST" && path.endsWith("/account/setup")) return json(200, await service.startSetup(body));
    if (method === "POST" && path.endsWith("/account/verification/resend")) return json(200, await service.resendVerificationCode(body));
    if (method === "POST" && path.endsWith("/account/confirm")) return json(200, await service.confirm(body));
    if (method === "POST" && path.endsWith("/account/password-reset/request")) return json(200, await service.requestPasswordReset(body));
    if (method === "POST" && path.endsWith("/account/password-reset/confirm")) return json(200, await service.confirmPasswordReset(body));
    if (method === "POST" && path.endsWith("/account/existing/claim")) {
      const requestContext = event.requestContext as typeof event.requestContext & { authorizer?: { jwt?: { claims?: unknown } } };
      return json(200, await service.claimExistingAccount(body, requestContext.authorizer?.jwt?.claims));
    }
    return json(404, { error: "NOT_FOUND", message: "The requested account endpoint does not exist." });
  } catch (error) {
    if (error instanceof AccountAuthError) return json(error.statusCode, { error: error.code, message: error.message });
    if (error instanceof ZodError) return json(400, { error: "VALIDATION_ERROR", message: "Please correct the account setup fields.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON", message: "The request body is invalid." });
    log("error", "account setup request failed", { requestId: context.awsRequestId, error: error instanceof Error ? error.message : "Unknown error" });
    return json(500, { error: "INTERNAL_ERROR", message: "We could not process account setup. Please try again." });
  }
};
