import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = resolve(root, 'docs/shopify-cli-assisted-setup.md');
const readmePath = resolve(root, 'README.md');

function readRunbook(): string {
  return readFileSync(runbookPath, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

describe('Shopify CLI-assisted setup runbook', () => {
  it('documents the verified Shopify CLI 4.1.0 capabilities and limits', () => {
    const markdown = readRunbook();

    expectAllPresent(markdown, [
      'Shopify CLI-assisted setup',
      '@shopify/cli@4.1.0',
      'shopify app init --help',
      '--template <reactRouter|none>',
      '--client-id',
      '--flavor',
      'creates a new app project',
      'shopify app config link --help',
      'fetches config from the Developer Dashboard',
      'shopify app deploy --help',
      '--allow-updates',
      '--source-control-url',
      '--message',
      '--version',
      'does not deploy the web app/callback server',
      'does not remove the need for browser login, organization/app selection, app install approval, or a running public HTTPS callback server',
    ]);
  });

  it('contains a safe automated path and TOML example without secrets', () => {
    const markdown = readRunbook();

    expectAllPresent(markdown, [
      'export COMMIT_URL="<commit-url>"',
      'export PUBLIC_APP_URL="https://<public-https-url>"',
      'npm exec --package @shopify/cli@4.1.0 -- shopify app init --template none --name "$APP_NAME" --path "$APP_DIR"',
      'npm exec --package @shopify/cli@4.1.0 -- shopify app init --template none --name "$APP_NAME" --path "$APP_DIR" --client-id "$SHOPIFY_CLIENT_ID"',
      'npm exec --package @shopify/cli@4.1.0 -- shopify app config link --client-id "$SHOPIFY_CLIENT_ID" --config hermes --path "$APP_DIR"',
      'application_url = "https://<public-https-url>"',
      'redirect_urls = ["https://<public-https-url>/auth/callback"]',
      'scopes = "read_products,read_orders,read_inventory,read_locations"',
      'embedded = false',
      'npm exec --package @shopify/cli@4.1.0 -- shopify app deploy --config hermes --client-id "$SHOPIFY_CLIENT_ID" --path "$APP_DIR" --allow-updates --source-control-url "$COMMIT_URL"',
      'shopify-hermes-oauth dev --tunnel',
      'shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url "$PUBLIC_APP_URL"',
      'Do not put Shopify client secrets, app secrets, access tokens, refresh tokens, or automation tokens in the repository, TOML file, shell history, or logs.',
    ]);

    expect(markdown).not.toMatch(/CLIENT_SECRET\s*=/i);
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/i);
  });

  it('keeps manual fallback and states the connector core path does not require Shopify CLI', () => {
    const markdown = readRunbook();

    expectAllPresent(markdown, [
      'Shopify CLI is optional for this connector',
      'The core connector path remains `shopify-hermes-oauth init`, `shopify-hermes-oauth credentials set`, `shopify-hermes-oauth dev --tunnel` or `serve`, and the browser install flow.',
      'Manual dashboard fallback',
      'Application URL: `https://<public-https-url>`',
      'Allowed redirection URL: `https://<public-https-url>/auth/callback`',
      'Required Admin API scopes: `read_products`, `read_orders`, `read_inventory`, `read_locations`',
      'After Shopify app setup, run the callback server separately',
    ]);
  });

  it('is linked from the README', () => {
    const markdown = readFileSync(readmePath, 'utf8');

    expect(markdown).toContain('[`docs/shopify-cli-assisted-setup.md`](docs/shopify-cli-assisted-setup.md)');
  });
});
