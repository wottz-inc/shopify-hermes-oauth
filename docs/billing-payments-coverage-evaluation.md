# M8 billing and Shopify Payments coverage evaluation

Issue #76 evaluates app billing and Shopify Payments/finance surfaces for `shopify-hermes-oauth`. This is a decision note only: no financial-data extraction, billing writes, or new MCP tools are implemented here.

## Decision

- **Defer implementation** of billing and Shopify Payments tooling until there is explicit product/merchant demand and a dedicated follow-up issue.
- **Do not add any billing, payment, payout, dispute, bank-account, ledger, REST Payment, or ShopifyQL finance report surface to the default v0.1 connector.**
- **Never add an unrestricted raw GraphQL, REST, or ShopifyQL finance tool.**
- If implemented later, only add curated read-only summaries with strict scope checks, date windows, pagination caps, financial/PII redaction, and safe structured errors.

## App billing findings

App billing resources describe charges for the current app installation, not the merchant's general store finances. They are relevant only if this connector itself charges merchants through Shopify app billing or needs subscription-gating diagnostics.

Primary docs:

- [`currentAppInstallation`](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation)
- [`AppInstallation`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppInstallation)
- [`AppSubscription`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppSubscription)
- [`AppSubscriptionLineItem`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppSubscriptionLineItem)
- [`AppUsagePricing`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppUsagePricing)
- [`AppUsageRecord`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppUsageRecord)
- [`AppPurchaseOneTime`](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppPurchaseOneTime)
- [`appSubscriptionCreate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate)
- [`appSubscriptionCancel`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCancel)
- [`appSubscriptionLineItemUpdate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionLineItemUpdate)
- [`appSubscriptionTrialExtend`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionTrialExtend)
- [`appPurchaseOneTimeCreate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appPurchaseOneTimeCreate)
- [`appUsageRecordCreate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appUsageRecordCreate)
- [Shopify billing overview](https://shopify.dev/docs/apps/launch/billing)
- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)
- [Manual pricing](https://shopify.dev/docs/apps/launch/billing/manual-pricing)

### App billing decision

- Candidate read-only future tool only if needed: `shopify.app_billing.summary`.
- Required gate: authenticated Admin GraphQL app billing access for the current app installation; treat online-token staff billing approval failures as `billing_permission_required`.
- Safe fields: active subscription count, status, test flag, trial days, current period end, plan/name if non-sensitive, and pricing model type.
- Avoid by default: exact prices, balances, capped usage amounts, usage record descriptions, idempotency keys, confirmation URLs, return URLs, full historical subscriptions/purchases, and merchant invoice/earnings data.
- Out of scope: all app billing mutations, including subscription creation/cancellation, line-item updates, trial extensions, one-time purchase creation, and usage-record creation.

### App billing scopes / permissions

Shopify app billing docs require authenticated Admin GraphQL access rather than normal store-data OAuth scopes such as `read_orders`. Some billing objects also mention online-token staff permissions to manage app billing or approve app charges. Follow-up implementation must treat permission failures as safe structured statuses, for example `billing_permission_required`, not raw Shopify error dumps.

## Shopify Payments and finance findings

Shopify Payments data is merchant financial data and is significantly more sensitive than ordinary product/inventory metadata.

Primary docs:

- [`shopifyPaymentsAccount`](https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyPaymentsAccount)
- [`ShopifyPaymentsAccount`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsAccount)
- [`ShopifyPaymentsPayout`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout)
- [`ShopifyPaymentsBalanceTransaction`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction)
- [`ShopifyPaymentsDispute`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsDispute)
- [`ShopifyPaymentsBankAccount`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBankAccount)
- [REST Balance](https://shopify.dev/docs/api/admin-rest/latest/resources/balance)
- [REST Payouts](https://shopify.dev/docs/api/admin-rest/latest/resources/payouts)
- [REST Transactions](https://shopify.dev/docs/api/admin-rest/latest/resources/transactions)
- [REST Dispute](https://shopify.dev/docs/api/admin-rest/latest/resources/dispute)
- [REST Payment](https://shopify.dev/docs/api/admin-rest/latest/resources/payment)
- [`shopifyqlQuery`](https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery)
- [Admin API access scopes](https://shopify.dev/docs/api/usage/access-scopes)

### Payments scopes / access

Relevant scopes and approval gates are finance-specific and may differ between GraphQL object docs, REST docs, and the central access-scope index. Follow-up implementation must verify current Shopify behavior before coding. Relevant scope names include:

- `read_shopify_payments`
- `read_shopify_payments_accounts`
- `read_shopify_payments_payouts`
- `read_shopify_payments_disputes`
- `read_shopify_payments_dispute_evidences`
- `read_shopify_payments_bank_accounts`
- REST docs also reference legacy/REST-style `shopify_payments`, `shopify_payments_accounts`, and `shopify_payments_payouts` access.
- ShopifyQL finance/report templates would require `read_reports` and may require protected customer data approval depending selected datasets/columns.

### Payments decision

Candidate future summaries, only under explicit protected financial-data gate:

1. `shopify.payments.account_summary`
   - Required scopes/gates: verify `read_shopify_payments` / `read_shopify_payments_accounts` behavior before coding; REST-style account access may appear as `shopify_payments_accounts`.
   - Safe fields: activated/onboardable status, balance totals by currency, payout schedule summary.
   - Omit: account opener name, bank account details, bank names, last digits, account identifiers.

2. `shopify.payments.payouts.summary`
   - Required scopes/gates: `read_shopify_payments_payouts` for GraphQL payouts/balance transactions; REST docs also reference `shopify_payments_payouts` or `shopify_payments`.
   - Safe fields: date-windowed payout counts/statuses and net totals by currency.
   - Omit: external trace IDs, raw payout IDs by default, bank-account metadata.

3. `shopify.payments.disputes.summary`
   - Required scopes/gates: `read_shopify_payments_disputes`; never request `read_shopify_payments_dispute_evidences` unless a separate evidence workflow is explicitly approved.
   - Safe fields: open/won/lost/needs-response counts, amount totals by currency, evidence deadline windows, reason/category counts.
   - Omit: dispute evidence payloads, customer/order PII, payment/card details, free-text evidence, raw order IDs.

Defer until later:

- Balance transaction / ledger rows. If added, expose aggregates only: totals by transaction type, fees/net/gross by currency, pending vs paid-out counts, and test transaction counts.
- Bank-account metadata. Even last digits and bank names should be excluded by default.

Out of scope:

- REST Payment / payment processing resources.
- Arbitrary `shopifyqlQuery` or broad finance-report query tools.
- General merchant financial-data extraction.

## Required privacy and finance guardrails for any future implementation

- Read-only only; no billing/payment mutations.
- No raw GraphQL, REST, or ShopifyQL tool.
- Validate scopes before calls and return structured safe errors such as `missing_scope`, `shopify_payments_unavailable`, `payments_permission_required`, `finance_report_unavailable`, and `protected_customer_data_required`.
- Bound all date windows and pagination; prefer summaries over rows.
- Redact or omit bank account last digits, bank names, external trace IDs, account opener names, order/customer identifiers, dispute evidence, source transaction IDs, payment/card details, raw provider errors, tokens, OAuth callback data, and app secrets.
- Audit operation names, scope/status/count metadata, and summary counts only; never audit row payloads or finance identifiers.
- Add tests proving sensitive fields are omitted or redacted before exposing any user-visible surface.

## Follow-up recommendation

Do not create a default-scope implementation from #76. If the product needs these surfaces later, create separate implementation issues for:

- optional app billing status summary;
- optional Shopify Payments account/payout/dispute summaries behind an explicit protected financial-data gate;
- optional hardcoded ShopifyQL finance templates only after #77/#90 analytics evaluation defines a safe template gate.

Close #76 as an evaluation/decision issue once this note is merged.
