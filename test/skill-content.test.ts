import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = resolve(root, 'skills/productivity/shopify-hermes-oauth/SKILL.md');

function readSkill(): string {
  return readFileSync(skillPath, 'utf8');
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, string>; rawFrontmatter: string; body: string } {
  expect(markdown.startsWith('---\n')).toBe(true);
  const end = markdown.indexOf('\n---\n', 4);
  expect(end).toBeGreaterThan(4);

  const rawFrontmatter = markdown.slice(4, end);
  const frontmatter: Record<string, string> = {};
  for (const line of rawFrontmatter.split('\n')) {
    if (line.trim().length === 0 || line.startsWith(' ')) {
      continue;
    }
    const separator = line.indexOf(':');
    expect(separator).toBeGreaterThan(0);
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
  }

  return { frontmatter, rawFrontmatter, body: markdown.slice(end + '\n---\n'.length).trim() };
}

function expectFrontmatterLine(rawFrontmatter: string, line: string): void {
  expect(rawFrontmatter.split('\n')).toContain(line);
}

function expectNoOldStandaloneMcpAliases(markdown: string): void {
  for (const alias of ['shops_list', 'shops_verify', 'report_products', 'report_orders', 'report_inventory']) {
    expect(markdown).not.toMatch(new RegExp(`(^|[^.\\w])${alias}([^.\\w]|$)`, 'u'));
  }
}

describe('shopify-hermes-oauth Hermes skill', () => {
  it('has valid concise Hermes skill frontmatter', () => {
    const { frontmatter, rawFrontmatter, body } = parseFrontmatter(readSkill());

    const name = frontmatter.name ?? '';
    const description = frontmatter.description ?? '';

    expect(name).toBe('shopify-hermes-oauth');
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(description).toBeTruthy();
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(frontmatter.version).toBeTruthy();
    expect(frontmatter.author).toBeTruthy();
    expect(frontmatter.license).toBeTruthy();
    expect(frontmatter.metadata).toBe('');
    expectFrontmatterLine(rawFrontmatter, 'metadata:');
    expectFrontmatterLine(rawFrontmatter, '  hermes:');
    expectFrontmatterLine(rawFrontmatter, '    tags: [shopify, oauth, mcp, ecommerce, reports]');
    expectFrontmatterLine(rawFrontmatter, '    related_skills: [shopify]');
    expect(rawFrontmatter).not.toContain('metadata: productivity,shopify,oauth,mcp');
    expect(body.length).toBeGreaterThan(0);
    expect(readSkill().length).toBeLessThan(6000);
  });

  it('explains safe OAuth setup, verification, reports, MCP, and skill selection', () => {
    const markdown = readSkill();

    for (const required of [
      'direct-token',
      'shopify',
      'shopify-hermes-oauth init',
      'shopify-hermes-oauth doctor',
      'shopify-hermes-oauth hermes install',
      'writes missing `.env` keys from current environment values or safe placeholders without printing secrets',
      'it is not an interactive prompt',
      'shopify-hermes-oauth dev --tunnel',
      'shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>',
      '/auth/start?shop=<shop>.myshopify.com',
      'shopify-hermes-oauth shops list',
      'shopify-hermes-oauth shops verify <shop>',
      'shopify-hermes-oauth report products <shop> --format markdown',
      'shopify-hermes-oauth report orders <shop> --since 30d --format markdown',
      'shopify-hermes-oauth report inventory <shop> --format markdown',
      'mcp serve',
      'shopify.list_shops',
      'shopify.verify_shop',
      'shopify.report_products',
      'shopify.report_orders',
      'shopify.report_inventory',
      'Do not ask users to paste Shopify access tokens into chat',
    ]) {
      expect(markdown).toContain(required);
    }

    expect(markdown).not.toContain('prompts for Shopify app credentials');
  });

  it('rejects reviewed-invalid commands and old MCP aliases', () => {
    const markdown = readSkill();

    expect(markdown).not.toContain('shopify-hermes-oauth install-url');
    expect(markdown).not.toContain('shopify-hermes-oauth serve --app-url <public-https-url>');
    expectNoOldStandaloneMcpAliases(markdown);
  });

  it('keeps stale install-url command and private-infra references out of reviewed docs', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const prd = readFileSync(resolve(root, 'docs/PRD.md'), 'utf8');
    const setup = readFileSync(resolve(root, 'docs/shopify-app-setup.md'), 'utf8');
    const reviewedDocs = `${readme}\n${prd}\n${setup}`;

    expect(reviewedDocs).not.toContain('shopify-hermes-oauth install-url');
    expect(reviewedDocs).not.toMatch(/Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(reviewedDocs).toContain('/auth/start?shop=example.myshopify.com');
  });

  it('stays generic and avoids private infrastructure references or secret placeholders', () => {
    const markdown = readSkill();

    expect(markdown).not.toMatch(/Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(markdown).not.toMatch(/shpat_[a-z0-9_]+/i);
    expect(markdown).not.toMatch(/SHOPIFY_ACCESS_TOKEN\s*=/i);
    expect(markdown).not.toMatch(/CLIENT_SECRET\s*=\s*[^\s<]/i);
  });
});
