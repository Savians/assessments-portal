import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRuntimeConfigForTests } from "../shared/runtime-config";
import { handler } from "./http";

const context = { awsRequestId: "test-request" } as Context;

function event(path: string, method = "GET"): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
      requestId: "test",
      routeKey: "$default",
      stage: "$default",
      time: "now",
      timeEpoch: 0
    },
    isBase64Encoded: false
  };
}

describe("foundation handler", () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = "public";
    process.env.ENVIRONMENT = "test";
    clearRuntimeConfigForTests();
  });

  it("returns a healthy foundation response", async () => {
    const result = await handler(event("/api/assessment/health"), context, () => undefined);
    expect(result).toBeDefined();
    expect(
      typeof result === "object" && result !== null && "statusCode" in result
        ? result.statusCode
        : undefined
    ).toBe(200);
  });

  it("does not pretend reserved routes are implemented", async () => {
    const result = await handler(event("/api/assessment/start", "POST"), context, () => undefined);
    expect(
      typeof result === "object" && result !== null && "statusCode" in result
        ? result.statusCode
        : undefined
    ).toBe(501);
  });
});
