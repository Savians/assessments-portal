import path from "node:path";
import { CreateSecretCommand, GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config as loadDotenv } from "dotenv";

const backend = path.resolve(__dirname, "..");
const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = envFileArg?.slice("--env-file=".length) ?? ".env";
const envPath = path.isAbsolute(envFile) ? envFile : path.join(backend, envFile);
loadDotenv({ path: envPath });

const names = [
  "DATABASE_URL", "RESEND_API_KEY", "EMAIL_ENABLED", "EMAIL_FROM", "EMAIL_REPLY_TO",
  "QB_ENVIRONMENT", "QB_CLIENT_ID", "QB_CLIENT_SECRET", "QB_REFRESH_TOKEN", "QB_REALM_ID",
  "QB_WEBHOOK_VERIFIER_TOKEN", "QB_SERVICE_ITEM_ID_TAX_ASSESSMENT", "QB_MINOR_VERSION", "QB_BASE_URL"
] as const;
const required = [
  "DATABASE_URL", "RESEND_API_KEY", "QB_ENVIRONMENT", "QB_CLIENT_ID", "QB_CLIENT_SECRET",
  "QB_REFRESH_TOKEN", "QB_REALM_ID", "QB_SERVICE_ITEM_ID_TAX_ASSESSMENT", "QB_BASE_URL"
] as const;

async function main() {
  const secretId = process.env.ASSESSMENT_SECRET_NAME ?? "savians/assessment/staging";
  const environment = process.env.DEPLOY_ENVIRONMENT ?? (secretId.includes("/production") ? "production" : "staging");
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required before syncing AWS Secrets Manager`);
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  let current: Record<string, unknown> = {};
  let exists = true;
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (response.SecretString) current = JSON.parse(response.SecretString) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") exists = false;
    else throw error;
  }
  const next = { ...current };
  for (const name of names) if (process.env[name]) next[name] = process.env[name];
  const secretString = JSON.stringify(next);
  if (!exists) {
    await client.send(new CreateSecretCommand({ Name: secretId, Description: `Savians Assessments ${environment} runtime credentials`, SecretString: secretString, Tags: [{ Key: "Project", Value: "savians-assessments" }, { Key: "Environment", Value: environment }] }));
    console.log(`CREATED ${secretId}`);
  } else if (JSON.stringify(current) !== secretString) {
    await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: secretString }));
    console.log(`UPDATED ${secretId}`);
  } else console.log(`UNCHANGED ${secretId}`);
  const verified = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!verified.SecretString) throw new Error("Synced secret has no SecretString");
  const value = JSON.parse(verified.SecretString) as Record<string, unknown>;
  for (const name of required) if (value[name] !== process.env[name]) throw new Error(`Secret verification failed for ${name}`);
  console.log(`VERIFIED ${secretId} requiredFields=${required.length} configuredFields=${Object.keys(value).length}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
