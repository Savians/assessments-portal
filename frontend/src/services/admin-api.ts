import { AssessmentApiError, type AssessmentDocument, type DocumentCategory, type PortalBusinessInvestment, type PortalHouseholdMember, type PortalProperty, type SavePortalProfileRequest } from "@/services/assessment-api";

const baseUrl = () => process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const headers = (token: string) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: { ...headers(token), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json() as T | { message?: string; issues?: Array<{ path: string; message: string }> };
  if (!response.ok) {
    const error = body as { message?: string; issues?: Array<{ path: string; message: string }> };
    throw new AssessmentApiError(error.message ?? "We could not complete the admin request.", error.issues);
  }
  return body as T;
}

export interface AdminOverview {
  totalClients: number; paymentPending: number; pendingUploads: number; readyForReview: number; inProgress: number; completed: number;
  documentCount: number; documentBytes: number; years: number[];
}
export interface AdminClientSummary {
  id: string; clientId: string | null; firstName: string; middleName: string | null; lastName: string; normalizedEmail: string; phone: string; assessmentYear: number;
  status: string; statusLabel: string; qbInvoiceNumber: string | null; qbInvoiceBalance: number | null; paymentVerifiedAt: string | null; updatedAt: string; documentCount: number;
}
export interface Paginated<T> { page: number; pageSize: number; total: number; totalPages: number; items: T[]; }
export interface AdminDocument extends AssessmentDocument {
  session: { id: string; firstName: string; middleName: string | null; lastName: string; normalizedEmail: string; assessmentYear: number };
}
export interface AdminClientDetail {
  id: string; clientId: string | null; normalizedEmail: string; phone: string; firstName: string; middleName: string | null; lastName: string; dateOfBirth: string;
  clientType: "INDIVIDUAL" | "BUSINESS_OWNER" | "REAL_ESTATE_INVESTOR" | "W2_HIGH_EARNER" | "OTHER"; businessName: string | null; state: string; incomeRange: string | null; estimatedTaxPaidRange: string | null;
  assessmentYear: number; status: string; statusLabel: string; serviceAmount: string; currency: string; qbCustomerId: string | null; qbInvoiceId: string | null; qbInvoiceNumber: string | null;
  qbInvoiceBalance: string | null; paymentVerifiedAt: string | null; agreementSignedAt: string | null; createdAt: string; updatedAt: string;
  client: { id: string; cognitoUserId: string | null; normalizedEmail: string; emailVerifiedAt: string | null } | null;
  profile: null | {
    id: string; householdName: string | null; homeAddress: string; city: string; state: string; zip: string; homeowner: boolean; maritalStatus: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
    preferredContact: string | null; residentStatus: "US_CITIZEN" | "GREEN_CARD_HOLDER" | "VISA" | "OTHER"; ownsRealEstate: boolean | null; ownsBusiness: boolean | null;
    lastYearTaxableIncome: string | null; projectedTaxableIncome: string | null; lifeInsuranceInPlace: boolean | null; estatePlanningInPlace: boolean | null; majorPurchaseNotes: string | null; completedAt: string | null;
    householdMembers: Array<PortalHouseholdMember & { id: string; memberType: "SPOUSE" | "DEPENDENT" }>;
    properties: Array<PortalProperty & { id: string }>;
    businessInvestments: Array<PortalBusinessInvestment & { id: string }>;
  };
  documents: AdminDocument[];
  statusHistory: Array<{ id: string; oldStatus: string | null; newStatus: string; reason: string | null; actorType: string; actorId: string | null; createdAt: string }>;
  auditLogs: Array<{ id: string; action: string; actorType: string; actorId: string | null; metadata: unknown; createdAt: string }>;
}

export const loadAdminOverview = (token: string) => request<AdminOverview>("/api/assessment/admin/overview", token);
export function loadAdminClients(token: string, query: { search?: string; status?: string; year?: string; page?: number; pageSize?: number }) {
  const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return request<Paginated<AdminClientSummary>>(`/api/assessment/admin/clients?${params}`, token);
}
export const loadAdminClient = (token: string, sessionId: string) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}`, token);
export function loadAdminDocuments(token: string, query: { search?: string; category?: DocumentCategory | ""; page?: number; pageSize?: number }) {
  const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return request<Paginated<AdminDocument>>(`/api/assessment/admin/documents?${params}`, token);
}
export const loadAdminDocumentPreview = (token: string, documentId: string) => request<{ previewUrl: string; expiresInSeconds: number }>(`/api/assessment/admin/documents/${encodeURIComponent(documentId)}/preview-url`, token);
export const updateAdminIdentity = (token: string, sessionId: string, input: object) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}/identity`, token, { method: "PUT", body: JSON.stringify(input) });
export const updateAdminProfile = (token: string, sessionId: string, input: SavePortalProfileRequest) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}/profile`, token, { method: "PUT", body: JSON.stringify(input) });
export const updateAdminProperties = (token: string, sessionId: string, properties: PortalProperty[]) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}/properties`, token, { method: "PUT", body: JSON.stringify({ properties }) });
export const updateAdminBusinesses = (token: string, sessionId: string, businessInvestments: PortalBusinessInvestment[]) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}/business-investments`, token, { method: "PUT", body: JSON.stringify({ businessInvestments }) });
export const updateAdminStatus = (token: string, sessionId: string, status: "IN_PROGRESS" | "COMPLETED", reason?: string) => request<AdminClientDetail>(`/api/assessment/admin/clients/${encodeURIComponent(sessionId)}/status`, token, { method: "PUT", body: JSON.stringify({ status, reason }) });
