import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession
} from "amazon-cognito-identity-js";
import { confirmAssessmentPasswordReset, requestAssessmentPasswordReset } from "@/services/assessment-api";

export const portalAccessTokenStorageKey = "saviansAssessmentAccessToken";

export type PortalRole = "SUPER_ADMIN" | "ADMIN" | "ASSESSMENT_CLIENT" | "UNKNOWN";
export interface PortalIdentity { sub: string; email: string; role: PortalRole; groups: string[]; }

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

function decodeTokenPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid portal token.");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return JSON.parse(window.atob(padded)) as Record<string, unknown>;
}

export function getPortalIdentity(token: string): PortalIdentity {
  const payload = decodeTokenPayload(token);
  const rawGroups = payload["cognito:groups"];
  const groups = Array.isArray(rawGroups) ? rawGroups.filter((value): value is string => typeof value === "string") : [];
  const role: PortalRole = groups.includes("superadmin") || groups.includes("SuperAdmin")
    ? "SUPER_ADMIN"
    : groups.includes("Admin") || groups.includes("Finance")
      ? "ADMIN"
      : groups.includes("ASSESSMENT_CLIENT")
        ? "ASSESSMENT_CLIENT"
        : "UNKNOWN";
  return { sub: typeof payload.sub === "string" ? payload.sub : "", email: typeof payload.email === "string" ? payload.email : "", role, groups };
}

export function routeForPortalRole(role: PortalRole) {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin/dashboard";
  if (role === "ASSESSMENT_CLIENT") return "/portal/dashboard";
  return "/login";
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

export async function signInToPortal(input: { email: string; password: string }): Promise<{ accessToken: string; identity: PortalIdentity }> {
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
        resolve({ accessToken: idToken, identity: getPortalIdentity(idToken) });
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

/**
 * Password recovery is assessment-scoped and delivered through Resend by the backend.
 * The request endpoint deliberately conceals whether an account exists.
 */
export async function requestPortalPasswordReset(email: string): Promise<void> {
  await requestAssessmentPasswordReset(email);
}

export async function confirmPortalPasswordReset(input: {
  email: string;
  confirmationCode: string;
  newPassword: string;
}): Promise<void> {
  await confirmAssessmentPasswordReset(input);
}
