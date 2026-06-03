# Embedded app / token-exchange boundary

This docs-only M8 note records Issue #88. It clarifies the runtime boundary for `shopify-hermes-oauth` and prevents accidental scope creep into embedded-app session-token or token-exchange flows.

## Current connector contract

`shopify-hermes-oauth` is non-embedded. It implements a classic OAuth authorization-code install that stores durable local tokens for approved Shopify stores. The supported runtime path is:

1. Run the local or hosted connector callback server.
2. Configure the Shopify app Application URL and `/auth/callback` redirect URL.
3. Open `/auth/start?shop=<shop>.myshopify.com`.
4. Complete browser install approval.
5. Use curated read-only reports and MCP tools that perform request-scoped token lookup for the named shop.

Those durable local tokens are used server-side by the connector. They are not pasted into chat, committed to files, or sent to browsers.

## Out-of-scope runtime flows

The following embedded-app and session-token families are out of runtime scope for the current connector:

- App Bridge session tokens.
- token exchange from an embedded session token to another access credential.
- client credentials flow.
- refresh token rotation or refresh-token based online access flows.
- Browser runtime handling for embedded Shopify admin iframes.
- Frontend authentication, App Bridge initialization, or Polaris/admin UI routing.

These are legitimate Shopify app patterns, but they are not required for a non-embedded local Hermes OAuth connector that performs classic install and server-side Admin API calls.

## Prerequisites / compatibility matrix for future work

| Future capability | Prerequisites before implementation | Compatibility expectation |
| --- | --- | --- |
| Embedded admin UI | Dedicated frontend package, App Bridge initialization, iframe-safe routing, CSP review, and user-session model | Must coexist with the current non-embedded OAuth callback server; no breaking change to durable local installs |
| App Bridge session tokens | Browser-origin token verification, signed-token validation tests, user identity model, and replay/staleness handling | Must not replace request-scoped shop token lookup for existing MCP/report calls |
| Token exchange | Explicit Shopify API-version support, reviewed grant type, scope mapping, audit logging, and negative tests for wrong audience/shop | Must be opt-in and separate from classic authorization-code install |
| Client credentials | Confirmed Shopify support for the target API surface, secret storage design, least-privilege scopes, and rotation plan | Must not require users to paste credentials into chat or docs |
| Refresh token flows | Online/offline token distinction, secure refresh storage, rotation/revocation handling, and failure-mode docs | Must not alter current offline durable token behavior without migration docs |
| Protected analytics | Protected-data approval gate, allowlisted templates, bounded result sizes, and redaction tests | May layer on existing Admin GraphQL clients without exposing raw unrestricted queries |

## No breaking change

Issue #88 is a documentation boundary only. It does not change current OAuth routes, token-store format, CLI commands, MCP tool names, or default scopes. Future embedded or token-exchange work must be additive, guarded, and covered by its own tests and migration notes.
