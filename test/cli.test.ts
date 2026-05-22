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
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth <doctor|init|shops|report>');
  });
});

describe('CLI shops', () => {
  it('lists shop domains and non-secret metadata without token values', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products', 'read_orders'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:05:00.000Z',
          metadata: { shopName: 'Example Shop', currencyCode: 'USD' },
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'list'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('example.myshopify.com');
    expect(output).toContain('Example Shop');
    expect(output).toContain('USD');
    expect(output).toContain('read_products,read_orders');
    expect(output).toContain('2026-05-22T12:05:00.000Z');
    expect(output).not.toContain('shpat_never_print_me');
  });

  it('removes a normalized shop and never prints token values', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'secret-token-value',
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'remove', 'EXAMPLE'], harness.deps);
    const output = harness.stdout.join('\n');
    const updated = harness.files.get('/tmp/hermes/shopify-hermes-oauth/tokens.json') ?? '';

    expect(exitCode).toBe(0);
    expect(output).toContain('Removed example.myshopify.com');
    expect(output).not.toContain('secret-token-value');
    expect(updated).not.toContain('secret-token-value');
    expect(harness.fileModes.get('/tmp/hermes/shopify-hermes-oauth/tokens.json')).toBe(0o600);
  });

  it('respects SHOPIFY_HERMES_DATA_DIR from Hermes .env when listing shops', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/hermes/.env', 'SHOPIFY_HERMES_DATA_DIR=/tmp/custom-shopify-data\n');
    harness.files.set('/tmp/custom-shopify-data/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'custom.myshopify.com': {
          shop: 'custom.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'list'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('custom.myshopify.com');
    expect(output).not.toContain('shpat_never_print_me');
  });

  it('respects SHOPIFY_HERMES_DATA_DIR from Hermes .env when removing shops', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/hermes/.env', 'SHOPIFY_HERMES_DATA_DIR=/tmp/custom-shopify-data\n');
    harness.files.set('/tmp/custom-shopify-data/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'custom.myshopify.com': {
          shop: 'custom.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'remove', 'custom'], harness.deps);
    const output = harness.stdout.join('\n');
    const defaultStore = harness.files.get('/tmp/hermes/shopify-hermes-oauth/tokens.json') ?? '';
    const customStore = harness.files.get('/tmp/custom-shopify-data/tokens.json') ?? '';

    expect(exitCode).toBe(0);
    expect(output).toContain('Removed custom.myshopify.com');
    expect(defaultStore).toBe('');
    expect(customStore).not.toContain('shpat_never_print_me');
  });

  it('distinguishes invalid shop input from token-store operational errors', async () => {
    const invalidHarness = createHarness();
    const corruptHarness = createHarness();
    corruptHarness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{not-json');

    await expect(runShopifyHermesOauthCli(['shops', 'remove', 'not a shop!'], invalidHarness.deps)).resolves.toBe(2);
    await expect(runShopifyHermesOauthCli(['shops', 'remove', 'example'], corruptHarness.deps)).resolves.toBe(1);

    expect(invalidHarness.stderr.join('\n')).toContain('Invalid Shopify shop domain.');
    expect(corruptHarness.stderr.join('\n')).toContain('Could not update token store.');
    expect(corruptHarness.stderr.join('\n')).not.toContain('Invalid Shopify shop domain.');
    expect(corruptHarness.stderr.join('\n')).not.toContain('{not-json');
  });

  it('sanitizes token metadata and scopes before printing list output', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products', 'read_orders\nINJECTED', 'read_customers\u001B[31m'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:05:00.000Z\nINJECTED',
          metadata: { shopName: 'Example\nInjected\u001B[31m', currencyCode: 'USD\rBAD' },
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'list'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.stdout).toHaveLength(1);
    expect(output).toContain('Example\\nInjected\\u001B[31m');
    expect(output).toContain('USD\\rBAD');
    expect(output).toContain('read_orders\\nINJECTED');
    expect(output).toContain('read_customers\\u001B[31m');
    expect(output).not.toContain('\u001B');
    expect(output).not.toContain('shpat_never_print_me');
  });

  it('verifies an installed shop via fake Admin GraphQL, audits success, and never prints token values', async () => {
    const accessToken = 'shpat_never_print_me';
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        data: {
          shop: {
            name: 'Example Shop',
            myshopifyDomain: 'example.myshopify.com',
            currencyCode: 'USD',
          },
        },
      }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'verify', 'EXAMPLE'], harness.deps);
    const output = harness.stdout.join('\n');
    const updatedStore = harness.files.get('/tmp/hermes/shopify-hermes-oauth/tokens.json') ?? '';

    expect(exitCode).toBe(0);
    expect(output).toContain('example.myshopify.com');
    expect(output).toContain('Example Shop');
    expect(output).toContain('USD');
    expect(output).not.toContain(accessToken);
    expect(updatedStore).toContain('Example Shop');
    expect(updatedStore).toContain('USD');
    expect(auditEvents).toEqual([{
      action: 'shops.verify',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: {
        shopName: 'Example Shop',
        myshopifyDomain: 'example.myshopify.com',
        currencyCode: 'USD',
      },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain(accessToken);
  });

  it('fails safely when verifying a shop with no stored token', async () => {
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')),
    });

    const exitCode = await runShopifyHermesOauthCli(['shops', 'verify', 'missing'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('No stored OAuth token found for missing.myshopify.com.');
    expect(harness.stderr.join('\n')).not.toContain('shpat_');
    expect(auditEvents).toEqual([{
      action: 'shops.verify',
      shop: 'missing.myshopify.com',
      result: 'failure',
      metadata: { reason: 'missing_oauth_record' },
    }]);
  });

  it('prints redacted Admin GraphQL verification errors', async () => {
    const accessToken = 'shpat_never_print_me';
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        errors: [{ message: `Denied for X-Shopify-Access-Token: ${accessToken}` }],
      }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'verify', 'example'], harness.deps);
    const errorOutput = harness.stderr.join('\n');

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain('[REDACTED]');
    expect(errorOutput).not.toContain(accessToken);
    expect(errorOutput).not.toContain('X-Shopify-Access-Token');
    expect(JSON.stringify(auditEvents)).not.toContain(accessToken);
  });

  it('prints redacted arbitrary HTTP verification secrets from injected responses', async () => {
    const accessToken = 'shpat_never_print_me';
    const plainSecret = 'plain_access_secret';
    const bearerSecret = 'plain_bearer_secret';
    const headerSecret = 'plain_header_secret';
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        access_token: plainSecret,
        authorization: `Bearer ${bearerSecret}`,
        headers: { 'X-Shopify-Access-Token': headerSecret },
      }), { status: 401, headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['shops', 'verify', 'example'], harness.deps);
    const errorOutput = harness.stderr.join('\n');
    const serializedAudit = JSON.stringify(auditEvents);

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain('[REDACTED]');
    expect(serializedAudit).toContain('[REDACTED]');
    for (const secret of [accessToken, plainSecret, bearerSecret, headerSecret]) {
      expect(errorOutput).not.toContain(secret);
      expect(serializedAudit).not.toContain(secret);
    }
  });

  it('returns usage-ish errors for missing or unknown shop subcommands', async () => {
    const missingHarness = createHarness();
    const unknownHarness = createHarness();

    await expect(runShopifyHermesOauthCli(['shops'], missingHarness.deps)).resolves.toBe(2);
    await expect(runShopifyHermesOauthCli(['shops', 'wat'], unknownHarness.deps)).resolves.toBe(2);

    expect(missingHarness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth shops <list|remove|verify>');
    expect(unknownHarness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth shops <list|remove|verify>');
  });
});

describe('CLI report products', () => {
  it('prints a markdown products report for an installed shop without exposing tokens', async () => {
    const accessToken = 'shpat_never_print_me';
    const harness = createHarness({
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        data: {
          products: {
            edges: [{ cursor: 'cursor-1', node: cliProductNode() }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'products', 'example', '--format', 'markdown'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('| ID | GID | Title | Handle | Status | Vendor | Type | Inventory | Variants |');
    expect(output).toContain('| 1001 | gid://shopify/Product/1001 | A Shirt | a-shirt | ACTIVE | Example Vendor | Apparel | 7 | 1 variant: Red / S (sku=SKU-RED-S, inventory=7) |');
    expect(output).not.toContain(accessToken);
  });

  it('prints json and csv products reports and validates format safely', async () => {
    const harness = createHarness({
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        data: {
          products: {
            edges: [{ cursor: 'cursor-1', node: cliProductNode() }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    await expect(runShopifyHermesOauthCli(['report', 'products', 'example', '--format', 'json'], harness.deps)).resolves.toBe(0);
    expect(JSON.parse(harness.stdout.join('\n'))).toEqual({ products: [expect.objectContaining({ id: '1001', title: 'A Shirt' })] });

    harness.stdout.length = 0;
    await expect(runShopifyHermesOauthCli(['report', 'products', 'example', '--format', 'csv'], harness.deps)).resolves.toBe(0);
    expect(harness.stdout.join('\n')).toContain('id,gid,title,handle,status,vendor,productType,totalInventory,variantsSummary');
    expect(harness.stdout.join('\n')).toContain('"1001","gid://shopify/Product/1001","A Shirt"');

    const invalidHarness = createHarness();
    await expect(runShopifyHermesOauthCli(['report', 'products', 'example', '--format', 'xml'], invalidHarness.deps)).resolves.toBe(2);
    expect(invalidHarness.stderr.join('\n')).toContain('Invalid report format. Use markdown, json, or csv.');
  });

  it('fails safely when products report has no stored token', async () => {
    const harness = createHarness({
      fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')),
    });

    const exitCode = await runShopifyHermesOauthCli(['report', 'products', 'missing'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('No stored OAuth token found for missing.myshopify.com.');
    expect(harness.stderr.join('\n')).not.toContain('shpat_');
  });
});

describe('CLI report orders', () => {
  it('prints an orders report for --since without exposing tokens and audits success', async () => {
    const accessToken = 'shpat_never_print_me';
    const audits: unknown[] = [];
    const requests: unknown[] = [];
    const harness = createHarness({
      fetch: (_url, init) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        requests.push(JSON.parse(body) as unknown);
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            orders: {
              edges: [{ cursor: 'cursor-1', node: cliOrderNode() }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
            },
          },
        }), { headers: { 'content-type': 'application/json' } }));
      },
      appendAuditEvent: (_path, event) => {
        audits.push(event);
      },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_orders', 'read_customers'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'orders', 'example', '--since', '30d', '--format', 'markdown'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('| ID | GID | Name | Created At | Financial Status | Fulfillment Status | Total | Currency | Customer | Email | Line Items |');
    expect(output).toContain('| 2001 | gid://shopify/Order/2001 | #1001 | 2026-05-20T10:30:00Z | PAID | UNFULFILLED | 42.50 | USD | Ada Lovelace | ada@example.test | 2 items: T-Shirt x2; Mug x1 |');
    expect(JSON.stringify(requests)).toContain('created_at:>=');
    expect(JSON.stringify(requests)).toContain('created_at:<=');
    expect(output).not.toContain(accessToken);
    expect(JSON.stringify(audits)).not.toContain(accessToken);
    expect(audits).toEqual([expect.objectContaining({ action: 'report.orders', shop: 'example.myshopify.com', result: 'success' })]);
  });

  it('supports explicit --from/--to json orders reports and rejects invalid dates before network', async () => {
    const harness = createHarness({
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        data: { orders: { edges: [{ cursor: 'cursor-1', node: cliOrderNode() }], pageInfo: { hasNextPage: false, endCursor: 'cursor-1' } } },
      }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_orders'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    await expect(runShopifyHermesOauthCli(['report', 'orders', 'example', '--from', '2026-05-01', '--to', '2026-05-22', '--format', 'json'], harness.deps)).resolves.toBe(0);
    const parsedOutput: unknown = JSON.parse(harness.stdout.join('\n'));
    expect(JSON.stringify(parsedOutput)).toContain('"from":"2026-05-01"');
    expect(JSON.stringify(parsedOutput)).toContain('"to":"2026-05-22"');
    expect(JSON.stringify(parsedOutput)).toContain('"id":"2001"');
    expect(JSON.stringify(parsedOutput)).toContain('"name":"#1001"');

    const invalidHarness = createHarness({ fetch: () => Promise.reject(new Error('should not call network')) });
    await expect(runShopifyHermesOauthCli(['report', 'orders', 'example', '--from', '2026-02-30', '--to', '2026-03-01'], invalidHarness.deps)).resolves.toBe(2);
    expect(invalidHarness.stderr.join('\n')).toContain('Invalid orders report date: 2026-02-30. Use YYYY-MM-DD.');
  });

  it('fails before fetching when stored token lacks read_orders and audit logging fails safely', async () => {
    const accessToken = 'shpat_never_print_me';
    const harness = createHarness({
      fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')),
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken,
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'orders', 'example', '--since', '30d'], harness.deps);
    const errorOutput = harness.stderr.join('\n');
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain('Stored OAuth token for example.myshopify.com is missing required scope: read_orders.');
    expect(errorOutput).not.toContain(accessToken);
    expect(errorOutput).not.toContain('audit sink unavailable');
    expect(output).not.toContain(accessToken);
  });
});

function cliProductNode() {
  return {
    id: 'gid://shopify/Product/1001',
    title: 'A Shirt',
    handle: 'a-shirt',
    status: 'ACTIVE',
    vendor: 'Example Vendor',
    productType: 'Apparel',
    totalInventory: 7,
    variants: {
      edges: [{ node: { title: 'Red / S', sku: 'SKU-RED-S', inventoryQuantity: 7 } }],
    },
  };
}

function cliOrderNode() {
  return {
    id: 'gid://shopify/Order/2001',
    name: '#1001',
    createdAt: '2026-05-20T10:30:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    totalPriceSet: { shopMoney: { amount: '42.50', currencyCode: 'USD' } },
    customer: { displayName: 'Ada Lovelace', email: 'ada@example.test' },
    lineItems: {
      edges: [{ node: { title: 'T-Shirt', quantity: 2 } }, { node: { title: 'Mug', quantity: 1 } }],
      pageInfo: { hasNextPage: false },
    },
  };
}
