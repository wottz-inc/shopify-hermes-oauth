---
name: shopify-hermes-oauth
description: Shopify OAuth connector for Hermes: setup, verification, reports, MCP tools, and direct-token use.
version: 0.1.0
author: Nous Research
license: MIT
metadata:
  hermes:
    tags: [shopify, oauth, mcp, ecommerce, reports]
    related_skills: [shopify]
---

# OAuth

Use for Shopify OAuth app installs, multi-store access, reports, MCP, or durable workflows. Prefer direct-token `shopify` for one-off GraphQL/curl.

## Safety rules

- Do not ask users to paste Shopify access tokens into chat.
- Do not ask users to paste Shopify client secrets into chat.
- Do not print OAuth secrets, access tokens, or token stores; keep operations read-only unless requested through a safe command or MCP tool.
- Default OAuth installs should request only the v0.1 least-privilege Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.
- Verify the target shop before reports or MCP calls.
- Use the canonical Admin `*.myshopify.com` domain; do not guess store domains from brand names. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.

## Setup and health checks

For chat-first onboarding, start with:

```bash
shopify-hermes-oauth onboard --shop <shop>.myshopify.com --app-name <app-name>
```

Output has `Agent can do:` and `Human must do in Shopify:` without secrets.

Run:

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
shopify-hermes-oauth hermes install
```

`init` writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks config. `hermes install` registers `mcp serve`.

Non-Bitwarden: `shopify-hermes-oauth credentials set`; the agent sends the exact command, the user runs it locally or over SSH/Termius, then replies `done` without sharing secrets. It hides the client secret while typing and updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`.

For VPS/chat-first use Hermes Bitwarden Secrets Manager: set `BWS_PROJECT_ID` (and `--server-url` if self-hosting), run `hermes secrets bitwarden status`, `hermes secrets bitwarden sync`, then `doctor`. Do not write secrets back to `.env`.

Source installs: `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz`. Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell; use `export PATH="$HERMES_HOME/node/bin:$PATH"`. If `Connector CLI: installed but not on PATH`, use its PATH fix.

OAuth callback setup:

```bash
shopify-hermes-oauth dev --tunnel
```

With your own tunnel, run:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>
```

Configure Application URL and `<public-https-url>/auth/callback`; install via `/auth/start?shop=<shop>.myshopify.com` while running.

## Shop verification

Before data reads:

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>
```

If verification fails, report the connector error. Do not ask for raw tokens.

## Read-only reports

```bash
shopify-hermes-oauth report products <shop> --format markdown
shopify-hermes-oauth report orders <shop> --since 30d --format markdown
shopify-hermes-oauth report inventory <shop> --format markdown
```

Prefer Markdown for summaries, JSON for tooling; avoid unnecessary customer details.

## Limits

v0.1 ceilings:

- Products report: shows at most the first 100 variants per product and marks omitted variants.
- Orders report: shows at most the first 50 line items per order and marks omitted line items.
- Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels.

Use `shopify.products.get`, `shopify.collections.list/get`, `shopify.locations.list/get`, `shopify.inventory.items.get`, `shopify.inventory.levels.list`, `shopify.orders.get`, and `shopify.fulfillment_orders.list/get` for targeted lookups. Lookup caps: product variants 25, media 10, metafield metadata 20; collection page 50/detail products 25/metafields 20; inventory locations/levels page 50; inventory levels require exactly one of inventoryItemId or locationId; order line items 25, fulfillments 10, refunds 10; fulfillment order page 50 and line items 25. Metafields expose namespace/key/type plus value presence/length, not raw values. Inventory lookups omit location address/contact fields, metafields, and adjustment history. `shopify.orders.get` omits customer contact/address, notes/tags, tracking numbers/URLs, and transactions. `shopify.fulfillment_orders.list/get` omits destination address, tracking numbers/URLs, customer contact, notes/tags, metafields, and transactions. If limits hit, narrow the scope or use a custom paginated Shopify Admin GraphQL workflow.

## MCP tools

After `shopify-hermes-oauth hermes install`, MCP tools:

- `shopify.health`
- `shopify.list_shops`
- `shopify.verify_shop`
- `shopify.report_products`
- `shopify.report_orders`
- `shopify.report_inventory`
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
- `shopify.webhooks.list/get`
- `shopify.customers.list/get`

`shopify.health` returns memory diagnostics. `mcp serve` emits lifecycle JSON to stderr.
Webhook tools require `read_webhooks`; no create/update/delete until gated. Customer tools require `read_customers`, cap `first` at 50, return `emailDomain`/`phonePresent`, omit addresses/notes/tags, and audit no raw query/PII.
App Automation Token CI/CD: `SHOPIFY_APP_AUTOMATION_TOKEN`; see `docs/shopify-app-automation-token-ci-cd.md`.
