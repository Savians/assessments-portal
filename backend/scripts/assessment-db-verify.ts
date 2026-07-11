import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const expectedTables = ["assessment_account_invites","assessment_agreement_signatures","assessment_agreement_templates","assessment_audit_logs","assessment_business_investments","assessment_client_profiles","assessment_clients","assessment_documents","assessment_email_events","assessment_household_members","assessment_payment_reconciliations","assessment_properties","assessment_property_owners","assessment_recovery_tokens","assessment_schema_migrations","assessment_sessions","assessment_status_history","assessment_webhook_events"].sort();
const expectedEnums = ["assessment_client_type","assessment_delivery_status","assessment_document_category","assessment_document_status","assessment_household_member_type","assessment_marital_status","assessment_reconciliation_status","assessment_resident_status","assessment_status","assessment_webhook_status"].sort();
async function main() {
  const prisma = new PrismaClient();
  try {
    const tables = (await prisma.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'assessment_%' ORDER BY tablename`).map((row) => row.name);
    const enums = (await prisma.$queryRaw<Array<{ name: string }>>`SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' AND t.typname LIKE 'assessment_%' ORDER BY t.typname`).map((row) => row.name);
    const ledger = await prisma.$queryRaw<Array<{ version: string; name: string; checksum: string }>>`SELECT version,name,checksum FROM assessment_schema_migrations ORDER BY version`;
    const templates = await prisma.$queryRaw<Array<{ version: string; docx_sha256: string; pdf_sha256: string; is_active: boolean }>>`SELECT version,docx_sha256,pdf_sha256,is_active FROM assessment_agreement_templates WHERE version='2026-v1.4'`;
    if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) throw new Error(`Assessment table mismatch: ${tables.join(',')}`);
    if (JSON.stringify(enums) !== JSON.stringify(expectedEnums)) throw new Error(`Assessment enum mismatch: ${enums.join(',')}`);
    if (ledger.length !== 3 || ledger.some((row) => row.checksum.length !== 64)) throw new Error("Assessment ledger verification failed");
    const template = templates[0];
    if (!template?.is_active || template.docx_sha256 !== "566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179" || template.pdf_sha256 !== "12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735") throw new Error("Legal template verification failed");
    console.log(`VERIFIED tables=${tables.length} enums=${enums.length} migrations=${ledger.length} active_template=${template.version}`);
    console.log(tables.join("\n"));
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; });