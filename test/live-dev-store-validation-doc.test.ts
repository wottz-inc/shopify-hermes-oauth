import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = resolve(root, 'docs/LIVE_DEV_STORE_VALIDATION.md');

function readRunbook(): string {
  return readFileSync(runbookPath, 'utf8');
}

describe('live dev-store validation runbook', () => {
  it('documents the required safe validation flow and exact connector commands', () => {
    const markdown = readRunbook();

    for (const required of [
      '# Live dev/test Shopify store validation runbook',
      'dev/test Shopify store only',
      'not a production-use playbook',
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
    ]) {
      expect(markdown).toContain(required);
    }
  });

  it('contains an evidence template that says what is safe to paste and what must be redacted', () => {
    const markdown = readRunbook();

    for (const required of [
      '## Evidence template for issues/PRs',
      'Safe to paste',
      'Must redact or omit',
      '<redacted-shop>.myshopify.com',
      '<redacted-public-https-url>',
      '<redacted-client-id>',
      '<redacted-client-secret>',
      '<redacted-access-token>',
      'Do not paste screenshots that show secrets',
      'Do not paste token store contents',
      'No live credentials are required in CI',
    ]) {
      expect(markdown).toContain(required);
    }
  });

  it('keeps the public runbook generic and free of committed secrets or private infrastructure', () => {
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
