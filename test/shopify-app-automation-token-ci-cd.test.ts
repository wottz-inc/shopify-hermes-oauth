import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = resolve(root, 'docs/shopify-app-automation-token-ci-cd.md');
const workflowPath = resolve(root, '.github/workflows/shopify-app-config-deploy.yml');
const stagingTomlPath = resolve(root, 'shopify.app.staging.toml');
const productionTomlPath = resolve(root, 'shopify.app.production.toml');
const readmePath = resolve(root, 'README.md');
const skillPath = resolve(root, 'skills/productivity/shopify-hermes-oauth/SKILL.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectAllPresent(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

function expectNoSecretLikeValues(text: string): void {
  expect(text).not.toMatch(/SHOPIFY_APP_AUTOMATION_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/u);
  expect(text).not.toMatch(/shpat_[a-z0-9_]+/iu);
  expect(text).not.toMatch(/CLIENT_SECRET\s*=\s*[^\s<]/iu);
  expect(text).not.toMatch(/app_secret\s*=\s*[^\s<]/iu);
}

describe('Shopify App Automation Token CI/CD deployment path', () => {
  it('has a security-conscious runbook distinguishing CI, local tunnel, stable env, and manual fallback paths', () => {
    expect(existsSync(runbookPath)).toBe(true);
    const markdown = read(runbookPath);

    expectAllPresent(markdown, [
      'Shopify App Automation Token CI/CD deployment',
      'SHOPIFY_APP_AUTOMATION_TOKEN',
      'GitHub Actions secret',
      'Do not commit',
      'Do not print',
      'rotate or revoke',
      'local/dev tunnel callback flow',
      'stable staging/production callback flow',
      'Manual dashboard fallback',
      'read_products,read_orders,read_inventory,read_locations',
      '@shopify/cli@4.1.0',
      'shopify app deploy',
      '--allow-updates',
      'can remove extensions or configuration not present in the deployed environment',
    ]);
    expect(markdown).toMatch(/application_url\s*=\s*"https:\/\//u);
    expect(markdown).toMatch(/redirect_urls\s*=\s*\["https:\/\/.*\/auth\/callback"\]/u);
    expectNoSecretLikeValues(markdown);
  });

  it('provides a non-interactive GitHub Actions workflow using secret env injection, not inline token interpolation', () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = read(workflowPath);

    expectAllPresent(workflow, [
      'workflow_dispatch:',
      'environment:',
      'SHOPIFY_CLIENT_ID: ${{ secrets.SHOPIFY_CLIENT_ID }}',
      'SHOPIFY_CONFIG_NAME: ${{ inputs.environment }}',
      'SHOPIFY_APP_AUTOMATION_TOKEN: ${{ secrets.SHOPIFY_APP_AUTOMATION_TOKEN }}',
      'npm exec --yes --package @shopify/cli@4.1.0 -- shopify app deploy',
      '--allow-updates',
      '--config "${SHOPIFY_CONFIG_NAME}"',
      '--client-id "${SHOPIFY_CLIENT_ID}"',
      '--source-control-url "${SOURCE_CONTROL_URL}"',
    ]);
    expect(workflow).not.toContain('${{ secrets.SHOPIFY_APP_AUTOMATION_TOKEN }} npm');
    expect(workflow).not.toContain('SHOPIFY_CONFIG_NAME: ${{ inputs.config }}');
    expect(workflow).not.toContain('config:');
    expect(workflow).not.toMatch(/jobs:[\s\S]*?env:[\s\S]*?SHOPIFY_APP_AUTOMATION_TOKEN:[\s\S]*?steps:/u);
    expect(workflow).not.toContain('--password');
    expect(workflow).not.toMatch(/echo .*SHOPIFY_APP_AUTOMATION_TOKEN/iu);
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\.SHOPIFY_APP_AUTOMATION_TOKEN\s*\}\}[^\n]*shopify app deploy/iu);
  });

  it('versions staging and production app config examples with required scopes and no secrets', () => {
    for (const [path, envName, url] of [
      [stagingTomlPath, 'staging', 'https://staging.example.com'],
      [productionTomlPath, 'production', 'https://app.example.com'],
    ] as const) {
      expect(existsSync(path)).toBe(true);
      const toml = read(path);
      expectAllPresent(toml, [
        `name = "Hermes Shopify OAuth (${envName})"`,
        `application_url = "${url}"`,
        'embedded = false',
        '[access_scopes]',
        'scopes = "read_products,read_orders,read_inventory,read_locations"',
        '[auth]',
        `redirect_urls = ["${url}/auth/callback"]`,
      ]);
      expect(toml).toMatch(/client_id\s*=\s*"<.*client-id.*>"/iu);
      expectNoSecretLikeValues(toml);
    }
  });

  it('links the CI/CD runbook from README and the Hermes skill', () => {
    const expectedLink = '[`docs/shopify-app-automation-token-ci-cd.md`](docs/shopify-app-automation-token-ci-cd.md)';
    expect(read(readmePath)).toContain(expectedLink);
    expectAllPresent(read(skillPath), [
      'App Automation Token CI/CD',
      'SHOPIFY_APP_AUTOMATION_TOKEN',
      'docs/shopify-app-automation-token-ci-cd.md',
    ]);
  });
});
