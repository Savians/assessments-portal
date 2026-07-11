# Phase 5 Progress: Paid-Only Account Setup and Authentication

Updated: 2026-07-06

Status: **Core implementation complete locally; external Cognito/staging QA pending**

## Implemented

- Paid-only account invite issuing through `POST /api/assessment/account/invite/reissue`.
- Account invite validation through `POST /api/assessment/account/invite/validate`.
- Account setup start through `POST /api/assessment/account/setup`.
- Email-code confirmation through `POST /api/assessment/account/confirm`.
- Seven-day account setup invite tokens.
- Invite tokens are stored only as SHA-256 hashes.
- Reissuing a setup invite revokes previous unused invites for the same paid session.
- Account setup is allowed only when:
  - payment has been verified;
  - `account_creation_allowed` is true;
  - session status is `PAID_VERIFIED` or `ACCOUNT_INVITED`;
  - invite token is valid, unexpired, unused, and not revoked.
- Account setup uses Cognito SignUp so Cognito sends/controls the email verification code.
- Account is linked only after Cognito confirmation verifies the email.
- Confirmed users are added to Cognito group `ASSESSMENT_CLIENT`.
- Confirmed users are transactionally linked to:
  - `assessment_clients.cognito_user_id`;
  - `assessment_clients.email_verified_at`;
  - the paid `assessment_sessions.client_id`;
  - `ACCOUNT_CREATED` session status;
  - used account invite timestamp;
  - audit and status-history records.
- Payment status page can send the secure setup link after payment verification.
- New `/assessment/account/setup/[token]` frontend page validates the invite, collects password, starts Cognito signup, then collects the email verification code.
- Portal backend now enforces defense-in-depth:
  - JWT must include `sub`;
  - JWT email must be verified;
  - JWT must include `ASSESSMENT_CLIENT`;
  - DB client must be linked to the Cognito user;
  - DB session must be paid/account-created and entitlement-enabled.
- Direct Cognito signup alone does not unlock portal access because the portal API also requires the linked paid assessment DB entitlement.

## Password and email verification

- Password must include at least 12 characters, uppercase, lowercase, number, and special character.
- Email verification remains Cognito-controlled.
- Portal access is denied until Cognito reports `email_verified=true`.

## Infrastructure

- Auth Lambda now handles invite validation, invite reissue, setup, and confirmation.
- Portal Lambda now uses the paid-entitlement guard instead of the generic placeholder.
- CDK routes added:
  - `POST /api/assessment/account/setup`
  - `POST /api/assessment/account/confirm`
- Auth Lambda IAM includes required Cognito actions for sign-up confirmation, user lookup, and group assignment.
- No database migration was required; Phase 5 uses existing `assessment_account_invites`, `assessment_clients`, `assessment_sessions`, `assessment_email_events`, status-history, and audit tables.

## Verification completed locally

- Backend tests: 28 passing.
- Backend lint: passed.
- Backend build/typecheck: passed.
- Frontend lint: passed.
- Frontend typecheck: passed.
- Frontend production build: passed and includes `/assessment/account/setup/[token]`.
- CDK synth: passed and includes new auth routes plus real auth/portal Lambda bundles.
- Existing imported subnet route-table annotations remain non-blocking.

## External gates still pending

- Deploy backend to staging after review.
- Confirm Cognito app client sign-up behavior in the existing shared user pool.
- Run controlled staging account setup using a paid verified assessment:
  - send account setup invite;
  - receive setup email;
  - create password;
  - receive Cognito verification code;
  - confirm account;
  - verify Cognito group membership;
  - verify DB client/session linkage;
  - verify portal rejects unverified, unlinked, or unpaid users.
- Phase 6 should not begin until the protected portal entitlement is proven in staging.
