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

- The v0.1 MCP allowlist is exactly:
  - `shopify.list_shops`
  - `shopify.verify_shop`
  - `shopify.report_products`
  - `shopify.report_orders`
  - `shopify.report_inventory`
- No raw Admin GraphQL MCP tool is exposed.
- No mutation/write MCP tools are exposed for refunds, deletes, fulfilment, product updates, or arbitrary GraphQL.
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
