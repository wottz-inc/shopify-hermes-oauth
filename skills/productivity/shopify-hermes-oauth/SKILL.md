---
name: shopify-hermes-oauth
description: Shopify OAuth setup/reports/MCP.
version: 0.1.0
author: Nous Research
license: MIT
metadata:
  hermes:
    tags: [shopify, oauth, mcp, ecommerce, reports]
    related_skills: [shopify]
---

# OAuth
OAuth setup/reports/MCP. Prefer direct-token `shopify` for one-off GraphQL.

## Safety

- Do not ask users to paste Shopify access tokens into chat.
- Do not ask users to paste Shopify client secrets into chat.
- No printing OAuth secrets/tokens; MCP read-only.
- Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.
- Verify target shop before reports/MCP.
- Use canonical Admin `*.myshopify.com` domain. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.

## Setup

Onboard

```bash
shopify-hermes-oauth onboard --shop <shop>.myshopify.com --app-name <app-name>
```

Output has `Agent can do:` and `Human must do in Shopify:`.
Run

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
shopify-hermes-oauth hermes install
```

`init` writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks config; `hermes install` registers `mcp serve`.

`shopify-hermes-oauth credentials set`; the agent sends the exact command, the user runs it locally or over SSH/Termius, then replies `done` without sharing secrets. It hides the client secret while typing and updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`.

Hermes Bitwarden Secrets Manager: `BWS_PROJECT_ID`, `--server-url`, `hermes secrets bitwarden status`, `hermes secrets bitwarden sync`. Do not write secrets back to `.env`.

App Automation Token CI/CD: use `SHOPIFY_APP_AUTOMATION_TOKEN`; see `docs/shopify-app-automation-token-ci-cd.md`.

Install: `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz`. Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell; `export PATH="$HERMES_HOME/node/bin:$PATH"`. `Connector CLI: installed but not on PATH`.

OAuth:
```bash
shopify-hermes-oauth dev --tunnel
# or
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>
```

Set Application URL and `<public-https-url>/auth/callback`; install via `/auth/start?shop=<shop>.myshopify.com`.

## Shops
```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>
shopify-hermes-oauth shops diagnostics <shop>
```

If verification fails, report connector error; do not ask for raw tokens. Diagnostics: safe store/app/access/privacy JSON; policy title/URL needs `read_content`, else `missing_scope`.

## Reports
```bash
shopify-hermes-oauth report products <shop> --format markdown
shopify-hermes-oauth report orders <shop> --since 30d --format markdown
shopify-hermes-oauth report inventory <shop> --format markdown
```

## Limits

Products report: shows at most the first 100 variants per product. Orders report: shows at most the first 50 line items per order. Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels.

Lookup caps: product variants 25, media 10, metafield metadata 20; collection page 50/detail products 25/metafields 20; inventory locations/levels page 50; inventory levels require exactly one of inventoryItemId or locationId; order line items 25, fulfillments 10, refunds 10; online store themes 5/pages+blogs 10; markets page 50/regions 10; custom data page 50. Metafields expose namespace/key/type plus value presence/length, not raw values. `shopify.orders.get` omits customer contact/address, notes/tags, tracking numbers/URLs, and transactions. If limits hit, narrow the scope or use Shopify bulk inventory export.

## MCP
Full MCP tool surface from `CAPABILITY_REGISTRY` (`src/capabilities.ts`); drift test keeps this block synced.
<!-- MCP_TOOL_SURFACE_START -->
`shopify.health`,`shopify.list_shops`,`shopify.verify_shop`,`shopify.store.diagnostics`,`shopify.online_store.summary`,`shopify.b2b.companies.summary`,`shopify.b2b.catalogs.summary`,`shopify.report_products`,`shopify.report_orders`,`shopify.report_inventory`,`shopify.analytics.shopifyql.summary`,`shopify.bulk.start`,`shopify.bulk.status`,`shopify.bulk.result`,`shopify.bulk.cancel`,`shopify.webhooks.list`,`shopify.webhooks.get`,`shopify.products.get`,`shopify.collections.list`,`shopify.collections.get`,`shopify.locations.list`,`shopify.locations.get`,`shopify.inventory.items.get`,`shopify.inventory.levels.list`,`shopify.orders.get`,`shopify.fulfillment_orders.list`,`shopify.fulfillment_orders.get`,`shopify.customers.list`,`shopify.customers.get`,`shopify.discounts.list`,`shopify.discounts.get`,`shopify.marketing_events.list`,`shopify.markets.list`,`shopify.localization.locales.list`,`shopify.metafield_definitions.list`,`shopify.metafield_definitions.get`,`shopify.resource_metafields.list`,`shopify.metaobject_definitions.list`,`shopify.metaobject_definitions.get`,`shopify.metaobjects.list`,`shopify.metaobjects.get`.
<!-- MCP_TOOL_SURFACE_END -->

Diagnostics: no tokens, raw GraphQL, owner/contact/billing/customer data, policy bodies, or merchant writes. Analytics needs `read_reports`, protected customer data / analytics approval, and `SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true`. Bulk: curated read-only export templates only; no arbitrary GraphQL. B2B needs `read_companies`/`read_products`; no contacts, addresses, external IDs, notes, payment terms, or full exports. Webhooks `read_webhooks`; customers `read_customers`; shopify.discounts.list/get `read_discounts`; marketing `read_marketing_events`; markets/locales `read_markets`/`read_locales`; metaobjects `read_metaobject_definitions`/`read_metaobjects`. Custom data gives bounded schema/value-presence only.
