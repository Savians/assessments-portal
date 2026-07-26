import {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AwsCognitoAccountGateway } from "./cognito-account-gateway";

const user = {
  UserAttributes: [
    { Name: "sub", Value: "sub-1" },
    { Name: "email_verified", Value: "true" }
  ]
};

describe("AwsCognitoAccountGateway mutation stages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.COGNITO_USER_POOL_ID;
  });

  it("labels a password-reset preflight failure as definitely before mutation", async () => {
    process.env.COGNITO_USER_POOL_ID = "pool-1";
    vi.spyOn(CognitoIdentityProviderClient.prototype, "send")
      .mockRejectedValueOnce(new Error("Cognito lookup failed"));
    const gateway = new AwsCognitoAccountGateway();

    await expect(gateway.setPermanentPassword({
      email: "client@example.com",
      password: "SecurePassword123!"
    })).rejects.toMatchObject({
      operation: "SET_PERMANENT_PASSWORD",
      stage: "BEFORE_MUTATION",
      message: "Cognito lookup failed"
    });
  });

  it("labels a failure after password mutation starts as mutation-attempted", async () => {
    process.env.COGNITO_USER_POOL_ID = "pool-1";
    const send = vi.spyOn(CognitoIdentityProviderClient.prototype, "send")
      .mockImplementation(async (command) => {
        if (command instanceof AdminGetUserCommand) return user;
        if (command instanceof AdminSetUserPasswordCommand) return {};
        if (command instanceof AdminUpdateUserAttributesCommand) {
          throw new Error("Cognito attribute update failed");
        }
        return {};
      });
    const gateway = new AwsCognitoAccountGateway();

    await expect(gateway.setPermanentPassword({
      email: "client@example.com",
      password: "SecurePassword123!"
    })).rejects.toMatchObject({
      operation: "SET_PERMANENT_PASSWORD",
      stage: "MUTATION_ATTEMPTED",
      message: "Cognito attribute update failed"
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(AdminGetUserCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(AdminSetUserPasswordCommand);
  });

  it("uses the same stage contract for account confirmation", async () => {
    process.env.COGNITO_USER_POOL_ID = "pool-1";
    vi.spyOn(CognitoIdentityProviderClient.prototype, "send")
      .mockResolvedValueOnce(user as never)
      .mockRejectedValueOnce(new Error("Cognito verification update failed"));
    const gateway = new AwsCognitoAccountGateway();

    await expect(gateway.confirmSignUp({
      email: "client@example.com",
      confirmationCode: "123456"
    })).rejects.toMatchObject({
      operation: "CONFIRM_SIGN_UP",
      stage: "MUTATION_ATTEMPTED",
      message: "Cognito verification update failed"
    });
  });
});
