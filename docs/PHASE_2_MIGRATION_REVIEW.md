# Phase 2 Migration Review

Reviewed: 2026-07-05

Migration moved into the independent assessment track as `backend/database/migrations/0001_initial_assessment_schema.sql`.

Application status: **APPLIED on 2026-07-05 through `assessment_schema_migrations`; verified 3 applied, 0 pending**

## Review summary

- Creates 17 PostgreSQL tables.
- Every created table begins with `assessment_`.
- Every foreign-key reference targets an `assessment_*` table.
- Creates 12 unique indexes and 16 non-unique indexes.
- Contains 19 `ALTER TABLE` statements, all adding foreign keys to newly created tables.
- Contains 0 `DROP` statements.
- Contains 0 referral-table references.
- Does not create or modify an RDS instance.

## Tables

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

## Required approval before application

Before running this migration against staging:

1. Confirm the target `DATABASE_URL` points to the intended shared staging PostgreSQL database.
2. Take or verify a restorable database snapshot.
3. Run `npm run assessment:migrate:status`; do not use or modify the referral portal's `_prisma_migrations` history.
4. Review the SQL once more against the live staging schema.
5. Obtain explicit approval to apply it.
6. Apply to staging only, run smoke tests, and record the migration result.

Production application remains a Phase 11 controlled-launch activity.