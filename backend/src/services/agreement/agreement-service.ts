import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { log } from "../../shared/logger";
import type { QuickBooksGateway } from "./quickbooks-client";

export type AgreementSession = {
  id: string; normalizedEmail: string; phone: string; firstName: string; middleName?: string | null; lastName: string;
  assessmentYear: number; serviceAmount: number; currency: string; status: string; statusTokenExpiresAt: Date;
  /** Internal-only seed derived from the persisted primary access-token hash. */
  downloadTokenSeed: string;
  agreementSignedAt?: Date | null;
  qbCustomerId?: string | null; qbInvoiceId?: string | null; qbInvoiceNumber?: string | null; qbInvoiceBalance?: number | null;
};
export type AgreementTemplateRecord = {
  id: string; version: string; title: string; docxSha256: string; pdfSha256: string; pdfS3Key: string;
  sourceFileName: string; consentTextVersion: string;
};
export type SignatureEvidence = {
  sessionId: string; templateId: string; typedSignatureName: string; agreementDisplayDate: Date; signedAt: Date;
  ipAddress?: string; userAgent?: string; templateVersion: string; templateTitle: string; docxSha256: string;
  pdfSha256: string; consentTextVersion: string; acknowledgementAcceptedAt: Date; evidencePayloadSha256: string;
};
export type AcceptedSignature = {
  signedAt: Date;
  template: AgreementTemplateRecord;
  evidencePayloadSha256: string;
};
export type AgreementDownloadRecord = {
  assessmentYear: number;
  expiresAt: Date;
  template: AgreementTemplateRecord;
};
export type AgreementConfirmationCandidate = AgreementSession & {
  agreementSignedAt: Date;
  template: AgreementTemplateRecord;
};
export interface AgreementRepository {
  findSessionByTokenHash(tokenHash: string): Promise<AgreementSession | null>;
  findActiveTemplate(at: Date): Promise<AgreementTemplateRecord | null>;
  findSignedTemplate(sessionId: string): Promise<AgreementTemplateRecord | null>;
  acceptSignature(evidence: SignatureEvidence): Promise<AcceptedSignature>;
  saveQuickBooksCustomer(sessionId: string, customerId: string, requestId: string): Promise<void>;
  saveQuickBooksInvoice(sessionId: string, invoice: { id: string; number?: string; balance: number }, requestId: string): Promise<void>;
  markInvoiceSent(sessionId: string): Promise<void>;
  recordBillingFailure(sessionId: string, message: string): Promise<void>;
  ensureAgreementDownloadToken(input: { sessionId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findAgreementDownloadByTokenHash(tokenHash: string): Promise<AgreementDownloadRecord | null>;
  findAgreementConfirmationCandidates(limit: number): Promise<AgreementConfirmationCandidate[]>;
  hasSentAgreementConfirmation(sessionId: string): Promise<boolean>;
  recordAgreementConfirmation(input: {
    sessionId: string;
    recipientEmail: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    attemptedAt: Date;
    providerMessageId?: string;
    failureReason?: string;
  }): Promise<void>;
}
export interface AgreementPdfProvider {
  getReadUrl(key: string, options?: { expiresIn?: number; downloadFileName?: string }): Promise<string>;
}
export interface AgreementConfirmationNotifier {
  send(input: {
    recipientEmail: string;
    recipientName: string;
    assessmentYear: number;
    agreementTitle: string;
    signedAt: Date;
    downloadUrl: string;
    downloadExpiresAt: Date;
    idempotencyKey: string;
  }): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }>;
}

export class AgreementFlowError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) { super(message); }
}

const acceptanceSchema = z.object({
  token: z.string().min(32).max(256), typedSignatureName: z.string().trim().min(2).max(200), acknowledgementAccepted: z.literal(true)
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const requestId = (kind: string, sessionId: string) => hash(`${kind}:${sessionId}`).slice(0, 50);
const AGREEMENT_DOWNLOAD_TTL_SECONDS = 15 * 60;
const AGREEMENT_DOWNLOAD_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AGREEMENT_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const agreementDownloadToken = (tokenSeed: string): string =>
  createHmac("sha256", Buffer.from(tokenSeed, "hex"))
    .update("savians-agreement-download-v1")
    .digest("base64url");
const agreementConfirmationDeliveryWindow = (at: Date): {
  expiresAt: Date;
  idempotencyWindow: string;
} => {
  const window = Math.floor(at.getTime() / AGREEMENT_CONFIRMATION_WINDOW_MS);
  return {
    // Pin both the payload and provider idempotency key to the same daily
    // delivery window. The extra day guarantees at least 30 full days of
    // validity even for a send at the end of the window.
    expiresAt: new Date(
      (window + 1) * AGREEMENT_CONFIRMATION_WINDOW_MS +
        AGREEMENT_DOWNLOAD_LINK_TTL_MS
    ),
    idempotencyWindow: window.toString(36)
  };
};
const postBillingStatuses = new Set([
  "INVOICE_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_VERIFYING",
  "PAID_VERIFIED",
  "ACCOUNT_INVITED",
  "ACCOUNT_CREATED",
  "PROFILE_IN_PROGRESS",
  "PROFILE_COMPLETED",
  "DOCUMENTS_IN_PROGRESS",
  "DOCUMENTS_SUBMITTED",
  "IN_PROGRESS",
  "COMPLETED",
  "ERROR"
]);

export class AgreementService {
  constructor(
    private readonly repository: AgreementRepository,
    private readonly pdfProvider: AgreementPdfProvider,
    private readonly quickBooks: QuickBooksGateway,
    private readonly confirmationNotifier: AgreementConfirmationNotifier,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async resolve(token: string): Promise<{
    session: AgreementSession;
    template: AgreementTemplateRecord;
    hasSignedAgreement: boolean;
  }> {
    const session = await this.repository.findSessionByTokenHash(hash(token));
    if (!session) throw new AgreementFlowError("INVALID_TOKEN", "This agreement link is invalid.", 404);
    if (session.statusTokenExpiresAt.getTime() <= this.now().getTime()) throw new AgreementFlowError("EXPIRED_TOKEN", "This agreement link has expired.", 410);
    const signedTemplate = await this.repository.findSignedTemplate(session.id);
    const template = signedTemplate ?? await this.repository.findActiveTemplate(this.now());
    if (!template) throw new AgreementFlowError("AGREEMENT_UNAVAILABLE", "The legal agreement is temporarily unavailable.", 503);
    return { session, template, hasSignedAgreement: Boolean(signedTemplate) };
  }

  private async sendAgreementConfirmation(
    session: AgreementSession,
    template: AgreementTemplateRecord,
    downloadTokenSeed: string,
    downloadBaseUrl: string
  ): Promise<"SENT" | "SKIPPED" | "FAILED" | "ALREADY_SENT"> {
    try {
      if (await this.repository.hasSentAgreementConfirmation(session.id)) {
        return "ALREADY_SENT";
      }
      const attemptedAt = this.now();
      const signedAt = session.agreementSignedAt ?? this.now();
      const purposeToken = agreementDownloadToken(downloadTokenSeed);
      const deliveryWindow = agreementConfirmationDeliveryWindow(attemptedAt);
      const downloadExpiresAt = deliveryWindow.expiresAt;
      await this.repository.ensureAgreementDownloadToken({
        sessionId: session.id,
        tokenHash: hash(purposeToken),
        expiresAt: downloadExpiresAt
      });
      const downloadUrl =
        `${downloadBaseUrl.replace(/\/$/, "")}/assessment/agreement/download/` +
        encodeURIComponent(purposeToken);
      const delivery = await this.confirmationNotifier.send({
        recipientEmail: session.normalizedEmail,
        recipientName: [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" "),
        assessmentYear: session.assessmentYear,
        agreementTitle: template.title,
        signedAt,
        downloadUrl,
        downloadExpiresAt,
        idempotencyKey:
          `agreement-signed-${session.id}-${deliveryWindow.idempotencyWindow}`
      });
      await this.repository.recordAgreementConfirmation({
        sessionId: session.id,
        recipientEmail: session.normalizedEmail,
        status: delivery.status,
        attemptedAt,
        providerMessageId: delivery.providerMessageId,
        failureReason: delivery.status === "SKIPPED" ? "Agreement confirmation email is disabled or not configured" : undefined
      });
      return delivery.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agreement confirmation email error";
      log("error", "agreement confirmation email failed", { sessionId: session.id, error: message });
      try {
        await this.repository.recordAgreementConfirmation({
          sessionId: session.id,
          recipientEmail: session.normalizedEmail,
          status: "FAILED",
          attemptedAt: this.now(),
          failureReason: message
        });
      } catch (recordError) {
        log("error", "agreement confirmation failure could not be recorded", {
          sessionId: session.id,
          error: recordError instanceof Error ? recordError.message : "Unknown persistence error"
        });
      }
      return "FAILED";
    }
  }

  async retryAgreementConfirmations(
    downloadBaseUrl: string,
    limit = 25
  ): Promise<{ checked: number; sent: number; skipped: number; failed: number }> {
    const candidates =
      await this.repository.findAgreementConfirmationCandidates(limit);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const result = await this.sendAgreementConfirmation(
        candidate,
        candidate.template,
        candidate.downloadTokenSeed,
        downloadBaseUrl
      );
      if (result === "SENT") sent++;
      if (result === "SKIPPED") skipped++;
      if (result === "FAILED") failed++;
    }
    return { checked: candidates.length, sent, skipped, failed };
  }

  async load(token: string) {
    const { session, template } = await this.resolve(token);
    if (!["AGREEMENT_PENDING", "AGREEMENT_SIGNED", "QB_CUSTOMER_CREATED", "INVOICE_CREATED"].includes(session.status)) {
      return { status: session.status, nextUrl: `/assessment/status/${token}` };
    }
    return {
      status: session.status,
      clientName: [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" "),
      assessmentYear: session.assessmentYear,
      amount: session.serviceAmount,
      currency: session.currency,
      agreement: {
        title: template.title, version: template.version, displayDate: this.now().toISOString().slice(0, 10),
        pdfUrl: await this.pdfProvider.getReadUrl(template.pdfS3Key), pdfSha256: template.pdfSha256,
        acknowledgementText: "I have read and agree to the complete Tax Assessment Plan Legal Service Agreement and intend my typed name to serve as my electronic signature."
      }
    };
  }

  async download(token: string) {
    const download = await this.repository.findAgreementDownloadByTokenHash(hash(token));
    if (!download) throw new AgreementFlowError("INVALID_DOWNLOAD_LINK", "This agreement download link is invalid.", 404);
    if (download.expiresAt.getTime() <= this.now().getTime()) {
      throw new AgreementFlowError("EXPIRED_DOWNLOAD_LINK", "This agreement download link has expired.", 410);
    }
    const expiresAt = new Date(this.now().getTime() + AGREEMENT_DOWNLOAD_TTL_SECONDS * 1000);
    return {
      url: await this.pdfProvider.getReadUrl(download.template.pdfS3Key, {
        expiresIn: AGREEMENT_DOWNLOAD_TTL_SECONDS,
        downloadFileName: `Savians ${download.assessmentYear} Tax Assessment Agreement.pdf`
      }),
      expiresAt: expiresAt.toISOString()
    };
  }

  async accept(raw: unknown, context: { ipAddress?: string; userAgent?: string; downloadBaseUrl: string }) {
    const input = acceptanceSchema.parse(raw);
    const { session, template, hasSignedAgreement } = await this.resolve(input.token);
    let confirmationTemplate = template;
    const legalName = [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" ");
    if (postBillingStatuses.has(session.status)) {
      if (hasSignedAgreement) {
        await this.sendAgreementConfirmation(
          session,
          template,
          session.downloadTokenSeed,
          context.downloadBaseUrl
        );
      }
      return { status: session.status, nextUrl: `/assessment/status/${input.token}`, invoiceNumber: session.qbInvoiceNumber ?? undefined };
    }
    if (normalizeName(input.typedSignatureName) !== normalizeName(legalName)) {
      throw new AgreementFlowError("SIGNATURE_NAME_MISMATCH", "Enter your full legal name exactly as shown above.", 400);
    }
    const signedAt = this.now();
    if (session.status === "AGREEMENT_PENDING") {
      const evidencePayload = {
        sessionId: session.id, templateId: template.id, templateVersion: template.version, templateTitle: template.title,
        docxSha256: template.docxSha256, pdfSha256: template.pdfSha256, typedSignatureName: input.typedSignatureName,
        agreementDisplayDate: signedAt.toISOString().slice(0, 10), signedAt: signedAt.toISOString(),
        ipAddress: context.ipAddress ?? null, userAgent: context.userAgent ?? null,
        consentTextVersion: template.consentTextVersion, acknowledgementAccepted: true
      };
      const accepted = await this.repository.acceptSignature({
        sessionId: session.id, templateId: template.id, typedSignatureName: input.typedSignatureName,
        agreementDisplayDate: new Date(`${evidencePayload.agreementDisplayDate}T00:00:00.000Z`), signedAt,
        ipAddress: context.ipAddress, userAgent: context.userAgent, templateVersion: template.version,
        templateTitle: template.title, docxSha256: template.docxSha256, pdfSha256: template.pdfSha256,
        consentTextVersion: template.consentTextVersion, acknowledgementAcceptedAt: signedAt,
        evidencePayloadSha256: hash(JSON.stringify(evidencePayload))
      });
      session.status = "AGREEMENT_SIGNED";
      session.agreementSignedAt = accepted.signedAt;
      confirmationTemplate = accepted.template;
    }

    await this.sendAgreementConfirmation(
      session,
      confirmationTemplate,
      session.downloadTokenSeed,
      context.downloadBaseUrl
    );

    let billingStep = "start";
    try {
      const customerRequestId = requestId("customer", session.id);
      if (!session.qbCustomerId) {
        billingStep = "find-or-create-customer";
        session.qbCustomerId = await this.quickBooks.findOrCreateCustomer({
          displayName: legalName, email: session.normalizedEmail, phone: session.phone, requestId: customerRequestId
        });
        billingStep = "save-customer";
        await this.repository.saveQuickBooksCustomer(session.id, session.qbCustomerId, customerRequestId);
      }
      const invoiceRequestId = requestId("invoice", session.id);
      if (!session.qbInvoiceId) {
        billingStep = "create-invoice";
        const invoice = await this.quickBooks.createInvoice({
          customerId: session.qbCustomerId, email: session.normalizedEmail, amount: session.serviceAmount,
          requestId: invoiceRequestId, description: `Savians Tax Assessment ${session.assessmentYear}`
        });
        session.qbInvoiceId = invoice.id; session.qbInvoiceNumber = invoice.number; session.qbInvoiceBalance = invoice.balance;
        billingStep = "save-invoice";
        await this.repository.saveQuickBooksInvoice(session.id, invoice, invoiceRequestId);
      }
      billingStep = "send-invoice";
      await this.quickBooks.sendInvoice(session.qbInvoiceId, session.normalizedEmail, requestId("send-invoice", session.id));
      billingStep = "mark-invoice-sent";
      await this.repository.markInvoiceSent(session.id);
      session.status = "PAYMENT_PENDING";
      return { status: "PAYMENT_PENDING", nextUrl: `/assessment/status/${input.token}`, invoiceNumber: session.qbInvoiceNumber };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown billing error";
      log("error", "agreement billing failed", {
        sessionId: session.id,
        assessmentYear: session.assessmentYear,
        status: session.status,
        billingStep,
        hasQuickBooksCustomer: Boolean(session.qbCustomerId),
        hasQuickBooksInvoice: Boolean(session.qbInvoiceId),
        error: message
      });
      await this.repository.recordBillingFailure(session.id, message);
      throw new AgreementFlowError("BILLING_RETRY_REQUIRED", "Your agreement is saved, but the invoice could not be completed. Please retry.", 502);
    }
  }
}
