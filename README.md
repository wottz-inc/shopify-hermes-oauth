# shopify-hermes-oauth

Hermes-first Shopify OAuth connector for agent-safe multi-store access, read-only reporting, guardrails, audit logging, and MCP integration.

This repository is being planned as the native Shopify OAuth access layer for Hermes agents. See [`docs/PRD.md`](docs/PRD.md) for the product requirements, implementation specification, milestones, and v0.1 acceptance criteria.

For practical setup, see [`docs/shopify-app-setup.md`](docs/shopify-app-setup.md). It separates automated CLI/Hermes steps from unavoidable Shopify dashboard and store approval steps. If you already use Shopify CLI, the optional [`docs/shopify-cli-assisted-setup.md`](docs/shopify-cli-assisted-setup.md) runbook automates the safe CLI-supported app project/config sync steps while keeping the core connector path CLI-independent. Reviewers can also find the security notes in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md), the live dev-store validation runbook in [`docs/LIVE_DEV_STORE_VALIDATION.md`](docs/LIVE_DEV_STORE_VALIDATION.md), and the post-review hardening backlog in [`docs/PRD.md`](docs/PRD.md#131-full-repository-review-follow-up-requirements).

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

## Nested connection limits

v0.1 report queries intentionally avoid unbounded nested pagination. The products report shows at most the first 100 variants per product, and the orders report shows at most the first 50 line items per order; both summaries explicitly say when additional nested records were omitted. The inventory report fails rather than silently truncating when a product has more than 100 variants or a variant has more than 50 inventory levels, and its error identifies the affected product/variant/inventory item GID where safe. If a store hits these ceilings, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports.

## Documentation test maintenance

Documentation tests use explicit `SAFETY-CRITICAL` names for non-negotiable contracts: no pasted tokens/secrets, no private infrastructure terms, exact public command/tool names, least-privilege scope guidance, and nested connection limit guidance. Do not delete or weaken those assertions for copy edits; update the docs so the safety contract remains true. Tests named `copy-polish` cover broad editorial structure or positioning and may be adjusted when wording changes without changing the safety posture.
