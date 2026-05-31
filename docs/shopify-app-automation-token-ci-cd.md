# Shopify App Automation Token CI/CD deployment

This runbook documents the non-interactive Shopify app config deployment path for `shopify-hermes-oauth` using a Shopify App Automation Token. Use it for staging/production app URL, callback URL, and Required Admin API scope drift control. The OAuth callback server/web app is still deployed separately.

Verified CLI baseline: `@shopify/cli@4.1.0`. Its `shopify app deploy` help documents `--config`, `--client-id`, `--path`, `--allow-updates`, `--allow-deletes`, `--source-control-url`, `--message`, and `--version`. `--allow-updates` is the CI/CD-friendly non-interactive approval flag for adding/updating supported app configuration. Avoid `--allow-deletes` unless you have reviewed deletion impact because Shopify deploy can remove extensions or configuration not present in the deployed environment.

## Security contract

- Store `SHOPIFY_APP_AUTOMATION_TOKEN` as a GitHub Actions secret or equivalent CI secret. Do not commit it, paste it into chat, put it in TOML, or store it in shell history.
- Do not print the token. Prefer environment secret injection (`env: SHOPIFY_APP_AUTOMATION_TOKEN: ${{ secrets.SHOPIFY_APP_AUTOMATION_TOKEN }}` in GitHub Actions) over inline shell interpolation.
- Store per-environment `SHOPIFY_CLIENT_ID` values as GitHub Actions environment secrets. The client ID is not the client secret, but this keeps workflow templates generic and avoids accidental wrong-app deploys.
- If `SHOPIFY_APP_AUTOMATION_TOKEN` is exposed, rotate or revoke it in Shopify immediately, replace the CI secret, and review CI logs/artifacts for disclosure.
- Do not put Shopify client secrets, app secrets, access tokens, refresh tokens, or automation tokens in the repository, TOML file, shell history, chat, or logs.

## Versioned Shopify app config

The repository includes example config files for stable environments:

- `shopify.app.staging.toml`
- `shopify.app.production.toml`

Copy the examples for your own app and replace only the placeholders and URLs that identify your app/environment. Required Admin API scopes are versioned where Shopify CLI app config supports them:

```toml
client_id = "<environment-client-id>"
name = "Hermes Shopify OAuth (production)"
application_url = "https://app.example.com"
embedded = false

[access_scopes]
scopes = "read_products,read_orders,read_inventory,read_locations"

[auth]
redirect_urls = ["https://app.example.com/auth/callback"]
```

Before deploying, confirm `application_url` is stable HTTPS for that environment and `redirect_urls` includes exactly the matching `/auth/callback` endpoint.

## GitHub Actions deployment path

Use `.github/workflows/shopify-app-config-deploy.yml` as a manual workflow template. It exposes a single `environment` input and derives the Shopify config name from that same value so production secrets cannot accidentally deploy staging TOML, or vice versa. Configure GitHub environments named `staging` and `production` with these secrets:

- `SHOPIFY_APP_AUTOMATION_TOKEN`
- `SHOPIFY_CLIENT_ID`

The workflow scopes `SHOPIFY_APP_AUTOMATION_TOKEN` to the deploy step so checkout, Node setup, and `npm ci` do not receive the token. It runs Shopify CLI without interactive Shopify login:

```bash
npm exec --yes --package @shopify/cli@4.1.0 -- shopify app deploy \
  --config "$SHOPIFY_CONFIG_NAME" \
  --client-id "$SHOPIFY_CLIENT_ID" \
  --path . \
  --allow-updates \
  --source-control-url "$SOURCE_CONTROL_URL" \
  --message "$DEPLOY_MESSAGE" \
  --version "$DEPLOY_VERSION"
```

Use `staging` with `shopify.app.staging.toml` and `production` with `shopify.app.production.toml`. Do not add `--allow-deletes` unless the deployed environment intentionally owns every extension/config entry and you have reviewed what Shopify will delete.

## local/dev tunnel callback flow

For local development, keep using a temporary public HTTPS tunnel and copy the resulting URLs into the Shopify app manually or into a throwaway dev config. Tunnel URLs change, so they are poor CI/CD targets.

```bash
shopify-hermes-oauth dev --tunnel
```

The helper prints:

```text
Application URL: https://<temporary-public-url>
Allowed redirection URL: https://<temporary-public-url>/auth/callback
```

Then install with `/auth/start?shop=<shop>.myshopify.com` while the callback server is running.

## stable staging/production callback flow

For staging and production, deploy or proxy the connector callback server at stable HTTPS origins first, then version those origins in TOML:

```toml
application_url = "https://staging.example.com"
redirect_urls = ["https://staging.example.com/auth/callback"]
```

Run the CI workflow after the stable callback endpoint is reachable. Shopify CLI deploy updates Shopify app config only; it does not deploy the callback server itself.

## Manual dashboard fallback

If you do not want CI/CD or App Automation Tokens, use the Shopify Developer Dashboard manually:

1. Create or open the Shopify app.
2. Set Application URL to the stable or tunnel HTTPS URL.
3. Set Allowed redirection URL to the same origin plus `/auth/callback`.
4. Set Required Admin API scopes to `read_products`, `read_orders`, `read_inventory`, `read_locations`.
5. Save, then run `shopify-hermes-oauth credentials set` locally for client credentials and start `shopify-hermes-oauth dev --tunnel` or `shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url "https://<public-https-url>"`.

Manual fallback is safe but prone to drift; review scopes and callback URLs during each environment change.
