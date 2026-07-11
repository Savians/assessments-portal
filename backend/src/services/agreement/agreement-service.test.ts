import { describe, expect, it } from "vitest";
import { AgreementFlowError, AgreementService, type AgreementRepository, type AgreementSession, type AgreementTemplateRecord, type SignatureEvidence } from "./agreement-service";
import type { QuickBooksGateway } from "./quickbooks-client";

const token = "a".repeat(43);
const template: AgreementTemplateRecord = { id: "template-1", version: "2026-v1.4", title: "Tax Assessment Plan Legal Service Agreement", docxSha256: "d".repeat(64), pdfSha256: "p".repeat(64), pdfS3Key: "assessments/legal/template.pdf", sourceFileName: "legal.docx", consentTextVersion: "agreement-acceptance-v1" };
class Repo implements AgreementRepository {
  session: AgreementSession = { id: "session-1", normalizedEmail: "client@example.com", phone: "+19185550123", firstName: "Jane", middleName: "Q", lastName: "Client", assessmentYear: 2026, serviceAmount: 2997, currency: "USD", status: "AGREEMENT_PENDING", statusTokenExpiresAt: new Date("2026-08-01T00:00:00Z") };
  signature?: SignatureEvidence;
  failures: string[] = [];
  async findSessionByTokenHash() { return this.session; }
  async findActiveTemplate() { return template; }
  async acceptSignature(evidence: SignatureEvidence) { this.signature ??= evidence; this.session.status = "AGREEMENT_SIGNED"; }
  async saveQuickBooksCustomer(_sessionId: string, id: string) { this.session.qbCustomerId = id; this.session.status = "QB_CUSTOMER_CREATED"; }
  async saveQuickBooksInvoice(_sessionId: string, invoice: { id: string; number?: string; balance: number }) { this.session.qbInvoiceId = invoice.id; this.session.qbInvoiceNumber = invoice.number; this.session.qbInvoiceBalance = invoice.balance; this.session.status = "INVOICE_CREATED"; }
  async markInvoiceSent() { this.session.status = "PAYMENT_PENDING"; }
  async recordBillingFailure(_sessionId: string, message: string) { this.failures.push(message); }
  async recordNotificationFailure(_sessionId: string, message: string) { this.failures.push(message); }
}
class Qbo implements QuickBooksGateway {
  customers = 0; invoices = 0; sends = 0; failFirstSend = false;
  async findOrCreateCustomer() { this.customers++; return "customer-1"; }
  async createInvoice() { this.invoices++; return { id: "invoice-1", number: "1001", balance: 2997 }; }
  async sendInvoice() { this.sends++; if (this.failFirstSend && this.sends === 1) throw new Error("temporary send failure"); }
}
const build = (repo = new Repo(), qbo = new Qbo()) => ({ repo, qbo, service: new AgreementService(repo, { getReadUrl: async () => "https://example.com/legal.pdf" }, qbo, { send: async () => undefined }, "https://assessments.savians.com", () => new Date("2026-07-05T12:00:00Z")) });

describe("AgreementService", () => {
  it("loads the immutable active template before billing", async () => {
    const { service, qbo } = build(); const result = await service.load(token);
    expect(result.agreement?.version).toBe("2026-v1.4"); expect(result.agreement?.pdfSha256).toBe("p".repeat(64)); expect(qbo.customers).toBe(0);
  });
  it("rejects a typed name that does not match the client", async () => {
    const { service, qbo } = build();
    await expect(service.accept({ token, typedSignatureName: "Someone Else", acknowledgementAccepted: true }, {})).rejects.toMatchObject({ code: "SIGNATURE_NAME_MISMATCH" });
    expect(qbo.invoices).toBe(0);
  });
  it("stores evidence then creates and sends exactly one invoice on duplicate submit", async () => {
    const { service, repo, qbo } = build(); const input = { token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true as const };
    await service.accept(input, { ipAddress: "203.0.113.10", userAgent: "test" }); await service.accept(input, {});
    expect(repo.signature?.templateVersion).toBe("2026-v1.4"); expect(repo.signature?.evidencePayloadSha256).toHaveLength(64);
    expect(qbo.customers).toBe(1); expect(qbo.invoices).toBe(1); expect(qbo.sends).toBe(1); expect(repo.session.status).toBe("PAYMENT_PENDING");
  });
  it("resumes after a send failure without duplicating the customer or invoice", async () => {
    const repo = new Repo(); const qbo = new Qbo(); qbo.failFirstSend = true; const { service } = build(repo, qbo);
    const input = { token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true as const };
    await expect(service.accept(input, {})).rejects.toBeInstanceOf(AgreementFlowError); await service.accept(input, {});
    expect(qbo.customers).toBe(1); expect(qbo.invoices).toBe(1); expect(qbo.sends).toBe(2); expect(repo.failures).toHaveLength(1);
  });
  it("rejects expired bearer tokens", async () => {
    const { service, repo } = build(); repo.session.statusTokenExpiresAt = new Date("2026-07-01T00:00:00Z");
    await expect(service.load(token)).rejects.toMatchObject({ code: "EXPIRED_TOKEN", statusCode: 410 });
  });
});