export interface AdminClaims {
  sub?: string;
  email?: string;
  "cognito:groups"?: string | string[];
}

export interface AdminIdentity {
  id: string;
  email: string;
  role: "ADMIN" | "SUPER_ADMIN";
}

export class AdminAccessError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

function groupsFromClaim(value: AdminClaims["cognito:groups"]): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((group) => group.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  return trimmed.split(",").map((group) => group.trim()).filter(Boolean);
}

export function assertAssessmentAdmin(claims: AdminClaims): AdminIdentity {
  if (!claims.sub || !claims.email) {
    throw new AdminAccessError("AUTH_CLAIMS_MISSING", "Your login session is missing required account claims.", 401);
  }
  const groups = new Set(groupsFromClaim(claims["cognito:groups"]));
  if (groups.has("superadmin") || groups.has("SuperAdmin")) {
    return { id: claims.sub, email: claims.email, role: "SUPER_ADMIN" };
  }
  if (groups.has("Admin") || groups.has("Finance")) {
    return { id: claims.sub, email: claims.email, role: "ADMIN" };
  }
  throw new AdminAccessError("ADMIN_ROLE_REQUIRED", "This account is not authorized for assessment administration.", 403);
}
