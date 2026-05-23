# Shopify Hermes OAuth PRD and Implementation Specification

> Repository: `wottz-inc/shopify-hermes-oauth`  
> Product: Hermes-first Shopify OAuth connector and skill  
> Status: v0.1 planning baseline  
> Date: 2026-05-21

## 1. Executive summary

`shopify-hermes-oauth` is the recommended native way for Hermes agents to access Shopify stores through a Shopify OAuth app rather than pasted per-store Admin API tokens. It provides a small service, CLI, MCP server, and Hermes skill that make Shopify access repeatable, multi-store capable, auditable, and safe for agent use.

The existing Nous/Hermes `shopify` skill is still useful for direct GraphQL/curl work against a single store token. This project complements it with an OAuth app harness designed for durable Hermes operation.

## 2. Product goals

1. **Hermes-native setup:** work with normal Hermes conventions: `HERMES_HOME`, `~/.hermes/.env`, `hermes mcp add`, optional skills, local files under `~/.hermes/`, and terminal-friendly commands.
2. **Minimal human setup:** reduce setup to the unavoidable Shopify steps: creating/choosing a Shopify app, providing client credentials, setting a callback URL, and approving store installation. Automate everything else.
3. **Safe default:** read-only by default; no raw write-capable Admin GraphQL exposed to agents.
4. **Multi-store ready:** support OAuth installs for multiple `<shop>.myshopify.com` stores.
5. **Simple dependency story:** no required private infrastructure, network overlays, hosted forge, hosted service, or third-party secret manager. Use local Hermes storage by default.
6. **Extensible:** keep token store, audit sink, and secret provider interfaces pluggable so teams can add external secret stores later.
7. **Upstreamable:** include a Hermes skill suitable for contribution to Nous Research as a companion to the direct-token `shopify` skill.

## 3. Non-goals for v0.1

- No hosted SaaS service operated by Wottz.
- No mandatory external secret-manager integration.
- No refunds, cancellations, fulfilment changes, customer exports, theme edits, or product writes.
- No generic `shopify.raw_graphql` MCP tool.
- No built-in scheduler; Hermes cron should schedule CLI/MCP operations.
- No elaborate UI. CLI, HTTP callback server, MCP server, and docs are enough.

## 4. Users and use cases

### 4.1 Ordinary Hermes user

Wants to let Hermes read Shopify orders/products/inventory reports from one or more stores without pasting store tokens into chats.

Expected path:

```bash
npm install -g @wottz/shopify-hermes-oauth
shopify-hermes-oauth init
shopify-hermes-oauth hermes install
shopify-hermes-oauth dev --tunnel
# Open <public-app-url>/auth/start?shop=example.myshopify.com after configuring Shopify app URLs.
shopify-hermes-oauth shops verify example.myshopify.com
```

Then in Hermes:

```text
Use the shopify-hermes-oauth skill. Verify my Shopify store and summarize products with low inventory.
```

### 4.2 Hermes gateway / cron operator

Wants scheduled reporting through Hermes cron without making the agent hold direct Admin API tokens.

Expected path:

```bash
shopify-hermes-oauth report orders example.myshopify.com --since 30d --format markdown
shopify-hermes-oauth report inventory example.myshopify.com --format json
```

### 4.3 Developer contributing to Hermes

Wants a small optional skill that explains when and how Hermes should use the OAuth connector rather than the direct-token `shopify` skill.

## 5. Native Hermes design

### 5.1 Hermes home and storage

The connector must resolve Hermes home in this order:

1. `HERMES_HOME` if set.
2. `~/.hermes` otherwise.

Default paths:

```text
$HERMES_HOME/.env
$HERMES_HOME/shopify-hermes-oauth/config.json
$HERMES_HOME/shopify-hermes-oauth/tokens.json
$HERMES_HOME/shopify-hermes-oauth/audit.jsonl
$HERMES_HOME/skills/productivity/shopify-hermes-oauth/SKILL.md  # optional local install
```

All token/config/audit files containing sensitive material must be created with owner-only permissions where the platform supports it.

### 5.2 Hermes environment variables

Default `.env` keys:

```text
SHOPIFY_HERMES_CLIENT_ID=
SHOPIFY_HERMES_CLIENT_SECRET=
SHOPIFY_HERMES_APP_URL=
SHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations
SHOPIFY_HERMES_API_VERSION=2026-01
SHOPIFY_HERMES_DATA_DIR=
```

No per-shop access token should be pasted into `.env` in normal OAuth operation.

The default scope set is least-privilege for v0.1 report/MCP surfaces: products, orders, inventory, and locations only. Customer, discounts, and reports scopes are intentionally not requested by default unless a future feature consumes them and documents an explicit opt-in.

### 5.3 Hermes MCP configuration

Provide a command:

```bash
shopify-hermes-oauth hermes install
```

It should:

- detect `hermes` CLI if available;
- run or print the equivalent of:

```bash
hermes mcp add shopify-hermes-oauth --command "shopify-hermes-oauth" --args "mcp serve"
```

- optionally install/update a local skill copy when the upstream skill is not bundled;
- never print secret values;
- be idempotent.

If the Hermes CLI is unavailable, it should print exact manual commands.

### 5.4 Skill-first user experience

The Hermes skill should instruct the agent to use:

```bash
shopify-hermes-oauth doctor
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>
shopify-hermes-oauth report products <shop> --format markdown
shopify-hermes-oauth report orders <shop> --since 30d --format markdown
shopify-hermes-oauth report inventory <shop> --format markdown
```

The skill should say:

- use the upstream direct `shopify` skill for one-off custom-token GraphQL operations;
- use `shopify-hermes-oauth` for durable OAuth, multi-store access, reports, and agent-safe operation.

## 6. Setup minimisation strategy

Some human setup is unavoidable because Shopify requires app ownership and store approval. The product must minimise everything else.

### 6.1 Setup initializer

`shopify-hermes-oauth init` should:

1. Detect `HERMES_HOME` and `.env`.
2. Check Node version, Hermes CLI availability, and optional `cloudflared`/`ngrok` availability.
3. Create Hermes-local configuration/data directories.
4. Write missing `$HERMES_HOME/.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt.
5. Initialize safe storage paths/files where applicable.
6. Offer to configure Hermes MCP via `shopify-hermes-oauth hermes install`.
7. Print next steps for creating/updating the Shopify app callback URL.

### 6.2 Dev tunnel helper

`shopify-hermes-oauth dev --tunnel` should:

- if `cloudflared` is installed, create a temporary tunnel to `http://127.0.0.1:3456`, extract its public HTTPS URL, then start the local callback server with `--app-url <public-url>`;
- otherwise detect `ngrok` if installed, create a temporary tunnel to `http://127.0.0.1:3456`, extract its public HTTPS URL, then start the local callback server with `--app-url <public-url>`;
- fail safely without starting the local callback server if an installed tunnel tool exits or does not print a public HTTPS URL during startup;
- otherwise print manual tunnel instructions and the `shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>` command without claiming local-only OAuth is ready;
- print the exact Shopify app URLs to set:

```text
Application URL: <public-url>
Allowed redirection URL: <public-url>/auth/callback
```

The tool should not require Wottz to host anything.

### 6.3 Shopify CLI compatibility

A later enhancement should investigate using Shopify CLI/Dev Dashboard workflows to reduce manual app configuration further. v0.1 should not depend on Shopify CLI because many Hermes users will not have it authenticated.

## 7. Architecture

```text
Hermes skill / Hermes MCP client / Hermes cron
        |
        v
shopify-hermes-oauth CLI and MCP server
        |
        v
Service layer: shops, reports, audit, guardrails
        |
        v
Token store + config loader + Shopify official SDK/Admin GraphQL client
        |
        v
Shopify OAuth app and Shopify Admin GraphQL
```

### 7.1 Official Shopify libraries

Use Shopify official packages where practical for OAuth, sessions/HMAC, webhook validation, and Admin GraphQL client behaviour. The project should not maintain hand-rolled Shopify protocol logic unless an official package is unsuitable.

### 7.2 Interfaces

Required interfaces:

- `ConfigProvider`
- `TokenStore`
- `AuditSink`
- `ShopifyAdminClient`
- `ReportService`
- `GuardrailPlanner`

Default implementations:

- config from `$HERMES_HOME/.env` and `config.json`;
- token store as local JSON file with atomic writes and owner-only permissions;
- audit sink as local JSONL;
- Shopify Admin client via official Shopify API library or thin GraphQL wrapper;
- reports as deterministic service functions reused by CLI and MCP.

Optional future implementations:

- SQLite token store;
- external secret-manager token store;
- remote audit sink.

## 8. CLI specification

### 8.1 Setup commands

```bash
shopify-hermes-oauth doctor
shopify-hermes-oauth init
shopify-hermes-oauth hermes install
shopify-hermes-oauth dev --tunnel
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456
```

### 8.2 OAuth/install commands

After `shopify-hermes-oauth dev --tunnel` or `shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>` is running and Shopify app URLs are configured, approve an install by opening `<public-app-url>/auth/start?shop=example.myshopify.com`.

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify example.myshopify.com
shopify-hermes-oauth shops remove example.myshopify.com
```

### 8.3 Report commands

```bash
shopify-hermes-oauth report products example.myshopify.com --format markdown|json|csv
shopify-hermes-oauth report orders example.myshopify.com --since 30d --format markdown|json|csv
shopify-hermes-oauth report inventory example.myshopify.com --format markdown|json|csv
```

### 8.4 MCP command

```bash
shopify-hermes-oauth mcp serve
```

## 9. MCP specification

Expose only curated read-only tools in v0.1:

```text
shopify.list_shops
shopify.verify_shop
shopify.report_products
shopify.report_orders
shopify.report_inventory
```

Do not expose raw GraphQL or mutation tools in v0.1.

Each tool must:

- validate shop domains;
- redact secrets from errors;
- log an audit event;
- return structured JSON plus human-readable summary where useful;
- avoid live writes.

## 10. HTTP server specification

Routes:

```text
GET /health
GET /auth/start?shop=<shop>
GET /auth/callback
```

Requirements:

- `/health` returns safe metadata only, never secrets or tokens.
- `/auth/start` validates shop, creates OAuth state, and redirects to Shopify.
- `/auth/callback` verifies state/HMAC/timestamp before token exchange/persistence.
- Successful callback stores per-shop token without printing it.
- Callback result should be safe browser-readable HTML/text.

## 11. Security model

### 11.1 Defaults

- Read-only scopes by default.
- Local token file owner-only permissions.
- No token values in terminal output, logs, audit files, thrown errors, or test fixtures.
- Redaction for strings matching token/secret patterns.
- No write scopes requested in v0.1.
- No raw Admin GraphQL exposed to MCP.

### 11.2 Guardrails for future writes

All future mutation commands must default to dry-run and present:

```text
Store:
Action:
Object IDs:
Before:
After:
Risk:
Rollback:
Approval reference:
Command to apply:
```

Apply mode must require explicit approval reference. High-risk actions require fresh confirmation.

## 12. Reporting specification

### Products report

Include:

- product ID/GID;
- title;
- handle;
- status;
- vendor/product type where available;
- total inventory;
- variants summary.

### Orders report

Include:

- order ID/GID;
- order name;
- created date;
- financial status;
- fulfilment status;
- total amount/currency;
- line item summary.

The v0.1 orders report intentionally excludes customer display name/email so the default install can remain least-privilege and avoid requesting `read_customers`.

### Inventory report

Include:

- product/variant;
- SKU;
- inventory item;
- locations;
- available/on-hand/committed quantities where supported;
- low-stock flags.

### Output formats

- `markdown` for Hermes chat responses;
- `json` for tools/automation;
- `csv` for spreadsheet export.

### Nested connection limits

v0.1 report queries intentionally avoid unbounded nested pagination. The products report shows at most the first 100 variants per product, and the orders report shows at most the first 50 line items per order; both summaries explicitly say when additional nested records were omitted. The inventory report fails rather than silently truncating when a product has more than 100 variants or a variant has more than 50 inventory levels, and its error identifies the affected product/variant/inventory item GID where safe. If a store hits these ceilings, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports.

## 13. Testing and quality gates

Every code issue must follow TDD where practical:

```bash
npm test
npm run typecheck
npm run lint
```

Tests must not call live Shopify or require real credentials.

Minimum test areas:

- config loading and redaction;
- shop-domain validation;
- local token store;
- OAuth start/callback with mocked exchange;
- Admin client error handling/redaction;
- reports with fake client fixtures;
- MCP tool allowlist and dispatch;
- CLI smoke tests;
- Hermes installer idempotence;
- audit log secret rejection;
- CSV formula neutralization shared across all report CSV outputs, including leading-whitespace cases;
- MCP audit-string redaction for the same secret-like patterns as the canonical redactor;
- route-level OAuth HTTP failure handling with no unhandled promise rejection;
- adversarial config/env values such as very large timestamps and excessive scope lists.

Dependency hygiene should be part of CI for the public package. At minimum, CI should run the normal test/typecheck/lint/build gates and a high-severity dependency advisory check. Any outdated-dependency check should be documented as either informational or blocking so the release signal stays deterministic.

Documentation-content tests should separate safety contracts from copy-polish assertions. Safety tests must continue to enforce no pasted tokens, no private deployment terms, least-privilege defaults, current command names, and nested-connection limit guidance. Copy tests may be looser so routine wording edits do not encourage removing safety assertions.

## 13.1 Full-repository review follow-up requirements

A full repository review on 2026-05-23 found no critical blockers and rated the project ready with minor fixes, but all findings are now part of the design backlog. The follow-up milestone is [M7 — full-repository review follow-ups](https://github.com/wottz-inc/shopify-hermes-oauth/milestone/7), with issues #33-#47.

### Release-hardening requirements

1. **Shared CSV safety helper** ([#33](https://github.com/wottz-inc/shopify-hermes-oauth/issues/33)): products, orders, and inventory CSV serializers must use one shared neutralization helper. It must prefix cells that begin with whitespace or with whitespace followed by spreadsheet formula characters (`=`, `+`, `-`, `@`).
2. **Canonical MCP audit redaction** ([#34](https://github.com/wottz-inc/shopify-hermes-oauth/issues/34)): MCP audit tool names and reasons must reuse the canonical sensitive-text redactor before truncation, rather than maintaining a narrower Shopify-only sanitizer.
3. **Top-level HTTP route safety** ([#35](https://github.com/wottz-inc/shopify-hermes-oauth/issues/35)): the OAuth HTTP server must catch unexpected route-level failures and response-write failures with generic responses and no unhandled rejections.
4. **Token-exchange boundary validation** ([#36](https://github.com/wottz-inc/shopify-hermes-oauth/issues/36)): the OAuth token exchange function must normalize and validate `input.shop` at the network boundary before constructing the Shopify token endpoint.
5. **Doctor audit health behavior** ([#37](https://github.com/wottz-inc/shopify-hermes-oauth/issues/37)): `doctor` must either verify audit writability without appending to the main operational audit log, or write clearly isolated health-check records with documented semantics.
6. **Shared strict JSON record guard** ([#38](https://github.com/wottz-inc/shopify-hermes-oauth/issues/38)): audit, MCP, report, and Admin parsing paths should use a single strict plain-object/JSON-record helper where serialized or audited data is accepted.
7. **Non-duplicative MCP result payloads** ([#39](https://github.com/wottz-inc/shopify-hermes-oauth/issues/39)): MCP tools should avoid duplicating full JSON in both text content and structured content; prefer structured data plus a concise summary where useful.
8. **Safe timestamp arithmetic** ([#40](https://github.com/wottz-inc/shopify-hermes-oauth/issues/40)): OAuth timestamp freshness checks should avoid unsafe second-to-millisecond multiplication for adversarially large safe integers.
9. **Structured Hermes idempotence detection** ([#41](https://github.com/wottz-inc/shopify-hermes-oauth/issues/41)): `hermes install` must not treat comments or unrelated text containing `shopify-hermes-oauth` as proof that MCP is configured.
10. **Scope-list caps** ([#42](https://github.com/wottz-inc/shopify-hermes-oauth/issues/42)): configured OAuth scopes should be trimmed, blank entries dropped, and over-large scope lists rejected before building OAuth URLs.
11. **Dependency hygiene** ([#43](https://github.com/wottz-inc/shopify-hermes-oauth/issues/43)): CI should include a high-severity dependency advisory check and a documented policy for outdated packages.
12. **Explicit dev-server readiness** ([#44](https://github.com/wottz-inc/shopify-hermes-oauth/issues/44)): `dev --tunnel` should wait for the local callback server's explicit listening signal or a bounded timeout, not a short stdout-silence window.
13. **Interactive lock timeout tuning** ([#45](https://github.com/wottz-inc/shopify-hermes-oauth/issues/45)): token-store lock timeout defaults should be suitable for interactive CLI use, while preserving override hooks for batch/test flows.
14. **Safety-vs-copy doc tests** ([#46](https://github.com/wottz-inc/shopify-hermes-oauth/issues/46)): documentation tests should make safety-critical assertions visibly non-negotiable and separate them from wording-polish assertions.
15. **Production export hygiene for test seams** ([#47](https://github.com/wottz-inc/shopify-hermes-oauth/issues/47)): OAuth HTTP testing factories must not accidentally become public production exports; add an export-surface guard or move them to test-only modules.

## 14. Documentation deliverables

Required docs:

- `README.md`
- `docs/getting-started.md`
- `docs/shopify-app-setup.md`
- `docs/hermes-setup.md`
- `docs/security-model.md`
- `docs/mcp.md`
- `docs/reports.md`
- `docs/guardrails.md`
- `docs/upstream-hermes-skill.md`
- `skills/productivity/shopify-hermes-oauth/SKILL.md`

## 15. Upstream Hermes contribution strategy

Create a small PR to `NousResearch/hermes-agent` after v0.1 is working. The PR should add an optional skill, not the whole app.

Skill positioning:

- Existing `shopify` skill: direct Admin/Storefront GraphQL via token and curl.
- New `shopify-hermes-oauth` skill: OAuth app harness for durable, multi-store, Hermes-safe access.

The skill should link to this repo as the reference implementation.

## 16. v0.1 acceptance criteria

v0.1 is complete when:

1. Public repo has README, MIT license, package metadata, CI, and clean docs.
2. `npm test`, `npm run typecheck`, and `npm run lint` pass in CI.
3. `shopify-hermes-oauth init` configures local Hermes-compatible storage.
4. `shopify-hermes-oauth hermes install` configures or prints MCP setup commands.
5. OAuth callback server supports one dev/test store install.
6. Token storage works locally and never prints tokens.
7. `shops list` and `shops verify` work against a mocked test path and are ready for live use.
8. Products, orders, and inventory reports are implemented and tested with fixtures.
9. MCP server exposes only the approved read-only tools.
10. Hermes skill exists and documents safe usage.
11. Docs explain unavoidable Shopify manual steps and the minimal setup path.
12. No private infrastructure, hosted forge, network-overlay, or third-party secret-manager dependencies remain.

## 17. Milestones

### Milestone 1 — Repository and Hermes-native foundation

Create the public project baseline, CI, config conventions, setup wizard skeleton, and local Hermes storage paths.

### Milestone 2 — OAuth app and local token storage

Implement Shopify OAuth callback server, state handling, local token store, and shop verification using official Shopify libraries where possible.

### Milestone 3 — Read-only reports and MCP tools

Implement products, orders, and inventory reports; expose them via CLI and MCP read-only tools.

### Milestone 4 — Hermes skill and minimal-human setup

Implement the Hermes installer command, full skill, setup docs, tunnel helper, and polished ordinary-user onboarding.

### Milestone 5 — Upstream readiness and production hardening

Code review, security review, live dev-store validation checklist, upstream skill PR preparation, and optional adapter roadmap.
