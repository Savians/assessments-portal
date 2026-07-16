import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";

const backend = path.resolve(__dirname, "..");
const envPath = path.join(backend, ".env.production");
const schema = "assessment_production";

async function main() {
  const original = await readFile(envPath, "utf8");
  const values = parse(original);
  if (values.DEPLOY_ENVIRONMENT !== "production") throw new Error(".env.production must set DEPLOY_ENVIRONMENT=production");
  if (!values.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const databaseUrl = new URL(values.DATABASE_URL);
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") throw new Error("DATABASE_URL must be PostgreSQL");
  databaseUrl.searchParams.set("schema", schema);
  const line = `DATABASE_URL=${databaseUrl.toString()}`;
  const next = original.replace(/^DATABASE_URL=.*$/m, line);
  if (next === original && !original.includes(line)) throw new Error("DATABASE_URL line was not found");
  const temp = `${envPath}.tmp`;
  await writeFile(temp, next, { encoding: "utf8", mode: 0o600 });
  await rename(temp, envPath);
  console.log(`Configured isolated production PostgreSQL schema: ${schema}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
