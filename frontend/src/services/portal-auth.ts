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
  const cognitoUser = new CognitoUser({
    Username: input.email,
    Pool: userPool()
  });
  const authenticationDetails = new AuthenticationDetails({
    Username: input.email,
    Password: input.password
  });

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session: CognitoUserSession) => {
        const idToken = session.getIdToken().getJwtToken();
        storePortalAccessToken(idToken);
        resolve({ accessToken: idToken });
      },
      onFailure: (error) => {
        reject(error instanceof Error ? error : new Error("We could not start your portal session."));
      }
    });
  });
}
