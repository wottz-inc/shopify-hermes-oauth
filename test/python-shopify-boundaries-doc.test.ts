import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = resolve(root, 'docs/python-shopify-migration.md');
const embeddedBoundaryPath = resolve(root, 'docs/embedded-token-exchange-boundary.md');
const cliRunbookPath = resolve(root, 'docs/shopify-cli-assisted-setup.md');
const readmePath = resolve(root, 'README.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

function expectNoSecrets(markdown: string): void {
  expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/iu);
  expect(markdown).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
  expect(markdown).not.toMatch(/Authorization:\s*Bearer\s+[^\s<]/iu);
  expect(markdown).not.toMatch(/client_secret\s*=\s*["'][^"'<]/iu);
  expect(markdown).not.toMatch(/refresh[_-]?token\s*=\s*["'][^"'<]/iu);
}

describe('Python Shopify migration and boundary docs', () => {
  it('SAFETY-CRITICAL: records issue #78 Python OAuth client research without adding Python dependency', () => {
    const markdown = read(migrationPath);

    expectAllPresent(markdown, [
      'Issue #78',
      'ShopifyAPI / shopify_python_api',
      'shopify-app-python',
      'python-social-auth',
      'ShopifyQL',
      'Cross-language parity lessons',
      'no Python runtime dependency',
      'No Python package is required or vendored by `shopify-hermes-oauth`',
      'follow-up issues',
    ]);
    expectNoSecrets(markdown);
  });

  it('SAFETY-CRITICAL: documents issue #79 safe migration path from Python Shopify apps', () => {
    const markdown = read(migrationPath);

    expectAllPresent(markdown, [
      'Issue #79',
      'Migration path from Python Shopify apps',
      'reuse the same Shopify app client ID and client secret locally only when you control that app',
      'perform a fresh Hermes OAuth install',
      'Do not import raw Python token-store rows',
      'Do not paste access tokens, refresh tokens, or session cookies into chat, docs, `.env`, TOML, tests, or fixtures',
      'Python `Session` / global activated session',
      'Hermes request-scoped token lookup',
      'look up the stored token for the requested `*.myshopify.com` shop at request time',
    ]);
    expectNoSecrets(markdown);
  });

  it('SAFETY-CRITICAL: documents issue #80 ShopifyQL decision and future guarded TypeScript path', () => {
    const markdown = read(migrationPath);

    expectAllPresent(markdown, [
      'Issue #80',
      'ShopifyQL Python SDK/CLI evaluation',
      'ShopifyQL Python SDK exists',
      'Do not add the ShopifyQL Python SDK or CLI as a dependency',
      'future native TypeScript Admin GraphQL implementation',
      'shopifyqlQuery',
      'opt-in protected-data gate',
      'allowlisted templates',
      'not a raw unrestricted query surface',
    ]);
    expectNoSecrets(markdown);
  });

  it('SAFETY-CRITICAL: extends issue #87 Shopify CLI TOML setup boundaries', () => {
    const markdown = read(cliRunbookPath);

    expectAllPresent(markdown, [
      'Issue #87',
      'application_url = "https://<public-https-url>"',
      'redirect_urls = ["https://<public-https-url>/auth/callback"]',
      '[access_scopes]',
      'scopes = "read_products,read_orders,read_inventory,read_locations"',
      'embedded = false',
      'Local tunnel and port boundaries',
      '`shopify-hermes-oauth dev --tunnel` starts this connector callback server and a tunnel when available',
      '`shopify app dev --reset` resets Shopify CLI app-dev state/configuration prompts for a Shopify app project',
      '`shopify-hermes-oauth dev --tunnel` does not run Shopify CLI, reset Shopify CLI state, or create a Shopify app project',
      'Shopify CLI remains optional and is not a runtime dependency of this connector',
    ]);
    expectNoSecrets(markdown);
  });

  it('SAFETY-CRITICAL: documents issue #88 embedded app and token-exchange boundary with future compatibility matrix', () => {
    const markdown = read(embeddedBoundaryPath);

    expectAllPresent(markdown, [
      'Issue #88',
      'Embedded app / token-exchange boundary',
      'non-embedded',
      'classic OAuth authorization-code install',
      'durable local tokens',
      'App Bridge session tokens',
      'token exchange',
      'client credentials',
      'refresh token',
      'out of runtime scope',
      'Prerequisites / compatibility matrix for future work',
      'No breaking change',
    ]);
    expectNoSecrets(markdown);
  });

  it('links the M8 boundary docs from the README', () => {
    const markdown = read(readmePath);

    expect(markdown).toContain('[`docs/python-shopify-migration.md`](docs/python-shopify-migration.md)');
    expect(markdown).toContain('[`docs/embedded-token-exchange-boundary.md`](docs/embedded-token-exchange-boundary.md)');
  });
});
