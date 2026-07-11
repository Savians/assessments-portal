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
2. Create production secrets without enabling invoice creation.
3. Deploy with `QB_INVOICE_CREATION_ENABLED=false` and payment reconciliation disabled.
4. Run read-only checks: token refresh, CompanyInfo realm match, service item lookup, and webhook signature test.
5. Confirm CloudWatch logs redact tokens, authorization headers, client data, and raw webhook secrets.
6. Enable the production webhook and verify successful delivery/acknowledgement.
7. Enable invoice creation for one approved internal production test session.
8. Confirm one customer, one USD 2,997 invoice, correct item/account mapping, invoice email delivery, local IDs, and idempotent retry behavior.
9. Complete an approved test payment or accounting-approved verification path; confirm exact invoice/zero-balance validation and account unlock.
10. Enable scheduled reconciliation and general production traffic.
11. Monitor Lambda errors, QuickBooks API failures, webhook signature failures, duplicate-prevention events, and reconciliation drift closely during launch.

## Rollback

- Set `QB_INVOICE_CREATION_ENABLED=false` to stop new invoices.
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

