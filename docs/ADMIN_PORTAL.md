# Assessment Admin Portal

## Purpose

The assessment administration workspace gives the existing Savians referral administrators one organized place to operate the assessment lifecycle. It reuses the referral portal Cognito user pool and its existing group membership; it does not create another administrator account or user pool.

## Identity and routing

- All assessment users sign in at `/login` through the assessment app client in the shared Cognito user pool.
- Cognito group routing is automatic:
  - `ADMIN`, `Admin`, and legacy `Finance` -> `/admin/dashboard`;
  - `SUPERADMIN`, `SUPER_ADMIN`, `superadmin`, and legacy `SuperAdmin` -> `/admin/dashboard` with super-admin identity and full admin inheritance;
  - `ASSESSMENT_CLIENT` -> `/portal/dashboard`.
- The browser redirect is a convenience only. Every `/api/assessment/admin/*` route independently requires an admin/super-admin group claim inside the Lambda.
- A valid client JWT cannot call an admin API.

## Admin information architecture

The admin dashboard is intentionally shallow and high-volume friendly:

1. **Overview** — total/status counts, document volume, and recently updated clients.
2. **Clients** — paginated table with name/email/phone/invoice search plus year and status filters.
3. **All Documents** — global paginated document library with client/category search and audited short-lived previews.
4. **Client Workspace** — one client at a time with tabs for Summary, Personal & Family, Real Estate, Businesses & Entities, Documents, and History.

## Editable and immutable data

Administrators may edit all client-entered data:

- primary identity/contact and original assessment intake;
- household, spouse, dependents, income, and planning information;
- every real-estate record and ownership split;
- every business/entity record and three-year income/loss history;
- status transitions to `IN_PROGRESS` and `COMPLETED`.

The following remain read-only because changing them would corrupt legal or accounting evidence:

- signed agreement evidence and hashes;
- verified payment timestamps/balances;
- QuickBooks customer/invoice identifiers;
- retained audit history.

Changing a linked client's email updates both the assessment database and the same Cognito user in the shared pool. The admin Lambda alone receives `cognito-idp:AdminUpdateUserAttributes`.

## Status policy

Client-facing labels and internal states are:

| Client label | Internal state |
|---|---|
| Payment Pending | invoice/payment states |
| Pending Uploads | paid account/profile/document intake states |
| Ready for Review | `DOCUMENTS_SUBMITTED` |
| In Progress | `IN_PROGRESS` |
| Completed | `COMPLETED` |

Only `DOCUMENTS_SUBMITTED`, `IN_PROGRESS`, or `COMPLETED` assessments can be changed by an admin to In Progress or Completed. Every change writes both status history and an audit record.

## Admin APIs

- `GET /api/assessment/admin/overview`
- `GET /api/assessment/admin/clients`
- `GET /api/assessment/admin/clients/{sessionId}`
- `PUT /api/assessment/admin/clients/{sessionId}/identity`
- `PUT /api/assessment/admin/clients/{sessionId}/profile`
- `PUT /api/assessment/admin/clients/{sessionId}/properties`
- `PUT /api/assessment/admin/clients/{sessionId}/business-investments`
- `PUT /api/assessment/admin/clients/{sessionId}/status`
- `GET /api/assessment/admin/documents`
- `GET /api/assessment/admin/documents/{documentId}/preview-url`

All list endpoints paginate; document URLs expire after five minutes; document views and all edits are audit-logged.

## Database credential rotation

The RDS instance owns the current master credential in its AWS-managed secret. When RDS rotates that password, update only DATABASE_URL in each assessment application secret with:

    npx ts-node scripts/sync-database-credential-from-rds.ts --application-secret=<assessment-secret-name> --rds-secret=<rds-managed-secret-id> --env-file=<local-env-file>

The script preserves and verifies every non-database field, including QuickBooks, Resend, and webhook credentials. Run it once for staging and once for production. This avoids using the general secret-sync command for a database-only rotation, which could overwrite a newer QuickBooks refresh token.

## Database migration

`backend/database/migrations/0005_admin_workflow_statuses.sql` adds `IN_PROGRESS` and `COMPLETED` to the assessment-only enum. It is applied through `assessment_schema_migrations`, not through the referral portal's Prisma migration history.

## Release checklist

1. Apply assessment migration `0005` from an authorized network path.
2. Regenerate Prisma Client (already part of the verified build).
3. Deploy the assessment backend CDK stack so the admin Lambda/routes/IAM are live.
4. Push the frontend so Amplify deploys `/login`, `/admin/dashboard`, and `/admin/clients/{sessionId}`.
5. Sign in with the existing referral admin and verify role routing.
6. Confirm a client credential routes to the client dashboard and receives `403` on an admin API.
7. Test status change, data edit, and document preview against a controlled assessment.

## Production smoke-test record

On July 17, 2026, the shared-pool superadmin account was verified against the production assessment portal. Overview counts, client directory, all-documents directory, client summary, personal/family data, real-estate intake, business/entity intake, documents, status history, and audit history all loaded without browser errors. Full visible-name search was also verified. No production client data or statuses were changed during this read-only smoke test.
