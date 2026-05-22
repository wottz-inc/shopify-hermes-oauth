#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod as fsChmod, mkdir as fsMkdir, readFile as fsReadFile, rename as fsRename, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendAuditEvent, type AuditEventInput } from './audit.js';
import { resolveShopifyHermesPaths } from './hermes-home.js';
import { startStdioMcpServer, type McpServerDependencies } from './mcp/server.js';
import { formatInventoryReport, generateInventoryReport, InventoryReportError } from './reports/inventory.js';
import { formatOrdersReport, generateOrdersReport, parseOrdersReportWindow, type OrdersReportWindowInput } from './reports/orders.js';
import { formatProductsReport, generateProductsReport, type ProductsReportFormat } from './reports/products.js';
import { createShopifyAdminGraphqlClient, redactSensitiveErrorMessage } from './shopify/admin-client.js';
import { verifyShop, type VerifyShopResult } from './shops/verify.js';
import { LocalJsonTokenStore, normalizeTokenStoreShopDomain, type StoredShopToken } from './tokens/local-token-store.js';

const REQUIRED_CONFIG_KEYS = [
  'SHOPIFY_HERMES_CLIENT_ID',
  'SHOPIFY_HERMES_CLIENT_SECRET',
  'SHOPIFY_HERMES_APP_URL',
] as const;

const INIT_ENV_KEYS = [
  ...REQUIRED_CONFIG_KEYS,
  'SHOPIFY_HERMES_SCOPES',
  'SHOPIFY_HERMES_DATA_DIR',
  'SHOPIFY_HERMES_API_VERSION',
] as const;

const DEFAULT_SHOPIFY_HERMES_APP_URL = 'https://your-public-app-url.example.com';
const DEFAULT_SHOPIFY_HERMES_SCOPES = 'read_products,read_orders,read_inventory,read_locations,read_customers,read_discounts,read_reports';
const DEFAULT_SHOPIFY_HERMES_API_VERSION = '2026-01';

type RequiredConfigKey = (typeof REQUIRED_CONFIG_KEYS)[number];
type InitEnvKey = (typeof INIT_ENV_KEYS)[number];

export interface CliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly nodeVersion?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly readFile?: (path: string) => string | undefined | Promise<string | undefined>;
  readonly writeFile?: (path: string, content: string, options?: { readonly mode?: number }) => void | Promise<void>;
  readonly renameFile?: (from: string, to: string) => void | Promise<void>;
  readonly chmod?: (path: string, mode: number) => void | Promise<void>;
  readonly mkdir?: (path: string) => void | Promise<void>;
  readonly fetch?: typeof globalThis.fetch;
  readonly appendAuditEvent?: (path: string, event: AuditEventInput) => void | Promise<void>;
}

interface CliContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string | undefined;
  readonly nodeVersion: string;
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly commandExists: (command: string) => Promise<boolean>;
  readonly readFile: (path: string) => Promise<string | undefined>;
  readonly writeEnvFile: (path: string, content: string) => Promise<void>;
  readonly writeJsonFile: (path: string, content: string) => Promise<void>;
  readonly renameFile: (from: string, to: string) => Promise<void>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly fetch: typeof globalThis.fetch;
  readonly appendAuditEvent: (path: string, event: AuditEventInput) => Promise<void>;
}

class UnsafeEnvValueError extends Error {
  public constructor(key: string) {
    super(`${key} cannot contain newlines. Remove line breaks before running init again.`);
  }
}

export async function runShopifyHermesOauthCli(
  args = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const context = createCliContext(dependencies);
  const command = args[0] ?? 'help';

  if (command === 'doctor') {
    return runDoctor(context);
  }

  if (command === 'init') {
    return runInit(context);
  }

  if (command === 'shops') {
    return runShops(args.slice(1), context);
  }

  if (command === 'report') {
    return runReport(args.slice(1), context);
  }

  if (command === 'mcp') {
    return runMcp(args.slice(1), context);
  }

  context.stderr(usage());
  return command === 'help' || command === '--help' || command === '-h' ? 0 : 2;
}

async function runShops(args: readonly string[], context: CliContext): Promise<number> {
  const subcommand = args[0];

  if (subcommand === 'list') {
    const store = await createTokenStore(context);
    const tokens = await store.listTokens();

    if (tokens.length === 0) {
      context.stdout('No shops installed.');
      return 0;
    }

    for (const token of tokens) {
      context.stdout(formatShopListEntry(token));
    }

    return 0;
  }

  if (subcommand === 'remove') {
    const shop = args[1];

    if (!isPresent(shop)) {
      context.stderr(shopsUsage());
      return 2;
    }

    let normalizedShop: string;

    try {
      normalizedShop = normalizeTokenStoreShopDomain(shop);
    } catch {
      context.stderr('Invalid Shopify shop domain.');
      return 2;
    }

    try {
      const store = await createTokenStore(context);
      const removed = await store.deleteToken(normalizedShop);

      context.stdout(removed ? `Removed ${normalizedShop}.` : `No token found for ${normalizedShop}.`);
      return 0;
    } catch {
      context.stderr('Could not update token store. Check local token storage and try again.');
      return 1;
    }
  }

  if (subcommand === 'verify') {
    const shop = args[1];

    if (!isPresent(shop)) {
      context.stderr(shopsUsage());
      return 2;
    }

    let normalizedShop: string;

    try {
      normalizedShop = normalizeTokenStoreShopDomain(shop);
    } catch {
      context.stderr('Invalid Shopify shop domain.');
      return 2;
    }

    try {
      const runtime = await resolveRuntimeConfiguration(context);
      const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
      const adminClient = createShopifyAdminGraphqlClient({
        apiVersion: runtime.mergedEnv.SHOPIFY_HERMES_API_VERSION ?? DEFAULT_SHOPIFY_HERMES_API_VERSION,
        fetch: context.fetch,
      });
      const result = await verifyShop({
        shop: normalizedShop,
        tokenStore: store,
        adminClient,
        appendAuditEvent: async (event) => context.appendAuditEvent(runtime.paths.auditLog, event),
      });

      context.stdout(formatShopVerificationResult(result));
      return 0;
    } catch (error) {
      context.stderr(error instanceof Error ? error.message : 'Could not verify shop.');
      return 1;
    }
  }

  context.stderr(shopsUsage());
  return 2;
}

async function runReport(args: readonly string[], context: CliContext): Promise<number> {
  const subcommand = args[0];

  if (subcommand !== 'products' && subcommand !== 'orders' && subcommand !== 'inventory') {
    context.stderr(reportUsage());
    return 2;
  }

  const shop = args[1];

  if (!isPresent(shop)) {
    context.stderr(reportUsage());
    return 2;
  }

  const reportArgs = args.slice(2);
  const parsedFormat = parseReportFormat(reportArgs.filter((arg, index) => reportArgs[index - 1] !== '--since' && reportArgs[index - 1] !== '--from' && reportArgs[index - 1] !== '--to' && reportArgs[index - 1] !== '--low-stock-threshold' && arg !== '--since' && arg !== '--from' && arg !== '--to' && arg !== '--low-stock-threshold'));

  if (parsedFormat === undefined) {
    context.stderr('Invalid report format. Use markdown, json, or csv.');
    return 2;
  }

  let ordersWindowInput: OrdersReportWindowInput | undefined;
  let lowStockThreshold = 5;
  if (subcommand === 'orders') {
    const parsedOrdersArgs = parseOrdersReportArgs(reportArgs);
    if (parsedOrdersArgs === undefined) {
      context.stderr(reportUsage());
      return 2;
    }
    try {
      parseOrdersReportWindow(parsedOrdersArgs);
    } catch (error) {
      context.stderr(error instanceof Error ? error.message : 'Invalid orders report date window.');
      return 2;
    }
    ordersWindowInput = parsedOrdersArgs;
  }

  if (subcommand === 'inventory') {
    let parsedInventoryArgs: InventoryReportArgs | undefined;
    try {
      parsedInventoryArgs = parseInventoryReportArgs(reportArgs);
    } catch (error) {
      context.stderr(error instanceof Error ? error.message : 'Invalid inventory report options.');
      return 2;
    }

    if (parsedInventoryArgs === undefined) {
      context.stderr(reportUsage());
      return 2;
    }

    if (parsedInventoryArgs.lowStockThreshold !== undefined) {
      lowStockThreshold = parsedInventoryArgs.lowStockThreshold;
    }
  }

  let normalizedShop: string;

  try {
    normalizedShop = normalizeTokenStoreShopDomain(shop);
  } catch {
    context.stderr('Invalid Shopify shop domain.');
    return 2;
  }

  const runtime = await resolveRuntimeConfiguration(context);

  try {
    const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
    const token = await store.getToken(normalizedShop);

    if (token === undefined) {
      context.stderr(`No stored OAuth token found for ${normalizedShop}.`);
      return 1;
    }

    if (subcommand === 'orders' && !token.scopes.includes('read_orders')) {
      throw new Error(`Stored OAuth token for ${normalizedShop} is missing required scope: read_orders.`);
    }

    if (subcommand === 'inventory') {
      if (!token.scopes.includes('read_inventory')) {
        throw new Error(`Stored OAuth token for ${normalizedShop} is missing required scope: read_inventory.`);
      }

      if (!token.scopes.includes('read_products')) {
        throw new Error(`Stored OAuth token for ${normalizedShop} is missing required scope: read_products.`);
      }
    }

    const adminClient = createShopifyAdminGraphqlClient({
      apiVersion: runtime.mergedEnv.SHOPIFY_HERMES_API_VERSION ?? DEFAULT_SHOPIFY_HERMES_API_VERSION,
      fetch: context.fetch,
    });

    if (subcommand === 'products') {
      const report = await generateProductsReport({
        client: {
          query: (query, variables) => adminClient.query({
            shop: normalizedShop,
            accessToken: token.accessToken,
            query,
            variables,
          }),
        },
      });

      context.stdout(formatProductsReport(report, parsedFormat));
      return 0;
    }

    if (subcommand === 'inventory') {
      const report = await generateInventoryReport({
        client: {
          query: (query, variables) => adminClient.query({
            shop: normalizedShop,
            accessToken: token.accessToken,
            query,
            variables,
          }),
        },
        lowStockThreshold,
      });

      await context.appendAuditEvent(runtime.paths.auditLog, {
        action: 'report.inventory',
        shop: normalizedShop,
        result: 'success',
        metadata: { format: parsedFormat, rowCount: report.rows.length, threshold: lowStockThreshold },
      });
      context.stdout(formatInventoryReport(report, parsedFormat));
      return 0;
    }

    const report = await generateOrdersReport({
      client: {
        query: (query, variables) => adminClient.query({
          shop: normalizedShop,
          accessToken: token.accessToken,
          query,
          variables,
        }),
      },
      window: ordersWindowInput ?? {},
    });

    await context.appendAuditEvent(runtime.paths.auditLog, {
      action: 'report.orders',
      shop: normalizedShop,
      result: 'success',
      metadata: { format: parsedFormat, from: report.window.from, to: report.window.to, orderCount: report.orders.length },
    });
    context.stdout(formatOrdersReport(report, parsedFormat));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? redactSensitiveErrorMessage(error.message) : `Could not generate ${subcommand} report.`;
    if (subcommand === 'orders' || subcommand === 'inventory') {
      try {
        await context.appendAuditEvent(runtime.paths.auditLog, {
          action: subcommand === 'orders' ? 'report.orders' : 'report.inventory',
          shop: normalizedShop,
          result: 'failure',
          metadata: subcommand === 'inventory' ? { reason: message, threshold: lowStockThreshold } : { reason: message },
        });
      } catch {
        // Preserve the original report error; audit logging must not expose or mask it.
      }
    }
    context.stderr(message);
    return 1;
  }
}

async function runMcp(args: readonly string[], context: CliContext): Promise<number> {
  if (args[0] !== 'serve') {
    context.stderr(mcpUsage());
    return 2;
  }

  try {
    await startStdioMcpServer(await createMcpServerDependencies(context));
    return 0;
  } catch (error) {
    context.stderr(error instanceof Error ? redactSensitiveErrorMessage(error.message) : 'MCP server failed.');
    return 1;
  }
}

async function runDoctor(context: CliContext): Promise<number> {
  const envFileContent = await context.readFile(resolveShopifyHermesPaths({
    env: context.env,
    homeDir: context.homeDir,
  }).envFile);
  const envFileValues = parseShopifyHermesEnv(envFileContent ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });
  const missingConfigKeys = missingRequiredConfigKeys(mergedEnv);
  const nodeOk = getNodeMajor(context.nodeVersion) >= 20;
  const hermesOk = await context.commandExists('hermes');
  const cloudflaredOk = await context.commandExists('cloudflared');
  const ngrokOk = await context.commandExists('ngrok');

  context.stdout('Shopify Hermes OAuth doctor');
  context.stdout(`Node.js >=20: ${nodeOk ? 'ok' : `missing (found ${context.nodeVersion}; install Node.js 20 or newer)`}`);
  context.stdout(`Hermes CLI: ${hermesOk ? 'ok' : 'missing (install Hermes Agent CLI before connecting this OAuth helper)'}`);
  context.stdout(`cloudflared: ${cloudflaredOk ? 'ok' : 'optional, not found'}`);
  context.stdout(`ngrok: ${ngrokOk ? 'ok' : 'optional, not found'}`);
  context.stdout(`Hermes home: ${paths.hermesHome}`);
  context.stdout(`Data directory: ${paths.dataDir}`);

  if (missingConfigKeys.length === 0) {
    context.stdout('Required configuration: ok');
  } else {
    context.stdout(`Missing required configuration: ${missingConfigKeys.join(', ')}`);
  }

  if (!nodeOk || !hermesOk || missingConfigKeys.length > 0) {
    printNextSteps(context, missingConfigKeys, { nodeOk, hermesOk, hasTunnel: cloudflaredOk || ngrokOk });
    return 1;
  }

  if (!cloudflaredOk && !ngrokOk) {
    context.stdout('No tunnel CLI detected. Install cloudflared or ngrok, or provide your own public HTTPS URL for SHOPIFY_HERMES_APP_URL.');
  }

  return 0;
}

async function runInit(context: CliContext): Promise<number> {
  const initialPaths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
  const existingEnvFile = await context.readFile(initialPaths.envFile);
  const envFileValues = parseShopifyHermesEnv(existingEnvFile ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });
  const existingValues = getExistingInitEnvValues(existingEnvFile ?? '');
  const keysNeedingWrite = INIT_ENV_KEYS.filter((key) => !isPresent(existingValues.get(key)));
  const nodeOk = getNodeMajor(context.nodeVersion) >= 20;
  const hermesOk = await context.commandExists('hermes');
  const cloudflaredOk = await context.commandExists('cloudflared');
  const ngrokOk = await context.commandExists('ngrok');

  await context.mkdir(paths.dataDir);

  if (keysNeedingWrite.length > 0) {
    let updatedEnvFile: string;

    try {
      updatedEnvFile = updateMissingEnvKeys(existingEnvFile ?? '', keysNeedingWrite, mergedEnv, paths.dataDir);
    } catch (error) {
      if (error instanceof UnsafeEnvValueError) {
        context.stderr(error.message);
        return 1;
      }

      throw error;
    }

    await context.writeEnvFile(paths.envFile, updatedEnvFile);
    context.stdout(`Updated ${paths.envFile} with missing SHOPIFY_HERMES_* keys (${keysNeedingWrite.join(', ')}).`);
  } else {
    context.stdout(`No .env changes needed at ${paths.envFile}.`);
  }

  context.stdout(`Created or verified data directory: ${paths.dataDir}`);
  printSetupChecks(context, { nodeOk, hermesOk, cloudflaredOk, ngrokOk });
  context.stdout('Manual Shopify setup is still required: create a Shopify app in your Shopify Partner dashboard, set the app URL to SHOPIFY_HERMES_APP_URL, and add the OAuth callback URL below.');
  printCallbackInstructions(context, mergedEnv);
  context.stdout('Next Hermes MCP step: run `shopify-hermes-oauth hermes install` to configure MCP when available.');
  context.stdout('Run `shopify-hermes-oauth doctor` after filling in any placeholder values.');

  return 0;
}

function createCliContext(dependencies: CliDependencies): CliContext {
  const renameFile = dependencies.renameFile ?? fsRename;
  const chmod = dependencies.chmod ?? fsChmod;

  return {
    env: dependencies.env ?? process.env,
    homeDir: dependencies.homeDir,
    nodeVersion: dependencies.nodeVersion ?? process.version,
    stdout: dependencies.stdout ?? ((message) => {
      console.log(message);
    }),
    stderr: dependencies.stderr ?? ((message) => {
      console.error(message);
    }),
    commandExists: async (command) => dependencies.commandExists?.(command) ?? defaultCommandExists(command),
    readFile: async (path) => {
      if (dependencies.readFile !== undefined) {
        return dependencies.readFile(path);
      }

      if (!existsSync(path)) {
        return undefined;
      }

      return fsReadFile(path, 'utf8');
    },
    writeEnvFile: async (path, content) => {
      const directory = dirname(path);
      const tempPath = join(directory, `.env.tmp-${String(process.pid)}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`);

      await fsMkdir(directory, { recursive: true });

      if (dependencies.writeFile !== undefined) {
        await dependencies.writeFile(tempPath, content, { mode: 0o600 });
      } else {
        await fsWriteFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });
      }

      await chmod(tempPath, 0o600);
      await renameFile(tempPath, path);
      await chmod(path, 0o600);
    },
    writeJsonFile: async (path, content) => {
      if (dependencies.writeFile !== undefined) {
        await dependencies.writeFile(path, content, { mode: 0o600 });
        return;
      }

      await fsWriteFile(path, content, { encoding: 'utf8', mode: 0o600 });
    },
    renameFile: async (from, to) => {
      await renameFile(from, to);
    },
    chmod: async (path, mode) => {
      await chmod(path, mode);
    },
    mkdir: async (path) => {
      if (dependencies.mkdir !== undefined) {
        await dependencies.mkdir(path);
        return;
      }

      await fsMkdir(path, { recursive: true });
    },
    fetch: dependencies.fetch ?? globalThis.fetch,
    appendAuditEvent: async (path, event) => {
      if (dependencies.appendAuditEvent !== undefined) {
        await dependencies.appendAuditEvent(path, event);
        return;
      }

      await appendAuditEvent(path, event);
    },
  };
}

function usage(): string {
  return [
    'Usage: shopify-hermes-oauth <doctor|init|shops|report|mcp>',
    '',
    'Commands:',
    '  doctor  Check Node, Hermes CLI, tunnel tools, paths, and required Shopify config.',
    '  init    Create the data directory and append missing SHOPIFY_HERMES_* .env keys.',
    '  shops   List or remove locally stored shop OAuth tokens (never prints token values).',
    '  report  Generate read-only Shopify reports.',
    '  mcp     Serve curated read-only Shopify MCP tools over stdio.',
  ].join('\n');
}

function mcpUsage(): string {
  return [
    'Usage: shopify-hermes-oauth mcp serve',
    '',
    'Commands:',
    '  mcp serve  Serve curated read-only Shopify MCP tools over stdio.',
  ].join('\n');
}

function reportUsage(): string {
  return [
    'Usage: shopify-hermes-oauth report products <shop> [--format markdown|json|csv]',
    '       shopify-hermes-oauth report inventory <shop> [--format markdown|json|csv] [--low-stock-threshold N]',
    '       shopify-hermes-oauth report orders <shop> (--since 30d | --from YYYY-MM-DD --to YYYY-MM-DD) [--format markdown|json|csv]',
    '',
    'Commands:',
    '  report products <shop>   Generate a read-only products report. Defaults to markdown.',
    '  report inventory <shop>  Generate a read-only inventory report. Defaults to markdown.',
    '  report orders <shop>     Generate a read-only orders report. Defaults to markdown.',
  ].join('\n');
}

function parseReportFormat(args: readonly string[]): ProductsReportFormat | undefined {
  let format: ProductsReportFormat = 'markdown';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg !== '--format') {
      return undefined;
    }

    const value = args[index + 1];

    if (value !== 'markdown' && value !== 'json' && value !== 'csv') {
      return undefined;
    }

    format = value;
    index += 1;
  }

  return format;
}

function parseOrdersReportArgs(args: readonly string[]): OrdersReportWindowInput | undefined {
  const window: { since?: string; from?: string; to?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--format') {
      index += 1;
      continue;
    }

    if (arg === '--since' || arg === '--from' || arg === '--to') {
      const value = args[index + 1];
      if (!isPresent(value) || value.startsWith('--')) {
        return undefined;
      }

      if (arg === '--since') {
        window.since = value;
      } else if (arg === '--from') {
        window.from = value;
      } else {
        window.to = value;
      }
      index += 1;
      continue;
    }

    return undefined;
  }

  return window;
}

interface InventoryReportArgs {
  readonly lowStockThreshold?: number;
}

function parseInventoryReportArgs(args: readonly string[]): InventoryReportArgs | undefined {
  const parsed: { lowStockThreshold?: number } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--format') {
      index += 1;
      continue;
    }

    if (arg === '--low-stock-threshold') {
      const value = args[index + 1];
      if (!isPresent(value) || value.startsWith('--')) {
        return undefined;
      }

      if (!/^\d+$/u.test(value)) {
        throw new InventoryReportError('Inventory report low-stock threshold must be a non-negative integer.');
      }

      const threshold = Number(value);

      parsed.lowStockThreshold = threshold;
      index += 1;
      continue;
    }

    return undefined;
  }

  return parsed;
}

function shopsUsage(): string {
  return [
    'Usage: shopify-hermes-oauth shops <list|remove|verify>',
    '',
    'Commands:',
    '  shops list           List installed shop domains and non-secret metadata.',
    '  shops remove <shop>  Delete the local OAuth token for a shop.',
    '  shops verify <shop>  Verify a stored shop token with safe Admin GraphQL metadata.',
  ].join('\n');
}

async function createTokenStore(context: CliContext): Promise<LocalJsonTokenStore> {
  const { paths } = await resolveRuntimeConfiguration(context);
  return createTokenStoreForPath(paths.tokenStore, context);
}

async function resolveRuntimeConfiguration(context: CliContext): Promise<{
  readonly mergedEnv: Record<string, string>;
  readonly paths: ReturnType<typeof resolveShopifyHermesPaths>;
}> {
  const initialPaths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
  const envFileContent = await context.readFile(initialPaths.envFile);
  const envFileValues = parseShopifyHermesEnv(envFileContent ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });

  return { mergedEnv, paths };
}

function createTokenStoreForPath(path: string, context: CliContext): LocalJsonTokenStore {
  return new LocalJsonTokenStore({
    path,
    fileDependencies: {
      readFile: async (path) => {
        const content = await context.readFile(path);

        if (content === undefined) {
          const error = new Error(`File not found: ${path}`) as Error & { code: string };
          error.code = 'ENOENT';
          throw error;
        }

        return content;
      },
      writeFile: async (path, content) => {
        await context.writeJsonFile(path, content);
      },
      rename: context.renameFile,
      chmod: context.chmod,
      mkdir: async (path) => {
        await context.mkdir(path);
      },
    },
  });
}

async function createMcpServerDependencies(context: CliContext): Promise<McpServerDependencies> {
  const runtime = await resolveRuntimeConfiguration(context);
  const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
  const adminClient = createShopifyAdminGraphqlClient({
    apiVersion: runtime.mergedEnv.SHOPIFY_HERMES_API_VERSION ?? DEFAULT_SHOPIFY_HERMES_API_VERSION,
    fetch: context.fetch,
  });
  const reportClientFor = async (shopInput: string, requiredScopes: readonly string[] = []) => {
    const shop = normalizeTokenStoreShopDomain(shopInput);
    const token = await store.getToken(shop);

    if (token === undefined) {
      throw new Error(`No stored OAuth token found for ${shop}.`);
    }

    for (const scope of requiredScopes) {
      if (!token.scopes.includes(scope)) {
        throw new Error(`Stored OAuth token for ${shop} is missing required scope: ${scope}.`);
      }
    }

    return {
      shop,
      client: {
        query: (query: string, variables: unknown) => adminClient.query({
          shop,
          accessToken: token.accessToken,
          query,
          variables,
        }),
      },
    };
  };

  return {
    tokenStore: store,
    verifyShop: ({ shop }) => verifyShop({
      shop,
      tokenStore: store,
      adminClient,
      appendAuditEvent: async (event) => context.appendAuditEvent(runtime.paths.auditLog, event),
    }),
    reportProducts: async ({ shop, format }) => {
      const reportRuntime = await reportClientFor(shop);
      const report = await generateProductsReport({ client: reportRuntime.client });
      return { shop: reportRuntime.shop, format, report, formatted: formatProductsReport(report, format) };
    },
    reportOrders: async ({ shop, format, since, from, to }) => {
      const reportRuntime = await reportClientFor(shop, ['read_orders']);
      const report = await generateOrdersReport({ client: reportRuntime.client, window: { since, from, to } });
      return { shop: reportRuntime.shop, format, report, formatted: formatOrdersReport(report, format) };
    },
    reportInventory: async ({ shop, format, lowStockThreshold }) => {
      const threshold = lowStockThreshold ?? 5;
      const reportRuntime = await reportClientFor(shop, ['read_inventory', 'read_products']);
      const report = await generateInventoryReport({ client: reportRuntime.client, lowStockThreshold: threshold });
      return { shop: reportRuntime.shop, format, lowStockThreshold: threshold, report, formatted: formatInventoryReport(report, format) };
    },
  };
}

function formatShopVerificationResult(result: VerifyShopResult): string {
  return [
    `Verified ${sanitizeCliField(result.shop)}`,
    `name=${sanitizeCliField(result.metadata.name)}`,
    `myshopifyDomain=${sanitizeCliField(result.metadata.myshopifyDomain)}`,
    `currencyCode=${sanitizeCliField(result.metadata.currencyCode)}`,
  ].join(' ');
}

function formatShopListEntry(token: StoredShopToken): string {
  const details = [
    sanitizeOptionalCliField(token.metadata?.shopName),
    sanitizeOptionalCliField(token.metadata?.currencyCode),
    sanitizeOptionalCliField(token.metadata?.myshopifyDomain),
    `scopes=${sanitizeCliField(token.scopes.join(','))}`,
    `storedAt=${sanitizeCliField(token.storedAt)}`,
    `updatedAt=${sanitizeCliField(token.updatedAt)}`,
  ].filter((value): value is string => value !== undefined && value.length > 0);

  return `${sanitizeCliField(token.shop)} ${details.join(' ')}`;
}

function sanitizeOptionalCliField(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeCliField(value);
}

function sanitizeCliField(value: string): string {
  let sanitized = '';

  for (const character of value) {
    sanitized += sanitizeCliCharacter(character);
  }

  return sanitized;
}

function sanitizeCliCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;

  if (!isControlCharacter(codePoint)) {
    return character;
  }

  switch (character) {
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    default:
      return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }
}

function isControlCharacter(codePoint: number): boolean {
  return (codePoint >= 0x00 && codePoint <= 0x1F) || (codePoint >= 0x7F && codePoint <= 0x9F);
}

function defaultCommandExists(command: string): boolean {
  const result = spawnSync('command', ['-v', command], {
    shell: '/bin/sh',
    stdio: 'ignore',
  });
  return result.status === 0;
}

function getNodeMajor(version: string): number {
  const match = /^v?(\d+)/u.exec(version.trim());
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
}

function missingRequiredConfigKeys(
  values: Readonly<Record<string, string | undefined>>,
): RequiredConfigKey[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => !isPresent(values[key]));
}

function parseShopifyHermesEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const parsedLine = parseEnvLine(rawLine);

    if (parsedLine !== undefined && parsedLine.key.startsWith('SHOPIFY_HERMES_') && isPresent(parsedLine.value)) {
      parsed[parsedLine.key] = parsedLine.value;
    }
  }

  return parsed;
}

function getExistingInitEnvValues(content: string): Map<InitEnvKey, string> {
  const values = new Map<InitEnvKey, string>();

  for (const rawLine of content.split(/\r?\n/u)) {
    const parsedLine = parseEnvLine(rawLine);

    if (parsedLine !== undefined && isInitEnvKey(parsedLine.key)) {
      values.set(parsedLine.key, parsedLine.value);
    }
  }

  return values;
}

function parseEnvLine(rawLine: string): { readonly key: string; readonly value: string } | undefined {
  let line = rawLine.trim();

  if (line.length === 0 || line.startsWith('#')) {
    return undefined;
  }

  if (line.startsWith('export ')) {
    line = line.slice('export '.length).trimStart();
  }

  const separatorIndex = line.indexOf('=');

  if (separatorIndex === -1) {
    return undefined;
  }

  const key = line.slice(0, separatorIndex).trim();
  const rawValue = stripInlineComment(line.slice(separatorIndex + 1)).trim();

  return { key, value: unquoteDotEnvValue(rawValue) };
}

function mergeShopifyHermesEnv(
  envFileValues: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...envFileValues };

  for (const [key, value] of Object.entries(env)) {
    if ((key === 'HERMES_HOME' || key.startsWith('SHOPIFY_HERMES_')) && isPresent(value)) {
      merged[key] = value;
    }
  }

  return merged;
}

function updateMissingEnvKeys(
  existingContent: string,
  keysNeedingWrite: readonly InitEnvKey[],
  mergedEnv: Readonly<Record<string, string | undefined>>,
  dataDir: string,
): string {
  const remainingKeys = new Set(keysNeedingWrite);
  const updatedLines = existingContent.split(/\r?\n/u).map((rawLine) => {
    const parsedLine = parseEnvLine(rawLine);

    if (parsedLine === undefined || !isInitEnvKey(parsedLine.key) || isPresent(parsedLine.value)) {
      return rawLine;
    }

    remainingKeys.delete(parsedLine.key);
    return formatDotEnvAssignment(parsedLine.key, getInitEnvValue(parsedLine.key, mergedEnv, dataDir));
  });
  const linesToAppend = [...remainingKeys].map((key) => formatDotEnvAssignment(key, getInitEnvValue(key, mergedEnv, dataDir)));

  if (linesToAppend.length === 0) {
    return `${updatedLines.join('\n').replace(/\n*$/u, '')}\n`;
  }

  const prefix = existingContent.length === 0 ? '' : `${updatedLines.join('\n').replace(/\n*$/u, '')}\n\n`;
  return `${prefix}${linesToAppend.join('\n')}\n`;
}

function formatDotEnvAssignment(key: InitEnvKey, value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new UnsafeEnvValueError(key);
  }

  return `${key}=${quoteDotEnvValue(value)}`;
}

function quoteDotEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,-]+$/u.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function getInitEnvValue(
  key: InitEnvKey,
  mergedEnv: Readonly<Record<string, string | undefined>>,
  dataDir: string,
): string {
  const configuredValue = mergedEnv[key];

  if (isPresent(configuredValue)) {
    return configuredValue;
  }

  switch (key) {
    case 'SHOPIFY_HERMES_CLIENT_ID':
      return 'replace-with-shopify-client-id';
    case 'SHOPIFY_HERMES_CLIENT_SECRET':
      return 'replace-with-shopify-client-secret';
    case 'SHOPIFY_HERMES_APP_URL':
      return DEFAULT_SHOPIFY_HERMES_APP_URL;
    case 'SHOPIFY_HERMES_SCOPES':
      return DEFAULT_SHOPIFY_HERMES_SCOPES;
    case 'SHOPIFY_HERMES_DATA_DIR':
      return dataDir;
    case 'SHOPIFY_HERMES_API_VERSION':
      return DEFAULT_SHOPIFY_HERMES_API_VERSION;
  }
}

function printSetupChecks(
  context: CliContext,
  status: {
    readonly nodeOk: boolean;
    readonly hermesOk: boolean;
    readonly cloudflaredOk: boolean;
    readonly ngrokOk: boolean;
  },
): void {
  context.stdout('Setup checks:');
  context.stdout(`Node.js >=20: ${status.nodeOk ? 'ok' : `missing (found ${context.nodeVersion}; install Node.js 20 or newer)`}`);
  context.stdout(`Hermes CLI: ${status.hermesOk ? 'ok' : 'missing (install Hermes Agent CLI before connecting this OAuth helper)'}`);
  context.stdout(`cloudflared: ${status.cloudflaredOk ? 'ok' : 'optional, not found'}`);
  context.stdout(`ngrok: ${status.ngrokOk ? 'ok' : 'optional, not found'}`);
}

function printCallbackInstructions(context: CliContext, mergedEnv: Readonly<Record<string, string | undefined>>): void {
  const appUrl = mergedEnv.SHOPIFY_HERMES_APP_URL;

  if (isKnownAppUrl(appUrl)) {
    context.stdout(`OAuth callback URL: ${appUrl.replace(/\/+$/u, '')}/auth/callback`);
    return;
  }

  context.stdout('Set SHOPIFY_HERMES_APP_URL then use <APP_URL>/auth/callback');
}

function isKnownAppUrl(value: string | undefined): value is string {
  if (!isPresent(value)) {
    return false;
  }

  return value !== DEFAULT_SHOPIFY_HERMES_APP_URL && !value.includes('your-public-app-url') && !value.includes('<APP_URL>');
}

function printNextSteps(
  context: CliContext,
  missingConfigKeys: readonly RequiredConfigKey[],
  status: { readonly nodeOk: boolean; readonly hermesOk: boolean; readonly hasTunnel: boolean },
): void {
  context.stdout('Next steps:');

  if (!status.nodeOk) {
    context.stdout('- Install Node.js 20 or newer.');
  }

  if (!status.hermesOk) {
    context.stdout('- Install the Hermes CLI and make sure `hermes` is on PATH.');
  }

  if (missingConfigKeys.length > 0) {
    context.stdout('- Create a Shopify app in your Shopify Partner dashboard to get the client ID and client secret.');
    context.stdout('- Run `shopify-hermes-oauth init` to create missing .env keys, then replace placeholders with Shopify app values.');
  }

  if (!status.hasTunnel) {
    context.stdout('- Install cloudflared or ngrok, or manually provide a public HTTPS URL for SHOPIFY_HERMES_APP_URL.');
  }
}

function isInitEnvKey(key: string): key is InitEnvKey {
  return (INIT_ENV_KEYS as readonly string[]).includes(key);
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function unquoteDotEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '"' || character === "'") && value[index - 1] !== '\\') {
      quote = quote === character ? undefined : (quote ?? character);
      continue;
    }

    if (
      character === '#' &&
      quote === undefined &&
      (index === 0 || /\s/u.test(value[index - 1] ?? ''))
    ) {
      return value.slice(0, index);
    }
  }

  return value;
}

const isDirectRun = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const exitCode = await runShopifyHermesOauthCli();
  process.exitCode = exitCode;
}
