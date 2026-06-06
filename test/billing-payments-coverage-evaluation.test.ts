import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evaluationPath = resolve(root, 'docs/billing-payments-coverage-evaluation.md');
const readmePath = resolve(root, 'README.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

describe('billing and Shopify Payments coverage evaluation', () => {
  it('documents issue #76 app billing decision, docs, and out-of-scope mutations', () => {
    expect(existsSync(evaluationPath)).toBe(true);
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Issue #76',
      'no financial-data extraction, billing writes, or new MCP tools are implemented here',
      'App billing findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/AppSubscription',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/AppUsageRecord',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/AppPurchaseOneTime',
      'https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate',
      'https://shopify.dev/docs/api/admin-graphql/latest/mutations/appUsageRecordCreate',
      'shopify.app_billing.summary',
      'Required gate: authenticated Admin GraphQL app billing access',
      'billing_permission_required',
      'Out of scope: all app billing mutations',
    ]);
  });

  it('documents Shopify Payments resources, scopes, redaction, and future gates', () => {
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Shopify Payments and finance findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyPaymentsAccount',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsDispute',
      'https://shopify.dev/docs/api/admin-rest/latest/resources/payment',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery',
      'read_shopify_payments_payouts',
      'read_shopify_payments_disputes',
      'read_reports',
      'shopify.payments.account_summary',
      'read_shopify_payments` / `read_shopify_payments_accounts',
      'shopify.payments.payouts.summary',
      'read_shopify_payments_payouts',
      'shopify.payments.disputes.summary',
      'read_shopify_payments_disputes',
      'protected financial-data gate',
      'Out of scope:',
      'Arbitrary `shopifyqlQuery` or broad finance-report query tools',
    ]);
  });

  it('is linked from README and avoids secret-like fixtures', () => {
    const markdown = read(evaluationPath);
    const readme = read(readmePath);

    expect(readme).toContain('[`docs/billing-payments-coverage-evaluation.md`](docs/billing-payments-coverage-evaluation.md)');
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/iu);
    expect(markdown).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
    expect(markdown).not.toMatch(/Authorization:\s*Bearer\s+[^\s<]/iu);
  });
});
