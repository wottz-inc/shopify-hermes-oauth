import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evaluationPath = resolve(root, 'docs/analytics-timeline-shopifyql-coverage-evaluation.md');
const readmePath = resolve(root, 'README.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectAllPresent(markdown: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(markdown).toContain(snippet);
  }
}

describe('analytics, timeline events, and ShopifyQL coverage evaluation', () => {
  it('documents issue #77 ShopifyQL feasibility, scopes, and protected-data guardrails', () => {
    expect(existsSync(evaluationPath)).toBe(true);
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Issue #77',
      'no analytics extraction, event tooling, raw GraphQL/REST/ShopifyQL, or new MCP surface is implemented here',
      'ShopifyQL / analytics findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery',
      'https://shopify.dev/docs/api/shopifyql',
      'https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api',
      'https://shopify.dev/docs/apps/launch/protected-customer-data',
      'read_reports',
      'Level 2 protected customer data',
      'Sales summary by period',
      'Top products by sales',
      'Sales by region',
      'Customer acquisition trends',
      'no arbitrary ShopifyQL input',
      'Use #90 for ShopifyQL implementation',
    ]);
  });

  it('documents Admin timeline/events resources, candidate reports, scopes, and omissions', () => {
    const markdown = read(evaluationPath);

    expectAllPresent(markdown, [
      'Admin timeline / events findings',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/events',
      'https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Event',
      'https://shopify.dev/docs/api/admin-graphql/latest/interfaces/HasEvents',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/BasicEvent',
      'https://shopify.dev/docs/api/admin-graphql/latest/objects/CommentEvent',
      'retained for **1 year**',
      'Product activity events',
      'Required scope: `read_products`',
      'Order activity events',
      'Required scope: `read_orders`',
      'Customer activity events',
      'read_customers',
      'includeComments`: default `false`',
      'message` text is omitted by default',
      'must redact comments, staff names, customer names, emails, phone numbers, addresses, order notes, tags',
      'shopify.activity.events',
      'additionalContent',
      'rawMessage',
      'author',
    ]);

    expect(markdown).not.toContain('Safe output fields:\n\n- `id`, `createdAt`, `action`, `subjectType`, `subjectId`, `message`');
  });

  it('is linked from README and avoids secret-like fixtures', () => {
    const markdown = read(evaluationPath);
    const readme = read(readmePath);

    expect(readme).toContain('[`docs/analytics-timeline-shopifyql-coverage-evaluation.md`](docs/analytics-timeline-shopifyql-coverage-evaluation.md)');
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/iu);
    expect(markdown).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
    expect(markdown).not.toMatch(/Authorization:\s*Bearer\s+[^\s<]/iu);
  });
});
