# Phase 3 Progress: Legal Agreement and QuickBooks Invoice

Updated: 2026-07-05

Status: **Complete; controlled QuickBooks sandbox transaction passed**

## Implemented

- Secure `GET /api/assessment/agreement/{token}` and `POST /api/assessment/agreement/sign` handlers.
- Bearer-token hashing, expiry validation, exact legal-name validation, and read-only agreement date.
- Immutable template/version/DOCX/PDF hash snapshots on every signature.
- Timestamp, IP, user agent, consent version, and canonical evidence-payload SHA-256 capture.
- Transactional signature, status-history, and audit records.
- Server-only QuickBooks OAuth refresh and rotated-token persistence boundary.
- Email-matched customer lookup/create after agreement acceptance only.
- One USD 2,997 invoice using the configured assessment service item.
- Stable QuickBooks request IDs for customer, invoice, and send operations.
- Retry continuation from signed/customer/invoice stages without duplicate customer or invoice creation.
- QuickBooks invoice delivery plus Resend status-email integration.
- QuickBooks invoice send requests omit JSON bodies/headers when using the `sendTo` email flow, matching the sandbox endpoint behavior.
- Resend status-email failures are recorded separately and do not incorrectly mark the QuickBooks invoice step as failed.
- Secure agreement frontend with full PDF viewer, acknowledgement, typed signature, errors, and progress UI.
- Agreement Lambda serialized to one concurrent execution for refresh-token rotation and accounting ordering.
- Controlled sandbox test script with an approved-recipient guard and duplicate-safe retry behavior.

## Legal artifact

- Source DOCX SHA-256: `566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179`
- Portal PDF SHA-256: `12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735`
- PDF: 5 US-Letter pages, 84 source paragraphs, 2 embedded images.
- All five rendered pages were visually inspected; no clipping, overlap, missing signature, or broken layout was found.

## Independent database track

- Assessment SQL moved to `backend/database/migrations/`.
- Dedicated ledger: `assessment_schema_migrations`.
- Dedicated advisory lock and immutable SHA-256 checksums.
- 17 tables and 10 PostgreSQL enum types are all assessment-prefixed.
- Migration audit: zero referral references, zero `_prisma_migrations` references, and zero drop statements.
- The referral migration history remains untouched.

## Verification completed

- Backend ESLint, TypeScript, Prisma validation/generation, build, and 14 tests pass.
- Frontend ESLint, TypeScript, production build, and 5 tests pass.
- CDK synthesis passes with the real agreement handler and 16 API routes.
- Existing subnet route-table annotations remain non-blocking.

## Controlled sandbox transaction

- Approved recipient: `thearpit2005@gmail.com`.
- Result: `CONTROLLED TEST PASSED`.
- Final session status: `PAYMENT_PENDING`.
- QuickBooks invoice number: `1038`.
- Invoice balance: `$2,997.00`.
- Agreement evidence hash verified: yes.
- Savians status email sent: yes.
- The test reused the existing controlled-test session/invoice after a recoverable send failure and did not create a duplicate invoice.
- No backend or frontend deployment has been performed.

## Phase 3 exit gate

Phase 3 is closed. Agreement evidence is immutable, invoice creation is idempotent, QuickBooks invoice email delivery works in sandbox, and the Savians status email is delivered to the approved recipient.

## Applied external evidence (2026-07-05)

- Database: 3 migrations applied, 0 pending.
- Database verification: 18 assessment tables, 10 assessment enums, active legal template verified.
- S3 DOCX: published and verified, 343,860 bytes, AES256.
- S3 PDF: published and verified, 327,232 bytes, AES256.
- Runtime IAM tightened to read-only access for legal template keys.
- QuickBooks sandbox OAuth: renewed and verified against `Sandbox Company US 7b3d`.
- QuickBooks item: active `Tax Assessment Plan` service, item ID stored privately, price `$2,997`, income account `Services`.
- AWS Secrets Manager: `savians/assessment/staging` created and verified with all required runtime fields.
- Controlled sandbox invoice/email test: passed for invoice `1038` with balance `$2,997.00`.
