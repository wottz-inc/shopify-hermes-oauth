---
name: shopify-hermes-oauth
description: Use the Shopify Hermes OAuth connector for safe, durable Hermes access to one or more Shopify stores without asking users to paste Admin API tokens into chat. Covers setup, health checks, store verification, read-only reports, MCP tools, and when to prefer the direct-token shopify skill instead.
version: 0.1.0
author: Nous Research
license: MIT
metadata:
  hermes:
    tags: [shopify, oauth, mcp, ecommerce, reports]
    related_skills: [shopify]
---

# Shopify Hermes OAuth

Use this skill when a user wants Hermes to work with Shopify through the `shopify-hermes-oauth` connector: OAuth app installs, multi-store access, repeatable reports, MCP use, or safer long-running agent workflows.

Prefer the direct-token `shopify` skill for one-off custom Admin GraphQL or curl work where the user already has a short-lived/direct-token workflow. For durable access, multiple stores, scheduled reports, or avoiding pasted per-store tokens, use this OAuth connector.

## Safety rules

- Do not ask users to paste Shopify access tokens into chat.
- Do not ask users to paste Shopify client secrets into chat.
- Do not print OAuth secrets, access tokens, or token-store contents.
- Keep operations read-only unless the user explicitly requests otherwise and the connector exposes a safe command or MCP tool for it.
- Default OAuth installs should request only the v0.1 least-privilege Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.
- Verify the target shop before reports or MCP calls.
- Use the store's canonical Admin `*.myshopify.com` domain; do not guess store domains from brand names. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.

## Setup and health checks

Run local commands via the terminal:

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
shopify-hermes-oauth hermes install
```

`init` prepares Hermes-local configuration/data directories and writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks local configuration, Node/Hermes integration, and connector readiness. `hermes install` registers the MCP server, equivalent to running the connector with `mcp serve`.

For non-Bitwarden chat-first credential setup, use `shopify-hermes-oauth credentials set`: the agent sends the exact command, the user runs it locally or over SSH/Termius, then replies `done` without sharing secrets. The prompt hides the client secret while typing and updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`.

For VPS/chat-first use, recommend Hermes Bitwarden Secrets Manager mode instead of asking for secrets in chat. Store `SHOPIFY_HERMES_CLIENT_ID`, `SHOPIFY_HERMES_CLIENT_SECRET`, and `SHOPIFY_HERMES_APP_URL` as Bitwarden project variables (`BWS_PROJECT_ID`); include `--server-url <self-hosted-url>` for a self-hosted Bitwarden endpoint. Check `hermes secrets bitwarden status` and `hermes secrets bitwarden sync`, then run `shopify-hermes-oauth doctor`. Do not write secrets back to `.env` in Bitwarden mode; status should list variable names only.

For OAuth callback setup during development, start a public HTTPS tunnel and local callback server:

```bash
shopify-hermes-oauth dev --tunnel
```

If you provide your own tunnel instead, run the callback server explicitly:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>
```

Configure the Shopify app in Shopify's app/admin UI with the public Application URL and `<public-https-url>/auth/callback` redirect URL. To approve an install, open `/auth/start?shop=<shop>.myshopify.com` on the public app URL when the app is configured and the callback server is running.

## Shop verification

Before reading data, list and verify stores:

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>
```

If verification fails, stop and report the connector error. Do not ask for raw tokens as a workaround.

## Read-only reports

Use built-in reports for summaries and exports:

```bash
shopify-hermes-oauth report products <shop> --format markdown
shopify-hermes-oauth report orders <shop> --since 30d --format markdown
shopify-hermes-oauth report inventory <shop> --format markdown
```

Prefer Markdown for user-facing summaries and JSON only when a downstream tool needs structured data. Avoid exposing unnecessary customer details; summarize only what the user needs.

## Limits

v0.1 reports have explicit nested-connection ceilings:

- Products report: shows at most the first 100 variants per product and marks the variants summary when additional variants are omitted.
- Orders report: shows at most the first 50 line items per order and marks the line-item summary when additional line items are omitted.
- Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels, with the affected product/variant/inventory item GID included where safe.

If a report hits these limits, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports.

## MCP tools

After `shopify-hermes-oauth hermes install`, use the MCP server for agent workflows. Expected read-oriented tools include:

- `shopify.list_shops`
- `shopify.verify_shop`
- `shopify.report_products`
- `shopify.report_orders`
- `shopify.report_inventory`

If MCP is unavailable, fall back to the matching CLI commands above and include the command output in the reasoning context without revealing secrets.

## Public references

- Project docs: `README.md`, `docs/PRD.md`, `docs/shopify-app-setup.md`
- Shopify app setup belongs in Shopify's app/admin UI; the connector stores local Hermes configuration under the user's Hermes home.
