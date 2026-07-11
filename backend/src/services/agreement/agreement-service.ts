import { createHash } from "node:crypto";
import { z } from "zod";
import { log } from "../../shared/logger";
import type { QuickBooksGateway } from "./quickbooks-client";

export type AgreementSession = {
  id: string; normalizedEmail: string; phone: string; firstName: string; middleName?: string | null; lastName: string;
  assessmentYear: number; serviceAmount: number; currency: string; status: string; statusTokenExpiresAt: Date;
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
export interface AgreementRepository {
  findSessionByTokenHash(tokenHash: string): Promise<AgreementSession | null>;
  findActiveTemplate(at: Date): Promise<AgreementTemplateRecord | null>;
  acceptSignature(evidence: SignatureEvidence): Promise<void>;
  saveQuickBooksCustomer(sessionId: string, customerId: string, requestId: string): Promise<void>;
  saveQuickBooksInvoice(sessionId: string, invoice: { id: string; number?: string; balance: number }, requestId: string): Promise<void>;
  markInvoiceSent(sessionId: string): Promise<void>;
  recordBillingFailure(sessionId: string, message: string): Promise<void>;
  recordNotificationFailure(sessionId: string, message: string): Promise<void>;
}
export interface AgreementPdfProvider { getReadUrl(key: string): Promise<string>; }
export interface InvoiceStatusNotifier { send(input: { sessionId: string; email: string; firstName: string; invoiceNumber?: string; amount: number; statusUrl: string }): Promise<void>; }

export class AgreementFlowError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) { super(message); }
}

const acceptanceSchema = z.object({
  token: z.string().min(32).max(256), typedSignatureName: z.string().trim().min(2).max(200), acknowledgementAccepted: z.literal(true)
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const requestId = (kind: string, sessionId: string) => hash(`${kind}:${sessionId}`).slice(0, 50);

export class AgreementService {
  constructor(
    private readonly repository: AgreementRepository,
    private readonly pdfProvider: AgreementPdfProvider,
    private readonly quickBooks: QuickBooksGateway,
    private readonly notifier: InvoiceStatusNotifier,
    private readonly frontendUrl: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async resolve(token: string): Promise<{ session: AgreementSession; template: AgreementTemplateRecord }> {
    const session = await this.repository.findSessionByTokenHash(hash(token));
    if (!session) throw new AgreementFlowError("INVALID_TOKEN", "This agreement link is invalid.", 404);
    if (session.statusTokenExpiresAt.getTime() <= this.now().getTime()) throw new AgreementFlowError("EXPIRED_TOKEN", "This agreement link has expired.", 410);
    const template = await this.repository.findActiveTemplate(this.now());
    if (!template) throw new AgreementFlowError("AGREEMENT_UNAVAILABLE", "The legal agreement is temporarily unavailable.", 503);
    return { session, template };
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

  async accept(raw: unknown, context: { ipAddress?: string; userAgent?: string }) {
    const input = acceptanceSchema.parse(raw);
    const { session, template } = await this.resolve(input.token);
    const legalName = [session.firstName, session.middleName, session.lastName].filter(Boolean).join(" ");
    if (["PAYMENT_PENDING", "PAYMENT_VERIFYING", "PAID_VERIFIED", "ACCOUNT_INVITED", "ACCOUNT_CREATED", "PROFILE_IN_PROGRESS", "PROFILE_COMPLETED", "DOCUMENTS_IN_PROGRESS", "DOCUMENTS_SUBMITTED"].includes(session.status)) {
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
      await this.repository.acceptSignature({
        sessionId: session.id, templateId: template.id, typedSignatureName: input.typedSignatureName,
        agreementDisplayDate: new Date(`${evidencePayload.agreementDisplayDate}T00:00:00.000Z`), signedAt,
        ipAddress: context.ipAddress, userAgent: context.userAgent, templateVersion: template.version,
        templateTitle: template.title, docxSha256: template.docxSha256, pdfSha256: template.pdfSha256,
        consentTextVersion: template.consentTextVersion, acknowledgementAcceptedAt: signedAt,
        evidencePayloadSha256: hash(JSON.stringify(evidencePayload))
      });
      session.status = "AGREEMENT_SIGNED";
    }

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
      const statusUrl = `${this.frontendUrl.replace(/\/$/, "")}/assessment/status/${input.token}`;
      try {
        billingStep = "notify-client";
        await this.notifier.send({ sessionId: session.id, email: session.normalizedEmail, firstName: session.firstName,
          invoiceNumber: session.qbInvoiceNumber ?? undefined, amount: session.serviceAmount, statusUrl });
      } catch (error) {
        await this.repository.recordNotificationFailure(session.id, error instanceof Error ? error.message : "Unknown notification error");
      }
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
