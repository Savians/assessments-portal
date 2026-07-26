import { describe, expect, it } from "vitest";
import { AgreementFlowError, AgreementService, type AgreementConfirmationNotifier, type AgreementRepository, type AgreementSession, type AgreementTemplateRecord, type SignatureEvidence } from "./agreement-service";
import type { QuickBooksGateway } from "./quickbooks-client";

const token = "a".repeat(43);
const template: AgreementTemplateRecord = { id: "template-1", version: "2026-v1.4", title: "Tax Assessment Plan Legal Service Agreement", docxSha256: "d".repeat(64), pdfSha256: "p".repeat(64), pdfS3Key: "assessments/legal/template.pdf", sourceFileName: "legal.docx", consentTextVersion: "agreement-acceptance-v1" };
class Repo implements AgreementRepository {
  session: AgreementSession = { id: "session-1", normalizedEmail: "client@example.com", phone: "+19185550123", firstName: "Jane", middleName: "Q", lastName: "Client", assessmentYear: 2026, serviceAmount: 2997, currency: "USD", status: "AGREEMENT_PENDING", statusTokenExpiresAt: new Date("2026-08-01T00:00:00Z"), downloadTokenSeed: "f".repeat(64) };
  signature?: SignatureEvidence;
  failures: string[] = [];
  download?: { tokenHash: string; expiresAt: Date };
  retryCandidates: Awaited<ReturnType<AgreementRepository["findAgreementConfirmationCandidates"]>> = [];
  confirmations: Array<{ status: "SENT" | "FAILED" | "SKIPPED"; failureReason?: string }> = [];
  async findSessionByTokenHash() { return this.session; }
  async findActiveTemplate() { return template; }
  async findSignedTemplate() { return this.signature ? template : null; }
  async acceptSignature(evidence: SignatureEvidence) {
    this.signature ??= evidence;
    this.session.status = "AGREEMENT_SIGNED";
    this.session.agreementSignedAt = this.signature.signedAt;
    return {
      signedAt: this.signature.signedAt,
      evidencePayloadSha256: this.signature.evidencePayloadSha256,
      template
    };
  }
  async saveQuickBooksCustomer(_sessionId: string, id: string) { this.session.qbCustomerId = id; this.session.status = "QB_CUSTOMER_CREATED"; }
  async saveQuickBooksInvoice(_sessionId: string, invoice: { id: string; number?: string; balance: number }) { this.session.qbInvoiceId = invoice.id; this.session.qbInvoiceNumber = invoice.number; this.session.qbInvoiceBalance = invoice.balance; this.session.status = "INVOICE_CREATED"; }
  async markInvoiceSent() { this.session.status = "PAYMENT_PENDING"; }
  async recordBillingFailure(_sessionId: string, message: string) { this.failures.push(message); }
  async ensureAgreementDownloadToken(input: { tokenHash: string; expiresAt: Date }) {
    this.download = input;
  }
  async findAgreementDownloadByTokenHash(tokenHash: string) {
    if (!this.download || this.download.tokenHash !== tokenHash) return null;
    return { assessmentYear: this.session.assessmentYear, expiresAt: this.download.expiresAt, template };
  }
  async hasSentAgreementConfirmation() {
    return this.confirmations.some((confirmation) => confirmation.status === "SENT");
  }
  async findAgreementConfirmationCandidates() {
    return this.retryCandidates;
  }
  async recordAgreementConfirmation(input: { status: "SENT" | "FAILED" | "SKIPPED"; failureReason?: string }) {
    this.confirmations.push({ status: input.status, failureReason: input.failureReason });
  }
}
class Qbo implements QuickBooksGateway {
  customers = 0; invoices = 0; sends = 0; failFirstSend = false;
  async findOrCreateCustomer() { this.customers++; return "customer-1"; }
  async createInvoice() { this.invoices++; return { id: "invoice-1", number: "1001", balance: 2997 }; }
  async sendInvoice() { this.sends++; if (this.failFirstSend && this.sends === 1) throw new Error("temporary send failure"); }
}
class Notifier implements AgreementConfirmationNotifier {
  sends = 0;
  fail = false;
  deliveryStatus: "SENT" | "SKIPPED" = "SENT";
  last?: Parameters<AgreementConfirmationNotifier["send"]>[0];
  async send(input: Parameters<AgreementConfirmationNotifier["send"]>[0]) {
    this.sends++;
    this.last = input;
    if (this.fail) throw new Error("Resend rejected confirmation");
    return {
      status: this.deliveryStatus,
      providerMessageId:
        this.deliveryStatus === "SENT" ? "email-1" : undefined
    };
  }
}
class PdfProvider {
  calls: Array<{ key: string; options?: { expiresIn?: number; downloadFileName?: string } }> = [];
  async getReadUrl(key: string, options?: { expiresIn?: number; downloadFileName?: string }) {
    this.calls.push({ key, options });
    return "https://s3.example.com/legal.pdf";
  }
}
const context = { downloadBaseUrl: "https://assessments.savians.com" };
const build = (
  repo = new Repo(),
  qbo = new Qbo(),
  notifier = new Notifier(),
  pdf = new PdfProvider(),
  now: () => Date = () => new Date("2026-07-05T12:00:00Z")
) => ({
  repo,
  qbo,
  notifier,
  pdf,
  service: new AgreementService(
    repo,
    pdf,
    qbo,
    notifier,
    now
  )
});

describe("AgreementService", () => {
  it("loads the immutable active template before billing", async () => {
    const { service, qbo } = build(); const result = await service.load(token);
    expect(result.agreement?.version).toBe("2026-v1.4"); expect(result.agreement?.pdfSha256).toBe("p".repeat(64)); expect(qbo.customers).toBe(0);
  });
  it("rejects a typed name that does not match the client", async () => {
    const { service, qbo } = build();
    await expect(service.accept({ token, typedSignatureName: "Someone Else", acknowledgementAccepted: true }, context)).rejects.toMatchObject({ code: "SIGNATURE_NAME_MISMATCH" });
    expect(qbo.invoices).toBe(0);
  });
  it("stores evidence, sends one confirmation, then creates exactly one invoice on duplicate submit", async () => {
    const { service, repo, qbo, notifier } = build(); const input = { token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true as const };
    await service.accept(input, { ...context, ipAddress: "203.0.113.10", userAgent: "test" }); await service.accept(input, context);
    expect(repo.signature?.templateVersion).toBe("2026-v1.4"); expect(repo.signature?.evidencePayloadSha256).toHaveLength(64);
    expect(qbo.customers).toBe(1); expect(qbo.invoices).toBe(1); expect(qbo.sends).toBe(1); expect(repo.session.status).toBe("PAYMENT_PENDING");
    expect(notifier.sends).toBe(1);
    expect(notifier.last?.downloadUrl).toMatch(/^https:\/\/assessments\.savians\.com\/assessment\/agreement\/download\//);
    expect(notifier.last?.downloadUrl).not.toContain(token);
    expect(repo.confirmations).toEqual([{ status: "SENT", failureReason: undefined }]);
  });
  it("uses the persisted first-writer timestamp and template after a concurrent signature wins", async () => {
    const repo = new Repo();
    const firstWriterSignedAt = new Date("2026-07-05T11:59:00Z");
    const firstWriterTemplate = {
      ...template,
      id: "template-first-writer",
      version: "2026-v1.3",
      title: "Persisted first-writer agreement"
    };
    repo.acceptSignature = async (evidence) => {
      repo.signature = {
        ...evidence,
        templateId: firstWriterTemplate.id,
        signedAt: firstWriterSignedAt,
        templateVersion: firstWriterTemplate.version,
        templateTitle: firstWriterTemplate.title
      };
      repo.session.status = "AGREEMENT_SIGNED";
      repo.session.agreementSignedAt = firstWriterSignedAt;
      return {
        signedAt: firstWriterSignedAt,
        evidencePayloadSha256: repo.signature.evidencePayloadSha256,
        template: firstWriterTemplate
      };
    };
    const { service, notifier } = build(repo);

    await service.accept(
      {
        token,
        typedSignatureName: "Jane Q Client",
        acknowledgementAccepted: true
      },
      context
    );

    expect(notifier.last).toMatchObject({
      signedAt: firstWriterSignedAt,
      agreementTitle: firstWriterTemplate.title
    });
  });
  it.each(["COMPLETED", "ERROR"])("does not restart billing for a %s session replay without signed evidence", async (status) => {
    const { service, repo, qbo, notifier } = build();
    repo.session.status = status;

    await expect(service.accept({
      token,
      typedSignatureName: "Jane Q Client",
      acknowledgementAccepted: true
    }, context)).resolves.toMatchObject({
      status,
      nextUrl: `/assessment/status/${token}`
    });

    expect(qbo.customers).toBe(0);
    expect(qbo.invoices).toBe(0);
    expect(qbo.sends).toBe(0);
    expect(notifier.sends).toBe(0);
  });
  it("resumes after a send failure without duplicating the customer or invoice", async () => {
    const repo = new Repo(); const qbo = new Qbo(); qbo.failFirstSend = true; const { service, notifier } = build(repo, qbo);
    const input = { token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true as const };
    await expect(service.accept(input, context)).rejects.toBeInstanceOf(AgreementFlowError); await service.accept(input, context);
    expect(qbo.customers).toBe(1); expect(qbo.invoices).toBe(1); expect(qbo.sends).toBe(2); expect(repo.failures).toHaveLength(1);
    expect(notifier.sends).toBe(1);
  });
  it("does not roll back signing or billing when the confirmation email fails", async () => {
    const repo = new Repo(); const notifier = new Notifier(); notifier.fail = true;
    const { service, qbo } = build(repo, new Qbo(), notifier);
    await service.accept({ token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true }, context);
    expect(repo.signature).toBeDefined();
    expect(repo.session.status).toBe("PAYMENT_PENDING");
    expect(qbo.invoices).toBe(1);
    expect(repo.confirmations).toEqual([{ status: "FAILED", failureReason: "Resend rejected confirmation" }]);
  });
  it("retries FAILED and SKIPPED confirmations until SENT with a stable private link and fresh expiry", async () => {
    const repo = new Repo();
    const notifier = new Notifier();
    notifier.fail = true;
    let currentTime = new Date("2026-07-05T12:00:00Z");
    const { service } = build(
      repo,
      new Qbo(),
      notifier,
      new PdfProvider(),
      () => currentTime
    );
    await service.accept(
      {
        token,
        typedSignatureName: "Jane Q Client",
        acknowledgementAccepted: true
      },
      context
    );
    const failedUrl = notifier.last?.downloadUrl;
    const failedExpiry = notifier.last?.downloadExpiresAt;
    const failedIdempotencyKey = notifier.last?.idempotencyKey;
    expect(repo.confirmations.at(-1)?.status).toBe("FAILED");

    repo.retryCandidates = [{
      ...repo.session,
      agreementSignedAt: repo.session.agreementSignedAt ??
        new Date("2026-07-05T12:00:00Z"),
      template
    }];
    currentTime = new Date("2026-07-05T18:00:00Z");
    notifier.fail = false;
    notifier.deliveryStatus = "SKIPPED";
    await expect(
      service.retryAgreementConfirmations(context.downloadBaseUrl)
    ).resolves.toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
    expect(notifier.last?.downloadUrl).toBe(failedUrl);
    expect(notifier.last?.downloadExpiresAt).toEqual(failedExpiry);
    expect(notifier.last?.idempotencyKey).toBe(failedIdempotencyKey);

    currentTime = new Date("2026-07-06T01:00:00Z");
    notifier.deliveryStatus = "SENT";
    await expect(
      service.retryAgreementConfirmations(context.downloadBaseUrl)
    ).resolves.toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(notifier.last?.downloadUrl).toBe(failedUrl);
    expect(notifier.last?.idempotencyKey).not.toBe(failedIdempotencyKey);
    expect(notifier.last?.downloadExpiresAt.getTime()).toBeGreaterThan(
      currentTime.getTime() + 30 * 24 * 60 * 60 * 1000 - 1
    );

    const sendsAfterSuccess = notifier.sends;
    await service.retryAgreementConfirmations(context.downloadBaseUrl);
    expect(notifier.sends).toBe(sendsAfterSuccess);
  });
  it("uses the persisted primary-token seed for the download link even when a resume grant is presented", async () => {
    const first = build();
    await first.service.accept(
      {
        token,
        typedSignatureName: "Jane Q Client",
        acknowledgementAccepted: true
      },
      context
    );

    const second = build();
    await second.service.accept(
      {
        token: "b".repeat(43),
        typedSignatureName: "Jane Q Client",
        acknowledgementAccepted: true
      },
      context
    );

    expect(second.notifier.last?.downloadUrl).toBe(
      first.notifier.last?.downloadUrl
    );
    expect(second.notifier.last?.idempotencyKey).toBe(
      first.notifier.last?.idempotencyKey
    );
  });
  it("validates the purpose-specific link and mints a fresh 15-minute URL for the exact signed template", async () => {
    const { service, notifier, pdf } = build();
    await service.accept({ token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true }, context);
    const purposeToken = notifier.last?.downloadUrl.split("/").at(-1);
    expect(purposeToken).toBeTruthy();
    const result = await service.download(purposeToken ?? "");
    expect(result.expiresAt).toBe("2026-07-05T12:15:00.000Z");
    expect(pdf.calls.at(-1)).toEqual({
      key: template.pdfS3Key,
      options: {
        expiresIn: 900,
        downloadFileName: "Savians 2026 Tax Assessment Agreement.pdf"
      }
    });
  });
  it("rejects an expired agreement download link", async () => {
    const { service, repo, notifier } = build();
    await service.accept({ token, typedSignatureName: "Jane Q Client", acknowledgementAccepted: true }, context);
    if (repo.download) repo.download.expiresAt = new Date("2026-07-01T00:00:00Z");
    const purposeToken = notifier.last?.downloadUrl.split("/").at(-1);
    await expect(service.download(purposeToken ?? "")).rejects.toMatchObject({ code: "EXPIRED_DOWNLOAD_LINK", statusCode: 410 });
  });
  it("rejects expired bearer tokens", async () => {
    const { service, repo } = build(); repo.session.statusTokenExpiresAt = new Date("2026-07-01T00:00:00Z");
    await expect(service.load(token)).rejects.toMatchObject({ code: "EXPIRED_TOKEN", statusCode: 410 });
  });
});
