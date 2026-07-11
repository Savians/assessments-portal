import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";
import { z } from "zod";
import type { CognitoAccountGateway } from "./account-auth-service";

const configSchema = z.object({
  COGNITO_USER_POOL_ID: z.string().min(1)
});

const isUsernameExists = (error: unknown): boolean =>
  error instanceof Error && error.name === "UsernameExistsException";

export class AwsCognitoAccountGateway implements CognitoAccountGateway {
  private readonly client = new CognitoIdentityProviderClient({});
  private readonly config = configSchema.parse(process.env);

  async signUp(input: { email: string; password: string; fullName: string }): Promise<void> {
    let createdUser = false;
    try {
      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: input.email,
          MessageAction: "SUPPRESS",
          UserAttributes: [
            { Name: "email", Value: input.email },
            { Name: "name", Value: input.fullName },
            { Name: "email_verified", Value: "false" }
          ]
        })
      );
      createdUser = true;
    } catch (error) {
      if (!isUsernameExists(error)) throw error;
    }

    if (createdUser) {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: input.email,
          Password: input.password,
          Permanent: true
        })
      );
    }
  }

  async confirmSignUp(input: {
    email: string;
    confirmationCode: string;
  }): Promise<{ userSub: string; emailVerified: boolean }> {
    await this.client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: input.email,
        UserAttributes: [{ Name: "email_verified", Value: "true" }]
      })
    );

    const user = await this.client.send(
      new AdminGetUserCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: input.email
      })
    );
    const userSub = user.UserAttributes?.find((attribute) => attribute.Name === "sub")?.Value;
    const emailVerified =
      user.UserAttributes?.find((attribute) => attribute.Name === "email_verified")?.Value ===
      "true";
    if (!userSub) throw new Error("Cognito confirmed user is missing sub");
    if (!emailVerified) throw new Error("Cognito confirmed user email is not verified");

    await this.client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: input.email,
        GroupName: "ASSESSMENT_CLIENT"
      })
    );
    return { userSub, emailVerified };
  }
}
