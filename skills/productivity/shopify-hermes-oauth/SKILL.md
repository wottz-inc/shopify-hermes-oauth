---
name: shopify-hermes-oauth
description: Shopify OAuth connector for Hermes: setup, health checks, shop verification, reports, MCP tools, and direct-token use.
version: 0.1.0
author: Nous Research
license: MIT
metadata:
  hermes:
    tags: [shopify, oauth, mcp, ecommerce, reports]
    related_skills: [shopify]
---

# OAuth

Use this for Shopify OAuth app installs, multi-store access, reports, MCP, or safer long-running workflows.

Prefer the direct-token `shopify` skill for one-off custom Admin GraphQL/curl. Use this OAuth connector for durable access, multiple stores, scheduled reports, or avoiding pasted per-store tokens.

## Safety rules

- Do not ask users to paste Shopify access tokens into chat.
- Do not ask users to paste Shopify client secrets into chat.
- Do not print OAuth secrets, access tokens, or token stores.
- Keep operations read-only unless requested through a safe command or MCP tool.
- Default OAuth installs should request only the v0.1 least-privilege Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.
- Verify the target shop before reports or MCP calls.
- Use the canonical Admin `*.myshopify.com` domain; do not guess store domains from brand names. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.

## Setup and health checks

For chat-first live onboarding, start with the non-interactive guided checklist:

```bash
shopify-hermes-oauth onboard --shop <shop>.myshopify.com --app-name <app-name>
```

Output has `Agent can do:` and `Human must do in Shopify:` without secrets.

Run local commands via the terminal:

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
shopify-hermes-oauth hermes install
```

`init` writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks config. `hermes install` registers `mcp serve`.

For non-Bitwarden setup, use `shopify-hermes-oauth credentials set`: the agent sends the exact command, the user runs it locally or over SSH/Termius, then replies `done` without sharing secrets. It hides the client secret while typing and updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`.

For VPS/chat-first use, recommend Hermes Bitwarden Secrets Manager. Store vars in Bitwarden (`BWS_PROJECT_ID`); include `--server-url` when self-hosting. Check `hermes secrets bitwarden status` and `hermes secrets bitwarden sync`, then run `shopify-hermes-oauth doctor`. Do not write secrets back to `.env`.

For source installs, prefer `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz`. Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell; use `export PATH="$HERMES_HOME/node/bin:$PATH"`. If `doctor` prints `Connector CLI: installed but not on PATH`, use its PATH fix.

For OAuth callback setup during development, start a public HTTPS tunnel and local callback server:

```bash
shopify-hermes-oauth dev --tunnel
```

If providing your own tunnel, run the callback server explicitly:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>
```

Configure the Shopify app with the public Application URL and `<public-https-url>/auth/callback`. To install, open `/auth/start?shop=<shop>.myshopify.com` while the callback server is running.

## Shop verification

Before reading data, list and verify stores:

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>
```

If verification fails, report the connector error. Do not ask for raw tokens.

## Read-only reports

Use built-in reports for summaries and exports:

```bash
shopify-hermes-oauth report products <shop> --format markdown
shopify-hermes-oauth report orders <shop> --since 30d --format markdown
shopify-hermes-oauth report inventory <shop> --format markdown
```

Prefer Markdown for summaries and JSON only for downstream tooling. Avoid unnecessary customer details.

## Limits

v0.1 reports have explicit nested-connection ceilings:

- Products report: shows at most the first 100 variants per product and marks the variants summary when additional variants are omitted.
- Orders report: shows at most the first 50 line items per order and marks the line-item summary when additional line items are omitted.
- Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels, including safe affected GIDs.

If a report hits limits, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow.

## MCP tools

After `shopify-hermes-oauth hermes install`, use these read-oriented MCP tools:

- `shopify.health`
- `shopify.list_shops`
- `shopify.verify_shop`
- `shopify.report_products`
- `shopify.report_orders`
- `shopify.report_inventory`
- `shopify.webhooks.list`
- `shopify.webhooks.get`
- `shopify.customers.list`
- `shopify.customers.get`

`shopify.health` returns lightweight memory diagnostics for reconnect/OOM triage without token-store contents. `mcp serve` emits start/stop lifecycle JSON to stderr, keeping JSON-RPC stdout clean.

Webhook tools require `read_webhooks`; no create/update/delete until gated. Customer tools require `read_customers`, cap `first` at 50, return `emailDomain`/`phonePresent`, omit addresses/notes/tags, and audit no raw query/PII.

App Automation Token CI/CD: use `SHOPIFY_APP_AUTOMATION_TOKEN`; see `docs/shopify-app-automation-token-ci-cd.md`.

If MCP is unavailable, fall back to matching CLI commands and include output without secrets.
