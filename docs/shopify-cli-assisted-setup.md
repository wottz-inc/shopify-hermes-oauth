# Shopify CLI-assisted setup

This runbook records the evaluated Shopify CLI-assisted setup path for `shopify-hermes-oauth`, including the Issue #87 Shopify CLI / `shopify.app.toml` boundary. Shopify CLI is optional for this connector: use it when you are already logged in and want to create/link/sync Shopify app configuration from a local TOML file, but do not require it for the core connector path. Shopify CLI remains optional and is not a runtime dependency of this connector.

The core connector path remains `shopify-hermes-oauth init`, `shopify-hermes-oauth credentials set`, `shopify-hermes-oauth dev --tunnel` or `serve`, and the browser install flow.

## Evaluated CLI version

Use the pinned CLI version when following or re-validating this runbook:

```bash
npm exec --package @shopify/cli@4.1.0 -- shopify version
```

Verified against `@shopify/cli@4.1.0`.

## Exact Shopify CLI capabilities and limitations

The following facts were verified from Shopify CLI help output for version 4.1.0:

- `shopify app init --help` supports `--name`, `--path`, `--template <reactRouter|none>`, `--flavor`, `--package-manager`, `--organization-id`, `--client-id`, `--no-color`, and `--verbose`.
  - Capability: `app init` creates a new app project. With `--client-id`, it can link the generated project to an existing Shopify app and avoid the app-selection prompt.
  - Limitation: login, browser authorization, organization selection, or app selection can still be required when corresponding flags/session state are missing.
- `shopify app config link --help` supports `--client-id`, `--config`, `--path`, `--reset`, `--no-color`, and `--verbose`.
  - Capability: `app config link` fetches config from the Developer Dashboard and can create or overwrite a local `shopify.app*.toml` file.
  - Limitation: it depends on Shopify CLI authentication and dashboard access; review the fetched TOML before deploying because local edits can later update dashboard configuration.
- `shopify app deploy --help` supports `--config`, `--client-id`, `--path`, `--reset`, `--allow-updates`, `--allow-deletes`, `--source-control-url`, `--no-release`, `--no-build`, `--message`, `--version`, `--no-color`, and `--verbose`.
  - Capability: `app deploy` syncs supported app configuration/extensions from TOML to Shopify and `--allow-updates` is the non-interactive approval flag useful for CI/CD.
  - Limitation: it does not deploy the web app/callback server. You must run `shopify-hermes-oauth dev --tunnel` or `serve` separately.

Shopify CLI does not remove the need for browser login, organization/app selection, app install approval, or a running public HTTPS callback server. Store owners still approve the OAuth install in the browser.

## Safe automated path

Set shell variables locally first; do not commit them. `SHOPIFY_CLIENT_ID` is not a secret, but avoid placing automation tokens or session material in repo files or logs.

```bash
export APP_NAME="Hermes Shopify OAuth"
export SHOPIFY_CLIENT_ID="<client-id>"
export APP_DIR="./shopify-hermes-app"
export COMMIT_URL="<commit-url>"
export PUBLIC_APP_URL="https://<public-https-url>"
```

### 1. Create or link a Shopify app project

Create a minimal Shopify app project without a frontend template:

```bash
npm exec --package @shopify/cli@4.1.0 -- shopify app init --template none --name "$APP_NAME" --path "$APP_DIR"
```

Or link the generated project to an existing Shopify app by client ID:

```bash
npm exec --package @shopify/cli@4.1.0 -- shopify app init --template none --name "$APP_NAME" --path "$APP_DIR" --client-id "$SHOPIFY_CLIENT_ID"
```

If prompted, complete Shopify CLI browser login and choose the correct organization/app. These prompts are safe user actions; do not try to script credentials or tokens.

### 2. Fetch the dashboard config into TOML

```bash
npm exec --package @shopify/cli@4.1.0 -- shopify app config link --client-id "$SHOPIFY_CLIENT_ID" --config hermes --path "$APP_DIR"
```

This writes or updates a local config such as `shopify.app.hermes.toml`. Review the diff before deploying.

### 3. Edit and check TOML

Use a public HTTPS URL from `shopify-hermes-oauth dev --tunnel` or from your own reverse proxy. The connector is a non-embedded OAuth callback server, so `embedded = false` is the expected assumption unless you intentionally build an embedded Shopify UI outside this connector.

Safe TOML example with no secrets:

```toml
client_id = "<client-id>"
name = "Hermes Shopify OAuth"
application_url = "https://<public-https-url>"
embedded = false

[access_scopes]
scopes = "read_products,read_orders,read_inventory,read_locations"

[auth]
redirect_urls = ["https://<public-https-url>/auth/callback"]
```

Required checks before deploy:

- `application_url` is the exact public HTTPS app URL that reaches the local connector or hosted callback server.
- `redirect_urls` includes exactly the callback path `/auth/callback` on that public HTTPS URL.
- Required Admin API scopes are `read_products`, `read_orders`, `read_inventory`, and `read_locations`.
- The app is non-embedded for this connector path (`embedded = false`) unless another app surface intentionally owns embedded behavior.
- No secrets are present. Do not put Shopify client secrets, app secrets, access tokens, refresh tokens, or automation tokens in the repository, TOML file, shell history, or logs.

### 4. Deploy supported Shopify app configuration

```bash
npm exec --package @shopify/cli@4.1.0 -- shopify app deploy --config hermes --client-id "$SHOPIFY_CLIENT_ID" --path "$APP_DIR" --allow-updates --source-control-url "$COMMIT_URL"
```

Use a real commit URL when available so Shopify dashboard history points to the source revision. Omit `--allow-deletes` unless you have intentionally reviewed deletions.

### 5. Run the connector callback server separately

Shopify CLI does not run or deploy this connector. Start the OAuth callback server separately:

```bash
shopify-hermes-oauth dev --tunnel
```

Or, with your own stable public HTTPS tunnel/reverse proxy:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url "$PUBLIC_APP_URL"
```

After Shopify app setup, run the callback server separately, then open:

```text
https://<public-https-url>/auth/start?shop=<shop>.myshopify.com
```

Complete the Shopify browser install approval for each target store.

## Local tunnel and port boundaries

`shopify-hermes-oauth dev --tunnel` starts this connector callback server and a tunnel when available. The connector's local server port and public HTTPS tunnel URL must match the `application_url` and `/auth/callback` redirect URL configured in Shopify. If you use `serve --host 127.0.0.1 --port 3456 --app-url "$PUBLIC_APP_URL"`, the local port is `3456`, while the Shopify dashboard still receives the public HTTPS URL, not the loopback URL.

`shopify app dev --reset` resets Shopify CLI app-dev state/configuration prompts for a Shopify app project. It is useful only when working inside a Shopify CLI app project and intentionally resetting CLI-managed development configuration. `shopify-hermes-oauth dev --tunnel` does not run Shopify CLI, reset Shopify CLI state, or create a Shopify app project; it only runs this connector's OAuth callback server and tunnel helper.

## Manual dashboard fallback

Use this path when Shopify CLI is not installed, not logged in, or cannot access the desired organization/app.

1. In the Shopify Developer Dashboard, create or open the app.
2. Configure the app URLs:
   - Application URL: `https://<public-https-url>`
   - Allowed redirection URL: `https://<public-https-url>/auth/callback`
3. Configure Required Admin API scopes: `read_products`, `read_orders`, `read_inventory`, `read_locations`.
4. Copy the client ID into local connector configuration and enter the client secret through the chat-safe local prompt:

   ```bash
   shopify-hermes-oauth credentials set
   ```

5. Start the connector callback server with `shopify-hermes-oauth dev --tunnel` or `shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url "$PUBLIC_APP_URL"`.
6. Complete the browser install at `/auth/start?shop=<shop>.myshopify.com`.

Do not paste Shopify client secrets, app secrets, access tokens, refresh tokens, or automation tokens into chat.
