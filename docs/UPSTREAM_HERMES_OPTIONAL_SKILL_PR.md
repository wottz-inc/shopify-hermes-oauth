# Upstream Hermes optional-skill PR materials

This document is the prepared contribution package for adding a small optional Hermes skill that points users to the public Shopify OAuth connector. It is a **small skill/docs pointer PR, not the connector app**. Do not open the upstream pull request from this repository unless explicitly asked.

Public connector repository: https://github.com/wottz-inc/shopify-hermes-oauth

## Proposed upstream file path

```text
optional-skills/productivity/shopify-hermes-oauth/SKILL.md
```

## Relation to the existing `shopify` skill

The direct-token `shopify` skill remains the right tool for one-off Admin GraphQL/curl work when a user already has a direct token workflow and needs a custom query or mutation under their own control.

The OAuth connector complements it. Use the `shopify-hermes-oauth` skill when the user wants durable OAuth, multi-store access, read-only reports, curated MCP tools, scheduled Hermes workflows, or an agent-safe setup that avoids asking users to paste Shopify Admin API tokens into chat.

The contribution story is intentionally narrow:

- keep the existing direct-token `shopify` skill as-is;
- add a companion optional skill for the OAuth connector;
- link to the public connector repo for installation, docs, and implementation;
- avoid vendoring the connector application into the upstream Hermes repo.

## Proposed skill content

Copy this content into `optional-skills/productivity/shopify-hermes-oauth/SKILL.md` in the upstream Hermes repository, adjusting only if upstream maintainers request wording changes.

```markdown
---
name: shopify-hermes-oauth
description: Use the Shopify Hermes OAuth connector for safe, durable Hermes access to one or more Shopify stores without asking users to paste Admin API tokens into chat. Covers setup, health checks, store verification, read-only reports, MCP tools, and when to prefer the direct-token shopify skill instead.
version: 0.1.0
author: Nous Research
license: MIT
platforms: [linux, macos, windows]
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

- Connector repo: `https://github.com/wottz-inc/shopify-hermes-oauth`
- Project docs: `README.md`, `docs/PRD.md`, `docs/shopify-app-setup.md`, `docs/SECURITY_REVIEW.md`, `docs/LIVE_DEV_STORE_VALIDATION.md`
- Shopify app setup belongs in Shopify's app/admin UI; the connector stores local Hermes configuration under the user's Hermes home.
```

## Draft PR description

```markdown
## Summary

Adds an optional `shopify-hermes-oauth` skill as a companion to the existing direct-token `shopify` skill.

The direct-token `shopify` skill remains appropriate for one-off Admin GraphQL/curl tasks where the user already has a token workflow. This new optional skill points Hermes agents to the public OAuth connector for durable OAuth installs, multi-store access, read-only reports, curated MCP tools, and safer long-running agent workflows that avoid pasted Shopify Admin API tokens.

Connector repository: https://github.com/wottz-inc/shopify-hermes-oauth

## Why this is small

This PR only adds an optional skill/docs pointer. It does not vendor the connector application, add a required dependency, or change the existing `shopify` skill.

## Safety posture

- Read-only by default for v0.1.
- No raw Admin GraphQL or mutation MCP tool is exposed by the connector's v0.1 MCP surface.
- The skill tells agents not to ask users to paste Shopify access tokens into chat.
- The connector stores local configuration under the user's Hermes home and avoids printing secrets.

## Validation evidence to cite

From the connector repository:

- `docs/SECURITY_REVIEW.md` documents the v0.1 security review.
- `docs/LIVE_DEV_STORE_VALIDATION.md` documents safe dev/test-store validation and evidence redaction.
- Latest local validation before preparing this PR material:
  - `npm test -- --run`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

## Reviewer notes

Please review the skill wording for fit with the existing optional-skills style. The intended relationship is complementary: direct-token skill for bespoke one-off GraphQL/curl; OAuth connector skill for repeatable, multi-store, agent-safe workflows.
```

## Validation evidence to cite

Use current connector evidence rather than live secrets or screenshots:

```text
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

Additional public docs to cite:

- `docs/SECURITY_REVIEW.md`
- `docs/LIVE_DEV_STORE_VALIDATION.md`
- `docs/PRD.md`
- `docs/shopify-app-setup.md`

Do not include token-store contents, callback query strings, client secrets, access tokens, or screenshots that reveal app settings. If live dev/test validation has been performed, cite only redacted evidence using the live validation runbook template.

## Submission checklist

- [ ] Confirm upstream optional-skills path and naming with current Hermes repository layout.
- [ ] Copy the proposed skill content into `optional-skills/productivity/shopify-hermes-oauth/SKILL.md`.
- [ ] Keep the PR limited to the skill/docs pointer unless maintainers ask for more.
- [ ] Confirm the skill text remains generic and has no private deployment assumptions.
- [ ] Link to the public connector repository and validation docs.
- [ ] Explain that the direct-token `shopify` skill remains for one-off Admin GraphQL/curl work and this OAuth connector complements it for durable OAuth workflows.
