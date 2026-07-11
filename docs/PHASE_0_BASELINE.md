# Phase 0: Architecture and Requirement Baseline

Status: Approved for Phase 1  
Decision date: 2026-07-04

## Product identity

- Customer-facing name: **Savians Tax Assessment Portal**.
- Production domain: `assessments.savians.com`.
- Service: annual Savians Tax Assessment.
- Current assessment price: USD 2,997. The price will be a server-side configuration value and an invoice snapshot, not scattered literals.
- QuickBooks Online is the accounting system of record.
- PostgreSQL is the system of record for onboarding, access state, agreement evidence, intake data, and document metadata.

## Deployment boundaries

- Frontend: Next.js in `frontend/`, pushed to GitHub and deployed by AWS Amplify.
- Backend: TypeScript Lambda services and CDK in `backend/`, deployed directly with CDK.
- Development, staging, and production use separate environment configuration and QuickBooks credentials.
- Production deployment is never a substitute for staging verification.

## Shared AWS resource decision

Reuse the existing Savians foundation where safe:

- Existing PostgreSQL RDS database and network configuration.
- Existing VPC, private subnets, Lambda security group, and RDS security group.
- Existing Cognito user pool, with an assessment-specific app client and an `ASSESSMENT_CLIENT` group.
- Existing encrypted S3 document bucket, using the isolated `assessments/` key prefix.
- Existing KMS key, subject to an IAM review in Phase 1.
- Existing Resend account/API key and approved sender configuration.
- Existing API Gateway may be imported by ID and extended with assessment routes. The CDK change set must prove that no referral route is replaced or removed.

The frontend is a separate Amplify application. All Lambda functions and database tables are assessment-specific.

## PostgreSQL naming and annual identity

Every physical table begins with `assessment_`. Initial model set:

- `assessment_clients`
- `assessment_sessions`
- `assessment_status_history`
- `assessment_agreement_templates`
- `assessment_agreement_signatures`
- `assessment_account_invites`
- `assessment_recovery_tokens`
- `assessment_client_profiles`
- `assessment_household_members`
- `assessment_properties`
- `assessment_property_owners`
- `assessment_business_investments`
- `assessment_documents`
- `assessment_audit_logs`
- `assessment_email_events`
- `assessment_webhook_events`
- `assessment_payment_reconciliations`

One `assessment_client` represents the reusable client identity and Cognito account. Each year creates a new `assessment_session`. The database enforces one canonical assessment per client, service, and year, with a controlled administrative override if policy later permits another assessment in the same year.

Before account creation, normalized email plus service plus assessment year identifies the resumable session. Linking a paid session to a Cognito user is transactional. A new year must never overwrite prior agreement, invoice, profile, or document records.

## Lambda naming

Physical pattern: `savians-assessment-{environment}-{service}`.

Planned services: `public`, `agreement`, `quickbooks`, `payment`, `auth`, `portal`, `documents`, `notifications`, `webhook`, and `scheduler`.

Example: `savians-assessment-prod-payment`.

## Authentication and reuse

- Account creation is unlocked only after verified payment.
- The same Cognito identity is reused for future annual assessments.
- Email must be verified before the account is active.
- Signup is invite-gated and bound to the paid session email.
- The backend checks paid entitlement on every protected operation.
- Email verification is the approved Phase 1 requirement. It is not true multi-factor authentication; Cognito MFA remains disabled unless a second factor is requested.
- Recovery and invite reissue use expiring email OTP or magic-link verification without revealing whether an email exists.

## Storage and retention

- Application records and uploaded documents are retained for seven years.
- Each assessment/document stores `retention_until`, calculated from the approved completion or closure event.
- S3 keys use `assessments/{environment}/{clientId}/{assessmentYear}/{assessmentSessionId}/{category}/{documentId}`.
- S3 lifecycle rules are scoped only to `assessments/`; referral documents must be unaffected.
- An auditable scheduled job handles database deletion. A legal-hold flag suspends deletion.
- Deletion covers S3 versions, metadata, and derived artifacts under the approved runbook.
- Backup expiration must be documented so deleted records are not retained indefinitely in snapshots.

## Resend

The existing backend environment contains `EMAIL_PROVIDER` and `RESEND_API_KEY`; values were not read or copied. Phase 1 will validate assessment sender/from/reply-to settings and use AWS secret management for deployed credentials.

Required templates: resume agreement, invoice/payment required, payment reminder, payment verified/create account, account link reissued, document reminder, and internal support/error notification.

## QuickBooks boundary

- Every call is server-side.
- Sandbox and production use separate credentials, URLs, realm IDs, webhooks, and verifier tokens.
- Customer/invoice creation occurs only after agreement signature.
- Invoice creation is idempotent: one invoice per assessment session.
- Unlock requires a server-side re-fetch verifying invoice ID, expected amount/currency, and zero balance.
- The newest refresh token returned by Intuit replaces the prior token atomically.

See `QUICKBOOKS_SANDBOX_SETUP.md` for the credential checklist and `QUICKBOOKS_PRODUCTION_CUTOVER.md` for the sandbox-to-production plan.

## Canonical status model

1. `AGREEMENT_PENDING`
2. `AGREEMENT_SIGNED`
3. `QB_CUSTOMER_CREATED`
4. `INVOICE_CREATED`
5. `INVOICE_SENT`
6. `PAYMENT_PENDING`
7. `PAYMENT_VERIFYING`
8. `PAID_VERIFIED`
9. `ACCOUNT_INVITED`
10. `ACCOUNT_CREATED`
11. `PROFILE_IN_PROGRESS`
12. `PROFILE_COMPLETED`
13. `DOCUMENTS_IN_PROGRESS`
14. `DOCUMENTS_SUBMITTED`
15. `ERROR`

Every transition is validated server-side and recorded in status history; sensitive actions are also recorded in audit logs.

## Phase 1 entry criteria

Phase 1 may begin. Sandbox client credentials, refresh token, realm ID, and webhook verifier have been provided and stored in the ignored backend `.env`. The Tax Assessment service item ID, minor-version decision, and a reachable staging webhook endpoint remain to be completed in later phases.

Phase 1 starts by validating imported AWS identifiers without changing production, creating staging configuration, and generating a CDK diff before deployment.
