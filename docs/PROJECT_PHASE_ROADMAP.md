# Savians Assessments: Complete Delivery Roadmap

Last updated: 2026-07-06

This is the governing implementation sequence. Each phase ends with tests, documentation, and an explicit exit gate. A later phase must not bypass an earlier security or accounting gate.

## Phase 0 - Product and architecture baseline

Status: **Complete**

Delivered:

- Product/domain decision: `assessments.savians.com`.
- PostgreSQL and shared-AWS-resource strategy.
- `assessment_*` table and assessment Lambda naming rules.
- Seven-year retention policy and annual repeat-assessment model.
- Canonical legal agreement inventory/hash.
- QuickBooks sandbox and production-cutover instructions.
- Resend, Amplify, CDK, and Cognito decisions.

Exit gate: architecture decisions and external dependencies documented.

## Phase 1 - Engineering foundation

Status: **Complete**

Delivered:

- Next.js/React frontend foundation, design tokens, shared UI, and route shell.
- TypeScript Lambda backend foundation and ten service boundaries.
- Prisma schema for 17 assessment tables.
- Dedicated assessment HTTP API and Cognito app client/group definitions.
- Shared RDS/VPC/S3/KMS/Cognito integration boundaries.
- GitHub Actions, Amplify build file, linting, tests, strict type checks, and documentation.
- CDK synth review confirming 10 isolated Lambdas, 15 routes, no RDS resources, and no QuickBooks secret values.

Exit gate: builds, tests, lint, schema validation, Prisma generation, CDK synth, and dependency audit pass. Nothing deployed or migrated.

## Phase 2 - Public assessment start and resume engine

Status: **Complete locally; not deployed**

Frontend:

- Final landing-page sections and content.
- Dedicated `/assessment/start` form.
- Required DOB, email, phone, state, client type, consent, and conditional business fields.
- Client-side Zod validation, accessible errors, loading, success, and resume states.
- Dedicated recovery entry page shell.

Backend:

- Implement `POST /api/assessment/start`.
- Normalize email and phone.
- Determine assessment year server-side.
- Create or resume one assessment per normalized email, service, and year.
- Generate high-entropy status tokens; store hashes only.
- Return the exact next URL for the session state.
- Write status history and audit events.
- Send the Resume Agreement email through Resend.
- Explicitly prohibit every QuickBooks call in this phase.

Database:

- Generate the initial migration SQL for the reviewed `assessment_*` schema.
- Review SQL for table prefixing, indexes, uniqueness, foreign keys, and absence of referral-table changes.
- Apply only to an approved staging/shared database after explicit review.

Tests:

- DOB/consent validation.
- Email normalization.
- Same-year duplicate prevention.
- New-year session creation for an existing client.
- Resume routing for every pre-payment state.
- Proof that no QuickBooks function is invoked.

Exit gate: a client can start, leave, and safely resume the same annual assessment without duplicate sessions or invoices.

## Phase 3 - Legal agreement and QuickBooks invoice creation

Status: **Complete**

Frontend:

- Secure PDF viewer at `/assessment/agreement/[token]`.
- Read-only agreement date.
- Acknowledgement checkbox and typed legal signature.
- Clear error/retry behavior.

Backend:

- Versioned legal-template storage and active-template lookup.
- Signature evidence: template/version/hashes, typed name, timestamp, IP, user agent, session.
- Tamper-evident evidence capture.
- QuickBooks server-only OAuth client and atomic refresh-token rotation.
- Customer lookup/create after signature only.
- One USD 2,997 invoice using the configured production/sandbox service item.
- Idempotency protection around signature-to-invoice processing.
- Send the QuickBooks invoice and Savians status email.
- Controlled sandbox validation passed with approved recipient, invoice `1038`, final status `PAYMENT_PENDING`, `$2,997.00` balance, verified agreement evidence, and Savians status email sent.

Exit gate: agreement evidence is immutable and retry/double-click scenarios cannot create duplicate customers or invoices.

## Phase 4 - Payment status, webhook, and reconciliation

Status: **Core implementation complete locally; external staging/webhook QA pending**

Frontend:

- `/assessment/status/[token]` with invoice number, balance, status, and last check.
- Twenty-second pending-state polling.
- Manual refresh and rate-limited resend.
- Paid-state account-creation CTA placeholder for Phase 5.

Backend:

- Local status endpoint with token validation.
- QuickBooks invoice re-fetch and exact ID/amount/currency/zero-balance checks.
- Public webhook endpoint using the raw request body.
- HMAC signature validation and idempotent webhook-event storage.
- Invoice/Payment event handling.
- Disabled-by-default EventBridge reconciliation promoted after staging QA.
- Exactly-once payment-verified behavior; account invite creation remains Phase 5.
- QuickBooks SMS/text is intentionally out of scope because QuickBooks does not expose a native invoice-SMS API.

Exit gate: webhook, manual refresh, and scheduled reconciliation converge on the same verified payment state; partial/mismatched payments never unlock access.

## Phase 5 - Paid-only account setup and authentication

Status: **Core implementation complete locally; external Cognito/staging QA pending**

- Invite validation and single-use seven-day setup links.
- Email-bound Cognito signup using the assessment app client.
- Cognito/portal defense-in-depth through DB entitlement checks in addition to Cognito JWT/group checks.
- Email verification requirement.
- Existing client annual-session linking through `assessment_clients`.
- Expired/replaced invite reissue for paid sessions.
- Transactional Cognito-user/client/session linkage after email confirmation.
- Server-side paid-entitlement middleware for protected endpoints.

Exit gate: unpaid users cannot create or access an account through the UI, API, or direct Cognito signup.

## Phase 6 - Personal and household profile

Status: **Core implementation complete locally; external Cognito/staging QA pending**

- Protected `GET /api/assessment/portal/profile` load endpoint.
- Protected `POST /api/assessment/portal/profile` save endpoint.
- Paid-entitlement enforcement reused from Phase 5: Cognito verified email, `ASSESSMENT_CLIENT` group, and linked paid DB session are required.
- Primary taxpayer details are loaded from the paid assessment session, including mandatory DOB captured at intake.
- Address, homeowner, marital, resident-status, preferred-contact, real-estate, and business ownership fields.
- Conditional spouse section with mandatory spouse DOB when marital status is `MARRIED`.
- Repeatable dependents with mandatory DOB and frontend derived age display.
- Frontend `/portal/profile` route with local draft autosave/resume.
- Server-side cross-field validation prevents married-without-spouse, spouse-on-non-married, missing person DOB, invalid state, and invalid ZIP.
- Complete profile save writes `assessment_client_profiles`, replaces spouse/dependent household rows in `assessment_household_members`, and advances eligible sessions to `PROFILE_COMPLETED`.
- No database migration was required because Phase 1 already created the profile/household tables.

Exit gate: conditional sections behave correctly, autosaved data survives return visits, and required-person DOB rules cannot be bypassed.

## Phase 7 - Real estate and business/investment intake

- Real-estate yes/no gate and Not Applicable state.
- Repeatable property records and conditional mortgage/rental/STR fields.
- Multiple property owners with total ownership validation.
- Business/investment yes/no gate.
- Repeatable entity records, tax classifications, ownership ranges, and prior-year values.
- Dashboard summaries and edit/resume behavior.

Exit gate: each conditional module supports zero, one, or many valid records without corrupting profile completion.

## Phase 8 - Secure document collection

- Paid/authenticated document portal.
- Categorized drag-and-drop uploads.
- Backend entitlement checks before every presigned URL.
- Strict file size/type/count policy.
- S3 `assessments/{environment}/{client}/{year}/{session}/...` keys.
- Encryption, metadata hashes, replace/delete, and category status.
- Quarantine/malware-scanning integration point.
- Seven-year retention date and legal-hold support.
- Download authorization preventing cross-client access.

Exit gate: unauthorized/unpaid users cannot request URLs or access another client’s documents; approved uploads are encrypted and traceable.

## Phase 9 - Recovery, communications, and operational automation

- Privacy-preserving email recovery and exact-stage routing.
- Resume Agreement, Payment Required, Reminder, Payment Verified, Link Reissued, Document Reminder, and Internal Error templates.
- Delivery logs, retry rules, and approved test-recipient controls.
- Reminder schedules and suppression after completion.
- Support-safe diagnostics without exposing tokens or PII.
- Retention/deletion job design and legal-hold exclusions.

Exit gate: every supported interrupted state can be recovered without leaking account existence or duplicating accounting records.

## Phase 10 - Security, QA, and compliance hardening

- Full unit, integration, contract, and end-to-end test suites.
- QuickBooks sandbox happy/negative/replay tests.
- Authorization and entitlement bypass tests.
- Rate limiting for public/recovery/refresh/resend endpoints.
- Security headers, logging redaction, IAM review, secret rotation, and dependency audit.
- Accessibility, responsive/mobile, and browser testing.
- Backup/restore and seven-year deletion verification.
- Load/concurrency tests for invoice idempotency.
- Incident, rollback, support, and data-retention runbooks.

Exit gate: acceptance criteria and security review pass with evidence.

## Phase 11 - Staging, production, and launch

- Deploy staging backend with CDK and staging frontend with Amplify.
- Configure sandbox webhook and run complete staging acceptance.
- Complete Intuit production approval/credentials.
- Configure real KMS key, production Secrets Manager entry, QuickBooks item, realm, OAuth, and webhook.
- Review production CDK diff and Prisma migration plan.
- Configure `assessments.savians.com`, TLS, and redirects from old plan URLs.
- Controlled internal production transaction.
- Monitor first live transactions, webhooks, emails, account setup, and uploads.
- Enable reconciliation/reminders only after smoke-test approval.

Exit gate: an approved production client completes the entire journey without admin intervention, duplicate invoices, or authorization bypass.

## Delivery discipline for every phase

Each phase must:

1. Update `TOMORROW_HANDOFF.md` and the phase progress document.
2. Add or update automated tests.
3. Pass lint, type-check, tests, and production build/synth as applicable.
4. Record migrations and infrastructure diffs before applying them.
5. Keep secrets out of Git, logs, docs, frontend bundles, and synthesized templates.
6. Avoid production deployment unless the phase explicitly includes it and the user approves.
