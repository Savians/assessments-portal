import type { AssessmentStartFormValues } from "@/lib/assessment-start-schema";

export interface StartAssessmentResponse {
  status: string;
  nextUrl: string;
  resumed: boolean;
  assessmentYear: number;
  message: string;
}

interface ApiErrorBody {
  message?: string;
  issues?: Array<{ path: string; message: string }>;
}

export class AssessmentApiError extends Error {
  constructor(
    message: string,
    readonly issues: ApiErrorBody["issues"] = []
  ) {
    super(message);
    this.name = "AssessmentApiError";
  }
}

export async function startAssessment(
  input: AssessmentStartFormValues
): Promise<StartAssessmentResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
  const response = await fetch(baseUrl + "/api/assessment/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  });

  const body = (await response.json()) as StartAssessmentResponse | ApiErrorBody;
  if (!response.ok) {
    const error = body as ApiErrorBody;
    throw new AssessmentApiError(
      error.message ?? "We could not start your assessment.",
      error.issues
    );
  }
  return body as StartAssessmentResponse;
}

export async function recoverAssessment(input: { email: string }): Promise<{ ok: true; nextUrl: string; message: string }> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
  const response = await fetch(baseUrl + "/api/assessment/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store"
  });

  const body = (await response.json()) as { ok: true; nextUrl: string; message: string } | ApiErrorBody;
  if (!response.ok) {
    const error = body as ApiErrorBody;
    throw new AssessmentApiError(error.message ?? "We could not recover your assessment.", error.issues);
  }
  return body as { ok: true; nextUrl: string; message: string };
}

export interface AgreementDetailsResponse {
  status: string;
  nextUrl?: string;
  clientName?: string;
  assessmentYear?: number;
  amount?: number;
  currency?: string;
  agreement?: {
    title: string;
    version: string;
    displayDate: string;
    pdfUrl: string;
    pdfSha256: string;
    acknowledgementText: string;
  };
}

const apiBaseUrl = () => process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function loadAgreement(token: string): Promise<AgreementDetailsResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/agreement/${encodeURIComponent(token)}`, { cache: "no-store" });
  const body = (await response.json()) as AgreementDetailsResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not load the agreement.");
  return body as AgreementDetailsResponse;
}

export async function signAgreement(input: { token: string; typedSignatureName: string; acknowledgementAccepted: true }): Promise<{ status: string; nextUrl: string; invoiceNumber?: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/agreement/sign`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), cache: "no-store"
  });
  const body = (await response.json()) as { status: string; nextUrl: string; invoiceNumber?: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not sign the agreement.", (body as ApiErrorBody).issues);
  return body as { status: string; nextUrl: string; invoiceNumber?: string };
}

export interface PaymentStatusResponse {
  status: string;
  invoiceNumber?: string;
  invoiceBalance?: number;
  invoiceAmount: number;
  currency: string;
  lastStatusCheckedAt?: string;
  paymentVerifiedAt?: string;
  accountCreationAllowed: boolean;
  nextUrl: string;
}

export async function loadPaymentStatus(token: string): Promise<PaymentStatusResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/status/${encodeURIComponent(token)}`, { cache: "no-store" });
  const body = (await response.json()) as PaymentStatusResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not load payment status.");
  return body as PaymentStatusResponse;
}

export async function refreshPaymentStatus(token: string): Promise<PaymentStatusResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/refresh-payment-status`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store"
  });
  const body = (await response.json()) as PaymentStatusResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not refresh payment status.");
  return body as PaymentStatusResponse;
}

export async function resendInvoiceEmail(token: string): Promise<{ ok: true }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/resend-invoice-email`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store"
  });
  const body = (await response.json()) as { ok: true } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not resend the invoice email.");
  return body as { ok: true };
}

export async function sendAccountSetupInvite(token: string): Promise<{ ok: true }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/invite/reissue`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store"
  });
  const body = (await response.json()) as { ok: true } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not send the account setup invite.");
  return body as { ok: true };
}

export async function startPaidAccountSetup(token: string): Promise<{ nextUrl: string; expiresAt: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/invite/start`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store"
  });
  const body = (await response.json()) as { nextUrl: string; expiresAt: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not start account setup.");
  return body as { nextUrl: string; expiresAt: string };
}

export interface AccountInviteDetails {
  status: "INVITE_ACTIVE" | "ACCOUNT_CREATED";
  email: string;
  clientName: string;
  assessmentYear: number;
  expiresAt: string;
  nextUrl: string | null;
}

export async function validateAccountInvite(inviteToken: string): Promise<AccountInviteDetails> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/invite/validate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteToken }), cache: "no-store"
  });
  const body = (await response.json()) as AccountInviteDetails | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not validate this account invite.");
  return body as AccountInviteDetails;
}

export async function startAccountSetup(input: { inviteToken: string; password: string }): Promise<{ status: "CONFIRMATION_REQUIRED" | "EXISTING_ACCOUNT"; email: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/setup`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), cache: "no-store"
  });
  const body = (await response.json()) as { status: "CONFIRMATION_REQUIRED" | "EXISTING_ACCOUNT"; email: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not start account setup.", (body as ApiErrorBody).issues);
  return body as { status: "CONFIRMATION_REQUIRED" | "EXISTING_ACCOUNT"; email: string };
}

export async function resendAccountVerificationCode(inviteToken: string): Promise<{ ok: true; retryAfterSeconds: number }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/verification/resend`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteToken }), cache: "no-store"
  });
  const body = (await response.json()) as { ok: true; retryAfterSeconds: number } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not resend the verification code.");
  return body as { ok: true; retryAfterSeconds: number };
}

export async function confirmAccountSetup(input: { inviteToken: string; confirmationCode: string }): Promise<{ status: "ACCOUNT_CREATED"; nextUrl: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/confirm`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), cache: "no-store"
  });
  const body = (await response.json()) as { status: "ACCOUNT_CREATED"; nextUrl: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not confirm account setup.", (body as ApiErrorBody).issues);
  return body as { status: "ACCOUNT_CREATED"; nextUrl: string };
}

export async function claimExistingAccount(input: { inviteToken: string; accessToken: string }): Promise<{ status: "ACCOUNT_CREATED"; nextUrl: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/account/existing/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ inviteToken: input.inviteToken }),
    cache: "no-store"
  });
  const body = (await response.json()) as { status: "ACCOUNT_CREATED"; nextUrl: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not connect this assessment to your existing account.");
  return body as { status: "ACCOUNT_CREATED"; nextUrl: string };
}

export type ResidentStatus = "US_CITIZEN" | "GREEN_CARD_HOLDER" | "VISA" | "OTHER";
export type MaritalStatus = "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
export type PreferredContact = "EMAIL" | "PHONE" | "EITHER";

export interface PortalHouseholdMember {
  id?: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  residentStatus: ResidentStatus | "";
  sex: string;
  fullTimeStudent: boolean | null;
  livesWithTaxpayer: boolean | null;
  notes: string;
}

export interface PortalProfilePayload {
  householdName?: string;
  homeAddress: string;
  city: string;
  state: string;
  zip: string;
  homeowner: boolean | null;
  maritalStatus: MaritalStatus | "";
  preferredContact: PreferredContact | "";
  residentStatus: ResidentStatus | "";
  ownsRealEstate: boolean | null;
  ownsBusiness: boolean | null;
  lastYearTaxableIncome: number | null;
  projectedTaxableIncome: number | null;
  lifeInsuranceInPlace: boolean | null;
  estatePlanningInPlace: boolean | null;
  majorPurchaseNotes: string;
  completedAt?: string | null;
}

export interface PortalProfileResponse {
  clientId: string;
  sessionId: string;
  assessmentYear: number;
  primaryTaxpayer: {
    firstName: string;
    middleName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
  };
  profile: PortalProfilePayload;
  spouse: PortalHouseholdMember | null;
  dependents: PortalHouseholdMember[];
  completion: {
    status: "NOT_STARTED" | "COMPLETE";
    progressPercent: number;
    completedAt: string | null;
  };
}

export interface PortalProperty {
  id?: string;
  category: string;
  propertyType: string;
  label: string;
  fullAddress: string;
  acquiredYear: number;
  acquiredMethod: string;
  purchaseBasis: number | null;
  currentFmv: number | null;
  landValue: number | null;
  mortgageBalance: number | null;
  monthlyPayment: number | null;
  mortgageCompany: string | null;
  interestRate: number | null;
  mortgageTermYears: number | null;
  taxYearUse: string;
  rentalStartDate: string | null;
  daysRented: number | null;
  personalUseDays: number | null;
  projectedGrossRent: number | null;
  priorInterestPaid: number | null;
  priorTaxPaid: number | null;
  totalExpenses: number | null;
  owners: Array<{
    id?: string;
    ownerName: string;
    ownershipPercentage: number;
  }>;
  notes: string | null;
}

export interface PortalBusinessInvestment {
  id?: string;
  entityName: string;
  entityType: string;
  ownershipPercent: number;
  taxClassification: string;
  priorYearIncomeLoss: number | null;
  priorYear: number | null;
  incomeLossYearMinus3: number | null;
  incomeLossYearMinus2: number | null;
  incomeLossYearMinus1: number | null;
  projectedCurrentYearIncomeLoss: number | null;
  active: boolean | null;
  notes: string | null;
}

export interface PortalDashboardResponse extends PortalProfileResponse {
  assessmentStatus: {
    raw: string;
    label: "Payment Pending" | "Pending Uploads" | "Ready for Review" | string;
  };
  properties: PortalProperty[];
  businessInvestments: PortalBusinessInvestment[];
  documentSummary: {
    uploadedCount: number;
    uploadedBytes: number;
    recentDocuments: Array<{
      id: string;
      category: DocumentCategory;
      originalName: string;
      sizeBytes: number;
      createdAt: string;
    }>;
  };
}

export interface SavePortalProfileRequest extends PortalProfilePayload {
  householdName?: never;
  spouse: Omit<PortalHouseholdMember, "id"> | null;
  dependents: Array<Omit<PortalHouseholdMember, "id">>;
}

function bearerHeaders(accessToken: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`
  };
}

export async function loadPortalProfile(accessToken: string): Promise<PortalProfileResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/profile`, {
    headers: bearerHeaders(accessToken),
    cache: "no-store"
  });
  const body = (await response.json()) as PortalProfileResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not load your profile.");
  return body as PortalProfileResponse;
}

export async function savePortalProfile(accessToken: string, input: SavePortalProfileRequest): Promise<PortalProfileResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/profile`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify(input),
    cache: "no-store"
  });
  const body = (await response.json()) as PortalProfileResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not save your profile.", (body as ApiErrorBody).issues);
  return body as PortalProfileResponse;
}

export async function loadPortalDashboard(accessToken: string): Promise<PortalDashboardResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/dashboard`, {
    headers: bearerHeaders(accessToken),
    cache: "no-store"
  });
  const body = (await response.json()) as PortalDashboardResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not load your dashboard.");
  return body as PortalDashboardResponse;
}

export async function savePortalProperties(accessToken: string, properties: PortalProperty[]): Promise<PortalDashboardResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/properties`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify({ properties }),
    cache: "no-store"
  });
  const body = (await response.json()) as PortalDashboardResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not save real estate intake.", (body as ApiErrorBody).issues);
  return body as PortalDashboardResponse;
}

export async function savePortalBusinessInvestments(accessToken: string, businessInvestments: PortalBusinessInvestment[]): Promise<PortalDashboardResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/business-investments`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify({ businessInvestments }),
    cache: "no-store"
  });
  const body = (await response.json()) as PortalDashboardResponse | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not save business/entity intake.", (body as ApiErrorBody).issues);
  return body as PortalDashboardResponse;
}

export async function markAssessmentReadyForReview(accessToken: string): Promise<{ ok: true; status: string; emailStatus: string }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/portal/ready-for-review`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify({}),
    cache: "no-store"
  });
  const body = (await response.json()) as { ok: true; status: string; emailStatus: string } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not mark this assessment ready for review.");
  return body as { ok: true; status: string; emailStatus: string };
}

export type DocumentCategory =
  | "TAX_RETURNS"
  | "W2_INCOME"
  | "OTHER_INCOME"
  | "INVESTMENT_PORTFOLIO"
  | "RETIREMENT_ACCOUNTS"
  | "MORTGAGE_STATEMENTS"
  | "BUSINESS_LLC_DOCUMENTS"
  | "ESTATE_PLAN"
  | "LIFE_INSURANCE"
  | "OTHER_ASSESSMENT_DETAILS";

export interface AssessmentDocument {
  id: string;
  category: DocumentCategory;
  status: "PENDING" | "UPLOADED" | "QUARANTINED" | "CLEAN" | "REJECTED" | "DELETED" | "NOT_APPLICABLE";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export async function loadDocuments(accessToken: string): Promise<{ documents: AssessmentDocument[] }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/documents`, {
    headers: bearerHeaders(accessToken),
    cache: "no-store"
  });
  const body = (await response.json()) as { documents: AssessmentDocument[] } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not load your documents.");
  return body as { documents: AssessmentDocument[] };
}

export async function createDocumentUploadUrl(
  accessToken: string,
  input: { category: DocumentCategory; fileName: string; contentType: string; sizeBytes: number }
): Promise<{ documentId: string; uploadUrl: string; expiresInSeconds: number }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/documents/upload-url`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify(input),
    cache: "no-store"
  });
  const body = (await response.json()) as { documentId: string; uploadUrl: string; expiresInSeconds: number } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not prepare the upload.", (body as ApiErrorBody).issues);
  return body as { documentId: string; uploadUrl: string; expiresInSeconds: number };
}

export async function completeDocumentUpload(
  accessToken: string,
  input: { documentId: string; sizeBytes: number }
): Promise<{ document: AssessmentDocument }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/documents/complete`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
    body: JSON.stringify(input),
    cache: "no-store"
  });
  const body = (await response.json()) as { document: AssessmentDocument } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not confirm the upload.", (body as ApiErrorBody).issues);
  return body as { document: AssessmentDocument };
}

export async function createDocumentPreviewUrl(
  accessToken: string,
  documentId: string
): Promise<{ documentId: string; previewUrl: string; expiresInSeconds: number }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/documents/${encodeURIComponent(documentId)}/preview-url`, {
    headers: bearerHeaders(accessToken),
    cache: "no-store"
  });
  const body = (await response.json()) as { documentId: string; previewUrl: string; expiresInSeconds: number } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not prepare the document preview.");
  return body as { documentId: string; previewUrl: string; expiresInSeconds: number };
}

export async function removeDocument(accessToken: string, documentId: string): Promise<{ ok: true }> {
  const response = await fetch(`${apiBaseUrl()}/api/assessment/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: bearerHeaders(accessToken),
    cache: "no-store"
  });
  const body = (await response.json()) as { ok: true } | ApiErrorBody;
  if (!response.ok) throw new AssessmentApiError((body as ApiErrorBody).message ?? "We could not remove this document.");
  return body as { ok: true };
}

export async function uploadDocumentFile(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file
  });
  if (!response.ok) throw new AssessmentApiError("The file upload failed. Please try again.");
}
