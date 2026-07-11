import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { AssessmentStatus, ClientType, PrismaClient } from "@prisma/client";
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getApplicationSecrets } from "../src/shared/application-secrets";
import { AgreementService } from "../src/services/agreement/agreement-service";
import { PrismaAgreementRepository } from "../src/services/agreement/prisma-agreement-repository";
import { IntuitQuickBooksGateway } from "../src/services/agreement/quickbooks-client";
import { ResendInvoiceStatusNotifier } from "../src/services/agreement/resend-invoice-status-notifier";

const backend = path.resolve(__dirname, "..");
const envPath = path.join(backend, ".env");
const serviceCode = "TAX_ASSESSMENT_SANDBOX_TEST";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function replaceEnv(name: string, value: string) {
  const original = await readFile(envPath, "utf8");
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(original) ? original.replace(pattern, line) : `${original.trimEnd()}\n${line}\n`;
  const temp = `${envPath}.tmp`;
  await writeFile(temp, next, { encoding: "utf8", mode: 0o600 });
  await rename(temp, envPath);
}

async function persistRotatedToken(expected: string, next: string) {
  if (expected === next) return;
  const secretId = process.env.ASSESSMENT_SECRET_NAME ?? "savians/assessment/staging";
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!current.SecretString) throw new Error("Assessment secret has no SecretString");
  const value = JSON.parse(current.SecretString) as Record<string, unknown>;
  if (value.QB_REFRESH_TOKEN !== expected) throw new Error("AWS and local QuickBooks refresh tokens are not synchronized");
  value.QB_REFRESH_TOKEN = next;
  await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(value) }));
  await replaceEnv("QB_REFRESH_TOKEN", next);
  process.env.QB_REFRESH_TOKEN = next;
  console.log("Persisted the rotated QuickBooks refresh token to local .env and AWS Secrets Manager.");
}

async function main() {
  const recipient = process.env.CONTROLLED_TEST_EMAIL?.trim().toLowerCase();
  if (!recipient || recipient !== "thearpit2005@gmail.com") throw new Error("CONTROLLED_TEST_EMAIL must be the explicitly approved recipient");
  const secrets = await getApplicationSecrets();
  const emailSecrets = { ...secrets, EMAIL_ENABLED: true };
  const prisma = new PrismaClient({ datasourceUrl: secrets.DATABASE_URL });
  const now = new Date();
  const assessmentYear = now.getUTCFullYear();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hash(token);
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  try {
    let session = await prisma.assessmentSession.findUnique({ where: { normalizedEmail_serviceCode_assessmentYear: { normalizedEmail: recipient, serviceCode, assessmentYear } } });
    if (!session) {
      session = await prisma.$transaction(async (tx) => {
        const created = await tx.assessmentSession.create({ data: {
          normalizedEmail: recipient, phone: "+19185550199", firstName: "Arpit", lastName: "Assessment Sandbox Test",
          dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), clientType: ClientType.INDIVIDUAL, state: "OK",
          consentAcceptedAt: now, consentVersion: "controlled-sandbox-test-v1", assessmentYear, serviceCode,
          serviceAmount: 2997, currency: "USD", status: AssessmentStatus.AGREEMENT_PENDING,
          statusTokenHash: tokenHash, statusTokenExpiresAt: expiresAt
        } });
        await tx.assessmentStatusHistory.create({ data: { sessionId: created.id, newStatus: AssessmentStatus.AGREEMENT_PENDING, reason: "Approved controlled sandbox test", actorType: "SYSTEM" } });
        await tx.auditLog.create({ data: { sessionId: created.id, action: "CONTROLLED_SANDBOX_TEST_STARTED", entityType: "ASSESSMENT_SESSION", entityId: created.id, actorType: "SYSTEM", metadata: { serviceCode } } });
        return created;
      });
      console.log("Created isolated controlled-test assessment session.");
    } else {
      session = await prisma.assessmentSession.update({ where: { id: session.id }, data: { statusTokenHash: tokenHash, statusTokenExpiresAt: expiresAt } });
      console.log(`Reusing controlled-test session at status ${session.status}.`);
    }

    const repository = new PrismaAgreementRepository(prisma);
    const qbo = new IntuitQuickBooksGateway(secrets, persistRotatedToken);
    const resend = new ResendInvoiceStatusNotifier(emailSecrets);
    let statusEmailSent = false;
    const notifier = { send: async (input: Parameters<ResendInvoiceStatusNotifier["send"]>[0]) => { await resend.send(input); statusEmailSent = true; } };
    const service = new AgreementService(repository, { getReadUrl: async () => "" }, qbo, notifier, "https://staging.assessments.savians.com");
    let result;
    try {
      result = await service.accept({ token, typedSignatureName: "Arpit Assessment Sandbox Test", acknowledgementAccepted: true }, { ipAddress: "127.0.0.1", userAgent: "savians-assessment-controlled-test/1.0" });
    } catch (error) {
      const failure = await prisma.auditLog.findFirst({
        where: { sessionId: session.id, action: "AGREEMENT_BILLING_FAILED" },
        orderBy: { createdAt: "desc" },
        select: { metadata: true }
      });
      const metadata = failure?.metadata;
      const message = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "message" in metadata
        ? String(metadata.message)
        : "No stored QuickBooks failure detail was found";
      console.error(`Stored QuickBooks failure: ${message}`);
      throw error;
    }
    const verified = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: session.id }, include: { signatures: true } });
    if (result.status !== "PAYMENT_PENDING" || verified.status !== AssessmentStatus.PAYMENT_PENDING) throw new Error("Controlled session did not reach PAYMENT_PENDING");
    if (!verified.qbCustomerId || !verified.qbInvoiceId || !verified.qbInvoiceNumber || verified.qbInvoiceBalance?.toNumber() !== 2997) throw new Error("QuickBooks invoice evidence is incomplete");
    if (verified.signatures.length !== 1 || verified.signatures[0]?.evidencePayloadSha256.length !== 64) throw new Error("Agreement signature evidence is incomplete");
    if (!statusEmailSent && session.status !== AssessmentStatus.PAYMENT_PENDING) throw new Error("Savians status email was not sent");
    await prisma.auditLog.create({ data: { sessionId: session.id, action: "CONTROLLED_SANDBOX_TEST_PASSED", entityType: "ASSESSMENT_SESSION", entityId: session.id, actorType: "SYSTEM", metadata: { invoiceNumber: verified.qbInvoiceNumber, statusEmailSent } } });
    console.log(`CONTROLLED TEST PASSED status=${verified.status} invoiceNumber=${verified.qbInvoiceNumber} balance=${verified.qbInvoiceBalance?.toFixed(2)} agreementEvidence=true statusEmailSent=${statusEmailSent}`);
  } finally { await prisma.$disconnect(); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
