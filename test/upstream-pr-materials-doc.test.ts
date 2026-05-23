import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const materialsPath = resolve(root, 'docs/UPSTREAM_HERMES_OPTIONAL_SKILL_PR.md');
const allowedPublicRepoLink = 'https://github.com/wottz-inc/shopify-hermes-oauth';

function readMaterials(): string {
  return readFileSync(materialsPath, 'utf8');
}

function expectAllPresent(markdown: string, requiredSnippets: readonly string[]): void {
  for (const required of requiredSnippets) {
    expect(markdown).toContain(required);
  }
}

// SAFETY-CRITICAL documentation tests are non-negotiable guardrails. If one of
// these fails after a copy edit, update the documentation to preserve the safety
// contract rather than deleting or weakening the assertion.
describe('SAFETY-CRITICAL upstream Hermes optional-skill PR material contracts', () => {
  it('enforces the upstream path, validation commands, and public evidence references', () => {
    const markdown = readMaterials();

    expectAllPresent(markdown, [
      'optional-skills/productivity/shopify-hermes-oauth/SKILL.md',
      allowedPublicRepoLink,
      'docs/SECURITY_REVIEW.md',
      'docs/LIVE_DEV_STORE_VALIDATION.md',
      'npm test -- --run',
      'npm run typecheck',
      'npm run lint',
      'npm run build',
    ]);
  });

  it('enforces token-paste prevention, read-only defaults, and exact connector command/tool names', () => {
    const markdown = readMaterials();

    expectAllPresent(markdown, [
      'Do not ask users to paste Shopify access tokens into chat',
      'Do not print OAuth secrets, access tokens, or token-store contents',
      'read-only reports',
      'No raw Admin GraphQL or mutation MCP tool is exposed',
      'shopify-hermes-oauth init',
      'shopify-hermes-oauth doctor',
      'shopify-hermes-oauth hermes install',
      'shopify-hermes-oauth dev --tunnel',
      'shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>',
      'shopify-hermes-oauth shops list',
      'shopify-hermes-oauth shops verify <shop>',
      'shopify-hermes-oauth report products <shop> --format markdown',
      'shopify-hermes-oauth report orders <shop> --since 30d --format markdown',
      'shopify-hermes-oauth report inventory <shop> --format markdown',
      'shopify.list_shops',
      'shopify.verify_shop',
      'shopify.report_products',
      'shopify.report_orders',
      'shopify.report_inventory',
    ]);
  });

  it('keeps the proposal generic, small, and free of private infrastructure or secrets', () => {
    const markdown = readMaterials();
    const withoutAllowedPublicRepoLink = markdown.replaceAll(allowedPublicRepoLink, '');

    expect(markdown).toContain('small skill/docs pointer PR, not the connector app');
    expect(withoutAllowedPublicRepoLink).not.toMatch(/Wottz|Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/shpss_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i);
    expect(markdown).not.toMatch(/SHOPIFY_ACCESS_TOKEN\s*=/i);
    expect(markdown).not.toMatch(/CLIENT_SECRET\s*=\s*[^\s<]/i);
  });
});

// COPY/POLISH tests document broad positioning only. These may be updated for
// editorial changes as long as the SAFETY-CRITICAL tests above continue to pass.
describe('copy-polish upstream Hermes optional-skill PR material structure', () => {
  it('keeps the package organized for upstream reviewers without pinning marketing copy', () => {
    const markdown = readMaterials();
    const headings = Array.from(markdown.matchAll(/^## /gm));

    expect(markdown).toContain('# Upstream Hermes optional-skill PR materials');
    expect(headings.length).toBeGreaterThanOrEqual(6);
    expect(markdown).toMatch(/direct-token [`']?shopify[`']? skill/i);
    expect(markdown).toMatch(/OAuth connector[\s\S]{0,80}complement/i);
    expect(markdown).toMatch(/durable OAuth/i);
  });
});
