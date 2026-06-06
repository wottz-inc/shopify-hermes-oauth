import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evaluationPath = resolve(root, 'docs/b2b-retail-coverage-evaluation.md');
const readmePath = resolve(root, 'README.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

describe('B2B and retail Admin GraphQL coverage evaluation', () => {
  it('documents issue #75 B2B resources, scopes, constraints, and safe follow-ups', () => {
    expect(existsSync(evaluationPath)).toBe(true);
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Issue #75',
      'B2B Admin GraphQL findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/Company',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/CompanyLocation',
      'https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Catalog',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/PriceList',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/PurchasingCompany',
      'https://shopify.dev/docs/apps/build/b2b',
      'read_companies',
      'read_products',
      'shopify.b2b.companies.summary',
      'follow-up implementation issue #122',
      'shopify.b2b.catalogs.summary',
      'b2b_unavailable',
      'catalog_permission_required',
      'Do not include raw GraphQL error text, token-store contents, OAuth data, or PII',
    ]);
  });

  it('documents retail/POS resources and defers sensitive POS/staff surfaces', () => {
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Retail / POS Admin GraphQL findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/Location',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryLevel',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/Order',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/CashTrackingSession',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/StaffMember',
      'shopify.locations.list',
      'shopify.inventory.levels.list',
      'current curated order report/detail tools do not expose POS source/location filtering',
      'possible future order-tool enhancement',
      'read_cash_tracking',
      'shopify.pos.cash_sessions.summary',
      'Staff/POS staff should remain out of default scope',
      'POS Pro cash-tracking locations',
      'Defer POS cash-session tooling unless a merchant explicitly needs POS Pro cash reconciliation',
    ]);
  });

  it('is linked from README and avoids secret-like fixtures', () => {
    const markdown = read(evaluationPath);
    const readme = read(readmePath);

    expect(readme).toContain('[`docs/b2b-retail-coverage-evaluation.md`](docs/b2b-retail-coverage-evaluation.md)');
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/iu);
    expect(markdown).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
    expect(markdown).not.toMatch(/Authorization:\s*Bearer\s+[^\s<]/iu);
  });
});
