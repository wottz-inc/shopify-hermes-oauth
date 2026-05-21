# shopify-hermes-oauth

Hermes-first Shopify OAuth connector for agent-safe multi-store access, read-only reporting, guardrails, audit logging, and MCP integration.

This repository is being planned as the native Shopify OAuth access layer for Hermes agents. See [`docs/PRD.md`](docs/PRD.md) for the product requirements, implementation specification, milestones, and v0.1 acceptance criteria.

## Intended positioning

- Use the upstream Hermes `shopify` skill for direct one-store token/curl GraphQL operations.
- Use `shopify-hermes-oauth` for durable OAuth installs, multi-store access, curated MCP tools, read-only reports, and guarded future write operations.

## v0.1 principles

- Hermes-native: uses `HERMES_HOME`, `~/.hermes/.env`, `hermes mcp add`, and an optional Hermes skill.
- Minimal human setup: automate everything except unavoidable Shopify app creation/callback approval/store install approval.
- Read-only by default.
- No required Infisical, Vault, Pendragon infrastructure, Forgejo, or hosted Wottz service.
- No raw write-capable Shopify Admin GraphQL exposed to agents.
