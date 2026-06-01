# M8 Admin GraphQL coverage plan

## Issue #61

This plan closes the design question in issue #61: how to broaden curated Shopify Admin GraphQL coverage for Hermes without weakening the v0.1 safety model.

The connector already covers durable OAuth install, local token storage, shop list/verify/remove, MCP setup, and read-only products/orders/inventory reports. M8 expands beyond those proven surfaces with a deliberate allowlisted Admin GraphQL model.

## Non-negotiable guardrails

- Do not add a raw unrestricted GraphQL MCP tool.
- Keep the public surface curated and auditable.
- Start read-only by default.
- Any writes require dry-run, explicit confirmation, audit logging, and rollback notes.
- Validate OAuth scopes before calls and return safe non-secret errors.
- Respect Shopify GraphQL pagination, nested connection, and cost limits.
- No duplicate work for `shopify.report_products`, `shopify.report_orders`, or `shopify.report_inventory`; expansion issues add detail lookups, related resources, or shared infrastructure.
- Python client and ShopifyQL research are design inputs, not runtime dependency decisions.

## Recommended sequence

### Phase 0 — foundations before broad expansion

1. #62 — Capability registry / allowlist.
   - Required before new public tools so every capability has consistent metadata, scope gates, audit behavior, docs, and tests.
2. #81 — Granted-scope parsing, implication, and drift diagnostics.
   - Needed before scope expansion so missing/extra scopes produce safe reinstall guidance.
3. #82 — Retry, throttle, and cost telemetry.
   - Needed before higher-volume queries so GraphQL cost and Shopify throttle status are visible and bounded.
4. #83 — operationName support and API-version validation.
   - Required for consistent GraphQL auditability and safe endpoint construction.
5. #86 — Redaction parity.
   - Should land before PII, webhook, billing, embedded, or protected-data surfaces.
6. #89 — Structured result and safe error-code model.
   - Gives all future operations consistent success/failure shapes and reason codes.
7. #84 — Token-store metadata migration.
   - Supports richer scope, token-source, access-mode, and future online/token-exchange metadata.

### Phase 1 — low-risk read-only visibility

8. #73 — Store properties, access, apps, and privacy diagnostics.
9. #63 — Curated Admin Graph webhook subscription tools.
10. #66 — Products and collections detail beyond the existing report.
11. #68 — Inventory and locations detail beyond the existing report.
12. #71 — Metafields and metaobjects coverage.
13. #72 — Markets and localization coverage.

### Phase 2 — PII or operationally sensitive read-only surfaces

14. #65 — Customers coverage.
15. #67 — Orders detail beyond the existing report.
16. #69 — Shipping and fulfillment coverage.
17. #70 — Discounts and marketing coverage.
18. #74 — Online store, checkout, and branding configuration coverage.

### Phase 3 — evaluation, protected data, and migration inputs

19. #75 — B2B and retail coverage evaluation.
20. #76 — Billing and Shopify Payments coverage evaluation.
21. #77 — Analytics, timeline events, and ShopifyQL reporting evaluation.
22. #78 — Shopify Python OAuth clients research.
23. #79 — Migration path from Python Shopify apps to Hermes OAuth connector.
24. #80 — ShopifyQL Python SDK/CLI reference evaluation.
25. #87 — Shopify CLI and `shopify.app.toml` compatibility documentation.
26. #88 — Embedded-app and token-exchange architecture boundary.
27. #85 — Old Shopify client secret support during app secret rotation.
28. #90 — Optional curated ShopifyQL analytics reports behind explicit protected-data gate.

## Per-domain M8 matrix

| Issue | Domain | Candidate tools / commands | Required scopes | Safety level | Pagination / cost concerns | Docs and test expectations |
|---|---|---|---|---|---|---|
| #62 | Capability registry / allowlist | internal registry, future `shopify capabilities list` | none directly; records scopes for all operations | policy-critical foundation | store page-size, max-page, nested-connection, and cost strategy per capability | registry metadata tests; existing MCP tools represented; docs say no raw GraphQL bypass |
| #63 | Webhook subscriptions | `shopify.webhooks.list`, `shopify.webhooks.get`, gated dry-run create/update/delete commands | `read_webhooks`; writes need `write_webhooks` | read medium, writes high | paginate `webhookSubscriptions`; validate callback URLs and topics | HMAC/callback docs; tests for topic, URL, scope, audit, dry-run behavior |
| #64 | Bulk operations | `shopify.bulk.start`, `shopify.bulk.status`, `shopify.bulk.cancel`, `shopify.bulk.result` | template-specific read scopes such as `read_products`, `read_orders`, `read_inventory`, `read_customers` | read medium | one active operation, polling, failure states, result URL expiry | template allowlist tests; status/cancel tests; redacted result handling |
| #65 | Customers | `shopify.customers.search`, `shopify.customers.get`, `shopify.customers.summary` | `read_customers`; protected customer data may apply | read PII | bounded search and minimal default fields; avoid nested orders by default | PII minimization docs; redaction/audit tests; pagination bounds |
| #66 | Products and collections | `shopify.products.get`, `shopify.products.search`, `shopify.collections.list`, `shopify.collections.get` | `read_products` | read low | bound variants, media, metafields, publications, and collections | clarify report vs lookup; tests for nested limits and collection pagination |
| #67 | Orders | `shopify.orders.get`, `shopify.orders.find`, `shopify.orders.fulfillment_summary`, `shopify.orders.refund_summary` | `read_orders`; older ranges may need `read_all_orders` | read PII / financial | bound line items, fulfillments, refunds; require explicit ID/name/date filters | docs separate from report; redaction tests; nested pagination tests |
| #68 | Inventory and locations | `shopify.locations.list`, `shopify.locations.get`, `shopify.inventory.item_get`, `shopify.inventory.levels` | `read_inventory`, `read_locations` | read medium | avoid product × variant × location explosion; require filters for detailed views | identifier validation; cost-safe dimension tests; write adjustments deferred |
| #69 | Shipping and fulfillment | `shopify.fulfillment_orders.by_order`, `shopify.fulfillments.get`, `shopify.shipping.profiles.summary` | `read_fulfillments`, `read_assigned_fulfillment_orders`, `read_merchant_managed_fulfillment_orders`, `read_third_party_fulfillment_orders`, `read_shipping` | read operational | require order ID where possible; bound nested fulfillment connections | scope-variant tests; audit metadata tests; writes split into high-risk follow-ups |
| #70 | Discounts and marketing | `shopify.discounts.list`, `shopify.discounts.get`, `shopify.marketing_events.list` | `read_discounts`, `read_marketing_events`, maybe `read_price_rules` | read revenue-sensitive | paginate discounts/codes; do not dump bulk codes | status filter tests; docs say writes are separately gated |
| #71 | Metafields and metaobjects | `shopify.metafields.list`, `shopify.metafields.get`, `shopify.metaobjects.list`, `shopify.metaobjects.get` | owner resource scopes plus `read_metaobjects`, `read_metaobject_definitions` where needed | read custom-data sensitive | bound owner IDs, namespaces, keys, definitions, and entries | namespace/key allowlist tests; custom-data risk docs; redaction tests |
| #72 | Markets and localization | `shopify.markets.list`, `shopify.markets.get`, `shopify.locales.list`, `shopify.translations.summary` | `read_markets`, `read_locales`, `read_translations` | read low / medium | paginate countries, languages, markets, and translations | unsupported plan/store behavior tests; reinstall scope docs |
| #73 | Store properties, access, apps, privacy | `shopify.diagnose_shop`, `shopify.apps.summary`, `shopify.privacy.summary` | current baseline plus any privacy/app-specific read scopes verified per field | read low / medium | mostly single-object low-cost queries | distinguish from verify; tests for missing scopes and non-secret output |
| #74 | Online store, checkout, branding | `shopify.content.pages.summary`, `shopify.themes.list`, `shopify.checkout.config.get`, `shopify.checkout.branding.get` | `read_content`, `read_themes`, `read_checkout_and_accounts_configurations`, `read_checkout_branding_settings` | read medium; writes very high | do not fetch theme assets; summarize config only | docs on limitations; tests ensure assets/secrets are not dumped |
| #75 | B2B and retail evaluation | research first; possible future `shopify.b2b.companies.summary` and retail diagnostics | verify plan/resource-specific B2B/POS scopes during research | evaluation / likely sensitive | unknown until workflows are justified | decision note with scope/plan matrix and implement/defer recommendation |
| #76 | Billing and Shopify Payments evaluation | research first; possible safe app-billing status or aggregate payout summary only | verify billing/payment scopes; possible `read_shopify_payments_payouts` and dispute scopes | financial high | avoid transaction exports by default | decision note; no extraction in research issue; finance redaction requirements |
| #77 | Analytics, timeline, ShopifyQL evaluation | `shopify.analytics.sales_summary`, `shopify.timeline.events` as candidates | `read_reports`; customer events may need protected scopes | protected-data candidate | template-only, row/time-window limits, no arbitrary ShopifyQL | research note with implement/defer/out-of-scope decision |
| #78 | Python clients research | docs only | none | design input | no runtime Python subprocess | record lessons for token metadata, redaction, retries, scopes, Shopify CLI, embedded boundaries |
| #79 | Migration docs | migration checklist from Python apps to Hermes OAuth | none | docs | none | docs explain direct-token vs OAuth connector and no Python runtime dependency |
| #80 | ShopifyQL Python SDK/CLI reference | docs only | `read_reports` for future native ShopifyQL | design input | no runtime Python dependency | evaluate package as reference only; feed #90 |
| #81 | Scope parsing/drift | `doctor`/MCP safe scope diagnostics | all configured/granted scopes | policy foundation | low cost; uses local token metadata | tests for implications, missing/extra scopes, reinstall guidance |
| #82 | Retry/throttle/cost | shared Admin GraphQL client telemetry | none directly | foundation | parse `extensions.cost.throttleStatus`, 429/5xx/network retries with bounded backoff | tests for Retry-After, cost extensions, safe errors |
| #83 | operationName / API-version | shared client API support | none directly | foundation | endpoint construction and operationName in every query | tests for central version validation and operationName propagation |
| #84 | Token metadata migration | token-store schema migration | none directly | storage-sensitive | no API cost | migration tests; no token loss; redaction of new secret-like fields |
| #85 | Secret rotation | current and old client secret verification | none directly | security-sensitive | no API cost | HMAC tests current-first/old-second; docs for temporary cleanup |
| #86 | Redaction parity | shared redaction coverage for OAuth/webhook/embedded fields | none directly | security-critical | no API cost | nested key/header/query/body redaction tests |
| #87 | Shopify CLI/TOML docs | docs only | none | docs | none | TOML/callback/scope examples; no secrets in examples |
| #88 | Embedded/token-exchange boundary | design note | future token-exchange scopes TBD | architecture boundary | no API cost | docs say embedded/token exchange is separate from durable offline Hermes tokens |
| #89 | Structured result/error model | shared error/result model | none directly | foundation | no API cost | tests for safe reason codes and no raw response leakage |
| #90 | ShopifyQL gated reports | `shopify.analytics.sales_summary`, `shopify.analytics.top_products` | `read_reports`; protected-data gate where needed | protected-data gated | template-only ShopifyQL, row/time-window limits | disabled by default; tests for missing scope, disabled gate, template allowlist |

## Capability metadata checklist

Each implementation issue should add or verify capability metadata with:

- Capability ID, for example `products.detail.get`.
- Public surfaces: MCP tool, CLI command, or internal-only.
- GraphQL `operationName`.
- Required scopes and whether write scopes imply read scopes for that operation.
- Scope gate behavior and reinstall guidance.
- Safety level: `read_low`, `read_pii`, `read_financial`, `write_medium`, `write_high`, or `protected_data`.
- Write policy: absent, dry-run, confirmation, audit-required, or follow-up-only.
- Pagination strategy: page size, max pages, cursor handling, and nested connection limits.
- Cost strategy: expected cost, max allowed cost, throttle telemetry, and retry behavior.
- Output redaction policy.
- Audit metadata: domain, operation, shop, result, safe reason code, no PII/secrets.
- Docs updates: README, skill text, CLI docs, or MCP tool docs as applicable.
- Tests: registry metadata, missing scopes, pagination/cost, redaction/audit, MCP schema, CLI output, and docs safety tests.

## Closeout decision

The M8 child issues now cover the intended broad Admin GraphQL domains. The implementation order should land #62 and the foundation issues before broad domain tools, then proceed through low-risk read-only surfaces before PII, financial, write-capable, or protected-data domains.
