# Live dev/test Shopify store validation runbook

This is a **dev/test Shopify store only** validation checklist for the v0.1 connector. It is **not a production-use playbook** and must not be used to justify write access, refunds, fulfilment changes, customer exports, theme edits, or any other production operation.

No live credentials are required in CI. Automated tests must use fixtures/mocks only. Run these steps only when you own or have explicit approval to use the dev/test store and Shopify app.

## Safety rules

- Use a dev/test Shopify store with non-sensitive test data.
- Keep v0.1 read-only: products, orders, inventory, shop metadata, audit review, and MCP smoke tests only.
- Do not paste tokens, client secrets, raw callback query strings, token-store contents, or screenshots that show secrets into issues, PRs, chat, or logs.
- Use placeholders such as `<redacted-shop>.myshopify.com` and `<redacted-public-https-url>` in evidence.
- If a command prints a secret unexpectedly, stop, delete the exposed output from local notes where possible, and file a security bug using redacted wording only.

## Prerequisites

- Node/npm environment with the package installed or running from the repository.
- A Shopify app configured for the connector's read-only scopes.
- A dev/test store where installing the app is approved.
- A public HTTPS tunnel for the local callback server.
- `$HERMES_HOME/.env` or environment variables configured with Shopify app client credentials. Do not commit these files.

## 1. Initialize and check local configuration

From the package/repository environment:

```bash
shopify-hermes-oauth init
shopify-hermes-oauth doctor
```

Expected evidence:

- Command names and pass/fail summary.
- Safe paths such as `$HERMES_HOME/shopify-hermes-oauth/`.
- Confirmation that missing configuration is reported without printing values.

Do not paste actual `.env` contents.

## 2. Start the public callback URL

Preferred helper:

```bash
shopify-hermes-oauth dev --tunnel
```

If no supported tunnel tool is available, expose local port `3456` yourself and run:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>
```

The helper/server should print Shopify app URL values in this form:

```text
Application URL: <public-url>
Allowed redirection URL: <public-url>/auth/callback
```

In the Shopify app dashboard for the dev/test app, set:

```text
Application URL: <public-url>
Allowed redirection URL: <public-url>/auth/callback
```

Evidence may include the fact that these fields were set, but redact the concrete public URL as `<redacted-public-https-url>` unless the URL is already disposable and contains no identifying information.

## 3. Complete OAuth install on the dev/test store

Open the install URL in a browser after the callback server is running and the Shopify app URLs are saved:

```text
/auth/start?shop=<shop>.myshopify.com
```

Use only the dev/test store. Approve only the read-only scopes expected for v0.1.

Safe evidence:

- Store domain redacted as `<redacted-shop>.myshopify.com`.
- Whether the install reached the callback success page.
- Scope list if copied from app configuration and it contains no secrets.

Must redact or omit:

- Full callback URLs and query strings.
- OAuth `code`, `hmac`, `state`, `host`, or session-looking values.
- Browser screenshots showing app credentials, URLs with query strings, or store details.

## 4. Verify stored shop access

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>.myshopify.com
```

Expected result:

- `shops list` shows the installed dev/test shop without printing a token.
- `shops verify` returns safe shop metadata and no token/header/client-secret values.

Evidence may paste the command names and redacted summaries. Replace the store with `<redacted-shop>.myshopify.com`.

## 5. Run read-only reports

```bash
shopify-hermes-oauth report products <shop>.myshopify.com --format markdown
shopify-hermes-oauth report orders <shop>.myshopify.com --since 30d --format markdown
shopify-hermes-oauth report inventory <shop>.myshopify.com --format markdown
```

Check that:

- reports complete without token output;
- product/order/inventory data is from the dev/test store only;
- markdown output is deterministic enough for issue evidence after redacting shop-identifying details;
- CSV output, if additionally checked, neutralizes spreadsheet formula-looking values.

Do not paste customer personal data, order details tied to real people, or complete row dumps. Prefer aggregate counts and a short redacted excerpt.

## 6. Smoke-test the curated MCP server

Start the MCP server:

```bash
shopify-hermes-oauth mcp serve
```

Through a Hermes MCP client or local JSON-RPC harness, call only these read-only tools:

```text
shopify.list_shops
shopify.verify_shop
shopify.report_products
shopify.report_orders
shopify.report_inventory
```

Confirm that raw GraphQL or write-like tool names are unavailable/fail closed. Do not add or test mutation tools for v0.1.

Safe evidence:

- Tool names called.
- Redacted pass/fail summaries.
- Confirmation that unknown/raw/write-like tools were rejected without leaking arguments or secrets.

## 7. Review audit output safely

Inspect the audit file locally under the configured data directory. Do not paste the raw file.

Check that audit events contain only safe metadata such as:

- action/tool name;
- result status;
- report format;
- aggregate row/count fields;
- redacted/generic failure reason.

Must redact or omit:

- token store contents;
- access tokens;
- client IDs or client secrets;
- authorization headers;
- raw GraphQL queries/responses containing row details;
- customer/order row data;
- local filesystem paths if they identify private infrastructure.

## 8. Cleanup

When validation is complete, remove the dev/test shop from local storage if the token is no longer needed:

```bash
shopify-hermes-oauth shops remove <shop>.myshopify.com
shopify-hermes-oauth shops list
```

Also revoke/uninstall the app from the dev/test store if the test install should not persist.

Safe evidence:

- Cleanup command names.
- Confirmation that the redacted shop no longer appears in `shops list`.

## Evidence template for issues/PRs

Copy this template into issue/PR comments after replacing all placeholders. Keep it concise and numeric-first.

```markdown
## Live dev/test validation evidence

Store: <redacted-shop>.myshopify.com
App URL: <redacted-public-https-url>
Date/runner: <date>, <initials or role>
Connector commit/version: <commit-or-version>

### Setup
- `shopify-hermes-oauth init`: <pass/fail summary>
- `shopify-hermes-oauth doctor`: <pass/fail summary>
- Callback configured:
  - Application URL: <redacted-public-https-url>
  - Allowed redirection URL: <redacted-public-https-url>/auth/callback

### OAuth install
- `/auth/start?shop=<shop>.myshopify.com`: <success/failure summary>
- Approved scopes: <read-only scope summary>

### CLI verification
- `shopify-hermes-oauth shops list`: <redacted summary>
- `shopify-hermes-oauth shops verify <shop>.myshopify.com`: <redacted summary>

### Reports
- `shopify-hermes-oauth report products <shop>.myshopify.com --format markdown`: <counts/redacted excerpt>
- `shopify-hermes-oauth report orders <shop>.myshopify.com --since 30d --format markdown`: <counts/redacted excerpt>
- `shopify-hermes-oauth report inventory <shop>.myshopify.com --format markdown`: <counts/redacted excerpt>

### MCP smoke test
- `shopify-hermes-oauth mcp serve`: <started/failed summary>
- `shopify.list_shops`: <pass/fail summary>
- `shopify.verify_shop`: <pass/fail summary>
- `shopify.report_products`: <pass/fail summary>
- `shopify.report_orders`: <pass/fail summary>
- `shopify.report_inventory`: <pass/fail summary>
- Unknown/raw/write-like tool rejection: <pass/fail summary>

### Audit and cleanup
- Audit review: <safe aggregate summary; no raw audit file pasted>
- `shopify-hermes-oauth shops remove <shop>.myshopify.com`: <done/not done + reason>
- App uninstalled/revoked from dev/test store: <done/not done + reason>
```

## Safe to paste

- Command names and exit/pass/fail summaries.
- Redacted store domain: `<redacted-shop>.myshopify.com`.
- Redacted public URL: `<redacted-public-https-url>`.
- Redacted app identifiers: `<redacted-client-id>`.
- Aggregate counts, row counts, and scope names.
- Short excerpts after removing store-identifying details and customer/order personal data.
- Confirmation that no live credentials are required in CI.

## Must redact or omit

- `<redacted-client-secret>` values and any real client secret.
- `<redacted-access-token>` values and any real access token.
- OAuth `code`, `state`, `hmac`, `host`, session values, callback query strings, and raw browser URLs after callback.
- Raw `$HERMES_HOME/.env` contents.
- Token store JSON or any token store contents.
- Authorization headers and `X-Shopify-Access-Token` values.
- Customer personal data, real order details, and large report row dumps.
- Screenshots of Shopify app settings, callback pages, terminals, or dashboards unless secrets and identifying details are fully redacted. Do not paste screenshots that show secrets.
- Local paths, hostnames, or tunnel URLs that identify private infrastructure.

Do not paste token store contents. If evidence is uncertain, summarize the result instead of pasting raw output.
