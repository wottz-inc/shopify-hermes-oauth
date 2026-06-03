# Python Shopify migration and research notes

This note covers the docs-only M8 tranche for Issue #78, Issue #79, and Issue #80. It is public guidance for teams comparing existing Python Shopify apps with the Hermes TypeScript connector. It is intentionally documentation-only: no Python runtime dependency is introduced.

## Issue #78 — Python OAuth client research

Reviewed ecosystem inputs:

- **ShopifyAPI / shopify_python_api**: the long-lived Python Admin API client centers OAuth around explicit `Session` objects and a process-level activated session convenience. Useful parity lessons are canonical `*.myshopify.com` shop naming, signed callback validation, scope-aware sessions, and making session activation easy for scripts. The Hermes connector should keep the validation and scope lessons, but avoid process-global mutable session state.
- **shopify-app-python**: demonstrates a framework-style app skeleton with install/callback handling, middleware, and persistent session storage responsibilities. The parity lesson is to keep app install, callback verification, session persistence, and request handling clearly separated so a user can reason about which step owns credentials.
- **python-social-auth**: useful as a generic OAuth abstraction reference. It highlights provider pipeline concepts, state/redirect validation, and the danger of over-generalizing provider-specific behavior. Hermes should keep Shopify-specific guardrails rather than hide them behind a generic OAuth plugin model.
- **ShopifyQL**: relevant for analytics/reporting expansion because ShopifyQL has existed in Python-facing SDK/CLI workflows, but analytics query access should not become a broad dependency or raw query surface in this connector.

Cross-language parity lessons:

1. Preserve Shopify-specific OAuth invariants: signed callback checks, state validation, canonical shop domains, explicit scopes, and per-shop session/token identity.
2. Prefer request-scoped token lookup over a Python-style global activated session.
3. Keep storage boundaries explicit and local; do not accept pasted token material as a migration shortcut.
4. Split follow-up issues for implementation work rather than importing a Python stack into this TypeScript package.

No Python package is required or vendored by `shopify-hermes-oauth`; this note creates no Python runtime dependency and no transitive Python install step.

Potential follow-up issues should be split by concern: migration checklist refinements, parity tests for callback/session assumptions, optional analytics templates, and future protected-data gates.

## Issue #79 — Migration path from Python Shopify apps

Use this safe migration path from Python Shopify apps:

1. Inventory the old Python app: shop domains, granted Admin API scopes, human owner, callback URLs, and whether the Shopify app is still controlled by your team.
2. You may reuse the same Shopify app client ID and client secret locally only when you control that app, understand who else depends on it, and can update its callback URL safely.
3. Configure `shopify-hermes-oauth` using the local credential handoff (`shopify-hermes-oauth credentials set`) or a secret manager. Do not put credentials in chat, committed files, fixtures, TOML, or logs.
4. Configure the Shopify app callback to the Hermes public URL, including `/auth/callback`.
5. Perform a fresh Hermes OAuth install for each target store by opening `/auth/start?shop=<shop>.myshopify.com` and approving the app in the browser; in short, perform a fresh Hermes OAuth install instead of migrating token material.
6. Verify stores through connector commands or MCP read-only reports before retiring old Python jobs.

Safety boundaries:

- Do not import raw Python token-store rows into the Hermes token store.
- Do not paste access tokens, refresh tokens, or session cookies into chat, docs, `.env`, TOML, tests, or fixtures.
- Do not copy serialized Python sessions or database rows into this connector.
- If the old app is not fully controlled by you, create a fresh Shopify app and complete a fresh install rather than reusing credentials.

Runtime model contrast:

- Python `Session` / global activated session patterns can make a script depend on mutable process-global state. That is convenient for one-off scripts but risky for multi-store agent runtimes because a later request can accidentally reuse the wrong activated shop.
- Hermes request-scoped token lookup means each request names the target shop, validates the canonical `*.myshopify.com` form, and then looks up the stored token for that shop. In operational terms, handlers look up the stored token for the requested `*.myshopify.com` shop at request time. This keeps multi-store access explicit and auditable.

## Issue #80 — ShopifyQL Python SDK/CLI evaluation

ShopifyQL Python SDK/CLI evaluation outcome:

- ShopifyQL Python SDK exists and is useful prior art for analytics-style query ergonomics.
- Do not add the ShopifyQL Python SDK or CLI as a dependency of this connector.
- Do not shell out to Python or require a Python virtual environment for analytics reporting.
- Do not expose raw ShopifyQL text input as a public MCP tool.

Future direction, if analytics work is prioritized:

- Implement a future native TypeScript Admin GraphQL implementation using Shopify's Admin GraphQL API and a bounded `shopifyqlQuery` operation where Shopify supports it.
- Put analytics behind an opt-in protected-data gate because reports can expose sensitive commerce, customer, or order-derived data depending on scopes and shop configuration.
- Use allowlisted templates with reviewed variables, bounded result sizes, explicit scopes, and deterministic tests.
- Treat ShopifyQL as template-only ShopifyQL, not a raw unrestricted query surface.

This decision keeps M8 docs useful for Python migrations while preserving the connector's TypeScript-only runtime and agent-safety boundaries.
