import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  type AdminGetUserCommandOutput
} from "@aws-sdk/client-cognito-identity-provider";
import { z } from "zod";
import {
  CognitoMutationError,
  type CognitoAccountGateway,
  type CognitoMutationOperation
} from "./account-auth-service";

const configSchema = z.object({
  COGNITO_USER_POOL_ID: z.string().min(1)
});

const isUsernameExists = (error: unknown): boolean =>
  error instanceof Error && error.name === "UsernameExistsException";
const isUserNotFound = (error: unknown): boolean =>
  error instanceof Error && error.name === "UserNotFoundException";

export class AwsCognitoAccountGateway implements CognitoAccountGateway {
  private readonly client = new CognitoIdentityProviderClient({});
  private readonly config = configSchema.parse(process.env);

  private async getUserBeforeMutation(
    email: string,
    operation: CognitoMutationOperation
  ): Promise<AdminGetUserCommandOutput> {
    try {
      return await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: email
        })
      );
    } catch (error) {
      throw new CognitoMutationError(operation, "BEFORE_MUTATION", error);
    }
  }

  async accountExists(email: string): Promise<boolean> {
    try {
      await this.client.send(new AdminGetUserCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: email.trim().toLowerCase()
      }));
      return true;
    } catch (error) {
      if (isUserNotFound(error)) return false;
      throw error;
    }
  }

  async prepareAccount(input: { email: string; password: string; fullName: string }): Promise<{ status: "PASSWORD_SET" | "EXISTING_ACCOUNT" }> {
    let existingUser: AdminGetUserCommandOutput | undefined;
    try {
      existingUser = await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: input.email
        })
      );
    } catch (error) {
      if (!isUserNotFound(error)) throw error;
    }

    if (!existingUser) {
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
      } catch (error) {
        if (!isUsernameExists(error)) throw error;
        existingUser = await this.client.send(
          new AdminGetUserCommand({
            UserPoolId: this.config.COGNITO_USER_POOL_ID,
            Username: input.email
          })
        );
      }
    }

    if (existingUser) return { status: "EXISTING_ACCOUNT" };

    await this.client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: input.email,
        UserAttributes: [
          { Name: "email", Value: input.email },
          { Name: "name", Value: input.fullName },
          { Name: "email_verified", Value: "false" }
        ]
      })
    );
    await this.client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.config.COGNITO_USER_POOL_ID,
        Username: input.email,
        Password: input.password,
        Permanent: true
      })
    );
    return { status: "PASSWORD_SET" };
  }

  async confirmSignUp(input: {
    email: string;
    confirmationCode: string;
  }): Promise<{ userSub: string; emailVerified: boolean }> {
    await this.getUserBeforeMutation(input.email, "CONFIRM_SIGN_UP");
    try {
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
    } catch (error) {
      throw new CognitoMutationError("CONFIRM_SIGN_UP", "MUTATION_ATTEMPTED", error);
    }
  }

  async setPermanentPassword(input: {
    email: string;
    password: string;
  }): Promise<{ userSub: string; emailVerified: boolean }> {
    await this.getUserBeforeMutation(input.email, "SET_PERMANENT_PASSWORD");
    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: input.email,
          Password: input.password,
          Permanent: true
        })
      );
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
      if (!userSub) throw new Error("Cognito recovered user is missing sub");
      if (!emailVerified) throw new Error("Cognito recovered user email is not verified");
      await this.client.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.config.COGNITO_USER_POOL_ID,
          Username: input.email,
          GroupName: "ASSESSMENT_CLIENT"
        })
      );
      return { userSub, emailVerified };
    } catch (error) {
      throw new CognitoMutationError("SET_PERMANENT_PASSWORD", "MUTATION_ATTEMPTED", error);
    }
  }
}
