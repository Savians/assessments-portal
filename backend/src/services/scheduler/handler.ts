import type { ScheduledHandler } from "aws-lambda";
import { getApplicationSecrets, persistQuickBooksRefreshToken } from "../../shared/application-secrets";
import { log } from "../../shared/logger";
import { getPrismaClient } from "../../shared/prisma-client";
import { IntuitQuickBooksGateway } from "../agreement/quickbooks-client";
import { ResendInvoiceStatusNotifier } from "../agreement/resend-invoice-status-notifier";
import { PaymentStatusService } from "../payment/payment-service";
import { PrismaPaymentRepository } from "../payment/prisma-payment-repository";

export const handler: ScheduledHandler = async (_event, context) => {
  const secrets = await getApplicationSecrets();
  const repository = new PrismaPaymentRepository(getPrismaClient(secrets.DATABASE_URL));
  const quickBooks = new IntuitQuickBooksGateway(secrets, persistQuickBooksRefreshToken);
  const service = new PaymentStatusService(repository, quickBooks, new ResendInvoiceStatusNotifier(secrets), process.env.FRONTEND_URL ?? "http://localhost:3000");
  const result = await service.reconcileOpenInvoices(25);
  log("info", "payment reconciliation completed", { requestId: context.awsRequestId, ...result });
};
