import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const analyticsDocsPath = resolve(root, 'docs/shopifyql-analytics-reports.md');

describe('ShopifyQL analytics report docs', () => {
  it('documents the analytics boolean gate contract', () => {
    const markdown = readFileSync(analyticsDocsPath, 'utf8');

    expect(markdown).toContain('SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true');
    expect(markdown).toContain('case-insensitive');
    expect(markdown).toContain('ignores surrounding whitespace');
    expect(markdown).toContain('`TRUE`');
    expect(markdown).toContain('` true `');
    expect(markdown).toContain('`1`');
    expect(markdown).toContain('`yes`');
  });
});
