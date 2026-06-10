# Security review for v0.1

Date: 2026-05-23  
Scope: GitHub issue #18, "Complete security review and secret-leak test pass"

## Methodology

Reviewed the connector against `docs/PRD.md`, with focus on agent safety and credential leakage before the v0.1 release. The review covered source, tests, docs, and the Hermes skill.

Searches performed included:

- `token|secret|authorization|access_token|client_secret|graphql|mutation|audit|redact|HMAC|hmac|state`
- `raw_graphql|mutate|mutation|delete_shop|refund|admin graphql|Admin GraphQL|accessToken|access_token|clientSecret|client_secret|Authorization|X-Shopify-Access-Token|shpat_|Bearer`
- private/project-specific terms that should not appear in the public connector docs/skill, including private infrastructure and secret-manager names called out in prior review guidance.

The remaining token-like strings found in tests are synthetic fixtures such as `shpat_never_print_me` and `shpss_super_secret_value`. No live Shopify credentials were used.

## OAuth state and HMAC findings

Reviewed `src/server.ts`, `src/oauth/state-store.ts`, and the OAuth/CLI tests.

Findings:

- `/auth/start` normalizes and validates `<shop>.myshopify.com` domains before redirecting to Shopify.
- The OAuth start URL includes `client_id`, requested scopes, callback URL, and opaque state; it does not include the client secret or access tokens.
- Callback handling validates required `shop`, `code`, `state`, `timestamp`, and `hmac` parameters.
- HMAC validation now delegates OAuth callback query verification to the official `@shopify/shopify-api` helper (`shopify.utils.validateHmac(..., { signator: 'admin' })`) instead of maintaining project-owned callback signing/comparison crypto.
- Stale callbacks are rejected before state consumption or token exchange.
- State is consumed before token exchange, and a shop mismatch between state and callback rejects the install.
- Error responses are generic (`Invalid OAuth callback`) and do not echo callback parameters, tokens, HMACs, or client secrets.

Notes/residual risk:

- The prior project-owned OAuth callback HMAC implementation has been removed. Callback ordering remains explicit: required parameters and local stale timestamp checks run before official HMAC validation; invalid HMACs reject before state consumption, token exchange, or token storage; state remains single-use; shop mismatch and other callback failures continue to return the same generic response.

## MCP allowlist and read-only posture

Reviewed `src/mcp/server.ts`, `test/mcp-server.test.ts`, the skill, and PRD.

Findings:

- The MCP allowlist is curated and read-oriented. The current full MCP tool surface is generated from `CAPABILITY_REGISTRY` metadata in `src/capabilities.ts`; keep this marked block in sync when registry metadata changes:

<!-- MCP_TOOL_SURFACE_START -->
- `shopify.health`
- `shopify.list_shops`
- `shopify.verify_shop`
- `shopify.store.diagnostics`
- `shopify.online_store.summary`
- `shopify.b2b.companies.summary`
- `shopify.b2b.catalogs.summary`
- `shopify.report_products`
- `shopify.report_orders`
- `shopify.report_inventory`
- `shopify.analytics.shopifyql.summary`
- `shopify.bulk.start`
- `shopify.bulk.status`
- `shopify.bulk.result`
- `shopify.bulk.cancel`
- `shopify.webhooks.list`
- `shopify.webhooks.get`
- `shopify.products.get`
- `shopify.collections.list`
- `shopify.collections.get`
- `shopify.locations.list`
- `shopify.locations.get`
- `shopify.inventory.items.get`
- `shopify.inventory.levels.list`
- `shopify.orders.get`
- `shopify.fulfillment_orders.list`
- `shopify.fulfillment_orders.get`
- `shopify.customers.list`
- `shopify.customers.get`
- `shopify.discounts.list`
- `shopify.discounts.get`
- `shopify.marketing_events.list`
- `shopify.markets.list`
- `shopify.localization.locales.list`
- `shopify.metafield_definitions.list`
- `shopify.metafield_definitions.get`
- `shopify.resource_metafields.list`
- `shopify.metaobject_definitions.list`
- `shopify.metaobject_definitions.get`
- `shopify.metaobjects.list`
- `shopify.metaobjects.get`
<!-- MCP_TOOL_SURFACE_END -->

- Higher-sensitivity read surfaces remain intentionally gated by scopes/feature flags where applicable; for example, `shopify.analytics.shopifyql.summary` requires `read_reports`, protected customer data / analytics approval, and `SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true`.
- No raw Admin GraphQL, REST, or ShopifyQL MCP tool is exposed.
- No merchant-data write MCP tools are exposed for refunds, deletes, fulfilment, product updates, or arbitrary GraphQL. Bulk lifecycle tools use constrained Admin GraphQL mutations only to start/cancel curated read-only export templates; they do not expose arbitrary GraphQL or mutate merchant records.
- Unknown/write-like tools such as `shopify.raw_graphql`, mutation-like names, refund/delete examples, and unknown tools fail closed with `Tool is not allowed.`
- Tool argument validation rejects extra/raw GraphQL/mutation-looking arguments per tool.
- MCP audit metadata records only safe operational fields: source, actor, read-only mode, tool name, optional shop, format, threshold, and generic reason. It does not audit customer/order/report rows, raw GraphQL, tokens, authorization headers, or token-store values.
- Tool outputs are sanitized recursively to remove token/authorization-like keys. `list_shops` summarizes non-secret token-store metadata only.

## Output, audit, and redaction findings

Reviewed `src/audit.ts`, `src/shopify/admin-client.ts`, `src/shops/verify.ts`, CLI/report tests, and existing redaction tests.

Findings:

- Audit events are canonicalized before writing to avoid accessor/toJSON time-of-check/time-of-use leaks.
- Audit metadata must be JSON-compatible plain data. Functions, accessors, circular data, non-finite numbers, symbols, class instances, maps/sets, dates, and non-JSON values are rejected.
- Audit writes refuse secret-like keys and secret-like values before any line is appended, including embedded Shopify token substrings and serialized JSON-like strings with quoted camelCase secret keys in otherwise innocuous fields.
- Audit files are created/corrected with owner-only permissions where supported and symlink audit paths are rejected when the platform supports `O_NOFOLLOW`.
- Service-boundary Admin GraphQL errors redact sensitive JSON keys/values, Shopify token formats, authorization headers, cookies, and token-ish fields before surfacing messages.
- CLI and MCP tests assert that token-bearing dependency errors and token-store values are not printed or audited.

Gaps fixed in this pass:

- Added a regression test and production fix so audit payloads reject authorization header strings even when the field name is innocuous, e.g. a `value` field containing `X-Shopify-Access-Token: ...`.
- Added a regression test and production fix so raw JSON-like strings with camelCase secret keys such as `clientSecret` are redacted by `redactSensitiveText`.

## Token/secret leakage review result

No known token printing paths remain after this pass.

Known intentional storage path:

- The local token store persists access tokens in the configured Hermes data directory. This is expected connector behavior and is covered by file permission tests. Token-store contents must not be printed, audited, committed, or included in docs/issues.

## Residual risks and out-of-scope items

- Live Shopify credential testing is out of scope for unit tests and was not performed.
- The default local JSON token store relies on host filesystem security and owner-only permissions; teams with stronger requirements can add a pluggable external secret store later.
- Report outputs intentionally contain read-only Shopify business data. The security goal is to avoid secrets/tokens and raw write tools; downstream users still need to handle report data according to their own data policies.
- OAuth callback HMAC verification now uses Shopify's official helper. Live Shopify credential testing remains out of scope for unit tests and should follow the redacted live validation runbook when performed.

## Full-repository review addendum — 2026-05-23

A later full repository review found no critical security blockers and no known token-leak path, but it identified several hardening items that affect the security/design specification. These are tracked in [M7 — full-repository review follow-ups](https://github.com/wottz-inc/shopify-hermes-oauth/milestone/7).

Security-relevant follow-ups:

- [#33](https://github.com/wottz-inc/shopify-hermes-oauth/issues/33): make CSV formula-injection neutralization a shared helper and cover leading-whitespace formulas in products/orders/inventory reports.
- [#34](https://github.com/wottz-inc/shopify-hermes-oauth/issues/34): make MCP audit-string sanitization call the canonical sensitive-text redactor before truncation.
- [#35](https://github.com/wottz-inc/shopify-hermes-oauth/issues/35): catch unexpected OAuth HTTP route failures so malformed requests or socket edge cases cannot surface as unhandled rejections.
- [#36](https://github.com/wottz-inc/shopify-hermes-oauth/issues/36): re-normalize the shop domain inside token exchange before constructing the Shopify token URL.
- [#38](https://github.com/wottz-inc/shopify-hermes-oauth/issues/38): consolidate strict plain-object checks for JSON/audit/MCP paths.
- [#40](https://github.com/wottz-inc/shopify-hermes-oauth/issues/40): make OAuth timestamp freshness arithmetic avoid unsafe multiplication for adversarially large values.
- [#42](https://github.com/wottz-inc/shopify-hermes-oauth/issues/42): cap configured scope-list length before building OAuth URLs.
- [#47](https://github.com/wottz-inc/shopify-hermes-oauth/issues/47): keep OAuth HTTP test seams out of production/public exports.

Operational and maintainability follow-ups from the same review are tracked in [#37](https://github.com/wottz-inc/shopify-hermes-oauth/issues/37), [#39](https://github.com/wottz-inc/shopify-hermes-oauth/issues/39), [#41](https://github.com/wottz-inc/shopify-hermes-oauth/issues/41), [#43](https://github.com/wottz-inc/shopify-hermes-oauth/issues/43), [#44](https://github.com/wottz-inc/shopify-hermes-oauth/issues/44), [#45](https://github.com/wottz-inc/shopify-hermes-oauth/issues/45), and [#46](https://github.com/wottz-inc/shopify-hermes-oauth/issues/46). They do not change the v0.1 no-raw-GraphQL/no-write-MCP posture, but they should be addressed before treating the connector as polished for broader release.
