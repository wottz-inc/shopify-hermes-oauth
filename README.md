# shopify-hermes-oauth

Hermes-first Shopify OAuth connector for agent-safe multi-store access, read-only reporting, guardrails, audit logging, and MCP integration.

This repository is being planned as the native Shopify OAuth access layer for Hermes agents. See [`docs/PRD.md`](docs/PRD.md) for the product requirements, implementation specification, milestones, and v0.1 acceptance criteria.

For practical setup, see [`docs/shopify-app-setup.md`](docs/shopify-app-setup.md). It separates automated CLI/Hermes steps from unavoidable Shopify dashboard and store approval steps. If you already use Shopify CLI, the optional [`docs/shopify-cli-assisted-setup.md`](docs/shopify-cli-assisted-setup.md) runbook automates safe CLI-supported app project/config sync steps while keeping the core connector path CLI-independent; for non-interactive staging/production config deploys with a Shopify App Automation Token, see [`docs/shopify-app-automation-token-ci-cd.md`](docs/shopify-app-automation-token-ci-cd.md). For Python app migrations and cross-language Shopify OAuth/ShopifyQL boundary notes, see [`docs/python-shopify-migration.md`](docs/python-shopify-migration.md); for the embedded-app/session-token boundary, see [`docs/embedded-token-exchange-boundary.md`](docs/embedded-token-exchange-boundary.md). For the M8 Admin GraphQL expansion sequence and safety metadata, see [`docs/admin-graphql-coverage-plan.md`](docs/admin-graphql-coverage-plan.md); for B2B and retail/POS coverage evaluation, see [`docs/b2b-retail-coverage-evaluation.md`](docs/b2b-retail-coverage-evaluation.md); for billing and Shopify Payments coverage evaluation, see [`docs/billing-payments-coverage-evaluation.md`](docs/billing-payments-coverage-evaluation.md); for analytics, timeline events, and ShopifyQL evaluation, see [`docs/analytics-timeline-shopifyql-coverage-evaluation.md`](docs/analytics-timeline-shopifyql-coverage-evaluation.md); for the optional curated ShopifyQL analytics MCP surface, see [`docs/shopifyql-analytics-reports.md`](docs/shopifyql-analytics-reports.md). Reviewers can also find the security notes in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md), the live dev-store validation runbook in [`docs/LIVE_DEV_STORE_VALIDATION.md`](docs/LIVE_DEV_STORE_VALIDATION.md), and the post-review hardening backlog in [`docs/PRD.md`](docs/PRD.md#131-full-repository-review-follow-up-requirements).

Quick dev tunnel helper:

```bash
shopify-hermes-oauth dev --tunnel
```

When `cloudflared` or `ngrok` is available, the helper starts the tunnel first, extracts its public HTTPS URL, then starts the local callback server with that public URL as `--app-url`. It prints the exact Shopify values to copy:

```text
Application URL: <public-url>
Allowed redirection URL: <public-url>/auth/callback
```

If neither tunnel tool is installed, it does not start a misleading local-only OAuth server; it prints the manual `serve --app-url <your-public-https-url>` command to run after exposing the local port.

## Intended positioning

- Use the upstream Hermes `shopify` skill for direct-token Admin GraphQL/curl operations and other single-token/direct-token GraphQL/curl workflows.
- Use `shopify-hermes-oauth` for durable OAuth installs, multi-store access, curated MCP tools, read-only reports, and guarded future write operations.

## v0.1 principles

- Hermes-native: uses `HERMES_HOME`, `~/.hermes/.env`, `hermes mcp add`, and an optional Hermes skill.
- Minimal human setup: automate everything except unavoidable Shopify app creation/callback approval/store install approval.
- Read-only by default.
- Least-privilege default OAuth scopes for v0.1 reports/MCP: `read_products`, `read_orders`, `read_inventory`, and `read_locations`. Curated customer, webhook, fulfillment-order, discount, marketing-event, markets, locale, privacy-policy diagnostics, and optional ShopifyQL analytics tools additionally require `read_customers` / `read_webhooks` / fulfillment-order read scopes / `read_discounts` / `read_marketing_events` / `read_markets` / `read_locales` / `read_content` / `read_reports` on stores where enabled; ShopifyQL analytics also requires `SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true` plus protected customer data / analytics approval and shop reauthorization.
- Required Admin API Scopes are the Shopify app scopes that grant Admin API access for OAuth installs. Optional scopes are not a substitute for required Admin API scopes; optional-only app configuration can fail the callback with Shopify's `At least one scope is required` validation.
- Use the store's canonical Admin `*.myshopify.com` domain for `/auth/start?shop=...`. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.
- No required private infrastructure, hosted forge, hosted service, or third-party secret manager.
- No raw write-capable Shopify Admin GraphQL exposed to agents.

## Bitwarden Secrets Manager mode

For VPS/chat-first Hermes deployments, prefer Hermes Bitwarden Secrets Manager instead of pasting Shopify credentials into chat or storing real secrets in `.env`. Store these variable names as Bitwarden project secrets: `SHOPIFY_HERMES_CLIENT_ID`, `SHOPIFY_HERMES_CLIENT_SECRET`, and `SHOPIFY_HERMES_APP_URL`; status output should list variable names only. Do not paste Shopify client secrets into chat. Do not write secrets back to `.env` when using Bitwarden mode.

Configure Hermes Bitwarden Secrets Manager with your `BWS_PROJECT_ID`; for a self-hosted Bitwarden endpoint include `--server-url <https://bitwarden.example.com>` when running the Hermes Bitwarden setup command. Then verify and load/sync secrets before launching the connector:

```bash
hermes secrets bitwarden status
hermes secrets bitwarden sync
shopify-hermes-oauth doctor
```

If `doctor` reports missing Shopify connector variables while Hermes Bitwarden Secrets Manager is enabled, launch the connector from Hermes after secrets are loaded or rerun the Bitwarden `status`/`sync` commands. It should never print secret values.

## Chat-safe credential handoff

When Bitwarden mode is not used and an agent needs the user to enter Shopify app credentials, use a chat-first handoff instead of asking for secrets. The agent sends this exact command:

```bash
shopify-hermes-oauth credentials set
```

Run this command in your local terminal or SSH/Termius shell, not in chat: `shopify-hermes-oauth credentials set`. The command prompts for the Shopify client ID and hides the client secret while you type. It updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`, preserves unrelated `.env` lines, and chmods `.env` to `0600`.

After it succeeds, reply `done` in chat without sharing the client ID or client secret. Do not paste Shopify client secrets into chat.

## Shopify app client secret rotation

During Shopify app client secret rotation, configure the new value as `SHOPIFY_HERMES_CLIENT_SECRET` and temporarily configure the previous value as `SHOPIFY_HERMES_OLD_CLIENT_SECRET`. OAuth callback HMAC validation tries the current secret first and then the old secret when present, without logging or reporting which secret matched. Optionally record a safe non-secret timestamp such as `SHOPIFY_HERMES_OLD_CLIENT_SECRET_ROTATED_AT=2026-05-20T00:00:00.000Z`; `shopify-hermes-oauth doctor` uses it to remind operators how long the fallback has been configured. Remove `SHOPIFY_HERMES_OLD_CLIENT_SECRET` after the transition window and rerun `shopify-hermes-oauth doctor` to confirm the rotation fallback is disabled.

Do not commit, print, or paste either client secret. If using Bitwarden mode, store both variable names as secrets for the temporary overlap and delete `SHOPIFY_HERMES_OLD_CLIENT_SECRET` from Bitwarden after cleanup.

## Guided chat-first onboarding

Use the guided checklist command to reduce decisions and copy/paste during live onboarding:

```bash
shopify-hermes-oauth onboard --shop finbobaggins.myshopify.com --app-name hermes-oauth
```

Example chat transcript:

```text
User: Set up Shopify OAuth for finbobaggins.myshopify.com.
Agent: I will run the safe checklist/status command.
Agent runs: shopify-hermes-oauth onboard --shop finbobaggins.myshopify.com --app-name hermes-oauth
CLI: Agent can do:
CLI:   shopify-hermes-oauth init
CLI:   shopify-hermes-oauth doctor
CLI:   shopify-hermes-oauth hermes install
CLI:   shopify-hermes-oauth dev --tunnel
CLI:   shopify-hermes-oauth credentials set
CLI: Human must do in Shopify:
CLI:   App name: hermes-oauth
CLI:   Application URL: https://<public-app-url>
CLI:   Allowed redirection URL: https://<public-app-url>/auth/callback
CLI:   Install URL: https://<public-app-url>/auth/start?shop=finbobaggins.myshopify.com
Agent: Please enter the Client ID and Client secret only in the local `shopify-hermes-oauth credentials set` prompt, then open `/auth/start?shop=finbobaggins.myshopify.com` on the public app URL.
User: done
Agent runs: shopify-hermes-oauth shops verify finbobaggins.myshopify.com
```

The onboarding command never prints Shopify client secrets or token-store contents. Re-running it is safe and idempotent: it reports current state such as missing config, configured tunnel/app URL, MCP configured/not configured, no shops installed, or the target shop installed locally.

## Safe shop diagnostics

Use diagnostics when you need more than token verification without exposing secrets:

```bash
shopify-hermes-oauth shops diagnostics <shop>
```

The command and MCP tool `shopify.store.diagnostics` return curated store/app/access JSON: safe shop properties, current app install status/title/handle, access-scope handles, configured-vs-granted scope drift, and privacy policy presence/title/URL only when `read_content` is granted. Without `read_content`, privacy returns `missing_scope` and policy fields are not queried. Diagnostics never return token-store contents, OAuth callback data, raw GraphQL, owner/contact/billing/customer data, policy bodies, writes, or mutations.

## Curated online store, checkout, and branding visibility

The MCP allowlist includes `shopify.online_store.summary` for bounded read-only storefront configuration visibility. It validates stored OAuth scopes before scoped calls: themes require `read_themes`, while pages/blogs require `read_content`; missing scopes return structured `missing_scope` statuses instead of probing unavailable fields.

The tool returns at most 5 theme summaries (`id`, `name`, `role`, timestamps) and at most 10 page/blog summaries (`id`, `title`, `handle`, visibility/timestamps where available), with `truncated`/`pageInfo` when more records exist. It intentionally omits theme assets, templates, liquid/HTML/body content, scripts, raw Admin GraphQL input, checkout writes, and branding writes. Checkout, customer account, and checkout branding configuration are reported as structured documented limitations when they are not safely available through the curated read-only Admin GraphQL surface.

## Local/source install and PATH diagnostics

For a source checkout, prefer packaging the same artifact shape that npm publishes instead of relying on `npm link` behavior:

```bash
npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz
```

Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell. If a plain SSH/Termius shell says `shopify-hermes-oauth: command not found`, either add the profile-local bin directory to that shell PATH:

```bash
export PATH="$HERMES_HOME/node/bin:$PATH"
```

or install globally from the source package with the `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz` command above. Run `shopify-hermes-oauth doctor`; if it prints `Connector CLI: installed but not on PATH`, use the PATH export it prints or add an equivalent shell/profile wrapper.

## Token-store lock waits

Local token-store writes use an owner-only lock file. The default lock-acquisition timeout is 10 seconds so interactive CLI commands fail promptly when another process leaves an active or unrecoverable lock behind. Batch jobs or tests that need longer waits can override this through the local file dependency hook (`lockTimeoutMs`) while retaining the same stale-lock recovery behavior.

## Dependency hygiene

CI runs `npm audit --audit-level=high` after `npm ci` so high, critical, or worse dependency advisories fail the build while non-actionable low/moderate advisories remain non-blocking. `npm outdated` is an informational local maintenance check for reviewers and maintainers; it is not a blocking CI gate because new package releases alone do not imply an actionable or deterministic failure.

## Curated webhook subscription tools

The MCP allowlist includes read-only webhook subscription tools:

- `shopify.webhooks.list` — list webhook subscriptions with bounded pagination (`first` defaults to 50 and is capped at 100; `after` accepts a Shopify cursor).
- `shopify.webhooks.get` — inspect one webhook subscription by Shopify GID.

These tools require a stored token with `read_webhooks`. Create/update/delete webhook flows remain intentionally absent from the public MCP surface until they have dry-run, explicit confirmation, audit logging, and rollback notes. Webhook payload handling must validate Shopify HMACs with official Shopify helpers where practical, reject stale/replayed deliveries idempotently, redact callback URLs/secrets in logs, and handle delivery failures without leaking tokens or customer payloads.


## Curated product and collection lookup tools

`shopify.report_products` remains the aggregate report/export surface. The MCP allowlist also includes read-only lookup/detail tools for targeted catalog inspection:

- `shopify.products.get` — inspect one product by stable `gid://shopify/Product/...` ID, including safe catalog fields, publication status, options, and bounded variants/media/metafield metadata.
- `shopify.collections.list` — list/search collections with explicit Shopify collection search semantics (`query` is a search string, not GraphQL) and bounded pagination (`first` defaults to 25 and is capped at 50).
- `shopify.collections.get` — inspect one collection by stable `gid://shopify/Collection/...` ID with bounded product and metafield metadata previews.

These tools require `read_products`. They are curated read-only surfaces: no raw Admin GraphQL input, product/collection mutations, or unbounded nested pagination are exposed. Metafield output intentionally returns namespace/key/type plus value presence/length metadata, not raw metafield values.

## Curated location and inventory lookup tools

`shopify.report_inventory` remains the aggregate inventory report surface. The MCP allowlist also includes read-only location and inventory lookup/detail tools:

- `shopify.locations.list` — list locations with bounded pagination (`first` defaults to 25 and is capped at 50).
- `shopify.locations.get` — inspect one location by stable `gid://shopify/Location/...` ID.
- `shopify.inventory.items.get` — inspect one inventory item by stable `gid://shopify/InventoryItem/...` ID with minimal product variant context.
- `shopify.inventory.levels.list` — list inventory levels by exactly one inventory item or location; it requires exactly one of `inventoryItemId` or `locationId`, uses stable IDs such as `gid://shopify/Location/123` and `gid://shopify/InventoryItem/123`, and defaults to 25 and is capped at 50.

Location list/get requires `read_locations`; inventory item get requires `read_inventory`; inventory level list requires `read_inventory` and `read_locations`. These curated tools pass IDs and cursors via variables, omit location addresses, phone/contact fields, metafields, and inventory adjustment history, and do not audit raw IDs, cursors, SKUs, location names, or quantity values.


## Curated order detail lookup tool

`shopify.report_orders` remains the aggregate/windowed report surface. The MCP allowlist also includes one read-only order lookup/detail tool:

- `shopify.orders.get` — inspect one order by stable `gid://shopify/Order/...` ID or bounded Shopify order name such as `#1001`, with minimized PII and bounded line item, fulfillment, and refund summaries.

This tool requires `read_orders`; Shopify may require `read_all_orders` for older orders outside the normal API read window, but that scope is not part of the default v0.1 install. Returned order detail intentionally omits customer identity/contact fields, billing/shipping addresses, notes, tags, tracking numbers/URLs, and transactions. Audit metadata records only shop/tool and whether ID or name input was present, not the raw order ID/name.

## Curated fulfillment order visibility tools

The MCP allowlist includes focused read-only fulfillment order visibility tools:

- `shopify.fulfillment_orders.list` — list fulfillment orders for exactly one order by `orderId` (`gid://shopify/Order/123`) or safe `orderName` such as `#1001`; `first` defaults to 25 and is capped at 50.
- `shopify.fulfillment_orders.get` — inspect one fulfillment order by stable `gid://shopify/FulfillmentOrder/123` ID.

These tools require `read_orders` plus `read_merchant_managed_fulfillment_orders`, `read_assigned_fulfillment_orders`, and `read_third_party_fulfillment_orders` when enabled. They return only safe fulfillment order visibility fields: `id`, `status`, `requestStatus`, optional delivery method type, optional assigned location ID/name, line item `id`/`totalQuantity`/`remainingQuantity` capped at 25, and pageInfo. Destination address, tracking numbers/URLs, customer contact, notes/tags, metafields, transactions, raw Admin GraphQL input, and all mutations are intentionally omitted.

## Curated customer tools

The MCP allowlist includes read-only, privacy-aware customer tools:

- `shopify.customers.list` — list/search customers with explicit Shopify customer search semantics (`query` is a search string, not GraphQL), bounded pagination (`first` defaults to 25 and is capped at 50), and safe aggregate summaries.
- `shopify.customers.get` — inspect one customer by stable `gid://shopify/Customer/...` ID.

These tools require `read_customers`. Returned customer fields intentionally minimize PII: full email is reduced to `emailDomain`, phone is reduced to `phonePresent`, addresses/notes/tags/full email/full phone are not returned, and audit metadata records only shop, tool name, page bounds, and whether query/cursor inputs were present. Tag, note, metafield, or other customer updates are intentionally out of scope for this read-only surface.

## Curated discounts and marketing event tools

The MCP allowlist includes read-only discounts/marketing visibility:

- `shopify.discounts.list` — list/search discounts with bounded pagination (`first` defaults to 25 and is capped at 50), safe fields, `codesCount.count` only, and aggregate summary counts.
- `shopify.discounts.get` — inspect one `gid://shopify/DiscountNode/...` by stable ID with safe summary fields only.
- `shopify.marketing_events.list` — list/search marketing events with shallow fields and bounded pagination (`first` defaults to 25 and is capped at 50).

Discount tools require `read_discounts`; marketing event tools require `read_marketing_events`. Individual discount codes, customer/order data, usage attribution, customerSelection details, customer/order/conversion attribution, raw Admin GraphQL input, and all mutations are intentionally omitted. Marketing event `manageUrl`/`previewUrl` query strings are redacted before output. Audit metadata records only shop/tool, `first`, and whether query/cursor or discount ID inputs were present, not raw IDs, cursors, titles, codes, or URLs.

## Curated markets and localization tools

The MCP allowlist includes read-only market/localization summary tools:

- `shopify.markets.list` — list Shopify Markets with bounded pagination (`first` defaults to 25 and is capped at 50), shallow market fields, base currency summary, and up to 10 region summaries per market with `regionsTruncated` when more regions exist.
- `shopify.localization.locales.list` — list shop locales with locale/name/primary/published status only; no translations, market-localized content, or raw Admin GraphQL input.

Markets require `read_markets`; locales require `read_locales`. Shopify may gate these Admin APIs by plan, Markets feature availability, API version, and app-scope approval. If Shopify returns an unsupported/permission/schema response, the helper returns `supported: false` with a documented `limitation` object instead of raw GraphQL errors. Empty stores return `supported: true` with empty arrays and zero counts. Audit metadata records only shop/tool, support status, counts, caps, and bounded pagination flags, not raw cursors or region/currency details.

## Curated custom data tools

The MCP allowlist includes read-only custom data schema/value summary tools. These differ from standard reports: reports summarize common Shopify objects for broad operational answers, while custom data tools expose store-specific metafield/metaobject schemas plus bounded value presence/length for targeted questions about merchant-defined data.

- `shopify.metafield_definitions.list` / `shopify.metafield_definitions.get` — inspect metafield definitions by required `ownerType` and optional/required `namespace` and `key`.
- `shopify.resource_metafields.list` — list metafields for one supported resource GID with optional `namespace`/`key` filters.
- `shopify.metaobject_definitions.list` / `shopify.metaobject_definitions.get` — inspect metaobject definitions by type with bounded field definition summaries.
- `shopify.metaobjects.list` / `shopify.metaobjects.get` — inspect metaobjects of one type or one Metaobject GID with schema-aware field value presence/length only.

Metafield namespace/key, owner type, metaobject type, and GID inputs are strictly validated. List tools default to 25 and cap `first` at 50. The tools use curated queries only: no unrestricted raw Admin GraphQL MCP tool, no writes/mutations, no `jsonValue`, no unbounded nested pagination, and safe non-secret errors/audit metadata. Metafield definition/resource metafield tools currently require `read_products`; metaobject definition tools require `read_metaobject_definitions`; metaobject value tools require `read_metaobjects`.

## Curated bulk export tools

The MCP allowlist includes template-only read-oriented Shopify Admin GraphQL bulk operation helpers for large exports:

- `shopify.bulk.start` — start one approved template (`products-basic`, `orders-basic`, or `inventory-items-basic`) after validating the template's required scopes.
- `shopify.bulk.status` — poll `currentBulkOperation` and return status, counts, failure code, redacted result URL paths, and opaque result handles when Shopify provides result URLs.
- `shopify.bulk.result` — fetch a bounded HTTPS JSONL preview from a Shopify bulk result URL or opaque `bulk-result:` handle using explicit `maxLines` / `maxBytes` limits. Prefer the opaque handle returned by status/cancel responses; raw signed Shopify URLs are accepted only for direct operator-supplied previews and are never echoed with query strings.
- `shopify.bulk.cancel` — cancel a running read-only bulk operation by BulkOperation GID.

These tools do not expose arbitrary raw GraphQL input. Result previews are bounded and sanitized before returning through MCP structured content. Opaque result handles are process-local, expire after 15 minutes, and are capped to avoid retaining signed result URLs indefinitely.

## Nested connection limits

v0.1 report and lookup queries intentionally avoid unbounded nested pagination. The products report shows at most the first 100 variants per product, and the orders report shows at most the first 50 line items per order; both summaries explicitly say when additional nested records were omitted. The inventory report fails rather than silently truncating when a product has more than 100 variants or a variant has more than 50 inventory levels, and its error identifies the affected product/variant/inventory item GID where safe. Product detail lookup caps variants at 25, media at 10, and metafield metadata at 20; collection list caps page size at 50; collection detail caps products at 25 and metafield metadata at 20; inventory location and level lookups default to 25 and cap page size at 50; order detail caps line items at 25, fulfillments at 10, and refunds at 10; fulfillment order lists cap page size at 50 and fulfillment order line items at 25. If a store hits these ceilings, narrow the report or lookup scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports or lookup surfaces.

## Documentation test maintenance

Documentation tests use explicit `SAFETY-CRITICAL` names for non-negotiable contracts: no pasted tokens/secrets, no private infrastructure terms, exact public command/tool names, least-privilege scope guidance, and nested connection limit guidance. Do not delete or weaken those assertions for copy edits; update the docs so the safety contract remains true. Tests named `copy-polish` cover broad editorial structure or positioning and may be adjusted when wording changes without changing the safety posture.
