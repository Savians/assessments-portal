# Current Handoff

Checkpoint date: 2026-07-09

## Start here

1. `PROJECT_IMPLEMENTATION_DOSSIER.md`
2. `PHASE_3_PROGRESS.md`
3. `PHASE_4_PROGRESS.md`
4. `PHASE_5_PROGRESS.md`
5. `PHASE_6_PROGRESS.md`
6. `ASSESSMENT_MIGRATIONS.md`
7. `LEGAL_AGREEMENT_INTEGRATION.md`
8. `PROJECT_PHASE_ROADMAP.md`

## Current status

Latest checkpoint: the onboarding flow has been revised so paid clients continue into `/portal/dashboard` instead of the old one-off `/portal/profile` + `/portal/documents` step. The dashboard is now the main protected client workspace.

Phase 3 is complete. The independent assessment migration ledger reports 3 applied and 0 pending. Database verification found exactly 18 assessment-owned tables, 10 assessment PostgreSQL enum types, and the active `2026-v1.4` legal template with the expected DOCX/PDF hashes.

The approved legal DOCX and five-page PDF are published under `assessments/legal/templates/2026-v1.4/`; both objects were verified for size, type, hash metadata, and AES-256 server-side encryption. Runtime agreement IAM is read-only for the template prefix.

QuickBooks OAuth is working against `Sandbox Company US 7b3d`. The API verified the active `Tax Assessment Plan` Service item at exactly `$2,997` using the `Services` income account. The latest rotated refresh token, Realm ID, and item ID are stored privately.

AWS Secrets Manager secret `savians/assessment/staging` has been created and verified with all required database, Resend, and QuickBooks runtime fields. No credential values were logged or committed.

The referral portal's `_prisma_migrations` history was not reconciled, modified, copied, or resolved.

## Phase 3 exit evidence

- Approved recipient: `thearpit2005@gmail.com`.
- Controlled sandbox result: `CONTROLLED TEST PASSED`.
- Final session status: `PAYMENT_PENDING`.
- QuickBooks invoice number: `1038`.
- Invoice balance: `$2,997.00`.
- Agreement evidence hash verified: yes.
- Savians status email sent: yes.
- Retry safety verified: the test reused the existing controlled-test session/invoice after an earlier recoverable send failure and did not create a duplicate invoice.

Phase 4 core implementation is deployed to staging: payment status, QuickBooks webhook verification, manual refresh/resend, and scheduled reconciliation all share the same strict payment verifier. External end-to-end webhook/payment QA is still pending.

Phase 5 core implementation is deployed to staging: paid-only account setup, seven-day invite links, Cognito email-code confirmation, DB client/session linkage, Cognito group assignment, and portal entitlement checks are implemented. External Cognito/browser QA is still pending.

Phase 6 core implementation is deployed to staging: protected profile load/save, strict household validation, spouse/dependent DOB gates, local draft autosave, and `/portal/profile` frontend are implemented. External authenticated profile-save QA is still pending.

## Staging backend deployment evidence

- Deployment date: 2026-07-07.
- Stack: `SaviansAssessment-staging`.
- API endpoint: `https://raw04zyetf.execute-api.us-east-1.amazonaws.com`.
- API ID: `raw04zyetf`.
- Cognito app client ID: `68kokvs5vdr18n6ouie7am7n1j`.
- QuickBooks webhook URL: `https://raw04zyetf.execute-api.us-east-1.amazonaws.com/api/assessment/webhooks/quickbooks`.
- Public health smoke test: `GET /api/assessment/health` returned `200` with `environment: staging`.
- Protected portal smoke test: unauthenticated `GET /api/assessment/portal/profile` returned `401 Unauthorized`.
- Public start smoke test after Prisma packaging fix: `POST /api/assessment/start` returned `200 OK`, `AGREEMENT_PENDING`, `resumed: true`, and `/assessment/check-email` for the approved test email.
- Exact-stage resume routing fix: repeated start/resume submissions still respond with `/assessment/check-email` for privacy, but the emailed secure link now maps the saved session status to the correct live step. Agreement-pending resumes go to agreement, payment/invoice/paid-before-account resumes go to the status page, and account/profile resumes go to `/portal/profile`.
- Local frontend env file created at `frontend/.env.local` pointing to the deployed staging API and Cognito app client.
- Deployment note: the first deploy attempt rolled back because staging Lambda reserved concurrency on the agreement function exceeded the account's unreserved concurrency buffer. CDK was patched so reserved concurrency remains production-only, then retained orphan Lambdas from the failed attempt were deleted and the staging stack deployed cleanly.
- Runtime fix note: the first browser attempt against `/api/assessment/start` returned `500` because the Lambda package did not contain Prisma's `linux-arm64-openssl-3.0.x` query engine. `prisma/schema.prisma` now includes that binary target, and CDK bundling now copies `node_modules/.prisma` plus `node_modules/@prisma` into every Lambda asset. Backend was redeployed successfully after confirming the engine exists in `cdk.out`.
- Resume-email fix note: staging email delivery was not active because `EMAIL_ENABLED=false` was still present in backend `.env` and likely synced to the staging secret. `EMAIL_ENABLED=true` was set, `savians/assessment/staging` was synced, and the public Lambda was redeployed with stricter behavior: resumed assessments now require a real Resend `SENT` result before routing to `/assessment/check-email`.
- Local RDS verification from this machine remains unavailable because the RDS endpoint is not reachable from the local network; deployed Lambdas use the configured VPC/subnets/security group.

## Phase 4 local evidence

- Frontend `/assessment/status/[token]` implemented with invoice details, current balance, last checked time, 20-second polling, manual refresh, and resend invoice email.
- Backend status endpoint implemented: `GET /api/assessment/status/{token}`.
- Backend manual refresh implemented: `POST /api/assessment/refresh-payment-status`.
- Backend resend implemented: `POST /api/assessment/resend-invoice-email`.
- QuickBooks invoice re-fetch implemented and requires stored invoice ID, exact amount, matching currency, and zero balance before unlock.
- Webhook endpoint verifies `intuit-signature` with HMAC-SHA256 and stores idempotent `assessment_webhook_events`.
- Invoice webhook events reconcile the matching invoice.
- Payment webhook events trigger a limited open-invoice sweep rather than trusting the payment payload alone.
- Scheduler handler runs the same open-invoice reconciliation logic; EventBridge remains disabled.
- Payment, webhook, and scheduler Lambdas have Secrets Manager write access for rotated QuickBooks refresh-token persistence.
- QuickBooks SMS/text is intentionally not implemented; QuickBooks does not expose a native invoice-SMS API. Use a separate SMS provider in a later notification phase if required.

## Phase 5 local evidence

- Payment status page can request a secure account setup link once `accountCreationAllowed` is true.
- `POST /api/assessment/account/invite/reissue` issues seven-day setup invites only for paid verified sessions.
- `POST /api/assessment/account/invite/start` issues the same seven-day setup invite for browser continuation and returns the setup route directly; it does not send an account setup email.
- `POST /api/assessment/account/invite/validate` validates invite token, expiry, used/revoked state, and paid entitlement.
- `POST /api/assessment/account/setup` now creates/updates the Cognito user with backend admin APIs because public Cognito self-signup is disabled on the shared user pool.
- The account setup start step suppresses Cognito's default invite email, sets the permanent password only for newly created Cognito users, stores a short-lived hashed setup verification code in `assessment_recovery_tokens`, and sends that code through Resend.
- Existing Cognito users keep their existing password; this supports repeat/client-existing account handling without silently resetting credentials.
- `POST /api/assessment/account/confirm` verifies the Resend-delivered setup code, marks Cognito `email_verified=true`, adds `ASSESSMENT_CLIENT`, links DB client/session, marks invite used, and moves session to `ACCOUNT_CREATED`.
- `/assessment/account/setup/[token]` validates the invite, collects password, then collects the Savians setup verification code sent by email.
- The payment status page no longer shows a "Send account setup link" button. After payment verification it shows `Set up profile now` and `I'll do this later`; the first action creates the invite and navigates directly to account/profile setup.
- Protected portal endpoints deny access unless Cognito `email_verified=true`, Cognito group is present, and the DB client is linked to a paid account-created session.
- Direct Cognito signup alone does not unlock portal API access.

## Phase 6 local evidence

- `GET /api/assessment/portal/profile` loads the entitled client's profile state and primary taxpayer details.
- `POST /api/assessment/portal/profile` validates and saves the complete household profile.
- Primary taxpayer DOB is loaded from the original assessment session and remains mandatory from Phase 2 intake.
- Account confirmation now signs the browser into Cognito automatically and stores the portal access token locally for the protected profile page.
- The temporary auth bridge/token textarea was removed from `/portal/profile`; clients should not manually paste Cognito tokens.
- If a browser does not already have the portal session, `/portal/profile` now shows a normal email/password sign-in form instead of asking for a token.
- `/portal/profile` shows captured client details from the paid assessment session: name, email, phone, date of birth, assessment year, and profile status.
- The `Household name` field was removed from the profile UI and is no longer sent by the browser.
- Preferred contact, home address, city, state, ZIP, homeowner, marital status, resident status, real estate ownership, and business ownership are mandatory on the profile page.
- Spouse details are required when marital status is `MARRIED`.
- Spouse DOB is mandatory and cannot be bypassed.
- All visible spouse/dependent fields are mandatory; optional middle-name/notes fields are not shown.
- Spouse data is rejected when marital status is not `MARRIED`.
- Dependents are repeatable and each dependent DOB is mandatory.
- Frontend `/portal/profile` includes household/address fields, conditional spouse fields, dependent rows, derived age display, status, and browser-local draft autosave.
- Complete profile saves write `assessment_client_profiles`, replace spouse/dependent rows in `assessment_household_members`, and advance eligible sessions to `PROFILE_COMPLETED`.
- No database migration was required.
- After `Save profile`, the backend marks profile intake complete and the next intended portal step is document upload. The dedicated document-upload UX remains the next build item.

## Completed evidence

- Dashboard onboarding revision implemented: `/portal/dashboard` now contains four tabs: Personal And Family Information, Real Estate Intake, Business And Entity Intake, and Document Upload Requirements.
- Dashboard protected API implemented: `GET /api/assessment/portal/dashboard`.
- Real estate dashboard save implemented: `POST /api/assessment/portal/properties`.
- Business/entity dashboard save implemented: `POST /api/assessment/portal/business-investments`.
- Ready-for-review dashboard action implemented: `POST /api/assessment/portal/ready-for-review` moves eligible sessions to `DOCUMENTS_SUBMITTED`, records status history/audit/email event, and sends the internal notification from `awsadmin@savians.com` to `contactus@savians.com`.
- Client-facing dashboard status mapping implemented: `Payment Pending`, `Pending Uploads`, and `Ready for Review`. Later admin-only states `In Progress` and `Completed` are deferred to the admin workflow phase.
- Old `/portal/profile` now redirects to `/portal/dashboard`.
- Account setup confirmation now redirects to `/portal/dashboard`.
- Dashboard top-right now includes `Logout`, which signs out the Cognito current user, clears the stored portal ID token, and returns the browser to the dashboard sign-in state.
- Payment verified page now automatically starts the paid account setup/dashboard flow instead of requiring a manual "send setup link" style action.
- Landing page now includes `Sign In / Resume`, backed by `/assessment/recover`, so users who leave midway can request a secure exact-stage resume link.
- Exact-stage resume behavior updated: account/profile/document-stage resumes route to `/portal/dashboard`; agreement and payment stages still resume to their appropriate tokenized pages.
- Dashboard documentation added to `docs/PROJECT_IMPLEMENTATION_DOSSIER.md`.
- Verification after dashboard revision: backend typecheck passed, backend tests passed 39/39, backend build passed, CDK synth passed, frontend typecheck passed, frontend tests passed 5/5, and frontend production build passed with no hook warnings.
- Dashboard backend deployed to staging on 2026-07-09. CDK created the new dashboard and ready-for-review API Gateway routes, updated public/auth/portal Lambda code assets, and completed `UPDATE_COMPLETE`.
- Post-deploy smoke evidence: `GET /api/assessment/health` returned HTTP `200`; unauthenticated `GET /api/assessment/portal/dashboard` returned `Unauthorized`; unauthenticated `POST /api/assessment/portal/ready-for-review` returned `Unauthorized`.
- Assessment migrations: 3 applied, 0 pending.
- Database verification: 18 tables, 10 enums, active template verified.
- Legal DOCX S3 object: 343,860 bytes, AES256, correct metadata.
- Legal PDF S3 object: 327,232 bytes, AES256, correct metadata.
- QuickBooks sandbox: company, OAuth, Realm, item type, active state, price, and income account verified.
- Controlled sandbox invoice/email: passed using invoice `1038` and approved recipient.
- AWS secret: created and verified with 9 required and 13 total configured fields.
- Backend: Prisma schema validation, lint, type-check/build, 33 tests, CDK synth, CDK diff, CDK deploy, and deployed smoke tests pass.
- Deployed start flow: `/api/assessment/start` now passes live smoke testing after the Prisma Lambda packaging fix.
- Deployed resume-email flow: `/api/assessment/start` returned `200 OK` after email was enabled and routed to `/assessment/check-email` only after a successful send result.
- Deployed exact-stage resume fix: public Lambda redeployed after tests confirmed `PAID_VERIFIED` resumes email `/assessment/status/{token}` and `ACCOUNT_CREATED`/`PROFILE_IN_PROGRESS` resumes email `/portal/profile`.
- Agreement invoice 502 diagnosis: browser QA found `POST /api/assessment/agreement/sign` returning `502` because the agreement was saved but QuickBooks billing could not complete.
- QuickBooks root cause: local OAuth refresh validation returned Intuit `invalid_grant`, meaning the current sandbox refresh token in `.env`/AWS secret is stale or invalid.
- Backend hardening deployed: AWS Secrets Manager reads are no longer cached indefinitely in warm Lambda containers, so after a fresh QuickBooks token is synced, staging Lambdas read the updated secret on the next invocation.
- Agreement billing diagnostics deployed: CloudWatch will now log the failed billing step and sanitized Intuit error details for agreement invoice failures.
- Billing-retry resume routing deployed: sessions at `AGREEMENT_SIGNED` or `QB_CUSTOMER_CREATED` resume to `/assessment/agreement/{token}` so invoice/customer creation can be retried instead of dumping the user onto a not-ready payment page.
- DB verification: latest `Test User` is correctly stored at `AGREEMENT_SIGNED` with signature saved and no QuickBooks customer/invoice yet, matching the current invalid-token failure.
- Required next QuickBooks action: generate a fresh sandbox refresh token for the same Intuit app/company, update backend `.env`, run `npm run quickbooks:configure-item`, then run `npm run secrets:sync:staging`, and retry the same agreement page.
- Portal profile 401 fix: frontend now sends Cognito ID tokens, not access tokens, to protected portal APIs so required `email`/`email_verified` claims are present. Stale locally stored access tokens are cleared automatically.
- Portal profile UX guard: household profile form is hidden until the protected profile successfully loads; signing in with an admin/shared account will not unlock a client profile because backend entitlement requires the paid client account.
- Portal profile immediate-after-setup fix: backend no longer hard-blocks on a missing fresh Cognito `ASSESSMENT_CLIENT` group claim; paid linked DB entitlement is authoritative after Cognito `sub`/`email`/`email_verified` are present. Portal Lambda was redeployed and backend tests pass 39/39.
- Profile-to-documents handoff implemented: saving `/portal/profile` now redirects to `/portal/documents` instead of leaving the client on a success notification.
- Secure document upload page implemented: `/portal/documents` loads with the existing stored Cognito ID token, supports categorized file uploads, lists uploaded documents, and calls new authenticated backend routes.
- Document backend deployed: documents Lambda now handles `GET /api/assessment/documents`, `POST /api/assessment/documents/upload-url`, and `POST /api/assessment/documents/complete`; first completed upload advances the session to `DOCUMENTS_IN_PROGRESS`.
- Document upload CORS fixed in CDK: the existing `savians-bucket` now receives a managed CORS rule for direct browser uploads from `http://localhost:3000`, `http://127.0.0.1:3000`, `props.frontendUrl`, and `https://*.savians.com`.
- Document page UX upgraded: `/portal/documents` is now a Drive-style category folder grid. Each folder supports drag-and-drop, separate upload selection, multiple files, uploaded counts, and an active-folder details panel while keeping the same backend document upload APIs.
- Document page UX refined again: category folders are now full-width horizontal rows with recent files, `Open Folder` / `View More`, folder modal, click-to-preview, upload-after-preview, and client-visible remove.
- Document preview/remove backend deployed: staging now has `GET /api/assessment/documents/{documentId}/preview-url` and `DELETE /api/assessment/documents/{documentId}`. Remove is a soft delete in Postgres and preserves S3 retention.
- Document reload unauthorized fix: `/portal/documents` now refreshes Cognito ID tokens from the SDK-managed current session before loading/uploading/previewing/removing documents, instead of reusing an expired localStorage token after reload.
- Document folder row sizing increased: horizontal folder rows now have larger min-height, padding, icon size, recent-file area, and drag target height.
- Document workspace revamp: `/portal/documents` now uses a compact top upload header, a left-side clickable document-category list, and a right-side selected-folder workspace with drag/drop, `Add Files`, scrollable uploaded-file list, preview, and soft remove actions.
- Document workspace refinement: `/portal/documents` now uses a wider page container, keeps the drag/drop area and uploaded-files panel side-by-side on desktop, and uses icon-only eye/bin actions for per-file preview/remove.
- Temporary localhost-link mode: because `staging.assessments.savians.com` is not deployed yet, backend `.env` now sets `FRONTEND_URL=http://localhost:3000` and the staging stack was redeployed. New emails/setup URLs generated by the staging backend should point directly to localhost. Change this back to `https://staging.assessments.savians.com` before staging frontend acceptance/deploy.
- CORS note: CDK now dedupes `allowOrigins` so local-link mode does not produce duplicate `http://localhost:3000` origins.
- Local frontend dev server was restarted on port `3000`; logs are at `savians-assessments/tmp/frontend-dev.out.log` and `savians-assessments/tmp/frontend-dev.err.log`.
- Frontend: lint, type-check, production build, and 5 tests pass.
- Account setup Cognito fix: browser QA exposed `SignUp is not permitted for this user pool`; backend was changed from public `SignUp`/`ConfirmSignUp` to admin `AdminCreateUser`/`AdminSetUserPassword`/`AdminUpdateUserAttributes`, IAM was updated, backend tests now pass 36/36, frontend/backend typechecks pass, CDK synth/deploy succeeded, and `GET /api/assessment/health` returned HTTP `200`.

## Safety rules

- Never use Prisma migration-history commands for Assessments against the shared database.
- Never edit an applied assessment SQL migration.
- Never touch referral migration history from this repository.
- Never paste or log OAuth tokens, client secrets, Resend keys, or database URLs.
- Do not run any further controlled invoice tests without an approved recipient; existing test invoice `1038` should be reused for diagnostics when possible.
- Do not trust webhook payloads alone for account unlock; always re-fetch the stored QuickBooks invoice.
- Do not enable scheduled reconciliation before staging acceptance.
- Do not grant portal access based on Cognito alone; always require linked paid DB entitlement.
- Do not enable public Cognito self-signup on the shared user pool for this portal. Account setup is intentionally backend-admin-created after paid entitlement.
- Do not mark email verified before the setup verification code is confirmed. The backend marks Cognito `email_verified=true` only after the Resend-delivered setup code matches the hashed recovery-token record.
- The account setup flow now creates the initial browser Cognito session, and `/portal/profile` has a basic email/password fallback. A fuller returning-client login/session provider is still required before production launch.

## Resume prompt

> Continue from `savians-assessments/docs/TOMORROW_HANDOFF.md`. Backend staging is deployed at `https://raw04zyetf.execute-api.us-east-1.amazonaws.com`. Run frontend locally with `frontend/.env.local`, then perform staging acceptance in order: Phase 4 payment/webhook verification, Phase 5 Cognito account setup/email verification/portal entitlement, and Phase 6 protected profile save.
