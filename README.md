# shopify-hermes-oauth

Hermes-first Shopify OAuth connector for agent-safe multi-store access, read-only reporting, guardrails, audit logging, and MCP integration.

This repository is being planned as the native Shopify OAuth access layer for Hermes agents. See [`docs/PRD.md`](docs/PRD.md) for the product requirements, implementation specification, milestones, and v0.1 acceptance criteria.

For practical setup, see [`docs/shopify-app-setup.md`](docs/shopify-app-setup.md). It separates automated CLI/Hermes steps from unavoidable Shopify dashboard and store approval steps. Reviewers can also find the security notes in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md), the live dev-store validation runbook in [`docs/LIVE_DEV_STORE_VALIDATION.md`](docs/LIVE_DEV_STORE_VALIDATION.md), and the post-review hardening backlog in [`docs/PRD.md`](docs/PRD.md#131-full-repository-review-follow-up-requirements).

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
- Least-privilege default OAuth scopes for v0.1 reports/MCP: `read_products`, `read_orders`, `read_inventory`, and `read_locations`.
- No required private infrastructure, hosted forge, hosted service, or third-party secret manager.
- No raw write-capable Shopify Admin GraphQL exposed to agents.

## Token-store lock waits

Local token-store writes use an owner-only lock file. The default lock-acquisition timeout is 10 seconds so interactive CLI commands fail promptly when another process leaves an active or unrecoverable lock behind. Batch jobs or tests that need longer waits can override this through the local file dependency hook (`lockTimeoutMs`) while retaining the same stale-lock recovery behavior.

## Dependency hygiene

CI runs `npm audit --audit-level=high` after `npm ci` so high, critical, or worse dependency advisories fail the build while non-actionable low/moderate advisories remain non-blocking. `npm outdated` is an informational local maintenance check for reviewers and maintainers; it is not a blocking CI gate because new package releases alone do not imply an actionable or deterministic failure.

## Nested connection limits

v0.1 report queries intentionally avoid unbounded nested pagination. The products report shows at most the first 100 variants per product, and the orders report shows at most the first 50 line items per order; both summaries explicitly say when additional nested records were omitted. The inventory report fails rather than silently truncating when a product has more than 100 variants or a variant has more than 50 inventory levels, and its error identifies the affected product/variant/inventory item GID where safe. If a store hits these ceilings, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports.

## Documentation test maintenance

Documentation tests use explicit `SAFETY-CRITICAL` names for non-negotiable contracts: no pasted tokens/secrets, no private infrastructure terms, exact public command/tool names, least-privilege scope guidance, and nested connection limit guidance. Do not delete or weaken those assertions for copy edits; update the docs so the safety contract remains true. Tests named `copy-polish` cover broad editorial structure or positioning and may be adjusted when wording changes without changing the safety posture.
