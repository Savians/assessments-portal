# Savians Assessments - Detailed Implementation Dossier

Document date: 2026-07-09

Production domain: `https://assessments.savians.com`

Project root: `savians-assessments/`

## 1. Executive summary

The Savians Tax Assessment Portal has progressed through the architecture baseline, engineering foundation, public assessment start/resume workflow, the legal-agreement/QuickBooks invoice phase, the local core implementation of payment status/webhook/reconciliation, and the local core implementation of paid-only account setup/authentication.

The application is deliberately isolated from the existing Savians Referral Portal while reusing approved AWS infrastructure. All assessment database tables, PostgreSQL enum types, Lambda functions, API routes, S3 object keys, Cognito resources, secrets, and operational documentation use assessment-specific names or prefixes.

The most important database decision is that this application does not use the referral portal's `_prisma_migrations` history. Assessment migrations use their own immutable SQL directory and their own `assessment_schema_migrations` ledger with SHA-256 checksums and PostgreSQL advisory locking.

## 2. Repository layout

```text
savians-assessments/
|-- frontend/                 Next.js application for AWS Amplify
|-- backend/                  Lambda services, Prisma schema, migration runner, and CDK
|   |-- database/
|   |   `-- migrations/       Assessment-only SQL history
|   |-- infrastructure/       AWS CDK stack
|   |-- prisma/               ORM schema only; not the deployment migration ledger
|   |-- scripts/              Migration, legal publishing, rendering, and QuickBooks utilities
|   `-- src/                  Lambda handlers and domain services
|-- docs/                     Architecture, phase status, runbooks, and handoffs
`-- legal/                    Approved source DOCX and verified portal PDF
```

## 3. Governing product and architecture decisions

- Production hostname: `assessments.savians.com`.
- Frontend delivery: GitHub to AWS Amplify.
- Backend delivery: AWS CDK.
- Database: existing shared PostgreSQL/Aurora resource.
- Database namespace: `assessment_*` physical tables and enum types.
- Lambda naming: `savians-assessment-{environment}-{service}`.
- Email provider: Resend.
- Authentication: existing Cognito user pool with a dedicated assessment app client and `ASSESSMENT_CLIENT` group.
- Accounting: QuickBooks Online; sandbox first, followed by a documented production cutover.
- Account creation: allowed only after exact invoice payment verification.
- Email verification: required before authenticated client access.
- Data retention: seven years.
- Document retention/deletion: seven years unless a legal hold applies.
- Repeat assessments: the same client credentials are reused, with a separate assessment session for each year.
- Legal source: `2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx`.

## 4. Phase 0 - Baseline and external configuration

Completed work:

- Recorded the approved domain, database, AWS reuse, naming, retention, annual-session, authentication, email, and deployment decisions.
- Catalogued the legal source as an immutable artifact.
- Recorded the legal source SHA-256 and version.
- Documented QuickBooks sandbox configuration and the future sandbox-to-production cutover.
- Stored local secrets only in ignored `.env` files.
- Established that the public QuickBooks webhook must eventually use a reachable deployed API endpoint; localhost is not a valid Intuit webhook destination.

Primary records:

- `docs/PHASE_0_BASELINE.md`
- `docs/ENVIRONMENT_MATRIX.md`
- `docs/QUICKBOOKS_SANDBOX_SETUP.md`
- `docs/QUICKBOOKS_PRODUCTION_CUTOVER.md`
- `docs/LEGAL_AGREEMENT_INTEGRATION.md`

## 5. Phase 1 - Engineering foundation

### Frontend foundation

- Created a Next.js 15/React 19 TypeScript application.
- Added strict TypeScript, ESLint, Vitest, Tailwind, shared design tokens, responsive layout primitives, error states, loading states, status badges, and workflow steppers.
- Added application route shells for the complete assessment journey.
- Added Amplify-compatible production builds.

### Backend foundation

- Created a Node.js 20 TypeScript Lambda application.
- Created ten isolated service boundaries:
  - public
  - agreement
  - quickbooks
  - payment
  - auth
  - portal
  - documents
  - notifications
  - webhook
  - scheduler
- Added structured logging and environment validation.
- Added Secrets Manager integration.
- Added a dedicated HTTP API and Cognito authorizer boundary.
- Added a disabled-by-default EventBridge payment reconciliation schedule.

### Infrastructure foundation

- Reuses the approved VPC, private subnets, Lambda security group, RDS resource, S3 bucket, KMS boundary, and Cognito user pool.
- Does not create a new RDS database.
- Creates a dedicated Cognito assessment app client and assessment client group.
- Restricts S3 access to `assessments/*`.
- Keeps payment reconciliation disabled until staging acceptance.

## 6. Phase 2 - Public assessment start and resume

### Public interface

- Completed the public landing page with pricing, inclusions, process, FAQs, and calls to action.
- Added `/assessment/start`.
- Added required first name, middle name, last name, DOB, email, phone, client type, state, income range, estimated-tax range, conditional business name, and consent fields.
- Added accessible validation and loading/error handling.
- Added `/assessment/check-email` for privacy-safe resume responses.
- Added the planned recovery entry shell.

### Annual session rules

- Assessment year is determined server-side in UTC.
- Email addresses are normalized to lowercase.
- US phone numbers are normalized to E.164.
- One session exists per normalized email, service code, and assessment year.
- Repeated submission in the same year resumes the existing session.
- A future year creates a new session for the same client identity.
- Existing-session submissions do not reveal a raw token to the browser; the token is sent to the recorded email address.

### Token security

- Tokens contain 32 cryptographically random bytes.
- Raw tokens are returned only in the intended client/email flow.
- Only SHA-256 token hashes are stored.
- Resume rotates the token.
- Tokens expire after 30 days.

### Auditability

- Session creation and resume write status-history and audit events transactionally.
- Resume-email delivery is recorded as `SENT`, `FAILED`, or `SKIPPED`.
- QuickBooks is not called anywhere in the Phase 2 start service.

## 7. Phase 3 - Legal agreement and invoice implementation

### Agreement API

Implemented endpoints:

- `GET /api/assessment/agreement/{token}`
- `POST /api/assessment/agreement/sign`

The agreement service:

- hashes and validates the bearer token;
- verifies token expiry;
- loads the active versioned agreement template;
- returns a short-lived private S3 PDF URL;
- displays a server-controlled read-only agreement date;
- requires the full legal agreement acknowledgement;
- requires the typed name to match the client's recorded full legal name;
- records template ID, version, title, DOCX hash, PDF hash, consent version, typed name, display date, UTC acceptance timestamp, IP address, user agent, and session ID;
- computes a canonical evidence-payload SHA-256;
- stores signature, session transition, history, and audit evidence transactionally.

### Agreement frontend

Implemented `/assessment/agreement/[token]` with:

- complete embedded PDF viewer;
- template version and agreement date;
- client name, assessment year, and invoice amount summary;
- acknowledgement checkbox;
- typed full legal signature;
- disabled submission until required fields are complete;
- clear expired/invalid token, validation, billing-retry, and general error states;
- progress and loading feedback;
- direct routing to payment status after successful invoice creation.

### QuickBooks sandbox boundary

The QuickBooks implementation is server-only and begins only after agreement evidence is committed.

Implemented behavior:

1. Exchange the refresh token for an access token.
2. Persist a rotated refresh token through the assessment Secrets Manager boundary in AWS.
3. Serialize agreement Lambda concurrency to reduce refresh-token race risk.
4. Search QuickBooks customers by normalized email.
5. Reuse an existing matching customer or create one.
6. Create exactly one USD 2,997 invoice using the configured tax-assessment service item.
7. Use stable request IDs for customer create, invoice create, and invoice send operations.
8. Store QuickBooks customer ID, invoice ID, number, balance, request IDs, and timestamps.
9. Send the invoice using QuickBooks.
10. Send the Savians invoice-status email using Resend.
11. Continue safely from agreement-signed, customer-created, or invoice-created states after a retry.
12. Do not duplicate the customer or invoice after a repeated click or recoverable failure.

Controlled sandbox validation on 2026-07-05:

- Approved test recipient: `thearpit2005@gmail.com`.
- Result: `CONTROLLED TEST PASSED`.
- Final status: `PAYMENT_PENDING`.
- QuickBooks invoice number: `1038`.
- Invoice balance: `$2,997.00`.
- Agreement evidence hash verified: yes.
- Savians status email sent: yes.
- The retry path reused the already-created test invoice after a recoverable QuickBooks send failure and did not create a duplicate invoice.
- QuickBooks invoice-send requests were adjusted to avoid sending JSON bodies/headers on the `sendTo` email flow.
- Resend email failures are recorded separately from QuickBooks billing failures.

## 8. Legal artifacts

### Approved source

- Version: `2026-v1.4`
- Source filename: `2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx`
- DOCX SHA-256: `566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179`
- Source structure: 84 paragraphs and 2 embedded images.

### Portal PDF

- Filename: `2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.pdf`
- PDF SHA-256: `12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735`
- Page count: 5 US-Letter pages.
- Preserved images: Savians Tax Advisors logo and Nagesh Mishra signature.
- QA: every page was rendered to PNG and visually inspected.
- QA result: no clipping, overlap, missing glyphs affecting content, broken layout, missing legal paragraph, missing logo, or missing signature.

Versioned S3 keys:

- `assessments/legal/templates/2026-v1.4/source.docx`
- `assessments/legal/templates/2026-v1.4/agreement.pdf`

## 8A. Dashboard onboarding revision - 2026-07-09

The post-payment onboarding model has been revised so paid clients land in a reusable dashboard instead of a one-time "profile and documents" step.

### Client flow

1. Public start captures the initial assessment details and creates/resumes the assessment session.
2. Agreement signing creates/sends the QuickBooks invoice.
3. Once the invoice balance is verified as zero, the payment status page automatically starts the paid account setup/dashboard path.
4. Account setup still uses the secure paid-only Cognito flow because protected dashboard APIs require a verified paid client identity.
5. After email-code confirmation, the client is routed to `/portal/dashboard`.
6. Returning clients can use the landing-page `Sign In / Resume` action to request a secure resume link. The emailed link maps to the exact saved stage:
   - agreement-pending sessions resume to agreement;
   - invoice/payment sessions resume to payment status;
   - account/profile/document sessions resume to the dashboard.

### Dashboard structure

The dashboard has four left-side tabs with a detailed right-side workspace:

1. `Personal And Family Information`
2. `Real Estate Intake`
3. `Business And Entity Intake`
4. `Document Upload Requirements`

The previous `/portal/profile` page now redirects to `/portal/dashboard`. The document upload workspace is reused inside the dashboard, with the same drag/drop folder UI, preview URLs, and soft-delete behavior already implemented for `/portal/documents`.

### Editable intake sections

- Personal/family data saves through `POST /api/assessment/portal/profile`.
- Real estate intake saves through `POST /api/assessment/portal/properties`.
- Business/entity intake saves through `POST /api/assessment/portal/business-investments`.
- Dashboard state loads from `GET /api/assessment/portal/dashboard`.

All protected dashboard calls require the same paid portal entitlement: verified Cognito identity plus linked paid assessment client/session in PostgreSQL.

### Client-facing status labels

The client dashboard displays these labels:

1. `Payment Pending`
2. `Pending Uploads`
3. `Ready for Review`
4. `In Progress`
5. `Completed`

The current automated system behavior is:

- `PAYMENT_PENDING` and `PAYMENT_VERIFYING` display as `Payment Pending`.
- Paid/account/profile/document-in-progress states display as `Pending Uploads`.
- Clicking `Mark The Assessment Ready For Review` moves the session to `DOCUMENTS_SUBMITTED`, which displays as `Ready for Review`.
- `In Progress` and `Completed` remain admin-side manual workflow states for the later admin dashboard phase.

### Ready-for-review notification

`POST /api/assessment/portal/ready-for-review`:

- requires a complete personal/family profile;
- requires at least one uploaded document;
- moves eligible sessions to `DOCUMENTS_SUBMITTED`;
- records status history, audit log, and email event rows;
- sends an internal Resend notification from `awsadmin@savians.com` to `contactus@savians.com`;
- includes client name, email, phone, assessment year, profile completion state, uploaded document count/bytes, real-estate entry count, and business/entity entry count.

### Frontend routes added/changed

- Added `/portal/dashboard`.
- Added `/assessment/recover` as the landing-page Sign In / Resume path.
- Changed `/portal/profile` to redirect to `/portal/dashboard`.
- Changed successful account confirmation to route to `/portal/dashboard`.
- Changed paid payment-status behavior to automatically initiate the paid account setup/dashboard path.

## 9. Database schema inventory

Assessment-owned tables:

1. `assessment_clients`
2. `assessment_sessions`
3. `assessment_status_history`
4. `assessment_agreement_templates`
5. `assessment_agreement_signatures`
6. `assessment_account_invites`
7. `assessment_recovery_tokens`
8. `assessment_client_profiles`
9. `assessment_household_members`
10. `assessment_properties`
11. `assessment_property_owners`
12. `assessment_business_investments`
13. `assessment_documents`
14. `assessment_audit_logs`
15. `assessment_email_events`
16. `assessment_webhook_events`
17. `assessment_payment_reconciliations`
18. `assessment_schema_migrations` - independent application migration ledger.

Assessment-owned PostgreSQL enum types:

1. `assessment_status`
2. `assessment_client_type`
3. `assessment_household_member_type`
4. `assessment_resident_status`
5. `assessment_marital_status`
6. `assessment_document_status`
7. `assessment_document_category`
8. `assessment_delivery_status`
9. `assessment_webhook_status`
10. `assessment_reconciliation_status`

## 10. Independent migration system

Assessment migration files live under `backend/database/migrations/`:

1. `0001_initial_assessment_schema.sql`
2. `0002_phase3_agreement_and_invoice_idempotency.sql`
3. `0003_register_legal_template_2026_v1_4.sql`

Operational properties:

- Does not call `prisma migrate`, `prisma migrate deploy`, or `prisma migrate resolve`.
- Does not read or write `_prisma_migrations`.
- Does not copy referral migration records.
- Uses `assessment_schema_migrations`.
- Stores immutable SHA-256 checksums.
- Fails if an applied file changes or disappears.
- Uses an assessment-specific PostgreSQL advisory lock.
- Runs each SQL migration in a transaction.
- Uses Prisma only as the database transport because it already supports the current RDS TLS configuration.
- Keeps the Prisma schema as the ORM contract, not as the shared migration-history owner.

Commands:

```powershell
npm run assessment:migrate:status
npm run assessment:migrate
```

## 11. Email behavior

Provider: Resend.

Implemented messages:

- Resume Agreement email after start/resume.
- Invoice/status email after agreement and QuickBooks invoice processing.

Controls:

- Email can be disabled per environment.
- API credentials remain server-side.
- Sender and reply-to addresses are environment-controlled.
- Email delivery failures do not erase the underlying assessment session or agreement evidence.

## 12. AWS/CDK state

The synthesized staging stack contains:

- 10 assessment-prefixed Lambda functions;
- 16 assessment API routes after adding agreement retrieval;
- a dedicated assessment Cognito app client;
- the `ASSESSMENT_CLIENT` Cognito group;
- a disabled payment-reconciliation EventBridge schedule;
- S3 policies limited to `assessments/*`;
- Secrets Manager read access for all required services;
- Secrets Manager write access for the serialized agreement Lambda to persist rotated QuickBooks refresh tokens;
- no new RDS resource.

Known non-blocking synthesis annotations:

- Existing imported subnet route-table IDs are not supplied to CDK. This produces annotations but does not prevent synthesis.

## 13. Security controls implemented

- Secrets excluded from Git and frontend bundles.
- Raw resume/status tokens are never stored.
- Token hashes use SHA-256.
- Token expiry and rotation are enforced.
- Existing-session privacy is preserved.
- Agreement signature snapshots prevent silent template substitution.
- QuickBooks credentials and calls are server-only.
- QuickBooks operations cannot occur before agreement acceptance.
- Stable accounting request IDs prevent duplicate customer/invoice operations.
- Status transitions and evidence writes are transactional.
- Audit records capture meaningful system/client actions.
- Shared database objects use assessment-specific names.
- S3 keys use the `assessments/` prefix.
- Paid access remains locked until exact invoice verification in later phases.
- Seven-year retention and legal-hold fields exist in the schema.

## 14. Verification evidence

Frontend verification:

- ESLint: passed.
- TypeScript: passed.
- Vitest: 5 tests passed.
- Next.js production build: passed.
- Agreement route included in production output.

Backend verification:

- ESLint: passed.
- TypeScript: passed.
- Prisma schema validation: passed.
- Prisma Client generation: passed.
- TypeScript production build: passed.
- Vitest: 14 tests passed across public start, agreement orchestration, QuickBooks adapter, and handler boundaries.
- CDK staging synthesis: passed.

Dependency security:

- Frontend production dependency audit: 0 vulnerabilities.
- Backend production dependency audit: 0 vulnerabilities.

Migration SQL audit:

- 3 migration files.
- 17 application tables.
- 10 PostgreSQL enum types.
- 0 non-assessment table names.
- 0 non-assessment enum names.
- 0 referral references.
- 0 `_prisma_migrations` references.
- 0 `DROP` statements.

## 15. Testing scenarios covered

- Required DOB and consent validation.
- Conditional business-name validation.
- Email normalization.
- Same-year duplicate prevention.
- Future-year session creation.
- Hash-only token storage.
- No QuickBooks dependency before agreement signing.
- Active legal-template loading.
- Expired agreement token rejection.
- Typed-signature legal-name mismatch rejection.
- Immutable evidence hash capture.
- Duplicate-sign submission does not duplicate customer or invoice.
- Retry after invoice-send failure resumes from the saved invoice.
- QuickBooks refresh-token rotation callback.
- Existing customer reuse.
- New customer creation only when no email match exists.
- Invoice uses the configured service item and exact USD 2,997 amount.
- QuickBooks request IDs are present on customer, invoice, and send operations.

## 16. Deployment and environment status

- No frontend production deployment has been performed by this work.
- No backend CDK deployment has been performed by this work.
- All three assessment migrations were applied successfully through the independent ledger on 2026-07-05.
- The approved legal DOCX and PDF were published and verified under the versioned assessment S3 keys on 2026-07-05.
- QuickBooks remains configured for sandbox operation.
- Production QuickBooks credentials, realm, service item, webhook, and controlled transaction remain part of the production cutover.

## 17. Phase 4 local implementation

Implemented on 2026-07-05:

- Public payment status endpoint: `GET /api/assessment/status/{token}`.
- Manual payment refresh endpoint: `POST /api/assessment/refresh-payment-status`.
- Manual invoice resend endpoint: `POST /api/assessment/resend-invoice-email`.
- QuickBooks invoice lookup by stored invoice ID.
- Strict payment verification that requires matching invoice ID, expected currency, expected total amount, and zero balance.
- Payment verification writes status, reconciliation, status-history, and audit records.
- Still-open and failed checks write reconciliation/audit evidence without unlocking access.
- Public QuickBooks webhook endpoint with HMAC-SHA256 `intuit-signature` verification.
- Idempotent webhook storage in `assessment_webhook_events`.
- Invoice webhook events reconcile their matching invoice.
- Payment webhook events trigger a limited open-invoice sweep rather than trusting a payment payload alone.
- Disabled-by-default scheduler handler using the same open-invoice reconciliation logic.
- Frontend `/assessment/status/[token]` with invoice details, 20-second polling, manual refresh, resend, and paid-state CTA placeholder.
- Payment, webhook, and scheduler Lambda definitions now point to real Phase 4 handlers and have Secrets Manager write access for QuickBooks refresh-token rotation.

QuickBooks SMS/text message delivery remains intentionally unimplemented because QuickBooks does not expose a native invoice-SMS API in the accounting API. If required later, SMS should be added as a separate notification provider rather than represented as a QuickBooks feature.

External Phase 4 acceptance still requires staging deployment, Intuit sandbox webhook URL configuration, a real sandbox payment, webhook receipt verification, manual refresh verification, and scheduled reconciliation verification before Phase 5 account setup begins.

## 18. Remaining roadmap

### Phase 4 external acceptance

Deploy staging, configure Intuit sandbox webhook URL, and prove webhook/manual refresh/scheduled reconciliation converge on the same verified payment state.

### Phase 5 external acceptance

Deploy staging, run controlled Cognito sign-up/email verification from a paid assessment invite, verify DB linkage and Cognito group assignment, and prove unpaid/unverified/unlinked users are denied by protected portal endpoints.

### Phase 6

Personal, spouse, dependent, household, and address profile with autosave.

### Phase 7

Repeatable real-estate and business/investment intake.

### Phase 8

Secure categorized document upload, malware/quarantine boundary, retention, and authorization.

### Phase 9

Full recovery, reminder communications, delivery retries, retention automation, and support diagnostics.

### Phase 10

Security, integration, end-to-end, concurrency, accessibility, browser, backup/restore, and compliance hardening.

### Phase 11

Staging deployment, full sandbox acceptance, production credentials/cutover, domain/TLS, controlled first transaction, and launch monitoring.

## 19. Operational warnings

- Never run Prisma migration-history commands for Assessments against the shared database.
- Never resolve or recreate the referral portal's historical migration records from this repository.
- Never edit an applied assessment SQL file; create the next numbered migration.
- Never expose `.env`, QuickBooks credentials, refresh tokens, Resend keys, or raw status tokens in logs or documentation.
- Never enable QuickBooks invoice creation before legal evidence is committed.
- Never enable account creation before exact payment verification.
- Never trust a QuickBooks webhook payload alone for account unlock; always re-fetch the stored invoice.
- Never enable the scheduled reconciliation rule before staging acceptance.
- Never deploy production changes without CDK diff, migration status, backup confirmation, and controlled acceptance evidence.

## 20. Execution record for this run

This section is updated after the external database and S3 operations finish.

- Assessment migration preflight: 0 applied, 3 pending.
- Assessment migrations applied: `0001`, `0002`, and `0003` executed successfully in order.
- Assessment ledger verification: 3 applied, 0 pending; all stored checksums are 64-character SHA-256 values.
- Database object verification: 18 assessment tables (including the independent ledger), 10 assessment enum types, and active legal template `2026-v1.4` verified.
- Referral migration handling: `_prisma_migrations` was neither read for reconciliation nor modified.
- Legal DOCX S3 publication: successful at `assessments/legal/templates/2026-v1.4/source.docx`.
- Legal PDF S3 publication: successful at `assessments/legal/templates/2026-v1.4/agreement.pdf`.
- S3 DOCX verification: 343,860 bytes, correct MIME type/hash metadata, AES-256 server-side encryption.
- S3 PDF verification: 327,232 bytes, correct MIME type/hash metadata, AES-256 server-side encryption.
- S3 bucket versioning: not enabled; legal immutability is enforced by versioned object keys, hash metadata, fail-closed publisher checks, and read-only runtime IAM for the template prefix.
- QuickBooks sandbox service-item discovery: completed after reconnecting the intended sandbox Realm.
- QuickBooks sandbox controlled invoice/email test: completed with invoice `1038`, balance `$2,997.00`, final session status `PAYMENT_PENDING`, verified agreement evidence, and Savians status email sent to the approved recipient.

## 21. QuickBooks and AWS configuration completion (2026-07-05)

- OAuth refresh succeeded after connecting the intended sandbox Realm.
- Diagnostic company lookup confirmed Sandbox Company US 7b3d.
- API item query returned 19 active items and 15 service items.
- Exactly one Tax Assessment candidate was found: Tax Assessment Plan.
- The selected item is active, uses the Service type, has a $2,997 unit price, and maps to Services income.
- The latest rotated refresh token, Realm ID, and service-item ID were saved only in ignored local configuration.
- savians/assessment/staging was created in AWS Secrets Manager and verified after write.
- The sync preserved optional configured fields and did not print credential values.
- The application/CDK boundary grants runtime secret reads and agreement-service refresh-token writes.
- Phase 3 exit test was completed with the user-approved email recipient.
- Phase 3 is closed; Phase 4 is next.

## 22. Phase 4 implementation record (2026-07-05)

- Payment status API, manual refresh, resend, QuickBooks invoice lookup, webhook processor, and scheduler reconciliation handler implemented locally.
- Frontend payment status page implemented and included in production build output.
- Backend tests increased to 20 passing.
- Frontend production build includes dynamic `/assessment/status/[token]`.
- CDK synth confirms real payment, webhook, and scheduler handler bundles.
- EventBridge reconciliation remains disabled pending staging QA.

## 23. Phase 5 implementation record (2026-07-06)

- Paid-only account setup invite service implemented.
- Account invite tokens are seven-day, single-use, revocable, and stored only as SHA-256 hashes.
- Account setup is allowed only after exact payment verification has set `account_creation_allowed`.
- Reissuing a setup invite revokes older unused invites for the same session.
- Account setup starts Cognito SignUp using the assessment app client.
- Cognito email verification is required before DB linkage and portal authorization.
- Confirmation adds the user to the `ASSESSMENT_CLIENT` Cognito group and transactionally links:
  - `assessment_clients.cognito_user_id`;
  - `assessment_clients.email_verified_at`;
  - `assessment_sessions.client_id`;
  - `ACCOUNT_CREATED` session status;
  - used invite timestamp;
  - audit and status-history records.
- Payment status page can send the setup link once payment is verified.
- `/assessment/account/setup/[token]` frontend route implemented.
- Portal protected endpoints now require Cognito email verification, Cognito group membership, and linked paid DB entitlement.
- Direct Cognito signup alone does not unlock the portal.
- No database migration was required.
- Backend tests increased to 28 passing.
- Frontend production build includes dynamic `/assessment/account/setup/[token]`.
- CDK synth confirms real auth and portal handler bundles plus account setup/confirm routes.

## 24. Phase 6 implementation record (2026-07-06)

- Protected profile load/save is implemented behind the Phase 5 paid portal entitlement.
- `GET /api/assessment/portal/profile` returns:
  - entitled client/session/year;
  - primary taxpayer details from `assessment_sessions`;
  - existing profile data when present;
  - default empty profile state when not started;
  - spouse/dependent household members;
  - completion status and progress percentage.
- `POST /api/assessment/portal/profile` validates and saves:
  - household name;
  - home address, city, state, ZIP;
  - homeowner status;
  - marital status;
  - preferred contact;
  - resident status;
  - owns-real-estate and owns-business gates;
  - conditional spouse details;
  - repeatable dependents.
- Server validation prevents:
  - missing required profile fields;
  - invalid state/ZIP;
  - married status without spouse details;
  - spouse data for non-married profiles;
  - missing spouse DOB;
  - missing dependent DOB;
  - invalid/future DOB.
- Profile persistence uses `assessment_client_profiles`.
- Spouse/dependent persistence uses `assessment_household_members`.
- Profile save is transactional and advances eligible sessions from `ACCOUNT_CREATED`/`PROFILE_IN_PROGRESS` to `PROFILE_COMPLETED`.
- Status-history evidence is written for profile completion.
- No database migration was required.
- `/portal/profile` is now a concrete frontend route rather than a placeholder.
- The frontend includes browser-local draft autosave, conditional spouse display, repeatable dependent rows, and derived age display.
- The profile page now uses the browser Cognito session created after account setup, with a basic email/password fallback for returning local QA.
- Backend tests increased to 33 passing.
- Frontend production build includes static `/portal/profile`.
- CDK synth confirms the portal Lambda bundle compiles with the new profile implementation.

## 25. Staging backend deployment record (2026-07-07)

- Pre-deployment backend checkup completed:
  - Prisma schema validation passed.
  - TypeScript typecheck passed.
  - ESLint passed with zero warnings.
  - Backend build passed.
  - Backend tests passed: 33/33.
  - CDK synth passed.
  - CDK diff completed.
- Local database verification commands could not reach the RDS endpoint from this machine. This did not block deployment because Phase 6 required no migration and the Lambdas are deployed inside the configured VPC/subnets/security group.
- Initial deployment rolled back because the staging agreement Lambda's reserved concurrency setting would reduce the AWS account's unreserved concurrency below AWS's minimum.
- CDK was patched so `reservedConcurrentExecutions: 1` applies only in production for the agreement Lambda.
- Failed-deploy cleanup performed:
  - deleted the failed `SaviansAssessment-staging` CloudFormation shell stack;
  - deleted the ten retained orphan Lambda functions named `savians-assessment-staging-*`;
  - verified the orphan Lambda list was empty before redeploying.
- Final staging deployment succeeded.
- Stack: `SaviansAssessment-staging`.
- API endpoint: `https://raw04zyetf.execute-api.us-east-1.amazonaws.com`.
- API ID: `raw04zyetf`.
- Cognito app client ID: `68kokvs5vdr18n6ouie7am7n1j`.
- QuickBooks webhook URL: `https://raw04zyetf.execute-api.us-east-1.amazonaws.com/api/assessment/webhooks/quickbooks`.
- Smoke tests:
  - `GET /api/assessment/health` returned HTTP `200` and `environment: staging`;
  - unauthenticated `GET /api/assessment/portal/profile` returned HTTP `401 Unauthorized`.
- Local frontend `.env.local` was created with the staging API endpoint and Cognito public client configuration.

## 26. Prisma Lambda packaging fix and start-flow smoke test (2026-07-07)

- Browser QA found that clicking `Continue to Agreement` on the local frontend produced a deployed API `500` from `POST /api/assessment/start`.
- CloudWatch showed the first root cause: Prisma Client could not locate the `linux-arm64-openssl-3.0.x` query engine in the Lambda runtime.
- `backend/prisma/schema.prisma` was updated so Prisma generates both the native local engine and the Lambda ARM/OpenSSL 3 engine:
  - `native`;
  - `linux-arm64-openssl-3.0.x`.
- CDK bundling was patched in `backend/infrastructure/lib/assessment-stack.ts` so each Lambda asset copies:
  - `node_modules/.prisma`;
  - `node_modules/@prisma`.
- Verification after the patch:
  - `npm run typecheck` passed;
  - `npm run build` passed;
  - `npm run cdk:synth` passed after cleaning stale generated `cdk.out`;
  - generated CDK assets were inspected and confirmed to contain `libquery_engine-linux-arm64-openssl-3.0.x.so.node`.
- Staging backend was redeployed successfully through CDK.
- Live smoke test after redeploy:
  - `POST https://raw04zyetf.execute-api.us-east-1.amazonaws.com/api/assessment/start`;
  - approved test email: `thearpit2005@gmail.com`;
  - result: HTTP `200 OK`;
  - response status: `AGREEMENT_PENDING`;
  - response indicated `resumed: true` and returned `/assessment/check-email`.
- This confirms the deployed public Lambda can now load Prisma, connect through the VPC path, read/update the assessment session, rotate the status token, and return a normal start/resume response.

## 27. Resume-email delivery fix (2026-07-07)

- Browser QA showed `/assessment/check-email` but no email was received.
- Root cause found locally: `backend/.env` still had `EMAIL_ENABLED=false`; if synced to staging, the public Lambda would skip Resend delivery while the UI still claimed the resume email had been sent.
- `EMAIL_ENABLED` was changed to `true`.
- `npm run secrets:sync:staging` updated and verified `savians/assessment/staging` without printing secret values.
- Backend behavior was tightened:
  - new assessments may still proceed to the visible agreement token even if email delivery is unavailable;
  - resumed assessments must receive a Resend `SENT` result before returning `/assessment/check-email`;
  - skipped/failed resumed emails now return `RESUME_EMAIL_DELIVERY_FAILED` with an actionable message.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 34/34;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded, updating the public Lambda;
  - live `POST /api/assessment/start` with the approved test email returned HTTP `200 OK` only after the stricter email path completed.

## 28. Paid payment UX direct profile setup (2026-07-07)

- The paid payment screen was changed so clients no longer see a `Send account setup link` button.
- New browser-first endpoint added:
  - `POST /api/assessment/account/invite/start`;
  - accepts the existing payment status token;
  - requires paid verification and `account_creation_allowed`;
  - revokes older unused invites;
  - creates a new seven-day invite token;
  - marks the session as `ACCOUNT_INVITED`;
  - returns `/assessment/account/setup/{inviteToken}` directly;
  - does not send an account setup email.
- Existing email-based reissue endpoint remains available for operational fallback, but it is no longer used by the paid status page.
- The paid status page now shows:
  - `Set up profile now`;
  - `I'll do this later`.
- The pending/unpaid state still shows payment refresh and invoice resend actions.
- Historical note: this phase originally routed account confirmation to `/portal/profile`; the 2026-07-09 dashboard revision now routes account confirmation to `/portal/dashboard`.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 35/35;
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed;
  - backend build and CDK synth passed;
  - CDK deploy succeeded and created the new API Gateway route;
  - live dummy-token smoke test reached the auth Lambda and returned `INVALID_TOKEN`, confirming route wiring.

## 29. Cognito account setup admin-flow fix (2026-07-08)

- Browser QA found that clicking `Create account` on `/assessment/account/setup/{inviteToken}` produced a deployed API `500`.
- CloudWatch root cause:
  - `account setup request failed`;
  - `SignUp is not permitted for this user pool`.
- Interpretation:
  - the shared Cognito user pool does not allow public self-signup;
  - the assessment account setup flow was still using Cognito's public `SignUp` / `ConfirmSignUp` APIs;
  - enabling public signup globally would be too broad for this portal because paid assessment entitlement should control account creation.
- Backend account setup was changed to a server-admin-created flow:
  - `AdminCreateUser` creates the Cognito user when missing;
  - `MessageAction: SUPPRESS` prevents Cognito's default invite email;
  - `AdminSetUserPassword` sets the client-selected password as permanent only for newly created Cognito users;
  - existing Cognito users are tolerated with `UsernameExistsException` handling and their existing password is not overwritten;
  - a six-digit setup verification code is generated by the backend;
  - older unused setup verification codes for the assessment session are invalidated;
  - the hashed setup verification code is stored in `assessment_recovery_tokens` with verification type `ACCOUNT_SETUP_EMAIL` and a 15-minute expiry;
  - Resend sends the setup verification code email.
- Confirmation flow was changed accordingly:
  - the submitted setup code is checked against the hashed `assessment_recovery_tokens` record;
  - the code is marked used before Cognito/DB entitlement is finalized;
  - `AdminUpdateUserAttributes` marks `email_verified=true`;
  - `AdminGetUser` verifies Cognito state and reads the Cognito `sub`;
  - `AdminAddUserToGroup` adds the user to `ASSESSMENT_CLIENT`;
  - the DB client/session link is written only after verification succeeds;
  - the invite is marked used and the session advances to `ACCOUNT_CREATED`;
  - the frontend proceeds to `/portal/profile`.
- IAM was updated for the auth Lambda:
  - removed public signup actions;
  - added `cognito-idp:AdminCreateUser`;
  - added `cognito-idp:AdminSetUserPassword`;
  - added `cognito-idp:AdminUpdateUserAttributes`;
  - retained `cognito-idp:AdminGetUser` and `cognito-idp:AdminAddUserToGroup`.
- Frontend setup copy was aligned so the code step refers to the Savians setup verification email rather than a native Cognito code.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 36/36;
  - frontend typecheck passed;
  - backend build passed;
  - CDK synth passed and showed the auth Lambda policy with the required admin Cognito actions;
  - CDK deploy completed successfully with the stack at `SaviansAssessment-staging`;
  - a follow-up auth Lambda deployment completed after tightening existing-user handling so repeat/client-existing accounts keep the same password;
  - live `GET https://raw04zyetf.execute-api.us-east-1.amazonaws.com/api/assessment/health` returned HTTP `200`.
- Local shell limitation:
  - outbound `curl.exe -X POST` calls from this shell returned a local `Bad access` connection failure, so the full live setup POST should be verified from the browser using a real invite token.
- Manual browser retry path:
  - refresh the current setup page;
  - if the invite was already used/expired, return to the paid payment-status page and click `Set up profile now` to generate a fresh setup invite;
  - enter a compliant password;
  - click `Create account`;
  - check the client email inbox/spam for the Savians setup verification code;
  - enter the code and confirm;
  - expected next route is `/portal/profile`.

## 30. Profile page auth/session cleanup and required-field tightening (2026-07-08)

- Browser QA found `/portal/profile` showing a `Temporary auth bridge` box that asked for a raw Cognito access token.
- Explanation:
  - this was a Phase 6 staging shortcut before the browser had an account-session handoff;
  - it was not intended for clients;
  - asking users to paste tokens is not acceptable for the real flow.
- Frontend account setup was updated:
  - after `POST /api/assessment/account/confirm` succeeds, the browser signs into Cognito using the email from the setup invite and the password the client just created;
  - the Cognito access token is stored in browser local storage under the portal token key;
  - `/portal/profile` loads the protected profile automatically from that stored session.
- Frontend profile page was updated:
  - removed the `Temporary auth bridge` card;
  - added a normal email/password sign-in fallback for browsers that do not already have the account setup session;
  - removed the `Household name` input;
  - added a read-only captured-client-details panel showing the paid assessment session's name, email, phone, DOB, assessment year, and profile status;
  - kept browser-local draft autosave;
  - made all visible profile intake choices mandatory;
  - hid optional spouse/dependent middle-name and notes fields so every visible spouse/dependent field is mandatory;
  - changed the save success message to clarify that document upload is the next portal step.
- Backend profile validation was tightened:
  - `preferredContact` is required;
  - `ownsRealEstate` is required;
  - `ownsBusiness` is required;
  - spouse/dependent `residentStatus` is required;
  - spouse/dependent `sex` is required;
  - spouse/dependent `fullTimeStudent` is required;
  - spouse/dependent `livesWithTaxpayer` is required.
- `Household name` remains as an unused nullable DB column for now. It is no longer shown or sent from the browser, avoiding an unnecessary migration during this phase.
- What happens after `Save profile`:
  - `POST /api/assessment/portal/profile` validates the full protected profile payload;
  - upserts `assessment_client_profiles`;
  - replaces spouse/dependent rows in `assessment_household_members`;
  - advances eligible sessions to `PROFILE_COMPLETED`;
  - writes status-history evidence;
  - returns the completed profile response to the browser;
  - the next intended portal step is document upload, whose dedicated frontend UX is still the next build item.
- Verification:
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed;
  - backend typecheck passed;
  - backend tests passed: 36/36;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded and updated the portal Lambda;
  - local dev server was restarted after a stale Next dev manifest error;
  - `GET http://localhost:3000/portal/profile` returned HTTP `200`.

## 31. Exact-stage resume routing fix (2026-07-08)

- Concern raised during browser QA:
  - a client who had already reached stage 4 could appear to be back at stage 1 after code/session changes;
  - exact-stage resume is critical and must be guaranteed by backend state, not just browser memory.
- Existing protection already in place:
  - one assessment session per normalized email and assessment year;
  - repeated start submissions resume the existing annual assessment instead of creating a duplicate;
  - raw resume/status tokens are rotated and only token hashes are stored;
  - for privacy, the browser still receives `/assessment/check-email` and the actual resume link is emailed to the assessment email.
- Gap found:
  - later statuses were mapped to placeholder routes such as `/assessment/recover?stage=account` or `/portal/dashboard`;
  - these routes did not reliably put the client back onto the active implemented step.
- Resume routing was corrected:
  - `AGREEMENT_PENDING`, `AGREEMENT_SIGNED`, `QB_CUSTOMER_CREATED` -> `/assessment/agreement/{token}`;
  - `INVOICE_CREATED`, `INVOICE_SENT`, `PAYMENT_PENDING`, `PAYMENT_VERIFYING` -> `/assessment/status/{token}`;
  - `PAID_VERIFIED`, `ACCOUNT_INVITED` -> `/assessment/status/{token}` so the client can continue with `Set up profile now`;
  - `ACCOUNT_CREATED`, `PROFILE_IN_PROGRESS` -> `/portal/profile`;
  - `PROFILE_COMPLETED`, `DOCUMENTS_IN_PROGRESS`, `DOCUMENTS_SUBMITTED` -> `/portal/profile` until the dedicated documents page is completed.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 38/38;
  - new tests assert that `PAID_VERIFIED` resume emails contain `/assessment/status/{token}`;
  - new tests assert that `ACCOUNT_CREATED` resume emails contain `/portal/profile`;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded and updated the public Lambda;
  - live `GET /api/assessment/health` returned HTTP `200`.

## 32. Agreement invoice 502 diagnosis and QuickBooks secret-cache hardening (2026-07-08)

- Browser QA found `POST /api/assessment/agreement/sign` returning HTTP `502 Bad Gateway` after the client clicked `Sign Agreement & Create Invoice`.
- The frontend message was correct: the agreement signature was saved, but invoice completion failed.
- Code path confirmed:
  - `AgreementService.accept()` saves signature/evidence first;
  - it then calls the QuickBooks billing pipeline;
  - billing failures are surfaced as `BILLING_RETRY_REQUIRED` with HTTP `502` so the user can retry after the integration issue is fixed.
- Local QuickBooks credential check found the actual root cause:
  - Intuit OAuth refresh returned `invalid_grant`;
  - Intuit described the refresh token as incorrect or invalid;
  - therefore the backend could not refresh QuickBooks OAuth, create/update customer records, create invoices, or email the invoice.
- Backend code was hardened so AWS Lambda no longer keeps a stale AWS Secrets Manager value in process memory for the lifetime of a warm container:
  - local `.env` mode can still use cached secrets for developer convenience;
  - AWS Secrets Manager mode now fetches the current secret value on each invocation;
  - refresh-token persistence still writes rotated QuickBooks tokens back into Secrets Manager.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 38/38;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy initially hit a Windows `EPERM` rename lock in `cdk.out` temporary bundling output;
  - only `cdk.out/bundling-temp-*` folders inside the backend workspace were cleaned;
  - retry CDK deploy succeeded and updated the staging Lambdas.
- Remaining action:
  - generate a fresh QuickBooks sandbox refresh token from the same Intuit app and sandbox company;
  - update backend `.env`;
  - run `npm run quickbooks:configure-item` so the token is validated and rotated locally;
  - run `npm run secrets:sync:staging` so AWS Secrets Manager receives the fresh token;
  - retry the same agreement/sign page. The retry path is designed to reuse existing saved agreement/customer/invoice state where present and continue the incomplete billing step instead of starting over.

## 33. Agreement billing retry resume-route correction and diagnostic logging (2026-07-08)

- Follow-up browser QA still showed `POST /api/assessment/agreement/sign` returning HTTP `502`.
- Local QuickBooks validation was re-run and returned the explicit Intuit response:
  - `invalid_grant`;
  - `Incorrect or invalid refresh token`.
- This confirms the active blocker is still the stale/invalid QuickBooks sandbox refresh token, not the frontend form or agreement-signature persistence.
- Diagnostic improvements were deployed:
  - QuickBooks OAuth/API failures now include sanitized Intuit error details in backend error messages;
  - agreement billing failures now log `billingStep`, status, whether QuickBooks customer/invoice IDs exist, and the sanitized error message;
  - this makes CloudWatch useful for the next retry instead of showing only START/END/REPORT lines.
- Database verification from the local workstation succeeded after DB access was restored:
  - the current `Test User` session is at `AGREEMENT_SIGNED`;
  - the signature is saved;
  - no QuickBooks customer or invoice exists yet;
  - this matches the failed billing state exactly.
- Resume-route edge case found and fixed:
  - after a saved signature but failed billing, `AGREEMENT_SIGNED` should return to `/assessment/agreement/{token}` so the invoice step can be retried;
  - `QB_CUSTOMER_CREATED` also returns to `/assessment/agreement/{token}` so invoice creation can resume if customer creation succeeded but invoice creation failed;
  - `INVOICE_CREATED`, `INVOICE_SENT`, `PAYMENT_PENDING`, and `PAYMENT_VERIFYING` continue to resume to `/assessment/status/{token}`.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 39/39;
  - new test asserts that saved-signature billing retries resume to `/assessment/agreement/{token}`;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded first for agreement diagnostic logging and then for public resume routing;
  - live `GET /api/assessment/health` returned HTTP `200`.

## 34. Portal profile Cognito token claim fix (2026-07-08)

- Browser QA found `/portal/profile` returning HTTP `401` with message `Your login session is missing required account claims.`
- Root cause:
  - the frontend was sending the Cognito access token to the protected portal API;
  - the backend entitlement check requires identity claims including `email` and `email_verified`;
  - Cognito access tokens do not reliably include those identity claims, while Cognito ID tokens do.
- Frontend auth helper was updated:
  - after account setup automatic sign-in, the browser stores the Cognito ID token for portal API calls;
  - after manual profile-page sign-in, the browser stores the Cognito ID token for portal API calls;
  - existing stale locally stored access tokens without an `email` claim are cleared automatically.
- Profile page UX was tightened:
  - the household profile form is hidden until the protected profile successfully loads;
  - unauthenticated users now see a sign-in-required card instead of an editable draft form that cannot be saved.
- Important behavior:
  - signing in as an admin/shared Cognito account does not unlock client profile access;
  - the user must sign in with the paid assessment client email/password created through the account setup link;
  - backend entitlement still requires Cognito `email_verified=true` and a linked paid assessment session.
- Verification:
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed;
  - local frontend dev server was restarted;
  - `GET http://localhost:3000/portal/profile` returned HTTP `200`.

## 35. Portal entitlement group-claim timing fix (2026-07-08)

- Browser QA found that immediately after password creation and setup-code verification, `/portal/profile` showed:
  - `This account is not authorized for the assessment portal.`
- Root cause:
  - account setup correctly verifies the email, links the Cognito user to the paid assessment client/session in the database, and adds the Cognito user to the `ASSESSMENT_CLIENT` group;
  - however, the freshly issued Cognito token may not include the new group claim immediately;
  - the portal entitlement check was rejecting the user before checking the database entitlement.
- Backend portal entitlement was corrected:
  - Cognito still must provide `sub`, `email`, and `email_verified=true`;
  - the database paid assessment entitlement is now the authority for portal access;
  - `ASSESSMENT_CLIENT` group membership is still maintained during account setup, but a missing fresh-token group claim no longer blocks a valid paid client.
- Security posture remains intact:
  - an admin/shared Cognito account cannot unlock a client profile unless its Cognito `sub` is linked to a paid assessment client record;
  - the linked session must have `accountCreationAllowed=true`;
  - the linked session must be at `ACCOUNT_CREATED` or a later eligible intake status.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 39/39;
  - test coverage now asserts that a paid linked DB entitlement works even when the fresh Cognito group claim is missing;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded and updated the portal Lambda;
  - live `GET /api/assessment/health` returned HTTP `200`.

## 36. Profile-to-documents handoff and secure document upload page (2026-07-08)

- UX issue raised during browser QA:
  - after saving the profile, the portal showed `Profile saved and marked complete. Document upload is the next portal step.`;
  - that message was a dead-end because the user should be moved directly to document intake.
- Frontend profile flow was updated:
  - successful `Save profile` now redirects automatically to `/portal/documents`;
  - the intermediate success message now only appears briefly while redirecting.
- A real `/portal/documents` page was added:
  - loads with the existing stored Cognito ID token from account setup/profile;
  - no second login is required in the normal account-setup -> profile -> documents path;
  - supports category selection;
  - supports file selection and upload;
  - displays uploaded document records;
  - supports refresh.
- Document categories available in the UI:
  - prior tax returns;
  - W-2 income;
  - other income;
  - investment portfolio;
  - retirement accounts;
  - mortgage statements;
  - business / LLC documents;
  - estate plan;
  - life insurance;
  - other assessment details.
- Backend document service was implemented:
  - `GET /api/assessment/documents` lists uploaded documents for the authenticated paid client session;
  - `POST /api/assessment/documents/upload-url` creates a document metadata record and returns a 10-minute S3 presigned PUT URL;
  - `POST /api/assessment/documents/complete` marks the uploaded document as `UPLOADED`;
  - first completed upload moves an eligible session from `PROFILE_COMPLETED` to `DOCUMENTS_IN_PROGRESS`.
- Profile completion now sets `documentUploadAllowed=true` on the assessment session.
- Security and retention behavior:
  - document routes use the same paid portal entitlement as profile;
  - uploads are scoped under `assessments/{environment}/client-documents/{assessmentYear}/{sessionId}/{category}/...`;
  - each document metadata row stores category, original file name, MIME type, size, S3 bucket/key, and seven-year retention date;
  - direct object metadata was intentionally not signed into the presigned PUT because Postgres stores the authoritative metadata and this avoids browser header mismatch.
- AWS/CDK changes:
  - documents Lambda now uses `src/services/documents/handler.ts`;
  - added authenticated routes for document list and completion;
  - existing upload-url route now points to the real documents handler.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 39/39;
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - backend production build passed;
  - frontend production build passed with `/portal/documents`;
  - CDK synth passed;
  - CDK deploy succeeded and created/updated the document routes;
  - local frontend dev server restarted;
  - `GET http://localhost:3000/portal/documents` returned HTTP `200`;
  - live `GET /api/assessment/health` returned HTTP `200`.
- Follow-up watch item:
  - browser direct-to-S3 upload requires S3 bucket CORS to allow localhost/staging origins for `PUT`;
  - if the upload page receives a browser CORS error during the first real upload, add/update the CORS rule on `savians-bucket`.

## 37. S3 direct-upload CORS fix (2026-07-08)

- Browser QA found document upload failing from `http://localhost:3000` with an S3 preflight error:
  - the backend created a valid presigned `PUT` URL;
  - the browser then sent an `OPTIONS` preflight request directly to `savians-bucket`;
  - S3 rejected the browser preflight because the bucket CORS configuration did not allow the frontend origin.
- The assessment CDK stack now manages the CORS rule for the existing `savians-bucket` through an `AwsCustomResource`.
- Allowed upload origins:
  - `props.frontendUrl`;
  - `http://localhost:3000`;
  - `http://127.0.0.1:3000`;
  - `https://*.savians.com`.
- Allowed S3 browser methods:
  - `PUT` for direct presigned uploads;
  - `GET`/`HEAD` for future document retrieval or verification flows.
- Allowed request headers are `*` so browser-sent `content-type` and AWS signed upload headers do not break the preflight check.
- Exposed response headers include `ETag`, AWS request IDs, and checksum header details for browser-side diagnostics.
- Important operational note:
  - this rule is applied at the bucket level, not only one object prefix;
  - the stack intentionally includes all Savians HTTPS subdomains so future Amplify/staging/prod frontend origins continue to work without another CORS change.

## 38. Drive-style document category folders (2026-07-08)

- The `/portal/documents` page was redesigned from a single category dropdown plus classic file input into a modern folder-based document drive.
- Each assessment document category now appears as its own folder card:
  - prior tax returns;
  - W-2 income;
  - other income;
  - investment portfolio;
  - retirement accounts;
  - mortgage statements;
  - business / LLC documents;
  - estate plan;
  - life insurance;
  - other assessment details.
- Each folder supports:
  - drag-and-drop upload directly onto the folder card;
  - separate “Upload to folder” file picker;
  - multiple-file selection;
  - per-folder uploaded-file count;
  - active folder details panel with another drop zone and file list.
- The backend contract did not change:
  - uploads still call `POST /api/assessment/documents/upload-url`;
  - browser uploads still use presigned S3 `PUT`;
  - completion still calls `POST /api/assessment/documents/complete`;
  - files still land under their existing backend category-specific S3 prefixes.
- Frontend client-side validation now blocks files larger than 25 MB before requesting a presigned URL.
- Verification:
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed and includes `/portal/documents`.

## 39. Horizontal folder rows, folder modal, preview, and client remove (2026-07-09)

- The `/portal/documents` page was refined from folder cards into full-width horizontal folder rows.
- Each folder row now uses the full width of the document-drive card and includes:
  - folder heading;
  - first-letter-capitalized title ending in `Documents`;
  - file count;
  - helper text;
  - recently added files;
  - drag-and-drop target;
  - upload button;
  - `Open Folder` or `View More` button.
- Folder headings now include:
  - Prior Tax Returns Documents;
  - W-2 Income Documents;
  - Other Income Documents;
  - Investment Portfolio Documents;
  - Retirement Accounts Documents;
  - Mortgage Statements Documents;
  - Business / LLC Documents;
  - Estate Plan Documents;
  - Life Insurance Documents;
  - Other Assessment Details Documents.
- Clicking a folder row opens a Google-Drive-style folder modal.
- Clicking `View More` opens the same folder modal.
- The folder modal supports:
  - viewing all uploaded files in that category;
  - adding more files;
  - drag-and-drop uploads into that category;
  - clicking a file to preview it;
  - removing a file from the visible client folder.
- Backend document APIs were extended:
  - `GET /api/assessment/documents/{documentId}/preview-url` returns a short-lived signed S3 read URL for an uploaded document;
  - `DELETE /api/assessment/documents/{documentId}` marks the document as deleted for the client view.
- Retention behavior:
  - client remove is intentionally soft-delete only;
  - the S3 object is retained to preserve the seven-year retention/audit policy;
  - an audit-log row records the client remove action.
- Preview behavior:
  - PDF and image files render inline in the portal preview modal;
  - Word, Excel, and other browser-non-previewable files show a preview fallback with an `Open In New Tab` action;
  - after a successful upload, the first uploaded document opens in preview automatically.
- AWS deployment:
  - documents Lambda was redeployed;
  - API Gateway routes for preview and delete were created in staging.
- Verification:
  - backend typecheck passed;
  - backend tests passed: 39/39;
  - backend build passed;
  - CDK synth passed;
  - CDK deploy succeeded;
  - staging health check returned HTTP `200`;
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed after clearing a stale generated `.next` cache;
  - local frontend server was restarted on port `3000`;
  - `GET http://localhost:3000/portal/documents` returned HTTP `200`.

## 40. Document reload unauthorized fix and larger folder rows (2026-07-09)

- Browser QA found `/portal/documents` showing `Unauthorized` after reload, even though uploads had worked earlier in the same tab.
- Root cause:
  - the frontend had manually stored a Cognito ID token for protected portal APIs;
  - the ID token expires after roughly one hour;
  - after reload, the documents page reused the expired stored token instead of asking Cognito to refresh the session from the SDK-managed refresh token.
- Frontend auth behavior was fixed:
  - added `getCurrentPortalAccessToken()` in `portal-auth.ts`;
  - it returns a still-valid stored ID token when possible;
  - if the stored token is expired, it uses Cognito's current user session to refresh and store a fresh ID token;
  - if no refreshable Cognito session exists, the user receives the normal sign-in-again message.
- The documents page now resolves a fresh token before:
  - loading document lists;
  - creating upload URLs;
  - completing uploads;
  - creating preview URLs;
  - removing documents.
- Folder row sizing was increased:
  - each horizontal folder row now has a larger minimum height;
  - padding, folder icon size, recent-file area, and drag target height were increased for a roomier drive-like layout.
- Verification:
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed;
  - stale generated `.next` cache was cleared after build;
  - local frontend dev server was restarted on port `3000`;
  - `GET http://localhost:3000/portal/documents` returned HTTP `200`.

## 41. Two-pane document workspace revamp (2026-07-09)

- The `/portal/documents` page was redesigned again to match the desired drive/workspace flow instead of the previous large left-side summary plus horizontal folder rows.
- The former left `Upload Documents` card was collapsed into a compact horizontal top header below the stepper:
  - page title;
  - short guidance text;
  - uploaded-file count;
  - total uploaded size;
  - 25 MB per-file limit.
- The main workspace now uses a two-pane layout:
  - left pane: a scrollable card of all document categories, with each row clickable;
  - right pane: the selected folder's detailed workspace.
- Each left-pane category row shows:
  - folder icon;
  - title-case category name ending in `Documents`;
  - uploaded-file count;
  - short helper text;
  - active selection styling.
- The right-pane folder detail includes:
  - selected-folder title and helper text;
  - `Add Files` file picker;
  - large drag-and-drop target;
  - scrollable uploaded-file list for that specific category;
  - per-file preview action;
  - per-file remove action.
- Browser preview behavior was preserved:
  - PDFs and images render inline;
  - non-browser-previewable files show the existing fallback and `Open In New Tab`;
  - the first file uploaded in a batch opens in preview automatically.
- Backend behavior did not change in this revamp:
  - upload URLs, direct S3 PUTs, completion, preview URLs, and soft delete still use the existing deployed document APIs;
  - no database migration or CDK deploy was required.
- Verification:
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - frontend production build passed;
  - local frontend dev server was restarted on port `3000`;
  - `GET http://localhost:3000/portal/documents` returned HTTP `200`;
  - browser readback confirmed the rendered page includes `Upload Documents`, all category rows, `Selected Folder`, `Drag & Drop Files`, and `Uploaded Files`.

## 42. Document workspace width and action-icon refinement (2026-07-09)

- The `/portal/documents` workspace was widened from the shared `page-shell` max width to a document-specific `1500px` max-width container.
- The category rail was adjusted to give the selected-folder workspace more horizontal room.
- The selected-folder detail now keeps the drag-and-drop upload zone and uploaded-files panel horizontally aligned on desktop-sized screens.
- The drop zone and uploaded-files panel were resized so the list has more usable space and does not compress file metadata as aggressively.
- Per-file actions were simplified:
  - preview is now an icon-only eye button;
  - remove is now an icon-only trash/bin button;
  - accessible labels and hover titles remain for clarity.
- Verification:
  - frontend production build passed;
  - frontend typecheck passed;
  - frontend tests passed: 5/5;
  - local frontend dev server was restarted on port `3000`;
  - `HEAD http://localhost:3000/portal/documents` returned HTTP `200`.
