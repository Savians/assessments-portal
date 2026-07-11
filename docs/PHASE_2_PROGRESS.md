# Phase 2 Progress: Public Start and Resume Engine

Completed: 2026-07-05

Status: **Complete locally; not deployed**

## Delivered

### Public experience

- Completed the public landing page with product value, price, process, FAQs, and calls to action.
- Added `/assessment/start` with the required identity, DOB, contact, state, client-type, income, tax, conditional business, and consent fields.
- Added accessible client-side validation, loading/error states, and responsive layout.
- Added privacy-safe `/assessment/check-email` and the planned `/assessment/recover` entry shell.

### Annual-session rules

- The backend determines the assessment year using server UTC time.
- Email addresses are normalized to lowercase and US phone numbers to E.164.
- A normalized email, service, and assessment year identifies one assessment session.
- Repeated starts in the same year resume the existing session rather than creating a duplicate.
- The same client can start a separate assessment in each new year with the same credentials.
- Existing-session starts return a neutral check-email page; the secure resume URL is sent only to the recorded email address.

### Security and auditability

- Status tokens use 32 random bytes and are URL-safe.
- Only SHA-256 token hashes are stored; raw tokens are never persisted.
- Resume rotates the token and sets a 30-day expiry.
- Session creation and resume write status-history and audit records transactionally.
- Resume-email outcomes are recorded as `SENT`, `FAILED`, or `SKIPPED`.
- QuickBooks is deliberately absent from the Phase 2 service boundary. No customer or invoice can be created before Phase 3 agreement acceptance.

### Email

- Added the Resend Resume Agreement email with the exact next-stage URL.
- Local email remains disabled by default with `EMAIL_ENABLED=false`.
- Staging must enable email only after its Secrets Manager configuration and approved test recipient are ready.

### Database

- Extended the reviewed Prisma model for consent evidence, hashed status tokens, expiry, and resume-email tracking.
- Generated the initial 17-table `assessment_*` PostgreSQL migration.
- Reviewed it for namespace isolation, indexes, constraints, foreign keys, and destructive statements.
- The migration has **not** been applied to any database.

## Verification evidence

Frontend:

- ESLint: passed
- TypeScript: passed
- Vitest: 5 tests passed
- Next.js production build: passed

Backend:

- ESLint: passed
- TypeScript: passed
- Vitest: 7 tests passed
- Prisma validation: passed
- TypeScript production build: passed
- CDK staging synthesis: passed

Synthesized infrastructure review:

- 10 `savians-assessment-staging-*` Lambda functions
- 15 API Gateway routes
- 0 RDS resources created
- Shared VPC/RDS/S3/Cognito boundaries retained
- Existing subnet route-table annotations remain non-blocking warnings

## Exit-gate result

The Phase 2 exit gate is satisfied locally: a client can start an annual assessment, safely resume the same year's session, and start a new session in a future year without a duplicate session or any QuickBooks activity.

## Deliberately deferred

- Applying the database migration
- AWS staging deployment
- Enabling live Resend delivery
- Legal agreement signing and evidence capture (Phase 3)
- QuickBooks customer/invoice creation (Phase 3)
- Full recovery workflow and communications automation (Phase 9)