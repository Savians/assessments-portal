import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const LEDGER = "assessment_schema_migrations";
const LOCK_KEY = "savians-assessments-schema-migrations-v1";
const MIGRATIONS_DIR = path.resolve(__dirname, "../database/migrations");
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
type AppliedMigration = { version: string; name: string; checksum: string; applied_at: Date };
type Migration = { version: string; name: string; fileName: string; checksum: string; sql: string };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const targetSchema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
if (!/^[a-z_][a-z0-9_]*$/i.test(targetSchema)) throw new Error("DATABASE_URL contains an invalid PostgreSQL schema name");
const quotedSchema = `"${targetSchema.replace(/"/g, '""')}"`;
const qualifiedLedger = `${quotedSchema}."${LEDGER}"`;

async function loadMigrations(): Promise<Migration[]> {
  const fileNames = (await readdir(MIGRATIONS_DIR)).filter((file) => FILE_PATTERN.test(file)).sort();
  const seen = new Set<string>(); const migrations: Migration[] = [];
  for (const fileName of fileNames) {
    const match = FILE_PATTERN.exec(fileName);
    if (!match?.[1] || !match[2]) throw new Error(`Invalid assessment migration filename: ${fileName}`);
    if (seen.has(match[1])) throw new Error(`Duplicate assessment migration version: ${match[1]}`);
    seen.add(match[1]); const sql = await readFile(path.join(MIGRATIONS_DIR, fileName), "utf8");
    migrations.push({ version: match[1], name: match[2], fileName, checksum: createHash("sha256").update(sql).digest("hex"), sql });
  }
  if (!migrations.length) throw new Error("No assessment migrations were found");
  return migrations;
}

async function readApplied(prisma: PrismaClient): Promise<AppliedMigration[]> {
  const exists = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`SELECT to_regclass('${targetSchema}.${LEDGER}') IS NOT NULL AS exists`);
  if (!exists[0]?.exists) return [];
  return prisma.$queryRawUnsafe<AppliedMigration[]>(`SELECT version, name, checksum, applied_at FROM ${qualifiedLedger} ORDER BY version`);
}
function verifyHistory(local: Migration[], applied: AppliedMigration[]): void {
  const localByVersion = new Map(local.map((migration) => [migration.version, migration]));
  for (const migration of applied) {
    const expected = localByVersion.get(migration.version);
    if (!expected) throw new Error(`Applied assessment migration ${migration.version} is missing locally`);
    if (expected.checksum !== migration.checksum) throw new Error(`Checksum mismatch for assessment migration ${migration.version}; never edit an applied migration`);
  }
}
async function status(prisma: PrismaClient, migrations: Migration[]): Promise<void> {
  const applied = await readApplied(prisma); verifyHistory(migrations, applied);
  const versions = new Set(applied.map((migration) => migration.version));
  console.log(`Assessment migration ledger: ${LEDGER}`);
  console.log(`PostgreSQL schema: ${targetSchema}`);
  for (const migration of migrations) console.log(`${versions.has(migration.version) ? "APPLIED" : "PENDING"} ${migration.fileName}`);
  console.log(`${applied.length} applied, ${migrations.length - applied.length} pending`);
}
const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextChar = sql[index + 1];
    current += char;

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag.slice(1);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }
      continue;
    }

    if (singleQuoted) {
      if (char === "'" && nextChar === "'") {
        current += nextChar;
        index += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      if (char === '"' && nextChar === '"') {
        current += nextChar;
        index += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === "'") {
      singleQuoted = true;
      continue;
    }
    if (char === '"') {
      doubleQuoted = true;
      continue;
    }
    if (char === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) dollarQuoteTag = tag;
      continue;
    }
    if (char === ";") {
      const statement = current.slice(0, -1).trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}
async function executeMigration(prisma: PrismaClient, migration: Migration): Promise<void> {
  const startedAt = Date.now();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quotedSchema}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext(${sqlLiteral(`${LOCK_KEY}:${targetSchema}`)}))`);
    await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${qualifiedLedger} (version VARCHAR(4) PRIMARY KEY, name VARCHAR(160) NOT NULL, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), execution_ms INTEGER NOT NULL DEFAULT 0)`);
    const alreadyApplied = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(`SELECT EXISTS (SELECT 1 FROM ${qualifiedLedger} WHERE version = ${sqlLiteral(migration.version)}) AS exists`);
    if (alreadyApplied[0]?.exists) throw new Error(`Assessment migration ${migration.version} is already applied`);
    for (const statement of splitSqlStatements(migration.sql)) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe(`INSERT INTO ${qualifiedLedger} (version, name, checksum, execution_ms) VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.checksum)}, ${Date.now() - startedAt})`);
  }, { timeout: 120_000 });
}
async function apply(prisma: PrismaClient, migrations: Migration[]): Promise<void> {
  const applied = await readApplied(prisma); verifyHistory(migrations, applied);
  const versions = new Set(applied.map((migration) => migration.version));
  for (const migration of migrations) { if (!versions.has(migration.version)) { console.log(`Applying ${migration.fileName}`); await executeMigration(prisma, migration); } }
  await status(prisma, migrations);
}
async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";
  if (command !== "status" && command !== "apply") throw new Error("Use status or apply");
  const migrations = await loadMigrations(); const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    if (command === "apply") await apply(prisma, migrations); else await status(prisma, migrations);
  }
  finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
