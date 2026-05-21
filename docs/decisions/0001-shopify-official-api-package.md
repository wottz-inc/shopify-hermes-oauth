# 0001: Shopify official API package usage

## Status

Accepted.

## Context

Issue #5 asks whether `shopify-hermes-oauth` should use Shopify's official JavaScript/TypeScript packages for OAuth, HMAC/session validation, and Admin GraphQL instead of hand-rolling Shopify protocol logic.

Package research performed for this decision:

- `@shopify/shopify-api` is the framework-agnostic official Shopify API Library for Node/TypeScript apps. The current npm version checked during implementation is `13.0.0`; its package description says it supports authentication, GraphQL proxy, webhooks, and Admin API access.
- Its README states that it supports creating online/offline Admin API access tokens through OAuth, making Admin REST and GraphQL requests, and registering/processing webhooks.
- It requires a runtime adapter import such as `@shopify/shopify-api/adapters/node` before calling `shopifyApi`.
- The installed type declarations expose `shopifyApi`, `ApiVersion`, OAuth `auth.begin` / `auth.callback`, `utils.validateHmac`, session classes, webhook validation, and Admin API clients.
- `@shopify/admin-api-client` is also official and lightweight, but `@shopify/shopify-api` already depends on it and adds OAuth, HMAC, session, webhook, and app configuration primitives that this project needs.
- `@shopify/shopify-app-remix` is official but framework-specific and not appropriate for this framework-agnostic Hermes connector.

## Decision

Add `@shopify/shopify-api` as a runtime dependency and use it as the source of truth for Shopify protocol behavior where practical.

Protocol ownership for this project:

| Area | Decision |
| --- | --- |
| OAuth authorization URL/start | Use `shopify.auth.begin` through a thin route/CLI wrapper when OAuth routes are implemented. |
| OAuth callback validation and token exchange | Use `shopify.auth.callback`; do not implement callback HMAC verification or token exchange by hand. |
| Query/HMAC validation | Use `shopify.utils.validateHmac` for OAuth-style query validation and official webhook/session validation helpers for matching surfaces. |
| Session object semantics | Use official `Session` shapes/classes at Shopify boundaries, then serialize only the minimal durable token metadata required by Hermes storage. |
| Admin GraphQL transport | Prefer the official Admin GraphQL client exposed by `@shopify/shopify-api` for live calls. Hermes MCP/reporting tools may remain thin, typed wrappers that choose safe queries and enforce read-only/guardrail policy before calling the official client. |
| Storage, audit logging, Hermes home resolution, CLI UX, report/query curation, guardrails | Keep project-owned thin wrappers; these are Hermes/product concerns rather than Shopify protocol concerns. |
| Raw GraphQL documents | Project-owned for curated read-only reports/tools, but sent via official Admin GraphQL client. |

## Consequences

- Reduces risk in OAuth/HMAC/session handling by tracking Shopify's official implementation.
- Adds a moderate dependency tree (`@shopify/shopify-api` and its official client dependencies), which is acceptable for a connector that will implement OAuth and Admin API calls.
- Tests must avoid live Shopify calls. Non-live tests should instantiate/import the official package and assert expected local surfaces only.
- Future implementation should centralize Shopify API initialization in a small adapter module so Hermes-specific code does not spread direct dependency usage everywhere.
