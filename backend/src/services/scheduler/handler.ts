import type { ScheduledHandler } from "aws-lambda";
import { getApplicationSecrets, persistQuickBooksRefreshToken } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { AgreementService } from "../agreement/agreement-service";
import { IntuitQuickBooksGateway } from "../agreement/quickbooks-client";
import { PrismaAgreementRepository } from "../agreement/prisma-agreement-repository";
import { ResendAgreementConfirmationNotifier } from "../agreement/resend-agreement-confirmation-notifier";
import { ResendPaymentSupportNotifier } from "../agreement/resend-payment-support-notifier";
import { S3AgreementPdfProvider } from "../agreement/s3-agreement-pdf-provider";
import { PaymentStatusService } from "../payment/payment-service";
import { PrismaPaymentRepository } from "../payment/prisma-payment-repository";
import { ResendPaymentConfirmedNotifier } from "../payment/resend-payment-confirmed-notifier";

export const handler: ScheduledHandler = async (_event, context) => {
  const secrets = await getApplicationSecrets();
  const prisma = getPrismaClient(secrets.DATABASE_URL);
  const repository = new PrismaPaymentRepository(prisma);
  const quickBooks = new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const service = new PaymentStatusService(
    repository,
    quickBooks,
    new ResendPaymentSupportNotifier(secrets),
    new ResendPaymentConfirmedNotifier(secrets),
    frontendUrl
  );
  const agreementService = new AgreementService(
    new PrismaAgreementRepository(prisma),
    new S3AgreementPdfProvider(process.env.S3_DOCUMENTS_BUCKET ?? ""),
    quickBooks,
    new ResendAgreementConfirmationNotifier(secrets)
  );
  const paymentReconciliation = await service.reconcileOpenInvoices(25);
  // Payment verification remains the scheduler's first priority. Agreement
  // confirmation recovery uses a deliberately smaller bounded batch so an
  // email backlog cannot consume the Lambda's reconciliation window.
  const agreementConfirmations =
    await agreementService.retryAgreementConfirmations(frontendUrl, 10);
  log("info", "scheduled assessment maintenance completed", {
    requestId: context.awsRequestId,
    agreementConfirmations,
    paymentReconciliation
  });
};
