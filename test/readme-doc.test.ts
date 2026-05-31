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
      'Required Admin API Scopes',
      'Optional scopes are not a substitute for required Admin API scopes',
      'read_products',
      'read_orders',
      'read_inventory',
      'read_locations',
      'No raw write-capable Shopify Admin GraphQL exposed to agents',
    ]);
  });

  it('documents canonical Shopify Admin shop domain usage', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      'canonical Admin `*.myshopify.com` domain',
      'If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain',
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

  it('documents Bitwarden Secrets Manager setup without asking for secrets in chat', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Bitwarden Secrets Manager mode',
      'Hermes Bitwarden Secrets Manager',
      'self-hosted Bitwarden endpoint',
      '--server-url',
      'BWS_PROJECT_ID',
      'hermes secrets bitwarden status',
      'hermes secrets bitwarden sync',
      'SHOPIFY_HERMES_CLIENT_ID',
      'SHOPIFY_HERMES_CLIENT_SECRET',
      'SHOPIFY_HERMES_APP_URL',
      'Do not paste Shopify client secrets into chat',
      'Do not write secrets back to `.env`',
    ]);
  });

  it('documents chat-first interactive credential handoff without sharing secrets in chat', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Chat-safe credential handoff',
      'shopify-hermes-oauth credentials set',
      'Run this command in your local terminal or SSH/Termius shell, not in chat:',
      'The command prompts for the Shopify client ID and hides the client secret while you type.',
      'After it succeeds, reply `done` in chat without sharing the client ID or client secret.',
      'Do not paste Shopify client secrets into chat',
      'updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`',
      'chmods `.env` to `0600`',
    ]);
  });

  it('documents source installs and Hermes profile-local npm PATH expectations', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Local/source install and PATH diagnostics',
      'npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz',
      'Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell',
      'export PATH="$HERMES_HOME/node/bin:$PATH"',
      'shopify-hermes-oauth doctor',
      'Connector CLI: installed but not on PATH',
    ]);
  });
});
