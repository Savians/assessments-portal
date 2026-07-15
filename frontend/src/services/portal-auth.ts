import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession
} from "amazon-cognito-identity-js";

export const portalAccessTokenStorageKey = "saviansAssessmentAccessToken";

const requiredEnv = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

function userPool() {
  return new CognitoUserPool({
    UserPoolId: requiredEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID),
    ClientId: requiredEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID)
  });
}

function cognitoUser(email: string) {
  return new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool() });
}

export function storePortalAccessToken(idToken: string) {
  window.localStorage.setItem(portalAccessTokenStorageKey, idToken);
}

export function getStoredPortalAccessToken() {
  const token = window.localStorage.getItem(portalAccessTokenStorageKey) ?? "";
  if (token && !hasEmailClaim(token)) {
    clearStoredPortalAccessToken();
    return "";
  }
  return token;
}

export async function getCurrentPortalAccessToken(): Promise<string> {
  const storedToken = getStoredPortalAccessToken();
  if (storedToken && !isTokenExpired(storedToken)) return storedToken;

  const currentUser = userPool().getCurrentUser();
  if (!currentUser) {
    clearStoredPortalAccessToken();
    return "";
  }

  return new Promise((resolve) => {
    currentUser.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session?.isValid()) {
        clearStoredPortalAccessToken();
        resolve("");
        return;
      }

      const idToken = session.getIdToken().getJwtToken();
      storePortalAccessToken(idToken);
      resolve(idToken);
    });
  });
}

export function clearStoredPortalAccessToken() {
  window.localStorage.removeItem(portalAccessTokenStorageKey);
}

export function signOutFromPortal() {
  userPool().getCurrentUser()?.signOut();
  clearStoredPortalAccessToken();
}

function hasEmailClaim(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(window.atob(padded)) as { email?: unknown };
    return typeof decoded.email === "string" && decoded.email.length > 0;
  } catch {
    return false;
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(window.atob(padded)) as { exp?: unknown };
    if (typeof decoded.exp !== "number") return true;
    return decoded.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function isPortalAuthError(error: unknown): boolean {
  return error instanceof AssessmentAuthError || (error instanceof Error && /unauthorized/i.test(error.message));
}

export class AssessmentAuthError extends Error {
  constructor(message = "Your secure portal session expired. Please sign in again from the profile page.") {
    super(message);
    this.name = "AssessmentAuthError";
  }
}

export async function signInToPortal(input: { email: string; password: string }): Promise<{ accessToken: string }> {
  const user = cognitoUser(input.email);
  const authenticationDetails = new AuthenticationDetails({
    Username: input.email.trim().toLowerCase(),
    Password: input.password
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authenticationDetails, {
      onSuccess: (session: CognitoUserSession) => {
        const idToken = session.getIdToken().getJwtToken();
        storePortalAccessToken(idToken);
        resolve({ accessToken: idToken });
      },
      onFailure: (error) => {
        reject(new AssessmentAuthError(portalAuthErrorMessage(error, "We could not sign you in. Please check your email and password.")));
      }
    });
  });
}

const errorName = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : "";

function portalAuthErrorMessage(error: unknown, fallback: string): string {
  switch (errorName(error)) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "The email or password is incorrect.";
    case "UserNotConfirmedException":
      return "Please finish verifying your email before signing in.";
    case "PasswordResetRequiredException":
      return "A password reset is required before you can sign in.";
    case "TooManyRequestsException":
    case "LimitExceededException":
      return "Too many attempts were made. Please wait a few minutes and try again.";
    default:
      return fallback;
  }
}

const concealedPasswordResetErrors = new Set([
  "UserNotFoundException",
  "NotAuthorizedException",
  "InvalidParameterException"
]);

/**
 * Requests Cognito's single-use password reset code. User-existence errors are deliberately
 * concealed so this public form cannot be used to discover registered client emails.
 */
export async function requestPortalPasswordReset(email: string): Promise<void> {
  const user = cognitoUser(email);
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    user.forgotPassword({
      onSuccess: succeed,
      inputVerificationCode: succeed,
      onFailure: (error) => {
        if (concealedPasswordResetErrors.has(errorName(error))) {
          succeed();
          return;
        }
        reject(new AssessmentAuthError(portalAuthErrorMessage(error, "We could not send a password reset code. Please try again.")));
      }
    });
  });
}

export async function confirmPortalPasswordReset(input: {
  email: string;
  confirmationCode: string;
  newPassword: string;
}): Promise<void> {
  const user = cognitoUser(input.email);
  return new Promise((resolve, reject) => {
    user.confirmPassword(input.confirmationCode.trim(), input.newPassword, {
      onSuccess: () => resolve(),
      onFailure: (error) => {
        const name = errorName(error);
        const message = name === "CodeMismatchException"
          ? "That verification code is incorrect. Check the latest email and try again."
          : name === "ExpiredCodeException"
            ? "That verification code has expired. Request a new code and try again."
            : name === "InvalidPasswordException"
              ? "The new password does not meet the security requirements."
              : name === "UserNotFoundException"
                ? "That verification code is invalid or expired."
                : portalAuthErrorMessage(error, "We could not reset your password. Please try again.");
        reject(new AssessmentAuthError(message));
      }
    });
  });
}
