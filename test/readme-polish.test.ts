import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('README review polish', () => {
  it('links reviewers to security and live dev-store validation docs', () => {
    const markdown = readProjectFile('README.md');

    expect(markdown).toContain('[`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md)');
    expect(markdown).toContain('[`docs/LIVE_DEV_STORE_VALIDATION.md`](docs/LIVE_DEV_STORE_VALIDATION.md)');
  });

  it('uses precise direct-token GraphQL/curl positioning instead of old one-store token/curl phrasing', () => {
    const markdown = readProjectFile('README.md');

    expect(markdown).toContain('direct-token Admin GraphQL/curl operations');
    expect(markdown).toContain('single-token/direct-token GraphQL/curl workflows');
    expect(markdown).not.toContain('direct one-store token/curl GraphQL operations');
    expect(markdown).not.toContain('one-store token/curl');
  });

  it('keeps a source note that Shopify OAuth callback timestamps are seconds since epoch', () => {
    const source = readProjectFile('src/server.ts');

    expect(source).toMatch(/Shopify callback timestamps are seconds since epoch/u);
  });
});
