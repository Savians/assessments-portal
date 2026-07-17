import fs from "node:fs";
import path from "node:path";
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";

const argumentValue = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(name + "="))?.split("=", 2)[1];
const requiredArgument = (name: string): string => {
  const value = argumentValue(name);
  if (!value) throw new Error("Missing required argument " + name);
  return value;
};
const applicationSecretId = requiredArgument("--application-secret");
const rdsSecretId = requiredArgument("--rds-secret");
const envFile = argumentValue("--env-file");

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });

async function readSecret(secretId: string): Promise<Record<string, unknown>> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) throw new Error(secretId + " has no SecretString");
  return JSON.parse(response.SecretString) as Record<string, unknown>;
}

function databaseUrlWithCredential(databaseUrl: string, username: string, password: string): string {
  const url = new URL(databaseUrl);
  if (decodeURIComponent(url.username) !== username) {
    throw new Error("The application database username does not match the RDS-managed username");
  }
  url.username = username;
  url.password = password;
  return url.toString();
}

const stableValue = (value: unknown): string => JSON.stringify(value);

async function main() {
  const [applicationSecret, rdsSecret] = await Promise.all([
    readSecret(applicationSecretId),
    readSecret(rdsSecretId)
  ]);
  const databaseUrl = applicationSecret.DATABASE_URL;
  const username = rdsSecret.username;
  const password = rdsSecret.password;
  if (typeof databaseUrl !== "string" || typeof username !== "string" || typeof password !== "string") {
    throw new Error("The application or RDS-managed secret is missing required database fields");
  }

  const preserved = new Map(
    Object.entries(applicationSecret)
      .filter(([name]) => name !== "DATABASE_URL")
      .map(([name, value]) => [name, stableValue(value)])
  );
  const updatedDatabaseUrl = databaseUrlWithCredential(databaseUrl, username, password);
  const next = { ...applicationSecret, DATABASE_URL: updatedDatabaseUrl };
  await client.send(new PutSecretValueCommand({
    SecretId: applicationSecretId,
    SecretString: JSON.stringify(next)
  }));

  const verified = await readSecret(applicationSecretId);
  for (const [name, value] of preserved) {
    if (stableValue(verified[name]) !== value) throw new Error(name + " changed unexpectedly");
  }
  if (verified.DATABASE_URL !== updatedDatabaseUrl) throw new Error("DATABASE_URL verification failed");

  if (envFile) {
    const resolved = path.resolve(process.cwd(), envFile);
    const contents = fs.readFileSync(resolved, "utf8");
    if (!/^DATABASE_URL=.*$/m.test(contents)) throw new Error(resolved + " has no DATABASE_URL line");
    fs.writeFileSync(resolved, contents.replace(/^DATABASE_URL=.*$/m, "DATABASE_URL=" + updatedDatabaseUrl));
  }

  console.log("UPDATED " + applicationSecretId + " DATABASE_URL only; preservedFields=" + preserved.size + (envFile ? "; localEnvUpdated=true" : ""));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
