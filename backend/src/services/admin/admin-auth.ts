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
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => entry.split(/[\s,[\]"']+/).map((group) => group.trim()).filter(Boolean));
}

const normalizeGroup = (group: string): string => group.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export function assertAssessmentAdmin(claims: AdminClaims): AdminIdentity {
  if (!claims.sub || !claims.email) {
    throw new AdminAccessError("AUTH_CLAIMS_MISSING", "Your login session is missing required account claims.", 401);
  }
  const groups = new Set(groupsFromClaim(claims["cognito:groups"]).map(normalizeGroup));
  if (groups.has("SUPERADMIN")) {
    return { id: claims.sub, email: claims.email, role: "SUPER_ADMIN" };
  }
  if (groups.has("ADMIN") || groups.has("FINANCE")) {
    return { id: claims.sub, email: claims.email, role: "ADMIN" };
  }
  throw new AdminAccessError("ADMIN_ROLE_REQUIRED", "This account is not authorized for assessment administration.", 403);
}
