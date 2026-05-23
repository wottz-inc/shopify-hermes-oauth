import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');

function readReadme(): string {
  return readFileSync(readmePath, 'utf8');
}

function expectAllPresent(markdown: string, requiredSnippets: readonly string[]): void {
  for (const required of requiredSnippets) {
    expect(markdown).toContain(required);
  }
}

// SAFETY-CRITICAL documentation tests are non-negotiable guardrails. If one of
// these fails after a copy edit, update the documentation to preserve the safety
// contract rather than deleting or weakening the assertion.
describe('SAFETY-CRITICAL README documentation contracts', () => {
  it('enforces least-privilege OAuth scope guidance', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      'Least-privilege default OAuth scopes',
      'read_products',
      'read_orders',
      'read_inventory',
      'read_locations',
      'No raw write-capable Shopify Admin GraphQL exposed to agents',
    ]);
  });

  it('enforces nested connection limit guidance', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Nested connection limits',
      'first 100 variants per product',
      'first 50 line items per order',
      'more than 100 variants',
      'more than 50 inventory levels',
      'custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports',
    ]);
  });

  it('tells maintainers which documentation assertions are non-negotiable', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Documentation test maintenance',
      'SAFETY-CRITICAL',
      'non-negotiable',
      'copy-polish',
    ]);
  });
});
