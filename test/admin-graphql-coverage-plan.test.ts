import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planPath = resolve(root, 'docs/admin-graphql-coverage-plan.md');
const readmePath = resolve(root, 'README.md');

function readPlan(): string {
  return readFileSync(planPath, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

describe('Admin GraphQL coverage plan', () => {
  it('records the issue #61 M8 coverage sequence and guardrails', () => {
    const markdown = readPlan();

    expectAllPresent(markdown, [
      'Issue #61',
      'M8 Admin GraphQL coverage plan',
      'Do not add a raw unrestricted GraphQL MCP tool',
      'read-only by default',
      'writes require dry-run, explicit confirmation, audit logging, and rollback notes',
      'Python client and ShopifyQL research are design inputs, not runtime dependency decisions',
      '#62 — Capability registry / allowlist',
      '#81 — Granted-scope parsing, implication, and drift diagnostics',
      '#82 — Retry, throttle, and cost telemetry',
      '#83 — operationName support and API-version validation',
      '#86 — Redaction parity',
      '#89 — Structured result and safe error-code model',
    ]);
  });

  it('maps every M8 child domain to candidate tools, scopes, safety, pagination/cost, and test expectations', () => {
    const markdown = readPlan();

    for (const issue of [
      '#62', '#63', '#64', '#65', '#66', '#67', '#68', '#69', '#70', '#71', '#72', '#73', '#74', '#75', '#76', '#77', '#78', '#79', '#80', '#81', '#82', '#83', '#84', '#85', '#86', '#87', '#88', '#89', '#90',
    ]) {
      expect(markdown).toContain(issue);
    }

    expectAllPresent(markdown, [
      'Candidate tools / commands',
      'Required scopes',
      'Safety level',
      'Pagination / cost concerns',
      'Docs and test expectations',
      'shopify.webhooks.list',
      'shopify.bulk.start',
      'shopify.customers.search',
      'shopify.products.get',
      'shopify.orders.get',
      'shopify.inventory.levels',
      'shopify.metafields.list',
      'shopify.markets.list',
      'shopify.analytics.sales_summary',
      'read_customers',
      'read_reports',
      'protected-data gate',
      'template-only ShopifyQL',
      'No duplicate work for `shopify.report_products`, `shopify.report_orders`, or `shopify.report_inventory`',
    ]);
  });

  it('is linked from the README and does not contain secret-like fixtures', () => {
    const plan = readPlan();
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toContain('[`docs/admin-graphql-coverage-plan.md`](docs/admin-graphql-coverage-plan.md)');
    expect(plan).not.toMatch(/shpat_[a-z0-9_]+/iu);
    expect(plan).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
    expect(plan).not.toMatch(/Authorization:\s*Bearer\s+[^\s<]/iu);
  });
});
