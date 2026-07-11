import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { getRuntimeConfig } from "./runtime-config";

const secretsSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_ENABLED: z.union([z.boolean(), z.enum(["true", "false"])]).default(false).transform((value) => value === true || value === "true"),
  EMAIL_FROM: z.string().email().default("contactus@savians.com"),
  EMAIL_REPLY_TO: z.string().email().default("contactus@savians.com"),
  QB_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  QB_CLIENT_ID: z.string().min(1).optional(),
  QB_CLIENT_SECRET: z.string().min(1).optional(),
  QB_REFRESH_TOKEN: z.string().min(1).optional(),
  QB_REALM_ID: z.string().min(1).optional(),
  QB_WEBHOOK_VERIFIER_TOKEN: z.string().min(1).optional(),
  QB_SERVICE_ITEM_ID_TAX_ASSESSMENT: z.string().min(1).optional(),
  QB_MINOR_VERSION: z.string().optional(),
  QB_BASE_URL: z.string().url().default("https://sandbox-quickbooks.api.intuit.com/v3")
});

export type ApplicationSecrets = z.infer<typeof secretsSchema>;
let cached: ApplicationSecrets | undefined;

const localSecrets = (): Record<string, unknown> => ({
  DATABASE_URL: process.env.DATABASE_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_ENABLED: process.env.EMAIL_ENABLED,
  EMAIL_FROM: process.env.EMAIL_FROM ?? process.env.SES_FROM_EMAIL,
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO ?? process.env.SES_REPLY_TO_EMAIL,
  QB_ENVIRONMENT: process.env.QB_ENVIRONMENT,
  QB_CLIENT_ID: process.env.QB_CLIENT_ID,
  QB_CLIENT_SECRET: process.env.QB_CLIENT_SECRET,
  QB_REFRESH_TOKEN: process.env.QB_REFRESH_TOKEN,
  QB_REALM_ID: process.env.QB_REALM_ID,
  QB_WEBHOOK_VERIFIER_TOKEN: process.env.QB_WEBHOOK_VERIFIER_TOKEN,
  QB_SERVICE_ITEM_ID_TAX_ASSESSMENT: process.env.QB_SERVICE_ITEM_ID_TAX_ASSESSMENT,
  QB_MINOR_VERSION: process.env.QB_MINOR_VERSION,
  QB_BASE_URL: process.env.QB_BASE_URL
});

export async function getApplicationSecrets(): Promise<ApplicationSecrets> {
  if (cached) return cached;
  if (process.env.DATABASE_URL) {
    cached = secretsSchema.parse(localSecrets());
    return cached;
  }
  const config = getRuntimeConfig();
  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: config.ASSESSMENT_SECRET_NAME }));
  if (!response.SecretString) throw new Error("Assessment application secret has no SecretString");
  return secretsSchema.parse(JSON.parse(response.SecretString) as unknown);
}

export async function persistQuickBooksRefreshToken(expected: string, next: string): Promise<void> {
  if (expected === next) return;
  if (process.env.DATABASE_URL) {
    process.env.QB_REFRESH_TOKEN = next;
    if (cached) cached = { ...cached, QB_REFRESH_TOKEN: next };
    return;
  }
  const config = getRuntimeConfig();
  const client = new SecretsManagerClient({});
  const current = await client.send(new GetSecretValueCommand({ SecretId: config.ASSESSMENT_SECRET_NAME }));
  if (!current.SecretString) throw new Error("Assessment application secret has no SecretString");
  const value = JSON.parse(current.SecretString) as Record<string, unknown>;
  if (value.QB_REFRESH_TOKEN !== expected) throw new Error("QuickBooks refresh token changed during rotation");
  value.QB_REFRESH_TOKEN = next;
  await client.send(new PutSecretValueCommand({ SecretId: config.ASSESSMENT_SECRET_NAME, SecretString: JSON.stringify(value) }));
}

export function clearApplicationSecretsForTests(): void { cached = undefined; }
