# Authentication and Account Recovery

Last updated: 2026-07-16

## Implemented flows

### Forgot password

- Entry point: `/assessment/forgot-password`.
- Discoverable from client-dashboard sign-in, profile sign-in, returning-account setup, and completed setup states.
- The assessment backend generates an eight-digit, cryptographically random reset code.
- Resend delivers the code from `Savians Tax Advisors <contactus@savians.com>`; Amazon SES and Cognito's `no-reply@verificationemail.com` sender are not used for this flow.
- Only a SHA-256 hash bound to the assessment session and normalized email is stored. The plaintext code is never persisted or logged.
- The public request response is identical for known and unknown emails, preventing account enumeration through response content.
- Codes expire after 15 minutes. Requesting a new code revokes earlier unused reset codes.
- Reset-code resend has a 60-second backend-enforced cooldown plus a matching UI countdown.
- A valid code is atomically consumed before the auth Lambda changes the permanent Cognito password, preventing replay.
- Password policy is validated by the backend before Cognito receives the new password.
- Recovery is limited to verified assessment clients linked to Cognito. The shared referral-portal recovery flow is not changed.
- A first-time client who has not completed payment and account setup has no verified assessment account, so the backend does not create or email a reset code.
- Repeat clients retain one reusable account across assessment years. If a repeat client has an unpaid new-year assessment but already has a verified Savians account from an earlier year, password recovery remains available for that existing account.
- The frontend explains the payment/account prerequisite and links to assessment recovery, while the API deliberately keeps the same response for known and unknown emails to prevent account enumeration.

### New paid account verification

- Savians sends the account verification code through Resend from the branded sender.
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

- `POST /api/assessment/account/verification/resend`: public, invite-token protected, rate-limited setup-code resend.
- `POST /api/assessment/account/password-reset/request`: public, enumeration-resistant, rate-limited Resend reset-code request.
- `POST /api/assessment/account/password-reset/confirm`: public, consumes a valid reset code and changes the Cognito password.
- `POST /api/assessment/account/existing/claim`: Cognito JWT protected, links a paid annual assessment to an existing verified account.

Existing setup endpoints remain in place:

- `POST /api/assessment/account/invite/validate`
- `POST /api/assessment/account/setup`
- `POST /api/assessment/account/confirm`

## Data and infrastructure impact

- No database migration or schema change is required.
- Existing `assessment_recovery_tokens`, `assessment_account_invites`, client, session, status-history, and audit tables are reused.
- Password-reset records use verification type `PASSWORD_RESET_EMAIL`.
- The Cognito app client remains secretless and uses SRP/refresh-token authentication.
- The auth Lambda retains the existing least-privilege Cognito administrative permissions.
- The shared Cognito user-pool email configuration remains unchanged, so the referral portal is not affected.
- The staging and production environment templates use `contactus@savians.com` for `EMAIL_FROM` and `EMAIL_REPLY_TO`.

### Resume-link delivery

- Each requested resume-link email receives a new Resend message and a unique short reference in its subject.
- The unique subject prevents Gmail from visually collapsing multiple user-requested links into one conversation.
- The newest resume URL remains the authoritative way to continue the current annual assessment.

## Verification completed locally

- Backend TypeScript typecheck: passed.
- Backend ESLint: passed.
- Backend test suite: 50 tests passed, including Resend reset delivery, account-existence concealment, one-time consumption, invalid/expired-code rejection, QuickBooks online-payment preparation, and unique resume-email subjects.
- Frontend ESLint: passed.
- Frontend test suite: 8 tests passed, including backend reset request, reset confirmation, and invalid-code handling.
- Next.js production build: passed.
- CDK synthesis: passed after retrying a transient Windows generated-bundle file lock.

## Deployment history

### Native Cognito recovery deployment - 2026-07-15

- The first recovery implementation used Cognito's browser-side `ForgotPassword` and `ConfirmForgotPassword` operations.
- This caused Cognito to deliver messages from `no-reply@verificationemail.com` because the shared user pool uses `COGNITO_DEFAULT` email delivery.
- Git commit `5c989d5` was pushed to `main`, and Amplify job `6` completed successfully.

### Resend recovery replacement - 2026-07-16

- Replaces only the assessment portal's forgot-password delivery with the assessment backend and Resend.
- Does not require SES production access.
- Does not install a pool-wide Cognito custom sender and therefore does not alter referral-portal email behavior.
- CDK diff contained only the auth Lambda code update, two API Gateway routes, their integrations, and Lambda invocation permissions.
- CloudFormation deployment of `SaviansAssessment-staging` completed successfully.
- The deployed invalid-code check returned HTTP 400 with `INVALID_PASSWORD_RESET_CODE` as expected.
- A controlled reset request was submitted for `thearpit2005@gmail.com`; inbox sender/content verification remains the final manual acceptance check.
- The deployed secret was verified without exposing its value: email delivery is enabled, the Resend key is present, and both sender and reply-to are `contactus@savians.com`.

## Manual acceptance checklist

1. Open `https://assessments.savians.com/assessment/forgot-password`.
2. Request a reset for the approved controlled test account.
3. Confirm the email shows sender `Savians Tax Advisors <contactus@savians.com>`.
4. Confirm the message contains an eight-digit code and no sensitive account details.
5. Request a replacement after the cooldown and confirm only the newest code works.
6. Submit the newest code with a policy-compliant password.
7. Sign in with the new password and confirm the previous password is rejected.
8. Submit an unknown email and confirm the public response is indistinguishable from a known account.
