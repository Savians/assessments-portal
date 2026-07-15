# Authentication and Account Recovery

Last updated: 2026-07-15

## Implemented flows

### Forgot password

- Entry point: `/assessment/forgot-password`
- Discoverable from the client dashboard sign-in, profile sign-in, returning-account setup, and completed setup states.
- AWS Cognito creates and emails the time-limited, single-use reset code.
- The public request response does not reveal whether an email is registered.
- The client must enter the latest reset code, a policy-compliant new password, and a matching confirmation.
- Cognito enforces code expiry, invalid-code handling, password policy, abuse limits, and old-password invalidation.
- Reset-code resend has a 60-second UI cooldown and uses Cognito's server-side throttling.

### New paid account verification

- Savians sends the account verification code through Resend.
- Codes expire after 15 minutes.
- Requesting another code revokes all older unused setup codes.
- Verification-code resend has a 60-second backend-enforced cooldown plus a matching UI countdown.
- Account linking, invite consumption, and verification-code consumption complete atomically in one database transaction.
- A successful backend confirmation is never presented as a failed verification merely because automatic browser sign-in failed.
- Reopening an already-completed setup invite safely directs the client to dashboard sign-in.

### Existing and repeat clients

- Cognito is inspected before any password is changed.
- An unfinished, unverified user can safely retry setup; the selected password is applied again.
- A verified existing user's password is never overwritten by account setup.
- The client authenticates with the existing password, then the authenticated claim endpoint links the new annual assessment to the same Savians account.
- Email and verified-email claims must match the assessment email before linking.

## Backend endpoints

- `POST /api/assessment/account/verification/resend` — public, invite-token protected, rate-limited setup-code resend.
- `POST /api/assessment/account/existing/claim` — Cognito JWT protected, links a paid annual assessment to an existing verified account.

Existing setup endpoints remain in place:

- `POST /api/assessment/account/invite/validate`
- `POST /api/assessment/account/setup`
- `POST /api/assessment/account/confirm`

## Data and infrastructure impact

- No database migration or schema change is required.
- Existing `assessment_recovery_tokens`, `assessment_account_invites`, client, session, status-history, and audit tables are reused.
- The Cognito app client remains secretless and uses SRP/refresh-token authentication.
- The auth Lambda retains the existing least-privilege Cognito administrative permissions.

## Verification completed locally

- Backend TypeScript typecheck
- Backend ESLint
- Backend test suite: 44 passing tests
- Frontend TypeScript typecheck
- Frontend ESLint
- Frontend test suite: 10 passing tests, including password reset delivery, privacy concealment, throttling, reset success, and invalid code handling
- Next.js production build
- CDK synthesis

## Deployment checklist

1. Authenticate the local AWS CLI session.
2. Run CDK diff for the staging stack.
3. Deploy the staging auth Lambda and the two API Gateway routes.
4. Confirm the imported Cognito user pool has email delivery and account recovery enabled.
5. Trigger a reset for the approved controlled test account and confirm receipt.
6. Complete the reset, sign in with the new password, and confirm the old password is rejected.
7. Exercise setup-code resend and confirm only the latest code works.
8. Push the frontend commit so Amplify publishes the new page and links.

