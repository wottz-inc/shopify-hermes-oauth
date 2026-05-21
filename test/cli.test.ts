import { describe, expect, it } from 'vitest';

import { runShopifyHermesOauthCli, type CliDependencies } from '../src/cli.js';

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, string>();
  const fileModes = new Map<string, number>();
  const renamedFiles: { readonly from: string; readonly to: string }[] = [];
  const madeDirs: string[] = [];
  const commands = new Set<string>();

  const deps: CliDependencies = {
    env: { HERMES_HOME: '/tmp/hermes' },
    homeDir: '/home/alice',
    nodeVersion: 'v20.11.1',
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    commandExists: (command) => commands.has(command),
    readFile: (path) => files.get(path),
    writeFile: (path, content, options) => {
      files.set(path, content);
      if (options?.mode !== undefined) {
        fileModes.set(path, options.mode);
      }
    },
    renameFile: (from, to) => {
      renamedFiles.push({ from, to });
      const content = files.get(from);
      if (content !== undefined) {
        files.set(to, content);
        files.delete(from);
      }
      const mode = fileModes.get(from);
      if (mode !== undefined) {
        fileModes.set(to, mode);
        fileModes.delete(from);
      }
    },
    chmod: (path, mode) => {
      fileModes.set(path, mode);
    },
    mkdir: (path) => {
      madeDirs.push(path);
    },
    ...overrides,
  };

  return { commands, deps, fileModes, files, madeDirs, renamedFiles, stderr, stdout };
}

describe('CLI doctor', () => {
  it('reports actionable setup status without invoking real commands', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
      },
      commandExists: (command) => command === 'hermes' || command === 'cloudflared',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(1);
    expect(output).toContain('Node.js >=20: ok');
    expect(output).toContain('Hermes CLI: ok');
    expect(output).toContain('cloudflared: ok');
    expect(output).toContain('ngrok: optional, not found');
    expect(output).toContain('Data directory: /tmp/hermes/shopify-hermes-oauth');
    expect(output).toContain('Missing required configuration: SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_APP_URL');
    expect(output).toContain('Next steps:');
    expect(output).toContain('Create a Shopify app in your Shopify Partner dashboard');
    expect(output).toContain('Run `shopify-hermes-oauth init`');
    expect(output).not.toContain('super-secret-value');
  });

  it('returns success when required setup is present', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Required configuration: ok');
    expect(output).not.toContain('super-secret-value');
  });
});

describe('CLI init', () => {
  it('creates the data directory and appends only missing .env keys', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
    });
    harness.files.set('/tmp/hermes/.env', '# existing file\nSHOPIFY_HERMES_CLIENT_ID=existing-id\nUNRELATED=value\n');

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.madeDirs).toEqual(['/tmp/hermes/shopify-hermes-oauth']);
    expect(envFile).toBe(
      '# existing file\nSHOPIFY_HERMES_CLIENT_ID=existing-id\nUNRELATED=value\n\nSHOPIFY_HERMES_CLIENT_SECRET=super-secret-value\nSHOPIFY_HERMES_APP_URL=https://app.example.test\nSHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations,read_customers,read_discounts,read_reports\nSHOPIFY_HERMES_DATA_DIR=/tmp/hermes/shopify-hermes-oauth\nSHOPIFY_HERMES_API_VERSION=2026-01\n',
    );
    expect(envFile).not.toContain('write_');
    expect(harness.fileModes.get('/tmp/hermes/.env')).toBe(0o600);
    expect(harness.renamedFiles).toHaveLength(1);
    expect(harness.renamedFiles[0]?.to).toBe('/tmp/hermes/.env');
    expect(harness.renamedFiles[0]?.from).toMatch(/^\/tmp\/hermes\/\.env\.tmp-/u);
    expect(output).toContain('Updated /tmp/hermes/.env with missing SHOPIFY_HERMES_* keys');
    expect(output).toContain('Setup checks:');
    expect(output).toContain('Node.js >=20: ok');
    expect(output).toContain('Hermes CLI: missing (install Hermes Agent CLI before connecting this OAuth helper)');
    expect(output).toContain('cloudflared: optional, not found');
    expect(output).toContain('ngrok: optional, not found');
    expect(output).toContain('Manual Shopify setup is still required');
    expect(output).toContain('OAuth callback URL: https://app.example.test/auth/callback');
    expect(output).toContain('Next Hermes MCP step: run `shopify-hermes-oauth hermes install` to configure MCP when available.');
    expect(output).not.toContain('super-secret-value');
  });

  it('prints placeholder callback instructions when APP_URL is not known', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'hermes' || command === 'ngrok',
      nodeVersion: 'v18.19.0',
    });

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Setup checks:');
    expect(output).toContain('Node.js >=20: missing (found v18.19.0; install Node.js 20 or newer)');
    expect(output).toContain('Hermes CLI: ok');
    expect(output).toContain('ngrok: ok');
    expect(output).toContain('Set SHOPIFY_HERMES_APP_URL then use <APP_URL>/auth/callback');
    expect(output).toContain('Next Hermes MCP step: run `shopify-hermes-oauth hermes install` to configure MCP when available.');
  });

  it('is idempotent and preserves existing .env lines', async () => {
    const existing = [
      'export SHOPIFY_HERMES_CLIENT_ID=existing-id',
      'SHOPIFY_HERMES_CLIENT_SECRET=existing-secret',
      'SHOPIFY_HERMES_APP_URL=https://existing.example.test',
      'SHOPIFY_HERMES_SCOPES=read_customers',
      'SHOPIFY_HERMES_DATA_DIR=/custom/data',
      'SHOPIFY_HERMES_API_VERSION=2024-07',
      'UNRELATED=value',
      '',
    ].join('\n');
    const harness = createHarness();
    harness.files.set('/tmp/hermes/.env', existing);

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.files.get('/tmp/hermes/.env')).toBe(existing);
    expect(harness.stdout.join('\n')).toContain('No .env changes needed');
    expect(harness.stdout.join('\n')).not.toContain('existing-secret');
  });

  it('quotes special characters and rejects multiline env values without writing secrets', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client id with spaces',
        SHOPIFY_HERMES_CLIENT_SECRET: 'secret # with spaces',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';

    expect(exitCode).toBe(0);
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_ID="client id with spaces"');
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_SECRET="secret # with spaces"');
    expect(envFile).not.toContain('\nwith spaces=');

    const multilineHarness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'first line\nINJECTED_KEY=value',
      },
    });

    const multilineExitCode = await runShopifyHermesOauthCli(['init'], multilineHarness.deps);

    expect(multilineExitCode).toBe(1);
    expect(multilineHarness.files.has('/tmp/hermes/.env')).toBe(false);
    expect(multilineHarness.stderr.join('\n')).toContain('cannot contain newlines');
    expect(multilineHarness.stderr.join('\n')).not.toContain('first line');
    expect(multilineHarness.stderr.join('\n')).not.toContain('INJECTED_KEY');
  });

  it('fills blank existing keys from environment or appends placeholders', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-from-env',
      },
    });
    harness.files.set('/tmp/hermes/.env', 'SHOPIFY_HERMES_CLIENT_ID=\nSHOPIFY_HERMES_CLIENT_SECRET=   \n');

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';

    expect(exitCode).toBe(0);
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_ID=client-from-env');
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_SECRET=replace-with-shopify-client-secret');
    expect(envFile).toContain('SHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations,read_customers,read_discounts,read_reports');
    expect(envFile).toContain('SHOPIFY_HERMES_API_VERSION=2026-01');
  });

  it('prints usage for unknown commands', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['wat'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth <doctor|init>');
  });
});
