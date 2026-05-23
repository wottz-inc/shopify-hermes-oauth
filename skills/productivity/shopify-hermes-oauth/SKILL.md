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
- Do not print OAuth secrets, access tokens, or token-store contents.
- Keep operations read-only unless the user explicitly requests otherwise and the connector exposes a safe command or MCP tool for it.
- Default OAuth installs should request only the v0.1 least-privilege scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`.
- Verify the target shop before reports or MCP calls.
- Use `<shop>.myshopify.com` domains; do not guess store domains from brand names.

## Setup and health checks

Run local commands via the terminal:

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
shopify-hermes-oauth hermes install
```

`init` prepares Hermes-local configuration/data directories and writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks local configuration, Node/Hermes integration, and connector readiness. `hermes install` registers the MCP server, equivalent to running the connector with `mcp serve`.

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
