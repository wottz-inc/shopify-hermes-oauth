# shopify-hermes-oauth

Hermes-first Shopify OAuth connector for agent-safe multi-store access, read-only reporting, guardrails, audit logging, and MCP integration.

This repository is being planned as the native Shopify OAuth access layer for Hermes agents. See [`docs/PRD.md`](docs/PRD.md) for the product requirements, implementation specification, milestones, and v0.1 acceptance criteria.

For practical setup, see [`docs/shopify-app-setup.md`](docs/shopify-app-setup.md). It separates automated CLI/Hermes steps from unavoidable Shopify dashboard and store approval steps.

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

- Use the upstream Hermes `shopify` skill for direct one-store token/curl GraphQL operations.
- Use `shopify-hermes-oauth` for durable OAuth installs, multi-store access, curated MCP tools, read-only reports, and guarded future write operations.

## v0.1 principles

- Hermes-native: uses `HERMES_HOME`, `~/.hermes/.env`, `hermes mcp add`, and an optional Hermes skill.
- Minimal human setup: automate everything except unavoidable Shopify app creation/callback approval/store install approval.
- Read-only by default.
- No required private infrastructure, hosted forge, hosted service, or third-party secret manager.
- No raw write-capable Shopify Admin GraphQL exposed to agents.
