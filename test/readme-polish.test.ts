import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

// COPY/POLISH tests cover editorial discoverability and phrasing only. They may
// be adjusted for wording changes; keep non-negotiable documentation contracts in
// SAFETY-CRITICAL suites such as readme-doc.test.ts.
describe('copy-polish README review notes', () => {
  it('links reviewers to security and live dev-store validation docs', () => {
    const markdown = readProjectFile('README.md');

    expect(markdown).toMatch(/docs\/SECURITY_REVIEW\.md/u);
    expect(markdown).toMatch(/docs\/LIVE_DEV_STORE_VALIDATION\.md/u);
  });

  it('keeps direct-token GraphQL/curl positioning without pinning exact prose', () => {
    const markdown = readProjectFile('README.md');

    expect(markdown).toMatch(/direct-token[\s\S]*GraphQL\/curl/i);
    expect(markdown).not.toContain('direct one-store token/curl GraphQL operations');
    expect(markdown).not.toContain('one-store token/curl');
  });

  it('keeps a source note that Shopify OAuth callback timestamps are seconds since epoch', () => {
    const source = readProjectFile('src/server.ts');

    expect(source).toMatch(/Shopify callback timestamps are seconds since epoch/u);
  });
});
