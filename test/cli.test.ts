import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultStartProcess, isDirectCliRun, runShopifyHermesOauthCli, type CliDependencies } from '../src/cli.js';
import { exchangeShopifyOAuthToken } from '../src/internal/shopify-oauth-token-exchange.js';

function createHarness(overrides: Partial<CliDependencies> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, string>();
  const fileModes = new Map<string, number>();
  const renamedFiles: { readonly from: string; readonly to: string }[] = [];
  const madeDirs: string[] = [];
  const commands = new Set<string>();
  const executedCommands: { readonly command: string; readonly args: readonly string[] }[] = [];
  const startedProcesses: { readonly command: string; readonly args: readonly string[] }[] = [];
  const listenedServers: { readonly host: string; readonly port: number }[] = [];

  const deps: CliDependencies = {
    env: { HERMES_HOME: '/tmp/hermes' },
    homeDir: '/home/alice',
    nodeVersion: 'v20.11.1',
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    commandExists: (command) => commands.has(command),
    executeCommand: (command, args) => {
      executedCommands.push({ command, args });
      return { status: 0 };
    },
    startProcess: (command, args) => {
      startedProcesses.push({ command, args });
      return { stdout: '' };
    },
    listenServer: (_server, options) => {
      listenedServers.push(options);
    },
    readFile: (path) => files.get(path),
    fileIsExecutable: (path) => files.has(path) && ((fileModes.get(path) ?? 0) & 0o111) !== 0,
    writeFile: (path, content, options) => {
      if (options?.flag === 'wx' && files.has(path)) {
        const error = new Error(`File exists: ${path}`) as Error & { code: string };
        error.code = 'EEXIST';
        throw error;
      }

      files.set(path, options?.flag === 'a' ? `${files.get(path) ?? ''}${content}` : content);
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
    unlinkFile: (path) => {
      if (!files.delete(path)) {
        const error = new Error(`File not found: ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        throw error;
      }

      fileModes.delete(path);
    },
    chmod: (path, mode) => {
      fileModes.set(path, mode);
    },
    mkdir: (path) => {
      madeDirs.push(path);
    },
    fetch: () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    appendAuditEvent: () => undefined,
    ...overrides,
  };

  return { commands, deps, executedCommands, fileModes, files, listenedServers, madeDirs, renamedFiles, startedProcesses, stderr, stdout };
}

function signedCliCallbackUrl(
  baseUrl: string,
  clientSecret: string,
  params: Record<'shop' | 'code' | 'state' | 'timestamp', string>,
): string {
  const searchParams = new URLSearchParams(params);
  searchParams.set('hmac', signCliCallbackParams(searchParams, clientSecret));

  return `${baseUrl}/auth/callback?${searchParams.toString()}`;
}

function signCliCallbackParams(params: URLSearchParams, clientSecret: string): string {
  const message = [...params.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return createHmac('sha256', clientSecret).update(message).digest('hex');
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error: Error | undefined) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function withTemporaryPathExecutable(name: string, source: string, run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shopify-hermes-oauth-test-'));
  const executable = join(directory, name);
  await writeFile(executable, source, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath ?? ''}`;

  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as Error & { readonly code?: string }).code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

async function expectProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      expect(isProcessAlive(pid)).toBe(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(isProcessAlive(pid)).toBe(false);
}

async function readPidFile(path: string): Promise<number> {
  return Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
}

function expectNoOldStandaloneMcpAliases(markdown: string): void {
  for (const alias of ['shops_list', 'shops_verify', 'report_products', 'report_orders', 'report_inventory']) {
    expect(markdown).not.toMatch(new RegExp(`(^|[^.\\w])${alias}([^.\\w]|$)`, 'u'));
  }
}

const DEV_SERVER_READY_OUTPUT = 'OAuth callback server listening: http://127.0.0.1:3456\n';

describe('CLI direct-run detection', () => {
  it('treats an npm-linked symlinked bin as a direct CLI invocation', async () => {
    const builtCli = '/repo/shopify-hermes-oauth/dist/cli.js';
    const linkedBin = '/usr/local/bin/shopify-hermes-oauth';
    const realpath = (path: string) => (path === linkedBin ? builtCli : path);

    await expect(isDirectCliRun(linkedBin, `file://${builtCli}`, realpath)).resolves.toBe(true);
  });
});

describe('CLI onboard', () => {
  it('prints a chat-first checklist with separated agent and Shopify-human work without leaking secrets', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://hermes-shopify.trycloudflare.com',
      },
      commandExists: (command) => command === 'hermes' || command === 'cloudflared' || command === 'shopify-hermes-oauth',
    });

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'finbobaggins.myshopify.com', '--app-name', 'hermes-oauth'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(output).toContain('Shopify Hermes OAuth chat-first onboarding');
    expect(output).toContain('Agent can do:');
    expect(output).toContain('Human must do in Shopify:');
    expect(output).toContain('shopify-hermes-oauth init');
    expect(output).toContain('shopify-hermes-oauth credentials set');
    expect(output).toContain('shopify-hermes-oauth doctor');
    expect(output).toContain('shopify-hermes-oauth hermes install');
    expect(output).toContain('shopify-hermes-oauth dev --tunnel');
    expect(output).toContain('App name: hermes-oauth');
    expect(output).toContain('Application URL: https://hermes-shopify.trycloudflare.com');
    expect(output).toContain('Allowed redirection URL: https://hermes-shopify.trycloudflare.com/auth/callback');
    expect(output).toContain('Install URL: https://hermes-shopify.trycloudflare.com/auth/start?shop=finbobaggins.myshopify.com');
    expect(output).toContain('shopify-hermes-oauth shops verify finbobaggins.myshopify.com');
    expect(output).toContain('Configuration: present');
    expect(output).toContain('MCP server: not configured');
    expect(output).toContain('Shops: none installed');
    expect(output).not.toContain('super-secret-value');
    expect(output).not.toContain('public-client-id');
    expect(harness.startedProcesses).toEqual([]);
    expect(harness.executedCommands).toEqual([]);
  });

  it('is idempotent and reports configured MCP plus installed shop state without printing token store contents', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes' || command === 'shopify-hermes-oauth',
    });
    harness.files.set('/tmp/hermes/config.yaml', [
      'mcp_servers:',
      '  shopify-hermes-oauth:',
      '    command: shopify-hermes-oauth',
      '    args: [mcp, serve]',
    ].join('\n'));
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'finbobaggins.myshopify.com': {
          shop: 'finbobaggins.myshopify.com',
          accessToken: 'shpat_do-not-print',
          scopes: ['read_products'],
          storedAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'finbobaggins.myshopify.com'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Configuration: present');
    expect(output).toContain('MCP server: configured');
    expect(output).toContain('Tunnel/app URL: configured');
    expect(output).toContain('Shop finbobaggins.myshopify.com: installed locally (verify with command below)');
    expect(output).toContain('Post-install verification:');
    expect(output).toContain('shopify-hermes-oauth shops verify finbobaggins.myshopify.com');
    expect(output).not.toContain('shpat_do-not-print');
    expect(output).not.toContain('super-secret-value');
    expect(output).not.toContain('tokens.json');
  });

  it('normalizes configured HTTPS app URLs and does not emit double-slash Shopify URLs', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test/',
      },
      commandExists: (command) => command === 'hermes' || command === 'shopify-hermes-oauth',
    });

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'finbobaggins.myshopify.com'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Application URL: https://app.example.test');
    expect(output).toContain('Allowed redirection URL: https://app.example.test/auth/callback');
    expect(output).toContain('Install URL: https://app.example.test/auth/start?shop=finbobaggins.myshopify.com');
    expect(output).not.toContain('https://app.example.test//auth');
    expect(output).not.toContain('super-secret-value');
  });

  it('treats non-HTTPS app URLs as missing for Shopify dashboard values', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'http://app.example.test',
      },
      commandExists: (command) => command === 'hermes' || command === 'shopify-hermes-oauth',
    });

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'finbobaggins.myshopify.com'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Tunnel/app URL: missing/public HTTPS URL needed');
    expect(output).toContain('Application URL: https://<public-app-url>');
    expect(output).toContain('Allowed redirection URL: https://<public-app-url>/auth/callback');
    expect(output).toContain('Install URL: https://<public-app-url>/auth/start?shop=finbobaggins.myshopify.com');
    expect(output).not.toContain('http://app.example.test/auth');
    expect(output).not.toContain('super-secret-value');
  });

  it('treats app URLs with userinfo as missing to avoid leaking credentials', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://user:password@app.example.test',
      },
      commandExists: (command) => command === 'hermes' || command === 'shopify-hermes-oauth',
    });

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'finbobaggins.myshopify.com'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Tunnel/app URL: missing/public HTTPS URL needed');
    expect(output).toContain('Application URL: https://<public-app-url>');
    expect(output).not.toContain('user:password');
    expect(output).not.toContain('password@app.example.test');
    expect(output).not.toContain('super-secret-value');
  });

  it('requires a canonical shop domain and shows onboard usage', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['onboard', '--shop', 'not-a-domain'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth onboard --shop <shop.myshopify.com> [--app-name <name>]');
  });
});

describe('CLI dev tunnel', () => {
  it('starts cloudflared before serve and passes the public app URL to serve', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
      },
      commandExists: (command) => command === 'cloudflared' || command === 'ngrok',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return { stdout: command === 'cloudflared' ? 'INF Requesting new quick Tunnel on trycloudflare.com... https://hermes-shopify.trycloudflare.com' : DEV_SERVER_READY_OUTPUT };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses).toEqual([
      { command: 'cloudflared', args: ['tunnel', '--url', 'http://127.0.0.1:3456'] },
      { command: 'shopify-hermes-oauth', args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.trycloudflare.com'] },
    ]);
    expect(output).toContain('Tunnel provider: cloudflared');
    expect(output).toContain('Application URL: https://hermes-shopify.trycloudflare.com');
    expect(output).toContain('Allowed redirection URL: https://hermes-shopify.trycloudflare.com/auth/callback');
    expect(output).toContain('Health status: OK (https://hermes-shopify.trycloudflare.com/health)');
    expect(output).toContain('Keep this command running while completing the Shopify install.');
    expect(output).not.toContain('super-secret-value');
  });

  it('prints install URL and health status after public health succeeds', async () => {
    const healthChecks: string[] = [];
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      fetch: (input) => {
        healthChecks.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'INF Requesting new quick Tunnel on trycloudflare.com... https://hermes-shopify.trycloudflare.com' }
          : { stdout: DEV_SERVER_READY_OUTPUT };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(healthChecks).toEqual(['https://hermes-shopify.trycloudflare.com/health']);
    expect(output).toContain('Application URL: https://hermes-shopify.trycloudflare.com');
    expect(output).toContain('Allowed redirection URL: https://hermes-shopify.trycloudflare.com/auth/callback');
    expect(output).toContain('Install URL: https://hermes-shopify.trycloudflare.com/auth/start?shop=<shop>.myshopify.com');
    expect(output).toContain('Health status: OK (https://hermes-shopify.trycloudflare.com/health)');
  });

  it('fails with callback guidance and no install-ready claim when public health returns 502', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      fetch: () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com' }
          : { stdout: DEV_SERVER_READY_OUTPUT };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);
    const output = harness.stdout.join('\n');
    const errors = harness.stderr.join('\n');

    expect(exitCode).toBe(1);
    expect(output).toContain('Application URL: https://hermes-shopify.trycloudflare.com');
    expect(output).toContain('Allowed redirection URL: https://hermes-shopify.trycloudflare.com/auth/callback');
    expect(output).not.toContain('Install URL:');
    expect(output).not.toContain('Keep this command running while completing the Shopify install.');
    expect(errors).toContain('Health status: 502 (https://hermes-shopify.trycloudflare.com/health)');
    expect(errors).toContain('Public tunnel health check failed. The tunnel is reachable, but the OAuth callback server is not responding through it.');
    expect(errors).toContain('Make sure the callback server is still running, then rerun `shopify-hermes-oauth dev --tunnel`.');
  });

  it('closes the tunnel and local server when public health fails', async () => {
    const closed: string[] = [];
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      fetch: () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com', close: () => { closed.push('tunnel'); } }
          : { stdout: DEV_SERVER_READY_OUTPUT, close: () => { closed.push('server'); } };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(closed).toEqual(['server', 'tunnel']);
  });

  it('keeps the tunnel and local server running when public health succeeds', async () => {
    const closed: string[] = [];
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com', close: () => { closed.push('tunnel'); } }
          : { stdout: DEV_SERVER_READY_OUTPUT, close: () => { closed.push('server'); } };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(closed).toEqual([]);
  });

  it('times out public health when injected fetch ignores AbortSignal and never settles', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      healthCheckTimeoutMs: 20,
      fetch: () => new Promise<Response>(() => {
        // Intentionally never settle to simulate an injected fetch that ignores AbortSignal.
      }),
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com' }
          : { stdout: DEV_SERVER_READY_OUTPUT };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('Health status: unreachable (https://hermes-shopify.trycloudflare.com/health)');
  }, 500);

  it('starts ngrok before serve and passes the public app URL to serve', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'ngrok',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return { stdout: command === 'ngrok' ? 'Forwarding https://hermes-shopify.ngrok-free.app -> http://127.0.0.1:3456' : DEV_SERVER_READY_OUTPUT };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses).toEqual([
      { command: 'ngrok', args: ['http', 'http://127.0.0.1:3456'] },
      { command: 'shopify-hermes-oauth', args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.ngrok-free.app'] },
    ]);
    expect(output).toContain('Tunnel provider: ngrok');
    expect(output).toContain('Application URL: https://hermes-shopify.ngrok-free.app');
    expect(output).toContain('Allowed redirection URL: https://hermes-shopify.ngrok-free.app/auth/callback');
  });

  it('ignores non-cloudflared HTTPS URLs when extracting the cloudflared tunnel URL', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return {
          stdout: command === 'cloudflared'
            ? 'Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ Try: https://hermes-shopify.trycloudflare.com'
            : DEV_SERVER_READY_OUTPUT,
        };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses[1]).toEqual({
      command: 'shopify-hermes-oauth',
      args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.trycloudflare.com'],
    });
  });

  it('ignores ngrok dashboard URLs and extracts the forwarding ngrok app URL', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'ngrok',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return {
          stdout: command === 'ngrok'
            ? 'Inspect traffic at https://dashboard.ngrok.com Forwarding https://hermes-shopify.ngrok.app -> http://127.0.0.1:3456'
            : DEV_SERVER_READY_OUTPUT,
        };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses[1]).toEqual({
      command: 'shopify-hermes-oauth',
      args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.ngrok.app'],
    });
  });

  it('rejects bare cloudflared provider URLs and uses the tunnel subdomain', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return {
          stdout: command === 'cloudflared'
            ? 'Docs: https://trycloudflare.com Quick tunnel: https://hermes-shopify.trycloudflare.com'
            : DEV_SERVER_READY_OUTPUT,
        };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses[1]).toEqual({
      command: 'shopify-hermes-oauth',
      args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.trycloudflare.com'],
    });
  });

  it.each([
    ['ngrok.io'],
    ['ngrok.app'],
    ['ngrok-free.app'],
  ])('rejects bare %s URLs and uses the ngrok tunnel subdomain', async (bareHostname) => {
    const harness = createHarness({
      commandExists: (command) => command === 'ngrok',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return {
          stdout: command === 'ngrok'
            ? `Docs: https://${bareHostname}/docs Dashboard: https://dashboard.ngrok.com Forwarding https://hermes-shopify.${bareHostname} -> http://127.0.0.1:3456`
            : DEV_SERVER_READY_OUTPUT,
        };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses[1]).toEqual({
      command: 'shopify-hermes-oauth',
      args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', `https://hermes-shopify.${bareHostname}`],
    });
  });

  it.each([
    ['cloudflared', 'https://trycloudflare.com'],
    ['ngrok', 'https://ngrok.io'],
    ['ngrok', 'https://ngrok.app'],
    ['ngrok', 'https://ngrok-free.app'],
  ])('fails safely when %s only prints a bare provider URL %s', async (provider, bareUrl) => {
    const harness = createHarness({
      commandExists: (command) => command === provider,
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return { stdout: command === provider ? `Open dashboard ${bareUrl}` : '' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.startedProcesses).toEqual([
      {
        command: provider,
        args: provider === 'cloudflared' ? ['tunnel', '--url', 'http://127.0.0.1:3456'] : ['http', 'http://127.0.0.1:3456'],
      },
    ]);
    expect(harness.stderr.join('\n')).toContain(`${provider} did not print a public HTTPS URL during startup.`);
  });

  it('prints manual fallback instructions without starting a local server when no tunnel tool is installed', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.startedProcesses).toEqual([]);
    expect(output).toContain('No tunnel tool detected.');
    expect(output).toContain('Install cloudflared or ngrok, then run `shopify-hermes-oauth dev --tunnel` again.');
    expect(output).toContain('Or expose http://127.0.0.1:3456 with your own HTTPS tunnel, then run:');
    expect(output).toContain('shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>');
    expect(output).toContain('Application URL: <your-public-https-url>');
    expect(output).toContain('Allowed redirection URL: <your-public-https-url>/auth/callback');
  });

  it('fails safely when the tunnel exits before printing a public URL', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared' ? { stdout: 'error', status: 2 } : { stdout: '' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.startedProcesses).toEqual([
      { command: 'cloudflared', args: ['tunnel', '--url', 'http://127.0.0.1:3456'] },
    ]);
    expect(harness.stderr.join('\n')).toContain('cloudflared failed before printing a public HTTPS URL.');
  });

  it('fails safely when the tunnel exits by signal before printing a public URL', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'ngrok',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'ngrok' ? { stdout: 'terminated', status: null } : { stdout: '' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.startedProcesses).toEqual([
      { command: 'ngrok', args: ['http', 'http://127.0.0.1:3456'] },
    ]);
    expect(harness.stderr.join('\n')).toContain('ngrok failed before printing a public HTTPS URL.');
  });

  it('fails safely when an installed tunnel tool does not print a public URL during startup', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return { stdout: 'still starting' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.startedProcesses).toEqual([
      { command: 'cloudflared', args: ['tunnel', '--url', 'http://127.0.0.1:3456'] },
    ]);
    expect(harness.stderr.join('\n')).toContain('cloudflared did not print a public HTTPS URL during startup.');
    expect(harness.stderr.join('\n')).toContain('shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <your-public-https-url>');
  });

  it('fails safely when the public-url-aligned local server exits immediately', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com' }
          : { stdout: 'usage', status: 2 };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.startedProcesses).toEqual([
      { command: 'cloudflared', args: ['tunnel', '--url', 'http://127.0.0.1:3456'] },
      { command: 'shopify-hermes-oauth', args: ['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'https://hermes-shopify.trycloudflare.com'] },
    ]);
    expect(harness.stderr.join('\n')).toContain('Local OAuth callback server failed to start.');
  });

  it('fails safely when the public-url-aligned local server does not print readiness', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com' }
          : { stdout: 'booting without a listening signal' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('Local OAuth callback server did not become ready within 5 seconds.');
  });

  it('continues only after the public-url-aligned local server prints readiness', async () => {
    const harness = createHarness({
      commandExists: (command) => command === 'cloudflared',
      startProcess: (command, args) => {
        harness.startedProcesses.push({ command, args });
        return command === 'cloudflared'
          ? { stdout: 'https://hermes-shopify.trycloudflare.com' }
          : { stdout: 'OAuth callback server listening: http://127.0.0.1:3456\nOAuth callback URL: https://hermes-shopify.trycloudflare.com/auth/callback' };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['dev', '--tunnel'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('Keep this command running while completing the Shopify install.');
  });

  it('prints dev usage for missing tunnel flag', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['dev'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth dev --tunnel');
  });
});

describe('defaultStartProcess', () => {
  it('waits for a delayed cloudflared public URL before resolving', async () => {
    await withTemporaryPathExecutable('cloudflared', `#!/usr/bin/env node
setTimeout(() => {
  console.error('INF Requesting new quick Tunnel on trycloudflare.com...');
}, 25);
setTimeout(() => {
  console.error('INF |  Your quick Tunnel has been created! Visit it at https://hermes-shopify.trycloudflare.com  |');
}, 750);
setTimeout(() => {}, 2000);
`, async () => {
      const startedAt = Date.now();
      const result = await defaultStartProcess('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:3456']);

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
      expect(result.stdout).toContain('https://hermes-shopify.trycloudflare.com');
      expect(result.status).toBeUndefined();
      expect(result.close).toEqual(expect.any(Function));
      await result.close?.();
    });
  });

  it('waits for a slow callback-server readiness signal before resolving', async () => {
    await withTemporaryPathExecutable('shopify-hermes-oauth', `#!/usr/bin/env node
setTimeout(() => {
  console.log('OAuth callback server listening: http://127.0.0.1:3456');
}, 750);
setTimeout(() => {}, 2000);
`, async () => {
      const startedAt = Date.now();
      const result = await defaultStartProcess('shopify-hermes-oauth', ['serve']);

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
      expect(result.stdout).toBe('OAuth callback server listening: http://127.0.0.1:3456\n');
      expect(result.close).toEqual(expect.any(Function));
      await result.close?.();
    });
  });

  it('fails safely when the callback server prints an explicit startup error', async () => {
    await withTemporaryPathExecutable('shopify-hermes-oauth', `#!/usr/bin/env node
setTimeout(() => {
  console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:3456');
}, 25);
setTimeout(() => {}, 2000);
`, async () => {
      const result = await defaultStartProcess('shopify-hermes-oauth', ['serve']);

      expect(result).toEqual({
        stdout: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3456\n',
        status: 1,
      });
    });
  });

  it('kills the callback server process after an explicit startup error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shopify-hermes-oauth-test-'));
    const pidFile = join(directory, 'callback-server.pid');

    await withTemporaryPathExecutable('shopify-hermes-oauth', `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {
  console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:3456');
}, 25);
setInterval(() => {}, 1000);
`, async () => {
      const result = await defaultStartProcess('shopify-hermes-oauth', ['serve']);
      const pid = await readPidFile(pidFile);

      expect(result).toEqual({
        stdout: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3456\n',
        status: 1,
      });
      await expectProcessToExit(pid);
    });
  });

  it('kills the callback server process after readiness timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shopify-hermes-oauth-test-'));
    const pidFile = join(directory, 'callback-server.pid');

    await withTemporaryPathExecutable('shopify-hermes-oauth', `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
console.log('booting without a listening signal');
setInterval(() => {}, 1000);
`, async () => {
      const result = await defaultStartProcess('shopify-hermes-oauth', ['serve']);
      const pid = await readPidFile(pidFile);

      expect(result).toEqual({ stdout: 'booting without a listening signal\n' });
      await expectProcessToExit(pid);
    });
  }, 10_000);
});

describe('CLI serve', () => {
  it('recognizes serve and listens through the injected server path without printing secrets', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://configured.example.test',
        SHOPIFY_HERMES_SCOPES: 'read_products, read_orders',
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', 'http://127.0.0.1:3456'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.listenedServers).toEqual([{ host: '127.0.0.1', port: 3456 }]);
    expect(output).toContain('OAuth callback server listening: http://127.0.0.1:3456');
    expect(output).toContain('OAuth callback URL: http://127.0.0.1:3456/auth/callback');
    expect(output).not.toContain('super-secret-value');
  });

  it('uses the default OAuth scopes when SHOPIFY_HERMES_SCOPES is unset', async () => {
    let server: Server | undefined;
    let baseUrl = '';
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://public-app.example.test',
      },
      listenServer: async (createdServer) => {
        server = createdServer;
        await new Promise<void>((resolve) => createdServer.listen(0, '127.0.0.1', resolve));
        const address = createdServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port.toString(10)}`;
      },
    });

    try {
      const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456'], harness.deps);
      expect(exitCode).toBe(0);

      const response = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
      const location = response.headers.get('location');

      expect(location).not.toBeNull();
      expect(new URL(location ?? '').searchParams.get('scope')).toBe('read_products,read_orders,read_inventory,read_locations');
    } finally {
      await closeServer(server);
    }
  });

  it('trims scopes and drops blanks from SHOPIFY_HERMES_SCOPES', async () => {
    let server: Server | undefined;
    let baseUrl = '';
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://public-app.example.test',
        SHOPIFY_HERMES_SCOPES: ' read_products, ,read_orders,, read_inventory ',
      },
      listenServer: async (createdServer) => {
        server = createdServer;
        await new Promise<void>((resolve) => createdServer.listen(0, '127.0.0.1', resolve));
        const address = createdServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port.toString(10)}`;
      },
    });

    try {
      const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456'], harness.deps);
      expect(exitCode).toBe(0);

      const response = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
      const location = response.headers.get('location');

      expect(location).not.toBeNull();
      expect(new URL(location ?? '').searchParams.get('scope')).toBe('read_products,read_orders,read_inventory');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects configured OAuth scope lists with more than 32 scopes using a generic error', async () => {
    const excessiveScopes = Array.from({ length: 33 }, (_, index) => `read_scope_${index.toString(10)}`).join(',');
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://public-app.example.test',
        SHOPIFY_HERMES_SCOPES: excessiveScopes,
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456'], harness.deps);
    const errorOutput = harness.stderr.join('\n');

    expect(exitCode).toBe(1);
    expect(harness.listenedServers).toEqual([]);
    expect(errorOutput).toContain('Invalid Shopify OAuth scope configuration.');
    expect(errorOutput).not.toContain('super-secret-value');
    expect(errorOutput).not.toContain('read_scope_0');
  });

  it('normalizes configured OAuth scopes before starting installs', async () => {
    let server: Server | undefined;
    let baseUrl = '';
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://public-app.example.test',
        SHOPIFY_HERMES_SCOPES: ' Read_Products,read_products, WRITE_ORDERS ',
      },
      listenServer: async (createdServer) => {
        server = createdServer;
        await new Promise<void>((resolve) => createdServer.listen(0, '127.0.0.1', resolve));
        const address = createdServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port.toString(10)}`;
      },
    });

    try {
      const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456'], harness.deps);
      expect(exitCode).toBe(0);

      const response = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
      const location = response.headers.get('location');

      expect(location).not.toBeNull();
      expect(new URL(location ?? '').searchParams.get('scope')).toBe('read_products,write_orders');
    } finally {
      await closeServer(server);
    }
  });

  it('prints serve usage for invalid arguments before listening', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', 'nope'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.listenedServers).toEqual([]);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 [--app-url URL]');
  });

  it('includes the public callback redirect_uri in the Shopify token exchange request', async () => {
    const appUrl = 'https://public-app.example.test';
    const clientSecret = 'super-secret-value';
    const tokenRequests: { readonly url: string; readonly init?: RequestInit }[] = [];
    let server: Server | undefined;
    let baseUrl = '';
    const tokenFetch: typeof globalThis.fetch = (url, init) => {
      const requestUrl = typeof url === 'string' || url instanceof URL ? url.toString() : url.url;
      tokenRequests.push({ url: requestUrl, init });
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'shpat_mocked_access_token', scope: 'read_products,write_orders' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: clientSecret,
        SHOPIFY_HERMES_APP_URL: appUrl,
        SHOPIFY_HERMES_SCOPES: 'read_products,write_orders',
      },
      fetch: tokenFetch,
      listenServer: async (createdServer) => {
        server = createdServer;
        await new Promise<void>((resolve) => createdServer.listen(0, '127.0.0.1', resolve));
        const address = createdServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port.toString(10)}`;
      },
    });

    try {
      const exitCode = await runShopifyHermesOauthCli(['serve', '--host', '127.0.0.1', '--port', '3456', '--app-url', appUrl], harness.deps);
      expect(exitCode).toBe(0);

      const startResponse = await fetch(`${baseUrl}/auth/start?shop=Example.myshopify.com`, { redirect: 'manual' });
      const location = startResponse.headers.get('location');
      expect(location).not.toBeNull();
      const state = new URL(location ?? '').searchParams.get('state');
      expect(state).not.toBeNull();

      const callbackUrl = signedCliCallbackUrl(baseUrl, clientSecret, {
        shop: 'Example.myshopify.com',
        code: 'oauth-code',
        state: state ?? '',
        timestamp: String(Math.floor(Date.now() / 1000)),
      });
      const callbackResponse = await fetch(callbackUrl);

      expect(callbackResponse.status).toBe(200);
      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0]?.url).toBe('https://example.myshopify.com/admin/oauth/access_token');
      expect(typeof tokenRequests[0]?.init?.body).toBe('string');
      expect(JSON.parse(tokenRequests[0]?.init?.body as string)).toEqual({
        client_id: 'client-id',
        client_secret: clientSecret,
        code: 'oauth-code',
        redirect_uri: `${appUrl}/auth/callback`,
      });
    } finally {
      await closeServer(server);
    }
  });
});

describe('Shopify OAuth token exchange', () => {
  it('normalizes the shop domain before constructing the token endpoint', async () => {
    const tokenRequests: { readonly url: string; readonly init?: RequestInit }[] = [];
    const tokenFetch: typeof globalThis.fetch = (url, init) => {
      const requestUrl = typeof url === 'string' || url instanceof URL ? url.toString() : url.url;
      tokenRequests.push({ url: requestUrl, init });

      return Promise.resolve(new Response(JSON.stringify({ access_token: 'shpat_mocked_access_token', scope: 'read_products' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };

    await expect(exchangeShopifyOAuthToken({
      fetch: tokenFetch,
      shop: 'Example',
      code: 'oauth-code',
      redirectUri: 'https://public-app.example.test/auth/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })).resolves.toEqual({ accessToken: 'shpat_mocked_access_token', scopes: 'read_products' });

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.url).toBe('https://example.myshopify.com/admin/oauth/access_token');
  });

  it('classifies Shopify missing required Admin API scope exchange errors without leaking the response body', async () => {
    const tokenFetch: typeof globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: 'At least one scope is required',
      code: 'oauth-code-should-not-leak',
      client_secret: 'client-secret-should-not-leak',
      access_token: 'shpat_token_should_not_leak',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    let thrown: unknown;
    try {
      await exchangeShopifyOAuthToken({
        fetch: tokenFetch,
        shop: 'Example',
        code: 'oauth-code-should-not-leak',
        redirectUri: 'https://public-app.example.test/auth/callback',
        clientId: 'client-id',
        clientSecret: 'client-secret-should-not-leak',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('At least one scope is required');
    expect((thrown as Error & { readonly code?: string }).code).toBe('OAUTH_MISSING_REQUIRED_SCOPES');
    expect((thrown as Error).message).not.toMatch(/oauth-code|client-secret|shpat_|access_token|client_secret|invalid_request/u);
  });

  it('classifies generic OAuth token exchange failures with safe stable codes', async () => {
    await expect(exchangeShopifyOAuthToken({
      fetch: () => Promise.resolve(new Response(JSON.stringify({ error: 'invalid_client', client_secret: 'client-secret-should-not-leak' }), { status: 401 })),
      shop: 'Example',
      code: 'oauth-code-should-not-leak',
      redirectUri: 'https://public-app.example.test/auth/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret-should-not-leak',
    })).rejects.toMatchObject({
      code: 'OAUTH_TOKEN_EXCHANGE_HTTP_ERROR',
      message: 'Shopify OAuth token exchange failed with HTTP 401.',
    });

    await expect(exchangeShopifyOAuthToken({
      fetch: () => Promise.resolve(new Response(JSON.stringify({ scope: 'read_products', access_token: '' }), { status: 200 })),
      shop: 'Example',
      code: 'oauth-code-should-not-leak',
      redirectUri: 'https://public-app.example.test/auth/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret-should-not-leak',
    })).rejects.toMatchObject({
      code: 'OAUTH_TOKEN_EXCHANGE_INVALID_RESPONSE',
      message: 'Shopify OAuth token exchange response did not include an access token.',
    });
  });

  it.each([
    'https://example.myshopify.com',
    'example.myshopify.com/admin/oauth/access_token',
    'example.myshopify.com/path',
    'example.myshopify.com?host=evil',
    'evil.example.com',
  ])('rejects invalid shop value %s before fetching', async (shop) => {
    let fetchCalls = 0;
    const tokenFetch: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('fetch should not be called'));
    };

    await expect(exchangeShopifyOAuthToken({
      fetch: tokenFetch,
      shop,
      code: 'oauth-code',
      redirectUri: 'https://public-app.example.test/auth/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })).rejects.toThrow('Invalid Shopify shop domain');

    expect(fetchCalls).toBe(0);
  });
});

describe('CLI doctor', () => {
  it('detects Hermes Bitwarden mode from safe env markers without printing marker values', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        BWS_ACCESS_TOKEN: 'bws-token-must-not-print',
        BWS_PROJECT_ID: 'project-id-must-not-print',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Hermes Bitwarden Secrets Manager appears enabled');
    expect(output).toContain('SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, SHOPIFY_HERMES_APP_URL');
    expect(output).not.toContain('bws-token-must-not-print');
    expect(output).not.toContain('project-id-must-not-print');
  });

  it('does not treat sibling enabled flags as nested Hermes Bitwarden enablement', async () => {
    const harness = createHarness({
      env: { HERMES_HOME: '/tmp/hermes' },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/config.yaml', [
      'secrets: bitwarden: enabled: false',
      'secrets:',
      '  bitwarden:',
      '    enabled: false',
      '    project_id: project-id-must-not-print',
      '  other_provider:',
      '    enabled: true',
    ].join('\n'));

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).not.toContain('Hermes Bitwarden Secrets Manager appears enabled');
    expect(output).toContain('Run `shopify-hermes-oauth init` to create missing .env keys');
    expect(output).not.toContain('project-id-must-not-print');
  });

  it('supports comments and blank lines in nested Hermes Bitwarden config detection', async () => {
    const harness = createHarness({
      env: { HERMES_HOME: '/tmp/hermes' },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/config.yaml', [
      'secrets: # secret backends',
      '',
      '  bitwarden: # configured by Hermes',
      '    # safe boolean marker only',
      '    enabled: true # values must not be printed',
    ].join('\n'));

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Hermes Bitwarden Secrets Manager appears enabled');
  });

  it('warns safely when required env is absent but Hermes Bitwarden Secrets Manager is enabled', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        BWS_ACCESS_TOKEN: 'bws-never-echo-this',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/config.yaml', [
      'secrets:',
      '  bitwarden:',
      '    enabled: true',
      '    access_token: bws-configured-token-never-echo-this',
      '    project_id: project-id-never-echo-this',
    ].join('\n'));

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Missing required configuration: SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, SHOPIFY_HERMES_APP_URL');
    expect(output).toContain('Hermes Bitwarden Secrets Manager appears enabled');
    expect(output).toContain('current process environment does not include required Shopify connector variables');
    expect(output).toContain('Launch the connector from Hermes after secrets are loaded');
    expect(output).toContain('hermes secrets bitwarden status');
    expect(output).toContain('hermes secrets bitwarden sync');
    expect(output).toContain('SHOPIFY_HERMES_CLIENT_ID');
    expect(output).toContain('SHOPIFY_HERMES_CLIENT_SECRET');
    expect(output).toContain('SHOPIFY_HERMES_APP_URL');
    expect(output).not.toContain('bws-never-echo-this');
    expect(output).not.toContain('bws-configured-token-never-echo-this');
    expect(output).not.toContain('project-id-never-echo-this');
  });

  it('detects flat Hermes Bitwarden configuration for safe missing-env guidance', async () => {
    const harness = createHarness({
      env: { HERMES_HOME: '/tmp/hermes' },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/config.yaml', 'secrets.bitwarden.enabled: true\n');

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Hermes Bitwarden Secrets Manager appears enabled');
    expect(output).toContain('SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, SHOPIFY_HERMES_APP_URL');
  });

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
    expect(output).toContain('Token store: not initialized');
    expect(output).toContain('Audit log: writable');
    expect(output).not.toContain('super-secret-value');
  });

  it('warns about granted OAuth scopes outside the configured least-privilege set', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
        SHOPIFY_HERMES_SCOPES: 'read_products,read_orders,read_inventory,read_locations',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_echo_this',
          scopes: ['read_products', 'write_orders', 'read_inventory', 'read_locations', 'read_customers'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(output).toContain('Scope drift warning: example.myshopify.com has granted scopes outside current configuration: write_orders,read_customers');
    expect(output).toContain('Reinstall or re-authorize the shop to return to least privilege.');
    expect(output).not.toContain('shpat_never_echo_this');
    expect(output).not.toContain('super-secret-value');
  });

  it('prints a clear PATH fix when the connector is installed in a Hermes npm bin directory but not on PATH', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        PATH: '/usr/local/bin:/usr/bin',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/node/bin/shopify-hermes-oauth', '#!/usr/bin/env node\n');
    harness.fileModes.set('/tmp/hermes/node/bin/shopify-hermes-oauth', 0o755);

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Connector CLI: installed but not on PATH');
    expect(output).toContain('/tmp/hermes/node/bin/shopify-hermes-oauth');
    expect(output).toContain('Add the Hermes profile-local npm bin directory to your shell PATH: export PATH="/tmp/hermes/node/bin:$PATH"');
    expect(output).toContain('or install globally from source with `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz`');
    expect(output).not.toContain('super-secret-value');
  });

  it('does not claim a non-executable Hermes npm bin candidate is installed but missing from PATH', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        PATH: '/usr/local/bin:/usr/bin',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/node/bin/shopify-hermes-oauth', 'stale non-executable file\n');
    harness.fileModes.set('/tmp/hermes/node/bin/shopify-hermes-oauth', 0o644);

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(output).toContain('Connector CLI: not found on PATH');
    expect(output).not.toContain('Connector CLI: installed but not on PATH');
    expect(output).not.toContain('export PATH="/tmp/hermes/node/bin:$PATH"');
    expect(output).not.toContain('super-secret-value');
  });

  it('treats generated credential placeholders as missing required configuration', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'replace-with-shopify-client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'replace-with-shopify-client-secret',
        SHOPIFY_HERMES_APP_URL: 'https://your-public-app-url.example.com',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(1);
    expect(output).toContain('Missing required configuration: SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, SHOPIFY_HERMES_APP_URL');
    expect(output).not.toContain('Required configuration: ok');
    expect(output).not.toContain('replace-with-shopify-client-secret');
  });

  it('treats app URL template placeholders as missing required configuration', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://<APP_URL>',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(1);
    expect(output).toContain('Missing required configuration: SHOPIFY_HERMES_APP_URL');
    expect(output).not.toContain('super-secret-value');
  });

  it('treats blank and whitespace required values as missing required configuration', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: '   ',
        SHOPIFY_HERMES_CLIENT_SECRET: '\t',
        SHOPIFY_HERMES_APP_URL: '  ',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(1);
    expect(output).toContain('Missing required configuration: SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, SHOPIFY_HERMES_APP_URL');
  });

  it('checks audit writability without appending a doctor event to the main audit log', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
      appendAuditEvent: () => {
        throw new Error('doctor must not append an audit event');
      },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{"version":1,"shops":{}}');
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/audit.jsonl', '{"action":"shops.list"}\n');

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(output).toContain('Audit log: writable');
    expect(harness.files.get('/tmp/hermes/shopify-hermes-oauth/audit.jsonl')).toBe('{"action":"shops.list"}\n');
    expect(output).not.toContain('doctor.audit_check');
    expect(output).not.toContain('super-secret-value');
  });

  it('fails clearly when the token store contains invalid JSON without echoing contents', async () => {
    const leakedTokenLikeContent = '{"shops":{"example.myshopify.com":{"accessToken":"shpat_never_echo_this"';
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', leakedTokenLikeContent);

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Token store: corrupted/invalid JSON');
    expect(output).toContain('Fix or remove /tmp/hermes/shopify-hermes-oauth/tokens.json before continuing.');
    expect(output).not.toContain('shpat_never_echo_this');
    expect(output).not.toContain(leakedTokenLikeContent);
    expect(output).not.toContain('super-secret-value');
  });

  it('fails clearly when the token store cannot be read without echoing low-level details', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
      readFile: (path) => {
        if (path === '/tmp/hermes/shopify-hermes-oauth/tokens.json') {
          throw Object.assign(new Error('EISDIR: illegal operation on a directory, read tokens.json'), { code: 'EISDIR' });
        }

        return harness.files.get(path);
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Token store: unreadable');
    expect(output).toContain('Check token store path: /tmp/hermes/shopify-hermes-oauth/tokens.json');
    expect(output).not.toContain('EISDIR');
    expect(output).not.toContain('super-secret-value');
  });

  it('uses the runtime token-store parser when validating doctor token store contents', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_echo_this',
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
          metadata: { shopName: 123 },
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Token store: corrupted/invalid JSON');
    expect(output).not.toContain('shpat_never_echo_this');
    expect(output).not.toContain('super-secret-value');
  });

  it('fails clearly when the audit path is not writable', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
      writeFile: (path, content, options) => {
        if (path === '/tmp/hermes/shopify-hermes-oauth/audit.jsonl' && options?.flag === 'a') {
          throw Object.assign(new Error('EISDIR: illegal operation on a directory, open audit.jsonl'), { code: 'EISDIR' });
        }

        harness.files.set(path, content);
      },
      appendAuditEvent: () => {
        throw new Error('doctor must not append an audit event');
      },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{"version":1,"shops":{}}');

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Token store: parseable/ok');
    expect(output).toContain('Audit log: not writable');
    expect(output).toContain('Check audit log path: /tmp/hermes/shopify-hermes-oauth/audit.jsonl');
    expect(output).not.toContain('EISDIR');
    expect(output).not.toContain('super-secret-value');
  });

  it('keeps audit writability probe failures generic when low-level details include secrets', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
        SHOPIFY_HERMES_APP_URL: 'https://app.example.test',
      },
      commandExists: (command) => command === 'hermes',
      writeFile: (path, content, options) => {
        if (path === '/tmp/hermes/shopify-hermes-oauth/audit.jsonl' && options?.flag === 'a') {
          throw new Error('permission denied for shpat_never_echo_this');
        }

        harness.files.set(path, content);
      },
      appendAuditEvent: () => {
        throw new Error('doctor must not append an audit event');
      },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{"version":1,"shops":{}}');

    const exitCode = await runShopifyHermesOauthCli(['doctor'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(output).toContain('Audit log: not writable');
    expect(output).toContain('Check audit log path: /tmp/hermes/shopify-hermes-oauth/audit.jsonl');
    expect(output).not.toContain('permission denied');
    expect(output).not.toContain('shpat_never_echo_this');
    expect(output).not.toContain('super-secret-value');
  });
});

describe('CLI init', () => {
  it('sets Shopify app credentials interactively without printing secrets', async () => {
    const prompted: string[] = [];
    const harness = createHarness({
      promptCredential: (label) => {
        prompted.push(label);
        return label === 'Shopify client ID' ? 'new-client-id' : 'new-client-secret';
      },
    });
    harness.files.set('/tmp/hermes/.env', [
      '# existing file',
      'UNRELATED=value',
      'SHOPIFY_HERMES_CLIENT_ID=old-client-id',
      'SHOPIFY_HERMES_CLIENT_SECRET=old-client-secret',
      'SHOPIFY_HERMES_APP_URL=https://app.example.test',
      'SHOPIFY_HERMES_SCOPES=read_products',
      '',
    ].join('\n'));

    const exitCode = await runShopifyHermesOauthCli(['credentials', 'set'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(prompted).toEqual(['Shopify client ID', 'Shopify client secret']);
    expect(envFile).toBe([
      '# existing file',
      'UNRELATED=value',
      'SHOPIFY_HERMES_CLIENT_ID=new-client-id',
      'SHOPIFY_HERMES_CLIENT_SECRET=new-client-secret',
      'SHOPIFY_HERMES_APP_URL=https://app.example.test',
      'SHOPIFY_HERMES_SCOPES=read_products',
      '',
    ].join('\n'));
    expect(harness.fileModes.get('/tmp/hermes/.env')).toBe(0o600);
    expect(harness.renamedFiles).toHaveLength(1);
    expect(output).toContain('Updated /tmp/hermes/.env with Shopify app credentials.');
    expect(output).toContain('Success: credential handoff complete. Reply `done` in chat; do not share secrets.');
    expect(output).not.toContain('new-client-secret');
    expect(output).not.toContain('old-client-secret');
  });

  it('appends credential keys when missing while preserving unrelated .env lines', async () => {
    const harness = createHarness({
      promptCredential: (label) => (label === 'Shopify client ID' ? 'client-id' : 'client-secret'),
    });
    harness.files.set('/tmp/hermes/.env', 'OTHER=value\nSHOPIFY_HERMES_APP_URL=https://app.example.test\n');

    const exitCode = await runShopifyHermesOauthCli(['credentials', 'set'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';

    expect(exitCode).toBe(0);
    expect(envFile).toBe('OTHER=value\nSHOPIFY_HERMES_APP_URL=https://app.example.test\n\nSHOPIFY_HERMES_CLIENT_ID=client-id\nSHOPIFY_HERMES_CLIENT_SECRET=client-secret\n');
    expect(harness.fileModes.get('/tmp/hermes/.env')).toBe(0o600);
  });

  it('fails credentials set without interactive stdin/TTY with chat-safe guidance', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['credentials', 'set'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(2);
    expect(harness.files.has('/tmp/hermes/.env')).toBe(false);
    expect(output).toContain('Cannot read credentials safely from this session.');
    expect(output).toContain('Run `shopify-hermes-oauth credentials set` from your local terminal or SSH/Termius shell.');
    expect(output).toContain('Do not paste Shopify client secrets into chat or a heredoc.');
  });

  it('rejects multiline interactive credentials without writing or echoing secrets', async () => {
    const harness = createHarness({
      promptCredential: (label) => (label === 'Shopify client ID' ? 'client-id' : 'first line\nINJECTED=value'),
    });

    const exitCode = await runShopifyHermesOauthCli(['credentials', 'set'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(harness.files.has('/tmp/hermes/.env')).toBe(false);
    expect(output).toContain('SHOPIFY_HERMES_CLIENT_SECRET cannot contain newlines.');
    expect(output).not.toContain('first line');
    expect(output).not.toContain('INJECTED');
  });

  it('does not persist Shopify secrets from process env when Hermes Bitwarden mode appears configured', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        BWS_ACCESS_TOKEN: 'bws-token-must-not-print',
        SHOPIFY_HERMES_CLIENT_ID: 'client-id-from-bitwarden-sync',
        SHOPIFY_HERMES_CLIENT_SECRET: 'client-secret-from-bitwarden-sync',
        SHOPIFY_HERMES_APP_URL: 'https://from-bitwarden.example.test',
      },
      commandExists: (command) => command === 'hermes',
    });

    const exitCode = await runShopifyHermesOauthCli(['init'], harness.deps);
    const envFile = harness.files.get('/tmp/hermes/.env') ?? '';
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(0);
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_ID=replace-with-shopify-client-id');
    expect(envFile).toContain('SHOPIFY_HERMES_CLIENT_SECRET=replace-with-shopify-client-secret');
    expect(envFile).toContain('SHOPIFY_HERMES_APP_URL=https://your-public-app-url.example.com');
    expect(envFile).not.toContain('client-id-from-bitwarden-sync');
    expect(envFile).not.toContain('client-secret-from-bitwarden-sync');
    expect(envFile).not.toContain('https://from-bitwarden.example.test');
    expect(output).toContain('Hermes Bitwarden Secrets Manager appears configured');
    expect(output).toContain('hermes secrets bitwarden status');
    expect(output).toContain('hermes secrets bitwarden sync');
    expect(output).not.toContain('bws-token-must-not-print');
    expect(output).not.toContain('client-secret-from-bitwarden-sync');
  });

  it('recommends Bitwarden onboarding for VPS/chat-first users only when Bitwarden appears configured', async () => {
    const bitwardenHarness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        BWS_PROJECT_ID: 'project-id-must-not-print',
      },
      commandExists: (command) => command === 'hermes',
    });

    const bitwardenExitCode = await runShopifyHermesOauthCli(['init'], bitwardenHarness.deps);
    const bitwardenOutput = `${bitwardenHarness.stdout.join('\n')}\n${bitwardenHarness.stderr.join('\n')}`;

    expect(bitwardenExitCode).toBe(0);
    expect(bitwardenOutput).toContain('For VPS/chat-first Hermes deployments, prefer Hermes Bitwarden Secrets Manager');
    expect(bitwardenOutput).toContain('hermes secrets bitwarden status');
    expect(bitwardenOutput).not.toContain('project-id-must-not-print');

    const envHarness = createHarness();

    const envExitCode = await runShopifyHermesOauthCli(['init'], envHarness.deps);
    const envOutput = `${envHarness.stdout.join('\n')}\n${envHarness.stderr.join('\n')}`;

    expect(envExitCode).toBe(0);
    expect(envOutput).toContain('replace placeholders with Shopify app values');
    expect(envOutput).not.toContain('For VPS/chat-first Hermes deployments, prefer Hermes Bitwarden Secrets Manager');
  });

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
      '# existing file\nSHOPIFY_HERMES_CLIENT_ID=existing-id\nUNRELATED=value\n\nSHOPIFY_HERMES_CLIENT_SECRET=super-secret-value\nSHOPIFY_HERMES_APP_URL=https://app.example.test\nSHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations\nSHOPIFY_HERMES_DATA_DIR=/tmp/hermes/shopify-hermes-oauth\nSHOPIFY_HERMES_API_VERSION=2026-01\n',
    );
    expect(envFile).not.toContain('write_');
    expect(envFile).not.toContain('read_customers');
    expect(envFile).not.toContain('read_discounts');
    expect(envFile).not.toContain('read_reports');
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
    expect(envFile).toContain('SHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations');
    expect(envFile).not.toContain('read_customers');
    expect(envFile).not.toContain('read_discounts');
    expect(envFile).not.toContain('read_reports');
    expect(envFile).toContain('SHOPIFY_HERMES_API_VERSION=2026-01');
  });

  it('prints usage for unknown commands', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['wat'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth <doctor|init|onboard|credentials|dev|serve|shops|report|mcp|hermes>');
  });

  it('recognizes the mcp serve command', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['mcp'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth mcp serve');
  });
});

describe('CLI hermes install', () => {
  it('runs Hermes MCP add when Hermes CLI is available and installs a safe local skill', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
      },
    });
    harness.commands.add('hermes');

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);
    const output = harness.stdout.join('\n');
    const skillPath = '/tmp/hermes/skills/productivity/shopify-hermes-oauth/SKILL.md';
    const skill = harness.files.get(skillPath) ?? '';

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([{
      command: 'hermes',
      args: ['mcp', 'add', 'shopify-hermes-oauth', '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'],
    }]);
    expect(harness.madeDirs).toContain('/tmp/hermes/skills/productivity/shopify-hermes-oauth');
    expect(skill).toContain('shopify-hermes-oauth');
    expect(skill).toContain('Prefer the direct-token `shopify` skill');
    expect(skill).toContain('For durable access, multiple stores, scheduled reports, or avoiding pasted per-store tokens, use this OAuth connector.');
    expect(skill).toContain('Do not ask users to paste Shopify access tokens into chat.');
    expect(skill).toContain('Default OAuth installs should request only the v0.1 least-privilege Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.');
    expect(skill).toContain('canonical Admin `*.myshopify.com` domain');
    expect(skill).toContain('If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain');
    expect(skill).not.toContain('read_products,read_orders,read_inventory,read_locations,read_customers');
    expect(skill).not.toContain('`read_customers`');
    expect(skill).toContain('writes missing `.env` keys from current environment values or safe placeholders without printing secrets');
    expect(skill).toContain('it is not an interactive prompt');
    expect(skill).toContain('shopify-hermes-oauth credentials set');
    expect(skill).toContain('shopify-hermes-oauth init');
    expect(skill).toContain('shopify-hermes-oauth doctor');
    expect(skill).toContain('shopify-hermes-oauth hermes install');
    expect(skill).toContain('npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz');
    expect(skill).toContain('Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell');
    expect(skill).toContain('Connector CLI: installed but not on PATH');
    expect(skill).toContain('shopify-hermes-oauth dev --tunnel');
    expect(skill).toContain('shops verify');
    expect(skill).toContain('shopify.health');
    expect(skill).toContain('shopify.list_shops');
    expect(skill).toContain('shopify.verify_shop');
    expect(skill).toContain('shopify.report_products');
    expect(skill).toContain('shopify.report_orders');
    expect(skill).toContain('shopify.report_inventory');
    expect(skill).toContain('shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>');
    expect(skill).toContain('/auth/start?shop=<shop>.myshopify.com');
    expect(skill).toContain('shopify-hermes-oauth report products <shop> --format markdown');
    expect(skill).toContain('shopify-hermes-oauth report orders <shop> --since 30d --format markdown');
    expect(skill).toContain('shopify-hermes-oauth report inventory <shop> --format markdown');
    expect(skill).toContain('## Limits');
    expect(skill).toContain('Products report: shows at most the first 100 variants per product');
    expect(skill).toContain('Orders report: shows at most the first 50 line items per order');
    expect(skill).toContain('Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels');
    expect(skill).toContain('Docs: `README.md`, `docs/shopify-app-setup.md`, `docs/shopify-cli-assisted-setup.md`');
    expect(skill).not.toContain('shopify-hermes-oauth install-url');
    expect(skill).not.toContain('shopify-hermes-oauth serve --app-url <public-https-url>');
    expect(skill).not.toContain('prompts for Shopify app credentials');
    expectNoOldStandaloneMcpAliases(skill);
    expect(skill).not.toMatch(/Pendragon|Infisical|Forgejo|Tailscale/i);
    expect(skill).not.toMatch(/shpat_[a-z0-9_]+/i);
    expect(skill).not.toMatch(/CLIENT_SECRET\s*=\s*[^\s<]/i);
    expect(skill).not.toContain('super-secret-value');
    expect(output).toContain('Configured Hermes MCP server: shopify-hermes-oauth.');
    expect(output).toContain('Installed local Hermes skill: /tmp/hermes/skills/productivity/shopify-hermes-oauth/SKILL.md');
    expect(output).not.toContain('super-secret-value');
  });

  it('prints exact copy-pasteable manual fallback when Hermes CLI is unavailable', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([]);
    expect(output).toContain('Hermes CLI not found. Run this command after installing Hermes:');
    expect(output).toContain('hermes mcp add shopify-hermes-oauth --command "shopify-hermes-oauth" --args mcp serve');
    expect(output).not.toContain('super-secret-value');
  });

  it('is idempotent when existing Hermes MCP config already names this server', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/mcp.json', JSON.stringify({
      servers: {
        'shopify-hermes-oauth': {
          command: 'shopify-hermes-oauth',
          args: ['mcp', 'serve'],
        },
      },
    }));

    await expect(runShopifyHermesOauthCli(['hermes', 'install'], harness.deps)).resolves.toBe(0);
    await expect(runShopifyHermesOauthCli(['hermes', 'install'], harness.deps)).resolves.toBe(0);

    expect(harness.executedCommands).toEqual([]);
    expect(harness.stdout.join('\n')).toContain('Hermes MCP server already configured: shopify-hermes-oauth.');
  });

  it('is idempotent when Hermes config.yaml already names this server under mcp_servers', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/config.yaml', [
      'mcp_servers:',
      '  shopify-hermes-oauth:',
      '    command: shopify-hermes-oauth',
      '    args:',
      '      - mcp',
      '      - serve',
      '    env:',
      '      SHOPIFY_HERMES_CLIENT_SECRET: super-secret-value',
      '',
    ].join('\n'));

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([]);
    expect(output).toContain('Hermes MCP server already configured: shopify-hermes-oauth.');
    expect(output).not.toContain('super-secret-value');
  });

  it('does not treat comments or stale notes mentioning this server as installed', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/config.yaml', [
      '# Tried shopify-hermes-oauth before, but removed the MCP server.',
      'mcp_servers:',
      '  other-server:',
      '    command: other-server',
      '    args:',
      '      - mcp',
      '      - serve',
      '',
    ].join('\n'));
    harness.files.set('/tmp/hermes/mcp.json', JSON.stringify({
      notes: 'stale text: shopify-hermes-oauth used to be configured here',
      servers: {
        unrelated: {
          command: 'shopify-hermes-oauth-helper',
          args: ['mcp', 'serve'],
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([{
      command: 'hermes',
      args: ['mcp', 'add', 'shopify-hermes-oauth', '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'],
    }]);
    expect(harness.stdout.join('\n')).toContain('Configured Hermes MCP server: shopify-hermes-oauth.');
  });

  it('is idempotent for valid Hermes MCP config with command and args shape', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/config.json', JSON.stringify({
      mcpServers: {
        shopify: {
          command: 'shopify-hermes-oauth',
          args: ['mcp', 'serve'],
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([]);
    expect(harness.stdout.join('\n')).toContain('Hermes MCP server already configured: shopify-hermes-oauth.');
  });

  it('does not treat unrelated JSON metadata command and args as installed', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/config.json', JSON.stringify({
      metadata: {
        lastCommand: {
          command: 'shopify-hermes-oauth',
          args: ['mcp', 'serve'],
        },
      },
      mcpServers: {
        unrelated: {
          command: 'other-server',
          args: ['mcp', 'serve'],
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([{
      command: 'hermes',
      args: ['mcp', 'add', 'shopify-hermes-oauth', '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'],
    }]);
    expect(harness.stdout.join('\n')).toContain('Configured Hermes MCP server: shopify-hermes-oauth.');
  });

  it('does not treat JSON MCP config with malformed non-string args as installed', async () => {
    const harness = createHarness({ commandExists: (command) => command === 'hermes' });
    harness.files.set('/tmp/hermes/mcp.json', JSON.stringify({
      servers: {
        shopify: {
          command: 'shopify-hermes-oauth',
          args: ['mcp', 123, 'serve'],
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.executedCommands).toEqual([{
      command: 'hermes',
      args: ['mcp', 'add', 'shopify-hermes-oauth', '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'],
    }]);
    expect(harness.stdout.join('\n')).toContain('Configured Hermes MCP server: shopify-hermes-oauth.');
  });

  it('returns failure with sanitized manual fallback when Hermes MCP add fails', async () => {
    const harness = createHarness({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'super-secret-value',
      },
      commandExists: (command) => command === 'hermes',
      executeCommand: (command, args) => {
        harness.executedCommands.push({ command, args });
        return { status: 1 };
      },
    });

    const exitCode = await runShopifyHermesOauthCli(['hermes', 'install'], harness.deps);
    const output = `${harness.stdout.join('\n')}\n${harness.stderr.join('\n')}`;

    expect(exitCode).toBe(1);
    expect(harness.executedCommands).toEqual([{
      command: 'hermes',
      args: ['mcp', 'add', 'shopify-hermes-oauth', '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'],
    }]);
    expect(harness.stderr.join('\n')).toContain('Hermes MCP configuration failed. Run manually: hermes mcp add shopify-hermes-oauth --command "shopify-hermes-oauth" --args mcp serve');
    expect(output).not.toContain('super-secret-value');
  });

  it('prints usage for unknown hermes subcommands', async () => {
    const harness = createHarness();

    const exitCode = await runShopifyHermesOauthCli(['hermes'], harness.deps);

    expect(exitCode).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth hermes install');
  });
});

describe('CLI shops', () => {
  it('does not let shops list success audit failures mask the successful operation', async () => {
    const harness = createHarness({
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
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

    const exitCode = await runShopifyHermesOauthCli(['shops', 'list'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('example.myshopify.com');
    expect(harness.stderr.join('\n')).not.toContain('audit sink unavailable');
  });

  it('audits shops list token-store failures best-effort without leaking store details', async () => {
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => { auditEvents.push(event); },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{not-json-with-shpat_secret');

    const exitCode = await runShopifyHermesOauthCli(['shops', 'list'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('Could not read token store.');
    expect(harness.stderr.join('\n')).not.toContain('shpat_secret');
    expect(auditEvents).toEqual([{
      action: 'shops.list',
      result: 'failure',
      metadata: { source: 'cli', actor: 'cli', mode: 'read-only', reason: 'token_store_list_failed' },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_secret');
  });

  it('lists shop domains and non-secret metadata without token values', async () => {
    const auditEvents: unknown[] = [];
    const harness = createHarness({ appendAuditEvent: (_path, event) => { auditEvents.push(event); } });
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
    expect(auditEvents).toEqual([{
      action: 'shops.list',
      result: 'success',
      metadata: { source: 'cli', actor: 'cli', mode: 'read-only', shopCount: 1 },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_never_print_me');
  });

  it('removes a normalized shop and never prints token values', async () => {
    const auditEvents: unknown[] = [];
    const harness = createHarness({ appendAuditEvent: (_path, event) => { auditEvents.push(event); } });
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
    expect(auditEvents).toEqual([{
      action: 'shops.remove',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: { source: 'cli', actor: 'cli', mode: 'write', removed: true },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain('secret-token-value');
  });

  it('does not let shops remove success audit failures mask the successful operation', async () => {
    const harness = createHarness({
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
    });
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

    const exitCode = await runShopifyHermesOauthCli(['shops', 'remove', 'example'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('Removed example.myshopify.com');
    expect(harness.stderr.join('\n')).not.toContain('audit sink unavailable');
  });

  it('audits shops remove token-store failures best-effort without masking the primary failure', async () => {
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => { auditEvents.push(event); },
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', '{not-json-with-secret-token-value');

    const exitCode = await runShopifyHermesOauthCli(['shops', 'remove', 'example'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('Could not update token store.');
    expect(auditEvents).toEqual([{
      action: 'shops.remove',
      shop: 'example.myshopify.com',
      result: 'failure',
      metadata: { source: 'cli', actor: 'cli', mode: 'write', reason: 'token_store_remove_failed' },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain('secret-token-value');
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
    expect(output).toContain('read_orders\\ninjected');
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
        source: 'cli',
        actor: 'cli',
        mode: 'read-only',
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
      metadata: { source: 'cli', actor: 'cli', mode: 'read-only', reason: 'missing_oauth_record' },
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
  it('rejects malformed products report extras before token lookup', async () => {
    for (const args of [
      ['report', 'products', 'example', '--since', '30d'],
      ['report', 'products', 'example', '--low-stock-threshold', '4'],
      ['report', 'products', 'example', '--format', 'markdown', 'garbage'],
    ]) {
      const harness = createHarness({ fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')) });

      await expect(runShopifyHermesOauthCli(args, harness.deps)).resolves.toBe(2);
      expect(harness.stderr.join('\n')).toContain('Usage: shopify-hermes-oauth report products <shop> [--format markdown|json|csv]');
    }
  });

  it('does not let products report success audit failures mask successful output', async () => {
    const harness = createHarness({
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        data: { products: { edges: [{ cursor: 'cursor-1', node: cliProductNode() }], pageInfo: { hasNextPage: false, endCursor: 'cursor-1' } } },
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

    const exitCode = await runShopifyHermesOauthCli(['report', 'products', 'example'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('A Shirt');
    expect(harness.stderr.join('\n')).not.toContain('audit sink unavailable');
  });

  it('prints a markdown products report for an installed shop without exposing tokens', async () => {
    const accessToken = 'shpat_never_print_me';
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
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
    expect(auditEvents).toEqual([{
      action: 'report.products',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: { source: 'cli', actor: 'cli', mode: 'read-only', format: 'markdown', productCount: 1 },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain(accessToken);
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
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')),
    });

    const exitCode = await runShopifyHermesOauthCli(['report', 'products', 'missing'], harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('No stored OAuth token found for missing.myshopify.com.');
    expect(harness.stderr.join('\n')).not.toContain('shpat_');
    expect(auditEvents).toEqual([{
      action: 'report.products',
      shop: 'missing.myshopify.com',
      result: 'failure',
      metadata: { source: 'cli', actor: 'cli', mode: 'read-only', reason: 'report_failed' },
    }]);
  });

  it('audits aggregate-only product report failures without leaking response secrets', async () => {
    const accessToken = 'shpat_never_print_me';
    const responseSecret = 'plain_response_secret';
    const auditEvents: unknown[] = [];
    const harness = createHarness({
      appendAuditEvent: (_path, event) => {
        auditEvents.push(event);
      },
      fetch: () => Promise.resolve(new Response(JSON.stringify({
        errors: [{ message: `Denied for X-Shopify-Access-Token: ${accessToken}; access_token=${responseSecret}` }],
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

    const exitCode = await runShopifyHermesOauthCli(['report', 'products', 'example'], harness.deps);
    const serializedAudit = JSON.stringify(auditEvents);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('[REDACTED]');
    expect(serializedAudit).toContain('"reason":"report_failed"');
    expect(serializedAudit).toContain('"action":"report.products"');
    for (const secret of [accessToken, responseSecret, 'X-Shopify-Access-Token']) {
      expect(harness.stderr.join('\n')).not.toContain(secret);
      expect(serializedAudit).not.toContain(secret);
    }
    expect(serializedAudit).not.toContain('[REDACTED]');
  });
});

describe('CLI report inventory', () => {
  it('rejects malformed inventory report extras before token lookup', async () => {
    for (const args of [
      ['report', 'inventory', 'example', '--since', '30d', 'garbage'],
      ['report', 'inventory', 'example', '--low-stock-threshold', '4', 'garbage'],
    ]) {
      const harness = createHarness({ fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')) });

      await expect(runShopifyHermesOauthCli(args, harness.deps)).resolves.toBe(2);
      expect(harness.stderr.join('\n')).toContain('shopify-hermes-oauth report inventory <shop> [--format markdown|json|csv] [--low-stock-threshold N]');
    }
  });

  it('does not let inventory report success audit failures mask successful output', async () => {
    const harness = createHarness({
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
      fetch: (_url, init) => Promise.resolve(new Response(JSON.stringify(readGraphqlQuery(init).includes('inventoryItem(id: $inventoryItemId)')
        ? cliInventoryLevelsGraphqlResponse()
        : { data: { products: { edges: [{ cursor: 'cursor-1', node: cliInventoryProductNode() }], pageInfo: { hasNextPage: false, endCursor: 'cursor-1' } } } }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products', 'read_inventory', 'read_locations'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'inventory', 'example'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('Main Warehouse');
    expect(harness.stderr.join('\n')).not.toContain('audit sink unavailable');
  });

  it('prints a markdown inventory report for an installed shop without exposing tokens and audits success', async () => {
    const accessToken = 'shpat_never_print_me';
    const audits: unknown[] = [];
    const requests: unknown[] = [];
    const harness = createHarness({
      fetch: (_url, init) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        requests.push(JSON.parse(body) as unknown);
        return Promise.resolve(new Response(JSON.stringify(readGraphqlQuery(init).includes('inventoryItem(id: $inventoryItemId)')
          ? cliInventoryLevelsGraphqlResponse()
          : {
            data: {
              products: {
                edges: [{ cursor: 'cursor-1', node: cliInventoryProductNode() }],
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
          scopes: ['read_products', 'read_inventory', 'read_locations'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'inventory', 'example', '--format', 'markdown', '--low-stock-threshold', '4'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('| Product ID | Product GID | Product | Variant ID | Variant GID | Variant | SKU | Inventory Item GID | Location | Available | On Hand | Committed | Low Stock |');
    expect(output).toContain('| 1001 | gid://shopify/Product/1001 | A Shirt | 2001 | gid://shopify/ProductVariant/2001 | Red / S | SKU-RED-S | gid://shopify/InventoryItem/3001 | Main Warehouse | 3 | 7 | 4 | yes |');
    expect(JSON.stringify(requests)).toContain('inventoryLevels');
    expect(output).not.toContain(accessToken);
    expect(JSON.stringify(audits)).not.toContain(accessToken);
    expect(JSON.stringify(audits)).toContain('"action":"report.inventory"');
    expect(JSON.stringify(audits)).toContain('"shop":"example.myshopify.com"');
    expect(JSON.stringify(audits)).toContain('"rowCount":1');
    expect(JSON.stringify(audits)).toContain('"threshold":4');
  });

  it('prints json and csv inventory reports and validates threshold safely', async () => {
    const harness = createHarness({
      fetch: (_url, init) => Promise.resolve(new Response(JSON.stringify(readGraphqlQuery(init).includes('inventoryItem(id: $inventoryItemId)')
        ? cliInventoryLevelsGraphqlResponse()
        : { data: { products: { edges: [{ cursor: 'cursor-1', node: cliInventoryProductNode({ sku: null }) }], pageInfo: { hasNextPage: false, endCursor: 'cursor-1' } } } }), { headers: { 'content-type': 'application/json' } })),
    });
    harness.files.set('/tmp/hermes/shopify-hermes-oauth/tokens.json', JSON.stringify({
      version: 1,
      shops: {
        'example.myshopify.com': {
          shop: 'example.myshopify.com',
          accessToken: 'shpat_never_print_me',
          scopes: ['read_products', 'read_inventory', 'read_locations'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    await expect(runShopifyHermesOauthCli(['report', 'inventory', 'example', '--format', 'json'], harness.deps)).resolves.toBe(0);
    expect(JSON.parse(harness.stdout.join('\n'))).toEqual(expect.objectContaining({ rows: [expect.objectContaining({ sku: '', locationName: 'Main Warehouse' })] }));

    harness.stdout.length = 0;
    await expect(runShopifyHermesOauthCli(['report', 'inventory', 'example', '--format', 'csv'], harness.deps)).resolves.toBe(0);
    expect(harness.stdout.join('\n')).toContain('productId,productGid,productTitle,variantId,variantGid,variantTitle,sku,inventoryItemGid,locationName,available,onHand,committed,lowStock');
    expect(harness.stdout.join('\n')).toContain('"1001","gid://shopify/Product/1001","A Shirt"');

    const invalidHarness = createHarness({ fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')) });
    await expect(runShopifyHermesOauthCli(['report', 'inventory', 'example', '--low-stock-threshold', '-1'], invalidHarness.deps)).resolves.toBe(2);
    expect(invalidHarness.stderr.join('\n')).toContain('Inventory report low-stock threshold must be a non-negative integer.');

    const decimalHarness = createHarness({ fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')) });
    await expect(runShopifyHermesOauthCli(['report', 'inventory', 'example', '--low-stock-threshold', '4.0'], decimalHarness.deps)).resolves.toBe(2);
    expect(decimalHarness.stderr.join('\n')).toContain('Inventory report low-stock threshold must be a non-negative integer.');
  });

  it('fails before fetching when stored token lacks read_inventory or read_products and audits safely', async () => {
    const accessToken = 'shpat_never_print_me';
    const audits: unknown[] = [];
    const harness = createHarness({
      fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')),
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
          scopes: ['read_products'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'inventory', 'example'], harness.deps);
    const errorOutput = harness.stderr.join('\n');

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain('Stored OAuth token for example.myshopify.com is missing required Shopify Admin API scopes: read_inventory, read_locations.');
    expect(errorOutput).toContain('Reinstall or re-authorize the shop');
    expect(errorOutput).not.toContain(accessToken);
    expect(JSON.stringify(audits)).not.toContain(accessToken);
    expect(JSON.stringify(audits)).toContain('"action":"report.inventory"');
    expect(JSON.stringify(audits)).toContain('"result":"failure"');
    expect(JSON.stringify(audits)).toContain('"reason":"report_failed"');
    expect(JSON.stringify(audits)).not.toContain('read_inventory');
  });
});

describe('CLI report orders', () => {
  it('rejects malformed orders report extras before token lookup', async () => {
    for (const args of [
      ['report', 'orders', 'example', '--since', '30d', 'garbage'],
      ['report', 'orders', 'example', '--from', '2026-05-01', '--to', '2026-05-22', '--low-stock-threshold', '4'],
    ]) {
      const harness = createHarness({ fetch: () => Promise.reject(new Error('Admin GraphQL should not be called')) });

      await expect(runShopifyHermesOauthCli(args, harness.deps)).resolves.toBe(2);
      expect(harness.stderr.join('\n')).toContain('shopify-hermes-oauth report orders <shop> (--since 30d | --from YYYY-MM-DD --to YYYY-MM-DD) [--format markdown|json|csv]');
    }
  });

  it('does not let orders report success audit failures mask successful output', async () => {
    const harness = createHarness({
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
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

    const exitCode = await runShopifyHermesOauthCli(['report', 'orders', 'example', '--since', '30d'], harness.deps);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('\n')).toContain('#1001');
    expect(harness.stderr.join('\n')).not.toContain('audit sink unavailable');
  });

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
          scopes: ['write_orders'],
          storedAt: '2026-05-22T12:00:00.000Z',
          updatedAt: '2026-05-22T12:00:00.000Z',
        },
      },
    }));

    const exitCode = await runShopifyHermesOauthCli(['report', 'orders', 'example', '--since', '30d', '--format', 'markdown'], harness.deps);
    const output = harness.stdout.join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('| ID | GID | Name | Created At | Financial Status | Fulfillment Status | Total | Currency | Line Items |');
    expect(output).toContain('| 2001 | gid://shopify/Order/2001 | #1001 | 2026-05-20T10:30:00Z | PAID | UNFULFILLED | 42.50 | USD | 2 items: T-Shirt x2; Mug x1 |');
    expect(output).not.toContain('Ada Lovelace');
    expect(output).not.toContain('ada@example.test');
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
    expect(errorOutput).toContain('Stored OAuth token for example.myshopify.com is missing required Shopify Admin API scope: read_orders.');
    expect(errorOutput).toContain('Reinstall or re-authorize the shop');
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

function readGraphqlQuery(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    return '';
  }

  const body = JSON.parse(init.body) as { readonly query?: unknown };
  return typeof body.query === 'string' ? body.query : '';
}

function cliInventoryLevelsGraphqlResponse() {
  return {
    data: {
      inventoryItem: {
        inventoryLevels: {
          edges: [{
            node: {
              location: { name: 'Main Warehouse' },
              quantities: [{ name: 'available', quantity: 3 }, { name: 'on_hand', quantity: 7 }, { name: 'committed', quantity: 4 }],
            },
          }],
          pageInfo: { hasNextPage: false, endCursor: 'level-cursor-1' },
        },
      },
    },
  };
}

function cliInventoryProductNode(overrides: Partial<{ readonly sku: string | null }> = {}) {
  return {
    id: 'gid://shopify/Product/1001',
    title: 'A Shirt',
    variants: {
      edges: [{
        node: {
          id: 'gid://shopify/ProductVariant/2001',
          title: 'Red / S',
          sku: Object.hasOwn(overrides, 'sku') ? overrides.sku : 'SKU-RED-S',
          inventoryItem: {
            id: 'gid://shopify/InventoryItem/3001',
            inventoryLevels: {
              edges: [{
                node: {
                  location: { name: 'Main Warehouse' },
                  quantities: [{ name: 'available', quantity: 3 }, { name: 'on_hand', quantity: 7 }, { name: 'committed', quantity: 4 }],
                },
              }],
            },
          },
        },
      }],
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
