import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const materialsPath = resolve(root, 'docs/UPSTREAM_HERMES_OPTIONAL_SKILL_PR.md');

function readMaterials(): string {
  return readFileSync(materialsPath, 'utf8');
}

describe('upstream Hermes optional-skill PR materials', () => {
  it('contains the required contribution package sections and upstream path', () => {
    const markdown = readMaterials();

    for (const required of [
      '# Upstream Hermes optional-skill PR materials',
      'optional-skills/productivity/shopify-hermes-oauth/SKILL.md',
      '## Proposed skill content',
      '## Draft PR description',
      '## Relation to the existing `shopify` skill',
      '## Validation evidence to cite',
      'https://github.com/wottz-inc/shopify-hermes-oauth',
      'docs/SECURITY_REVIEW.md',
      'docs/LIVE_DEV_STORE_VALIDATION.md',
      'npm test -- --run',
      'npm run typecheck',
      'npm run lint',
      'npm run build',
    ]) {
      expect(markdown).toContain(required);
    }
  });

  it('makes the complementary positioning clear', () => {
    const markdown = readMaterials();

    for (const required of [
      'direct-token `shopify` skill remains',
      'one-off Admin GraphQL/curl',
      'OAuth connector complements it',
      'durable OAuth',
      'multi-store access',
      'read-only reports',
      'curated MCP tools',
      'Do not ask users to paste Shopify access tokens into chat',
    ]) {
      expect(markdown).toContain(required);
    }
  });

  it('keeps the proposal generic, small, and free of private infrastructure or secrets', () => {
    const markdown = readMaterials();
    const withoutAllowedPublicRepoLink = markdown.replaceAll('https://github.com/wottz-inc/shopify-hermes-oauth', '');

    expect(markdown).toContain('small skill/docs pointer PR, not the connector app');
    expect(withoutAllowedPublicRepoLink).not.toMatch(/Wottz|Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/shpss_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i);
    expect(markdown).not.toMatch(/SHOPIFY_ACCESS_TOKEN\s*=/i);
    expect(markdown).not.toMatch(/CLIENT_SECRET\s*=\s*[^\s<]/i);
  });
});
