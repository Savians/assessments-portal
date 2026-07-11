# Phase 4 Progress: Payment Status, Webhook, and Reconciliation

Updated: 2026-07-05

Status: **Core implementation complete locally; external staging/webhook QA pending**

## Implemented

- Public `GET /api/assessment/status/{token}` payment-status endpoint.
- Public `POST /api/assessment/refresh-payment-status` manual refresh endpoint.
- Public `POST /api/assessment/resend-invoice-email` manual resend endpoint.
- Secure status-token hashing and expiry validation reused from the assessment flow.
- QuickBooks invoice re-fetch by stored invoice ID.
- Strict paid verification:
  - QuickBooks invoice ID must match the stored invoice ID.
  - Invoice currency must match the session currency.
  - Invoice total must match the expected assessment fee.
  - Invoice balance must be exactly zero before account creation is allowed.
- Paid verification writes:
  - `PAID_VERIFIED` status.
  - `payment_verified_at`.
  - `account_creation_allowed = true`.
  - reconciliation record.
  - status-history record.
  - audit record.
- Still-open invoices update stored balance and write reconciliation/audit evidence without unlocking access.
- Failed verification writes reconciliation/audit evidence and keeps access locked.
- Resend invoice email is rate-limited with existing email event history.
- Public QuickBooks webhook endpoint verifies `intuit-signature` using HMAC-SHA256 and the stored verifier token.
- Webhook events are stored idempotently in `assessment_webhook_events`.
- Invoice webhook events reconcile the matching invoice.
- Payment webhook events trigger a limited open-invoice sweep because Payment webhook payloads do not safely prove the exact assessment invoice is paid by themselves.
- Disabled-by-default EventBridge scheduler now runs the same open-invoice reconciliation logic.
- Payment, webhook, and scheduler Lambdas can read and persist rotated QuickBooks refresh tokens through the assessment Secrets Manager boundary.
- Frontend `/assessment/status/[token]` page with:
  - invoice number, invoice amount, current balance, last checked time;
  - 20-second polling while payment is pending;
  - manual refresh;
  - resend invoice email;
  - paid-state CTA placeholder for Phase 5 account setup.

## Safety posture

- No account access is unlocked from a webhook payload alone.
- Webhooks, manual refresh, and scheduled reconciliation converge through the same QuickBooks invoice verification service.
- Partial payments, mismatched currency, mismatched total amount, unknown invoice IDs, or QuickBooks lookup errors never set `account_creation_allowed`.
- QuickBooks SMS/text message delivery is intentionally not implemented because QuickBooks does not expose a native invoice-SMS API in the accounting API. A separate SMS provider can be added later as a non-QuickBooks notification channel.

## Verification completed locally

- Backend tests: 20 passing.
- Backend lint: passed.
- Backend build/typecheck: passed.
- Frontend lint: passed.
- Frontend production build: passed.
- CDK synth: passed.
- Existing imported subnet route-table annotations remain non-blocking.

## External gates still pending

- Deploy backend to staging with CDK after review.
- Point the Intuit sandbox webhook URL at the deployed `/api/assessment/webhooks/quickbooks` endpoint.
- Run a real sandbox payment against the controlled invoice and verify:
  - webhook receives and stores the event;
  - manual refresh reaches the same result;
  - scheduled reconciliation reaches the same result when enabled;
  - only exact zero-balance verification unlocks Phase 5 account setup.
- Keep the EventBridge reconciliation rule disabled until staging QA is accepted.
