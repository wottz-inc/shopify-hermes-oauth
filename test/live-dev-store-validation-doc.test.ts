import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = resolve(root, 'docs/LIVE_DEV_STORE_VALIDATION.md');

function readRunbook(): string {
  return readFileSync(runbookPath, 'utf8');
}

function expectAllPresent(markdown: string, requiredSnippets: readonly string[]): void {
  for (const required of requiredSnippets) {
    expect(markdown).toContain(required);
  }
}

// SAFETY-CRITICAL documentation tests are non-negotiable guardrails. If one of
// these fails after a copy edit, update the documentation to preserve the safety
// contract rather than deleting or weakening the assertion.
describe('SAFETY-CRITICAL live dev-store validation runbook contracts', () => {
  it('enforces dev/test-only validation and required redaction guidance', () => {
    const markdown = readRunbook();

    expectAllPresent(markdown, [
      'dev/test Shopify store only',
      'not a production-use playbook',
      'Do not paste tokens, client secrets, raw callback query strings, token-store contents, or screenshots that show secrets',
      'No live credentials are required in CI',
      'Must redact or omit',
      '<redacted-shop>.myshopify.com',
      '<redacted-public-https-url>',
      '<redacted-client-id>',
      '<redacted-client-secret>',
      '<redacted-access-token>',
      'Do not paste screenshots that show secrets',
      'Do not paste token store contents',
    ]);
  });

  it('enforces the exact connector commands and MCP tool names reviewers may cite', () => {
    const markdown = readRunbook();

    expectAllPresent(markdown, [
      'shopify-hermes-oauth init',
      'shopify-hermes-oauth doctor',
      'shopify-hermes-oauth dev --tunnel',
      'shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>',
      'Application URL: <public-url>',
      'Allowed redirection URL: <public-url>/auth/callback',
      '/auth/start?shop=<shop>.myshopify.com',
      'shopify-hermes-oauth shops list',
      'shopify-hermes-oauth shops verify <shop>.myshopify.com',
      'shopify-hermes-oauth report products <shop>.myshopify.com --format markdown',
      'shopify-hermes-oauth report orders <shop>.myshopify.com --since 30d --format markdown',
      'shopify-hermes-oauth report inventory <shop>.myshopify.com --format markdown',
      'shopify-hermes-oauth mcp serve',
      'shopify.list_shops',
      'shopify.verify_shop',
      'shopify.report_products',
      'shopify.report_orders',
      'shopify.report_inventory',
      'shopify-hermes-oauth shops remove <shop>.myshopify.com',
    ]);
  });

  it('keeps least-privilege guidance discoverable from the validation flow', () => {
    const markdown = readRunbook();
    const readOnlyGuidance = [
      /read-only scopes expected for v0\.1/i,
      /Keep v0\.1 read-only/i,
      /raw GraphQL or write-like tool names are unavailable\/fail closed/i,
    ];

    for (const required of readOnlyGuidance) {
      expect(markdown).toMatch(required);
    }
  });

  it('keeps the public runbook free of committed secrets or private infrastructure', () => {
    const markdown = readRunbook();

    expect(markdown).not.toMatch(/Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/shpss_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i);
    expect(markdown).not.toMatch(/SHOPIFY_ACCESS_TOKEN\s*=/i);
    expect(markdown).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/i);
    expect(markdown).not.toMatch(/https:\/\/[^\s<`]*ngrok[^\s<`]*/i);
    expect(markdown).not.toMatch(/https:\/\/[^\s<`]*trycloudflare[^\s<`]*/i);
  });
});

// COPY/POLISH tests document broad structure only. These may be updated for
// editorial changes as long as the SAFETY-CRITICAL tests above continue to pass.
describe('copy-polish live dev-store validation runbook structure', () => {
  it('keeps a validation title, numbered flow, and reusable evidence template', () => {
    const markdown = readRunbook();

    expect(markdown).toContain('# Live dev/test Shopify store validation runbook');
    expect(markdown.match(/^## \d+\./gm)?.length).toBeGreaterThanOrEqual(8);
    expect(markdown).toMatch(/^## Evidence template for issues\/PRs$/m);
    expect(markdown).toMatch(/^## Safe to paste$/m);
  });
});
