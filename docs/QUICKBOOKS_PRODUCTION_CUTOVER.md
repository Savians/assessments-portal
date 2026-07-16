# QuickBooks Sandbox-to-Production Cutover

Sandbox and production are separate integrations. Never switch production by changing only the base URL: production requires its own approved Intuit credentials, OAuth authorization, realm ID, service item ID, webhook configuration, and verifier token.

## Preconditions

- Full sandbox happy path and failure-path tests pass.
- Connect, disconnect, reconnect, token refresh, duplicate invoice prevention, webhook replay, and scheduled reconciliation are tested.
- Production privacy policy, terms/EULA, host domain, launch URL, disconnect URL, and connect/reconnect URL are available.
- `assessments.savians.com` and the production backend HTTPS callback/webhook endpoints are live.
- Accounting confirms the production Tax Assessment product/service, income account, invoice email behavior, and USD 2,997 amount.
- Deployment rollback and support ownership are agreed.

## Obtain production access

1. In the Intuit app, open **Keys and credentials -> Production**.
2. Complete App Details, Compliance, and the production assessment questionnaire.
3. After approval, retrieve the production Client ID and Client Secret.
4. Register the production HTTPS OAuth redirect URI.
5. Run the OAuth consent flow while signed into the intended live Savians QuickBooks company.
6. Store the resulting production Realm ID and latest refresh token.
7. Query the live Item entity and record the production Tax Assessment service item ID. Do not reuse the sandbox item ID.
8. Under **Webhooks -> Production**, configure the production endpoint and retrieve the production verifier token.

## Secret separation

Use separate AWS Secrets Manager entries or environment-scoped secret versions. Production Lambda configuration reads only production entries.

- `QB_ENVIRONMENT=production`
- `QB_CLIENT_ID`
- `QB_CLIENT_SECRET`
- `QB_REFRESH_TOKEN`
- `QB_REALM_ID`
- `QB_WEBHOOK_VERIFIER_TOKEN`
- `QB_SERVICE_ITEM_ID_TAX_ASSESSMENT`
- `QB_MINOR_VERSION`
- `QB_BASE_URL=https://quickbooks.api.intuit.com/v3`

Never copy development credentials, realm IDs, refresh tokens, item IDs, or verifier tokens into production.

## Controlled cutover

1. Rotate any credential that has been exposed outside the approved secret store.
2. Configure the ignored `.env.production`, run the read-only CompanyInfo/service-item check, and sync `savians/assessment/production`.
3. Apply only the assessment migrations to the isolated `assessment_production` PostgreSQL schema.
4. Run CDK diff, deploy `SaviansAssessment-production`, and smoke-test health, database reachability, unauthenticated admin rejection, and the scheduler.
5. Configure the deployed production webhook in Intuit and sync the production verifier token.
6. Confirm CloudWatch logs redact tokens, authorization headers, client data, and raw webhook secrets.
7. Switch Amplify to the production API and Cognito app client only after the backend checks pass.
8. Create one explicitly approved internal production assessment and confirm one customer, one USD 2,997 invoice, correct item/account mapping, delivery, local IDs, and idempotent retry behavior.
9. Complete one explicitly approved real payment or accounting-approved verification path; confirm exact invoice/currency/amount/zero-balance validation and account unlock.
10. Monitor Lambda errors, QuickBooks API failures, webhook signature failures, duplicate-prevention events, reconciliation drift, and client payment-support requests closely during launch.

## Rollback

- If invoice creation must stop, roll the live frontend back to the last approved API configuration or deploy a reviewed maintenance guard; do not invent a frontend-only payment state.
- Keep the portal in a friendly maintenance/retry state; never fall back to frontend-only payment approval.
- Disable reconciliation only if it is causing incorrect writes; retain webhook evidence and audit logs.
- Do not delete or silently recreate production invoices. Accounting decides whether a test/incorrect invoice is voided.
- Restore the previous Lambda version/configuration and re-run read-only CompanyInfo/item checks.
- Re-enable only after the root cause and accounting state are reconciled.

## Ongoing operations

- Persist the newest refresh token atomically after every refresh.
- Alert before prolonged token inactivity and on reconnect-required errors.
- Review production credentials and webhook configuration after Intuit app changes.
- Re-run security/compliance reviews required by Intuit.
- Keep sandbox available for regression testing; never test new invoice behavior first against the live company.

## Deployed production resources (2026-07-17)

- CDK stack: `SaviansAssessment-production`
- API: `https://uqh3tg1vz1.execute-api.us-east-1.amazonaws.com`
- Webhook: `https://uqh3tg1vz1.execute-api.us-east-1.amazonaws.com/api/assessment/webhooks/quickbooks`
- Cognito app client: `3me7hnbiulr5tcept74jt4srvk`
- Secret: `savians/assessment/production`
- Database schema: `assessment_production`
- Reconciliation: enabled every 15 minutes
- The service-item check selected the active production `Tax Assessment Plan` item with the expected USD 2,997 price.

The production verifier token must be copied from Intuit **Webhooks -> Production** after saving the deployed endpoint, then synced with `npm run secrets:sync:production`.
