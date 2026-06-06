# Shopify app setup for Hermes OAuth

This guide keeps the automated local/Hermes steps separate from the Shopify dashboard and store-approval steps that Shopify requires a human app owner or store admin to complete.

## Automated local steps

Run these on the machine where Hermes will use the connector:

```bash
npm install -g @wottz/shopify-hermes-oauth
shopify-hermes-oauth init
shopify-hermes-oauth hermes install
shopify-hermes-oauth dev --tunnel
```

`shopify-hermes-oauth dev --tunnel` starts the public tunnel first and then starts the local OAuth callback server on `http://127.0.0.1:3456` with `--app-url` set to the detected public HTTPS URL, so Shopify's OAuth `redirect_uri` matches the URL you configure. It:

1. uses `cloudflared tunnel --url http://127.0.0.1:3456` when `cloudflared` is installed, then starts `serve --app-url <cloudflared-url>`;
2. otherwise uses `ngrok http http://127.0.0.1:3456` when `ngrok` is installed, then starts `serve --app-url <ngrok-url>`;
3. otherwise prints manual tunnel instructions and does not start a local-only server for the public OAuth flow.

When a public tunnel URL is available, copy these exact values from the command output into Shopify:

```text
Application URL: <public-url>
Allowed redirection URL: <public-url>/auth/callback
```

Keep the command running while completing app setup and store installation. Do not paste Shopify client secrets or OAuth tokens into chat, tests, docs, or issue comments.

## Unavoidable Shopify dashboard steps

Shopify requires these steps in the Shopify Partner/Admin dashboard; the CLI cannot safely complete them for every user:

1. Create or choose a Shopify app for your Hermes OAuth connector.
2. Copy the app client ID and client secret into your local Hermes `.env` placeholders created by `shopify-hermes-oauth init`:
   - `SHOPIFY_HERMES_CLIENT_ID`
   - `SHOPIFY_HERMES_CLIENT_SECRET`
3. Set the app URL to the `Application URL` printed by `shopify-hermes-oauth dev --tunnel`.
4. Add the `Allowed redirection URL` printed by the command.
5. Under Required Admin API Scopes, confirm the app scopes match the read-only `SHOPIFY_HERMES_SCOPES` value unless you intentionally changed them. The default v0.1 required Admin API scope set is `read_products,read_orders,read_inventory,read_locations`; add `read_customers` only when enabling curated customer tools, add `read_reports` only when enabling curated ShopifyQL analytics with `SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true` plus protected customer data / analytics approval, and do not add discounts, reports, or write scopes unless a later feature explicitly documents why. Optional Shopify scopes alone are insufficient for Admin API OAuth installs and are not a substitute for Required Admin API Scopes.
6. Save the app settings.

## Unavoidable store approval steps

A store owner/admin must approve the app install for each store:

1. Start the dev tunnel and keep it running.
2. Open the generated install/start URL for the target canonical Admin `<shop>.myshopify.com` store domain when the connector provides one. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.
3. Review the requested read-only scopes in Shopify; default installs should request only `read_products`, `read_orders`, `read_inventory`, and `read_locations`.
4. Approve installation in Shopify.
5. Verify locally:

```bash
shopify-hermes-oauth shops list
shopify-hermes-oauth shops verify <shop>.myshopify.com
```

If neither `cloudflared` nor `ngrok` is installed, expose `http://127.0.0.1:3456` with your own HTTPS tunnel, then run:

```bash
shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>
```

Use these Shopify values:

```text
Application URL: <your-public-https-url>
Allowed redirection URL: <your-public-https-url>/auth/callback
```
