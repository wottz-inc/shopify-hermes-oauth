#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import { access as fsAccess, chmod as fsChmod, mkdir as fsMkdir, readFile as fsReadFile, realpath as fsRealpath, rename as fsRename, unlink as fsUnlink, writeFile as fsWriteFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { appendAuditEvent, type AuditEventInput } from './audit.js';
import { BulkOperationError, cancelBulkOperation, fetchBulkOperationResult, getBulkOperationTemplate, getCurrentBulkOperation, startBulkOperation } from './bulk/operations.js';
import { parseBooleanGate } from './config.js';
import { getCollection, getProductDetail, listCollections } from './catalog/details.js';
import { listDiscounts, getDiscount, listMarketingEvents } from './discounts-marketing/index.js';
import { getMetafieldDefinition, getMetaobject, getMetaobjectDefinition, listMetafieldDefinitions, listMetaobjectDefinitions, listMetaobjects, listResourceMetafields } from './custom-data/index.js';
import { listMarkets, listShopLocales } from './markets-localization/index.js';
import { summarizeOnlineStore } from './online-store/summary.js';
import { getFulfillmentOrder, listFulfillmentOrders } from './fulfillment/details.js';
import { getInventoryItem, getLocation, listInventoryLevels, listLocations } from './inventory/details.js';
import { getOrderDetail } from './orders/details.js';
import { getCustomer, listCustomers } from './customers/index.js';
import { resolveShopifyHermesPaths } from './hermes-home.js';
import { exchangeShopifyOAuthToken } from './internal/shopify-oauth-token-exchange.js';
import { startStdioMcpServer, type McpLifecycleEvent, type McpServerDependencies } from './mcp/server.js';
import { InMemoryOAuthStateStore } from './oauth/state-store.js';
import { formatInventoryReport, generateInventoryReport, InventoryReportError } from './reports/inventory.js';
import { formatOrdersReport, generateOrdersReport, parseOrdersReportWindow, type OrdersReportWindowInput } from './reports/orders.js';
import { formatProductsReport, generateProductsReport, type ProductsReportFormat } from './reports/products.js';
import { analyticsReportsDisabledMessage, formatShopifyqlAnalyticsReport, generateShopifyqlAnalyticsReport, ShopifyqlAnalyticsError } from './reports/shopifyql-analytics.js';
import { createOAuthHttpServer } from './server.js';
import { createShopifyAdminGraphqlClient, redactSensitiveErrorMessage, ShopifyAdminGraphqlError } from './shopify/admin-client.js';
import { generateStoreDiagnostics } from './shops/diagnostics.js';
import { compareShopifyScopes, MissingShopifyScopesError, missingShopifyScopes, normalizeShopifyScopes } from './shopify/scopes.js';
import { verifyShop, type VerifyShopResult } from './shops/verify.js';
import { LocalJsonTokenStore, normalizeTokenStoreShopDomain, parseLocalJsonTokenStoreFile, type StoredShopToken } from './tokens/local-token-store.js';
import { getWebhookSubscription, listWebhookSubscriptions } from './webhooks/subscriptions.js';

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
const DEFAULT_SHOPIFY_HERMES_SCOPES = 'read_products,read_orders,read_inventory,read_locations';
const MAX_SHOPIFY_HERMES_SCOPES = 32;
const DEFAULT_SHOPIFY_HERMES_API_VERSION = '2026-01';

type RequiredConfigKey = (typeof REQUIRED_CONFIG_KEYS)[number];
type InitEnvKey = (typeof INIT_ENV_KEYS)[number];
type CredentialEnvKey = 'SHOPIFY_HERMES_CLIENT_ID' | 'SHOPIFY_HERMES_CLIENT_SECRET';
interface StartedProcessResult {
  readonly stdout?: string;
  readonly status?: number | null;
  readonly close?: () => void | Promise<void>;
}

export interface CliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly nodeVersion?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly executeCommand?: (command: string, args: readonly string[]) => { readonly status: number | null } | Promise<{ readonly status: number | null }>;
  readonly startProcess?: (command: string, args: readonly string[]) => StartedProcessResult | Promise<StartedProcessResult>;
  readonly listenServer?: (server: Server, options: { readonly host: string; readonly port: number }) => void | Promise<void>;
  readonly readFile?: (path: string) => string | undefined | Promise<string | undefined>;
  readonly fileIsExecutable?: (path: string) => boolean | Promise<boolean>;
  readonly writeFile?: (path: string, content: string, options?: { readonly mode?: number; readonly flag?: string }) => void | Promise<void>;
  readonly renameFile?: (from: string, to: string) => void | Promise<void>;
  readonly unlinkFile?: (path: string) => void | Promise<void>;
  readonly chmod?: (path: string, mode: number) => void | Promise<void>;
  readonly mkdir?: (path: string) => void | Promise<void>;
  readonly promptCredential?: (label: string) => string | Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly healthCheckTimeoutMs?: number;
  readonly appendAuditEvent?: (path: string, event: AuditEventInput) => void | Promise<void>;
}

interface CliContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string | undefined;
  readonly nodeVersion: string;
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly commandExists: (command: string) => Promise<boolean>;
  readonly executeCommand: (command: string, args: readonly string[]) => Promise<{ readonly status: number | null }>;
  readonly startProcess: (command: string, args: readonly string[]) => Promise<StartedProcessResult>;
  readonly listenServer: (server: Server, options: { readonly host: string; readonly port: number }) => Promise<void>;
  readonly readFile: (path: string) => Promise<string | undefined>;
  readonly fileIsExecutable: (path: string) => Promise<boolean>;
  readonly writeEnvFile: (path: string, content: string) => Promise<void>;
  readonly writeJsonFile: (path: string, content: string, options?: { readonly flag?: string }) => Promise<void>;
  readonly renameFile: (from: string, to: string) => Promise<void>;
  readonly unlinkFile: (path: string) => Promise<void>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly promptCredential: (label: string) => Promise<string>;
  readonly fetch: typeof globalThis.fetch;
  readonly healthCheckTimeoutMs: number;
  readonly appendAuditEvent: (path: string, event: AuditEventInput) => Promise<void>;
}

class UnsafeEnvValueError extends Error {
  public constructor(key: string) {
    super(`${key} cannot contain newlines. Remove line breaks before running init again.`);
  }
}

class NoInteractiveCredentialInputError extends Error {
  public constructor() {
    super('Cannot read credentials safely from this session.');
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

  if (command === 'onboard') {
    return runOnboard(args.slice(1), context);
  }

  if (command === 'credentials') {
    return runCredentials(args.slice(1), context);
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

  if (command === 'hermes') {
    return runHermes(args.slice(1), context);
  }

  if (command === 'dev') {
    return runDev(args.slice(1), context);
  }

  if (command === 'serve') {
    return runServe(args.slice(1), context);
  }

  context.stderr(usage());
  return command === 'help' || command === '--help' || command === '-h' ? 0 : 2;
}

async function runShops(args: readonly string[], context: CliContext): Promise<number> {
  const subcommand = args[0];

  if (subcommand === 'list') {
    const runtime = await resolveRuntimeConfiguration(context);
    const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
    let tokens: readonly StoredShopToken[];

    try {
      tokens = await store.listTokens();
    } catch {
      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'shops.list',
        result: 'failure',
        metadata: auditMetadata({ mode: 'read-only', reason: 'token_store_list_failed' }),
      });
      context.stderr('Could not read token store. Check local token storage and try again.');
      return 1;
    }

    await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
      action: 'shops.list',
      result: 'success',
      metadata: auditMetadata({ mode: 'read-only', shopCount: tokens.length }),
    });

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
      const runtime = await resolveRuntimeConfiguration(context);
      const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
      const removed = await store.deleteToken(normalizedShop);

      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'shops.remove',
        shop: normalizedShop,
        result: 'success',
        metadata: auditMetadata({ mode: 'write', removed }),
      });

      context.stdout(removed ? `Removed ${normalizedShop}.` : `No token found for ${normalizedShop}.`);
      return 0;
    } catch {
      const runtime = await resolveRuntimeConfiguration(context);
      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'shops.remove',
        shop: normalizedShop,
        result: 'failure',
        metadata: auditMetadata({ mode: 'write', reason: 'token_store_remove_failed' }),
      });
      context.stderr('Could not update token store. Check local token storage and try again.');
      return 1;
    }
  }

  if (subcommand === 'diagnostics') {
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

    const runtime = await resolveRuntimeConfiguration(context);

    try {
      const store = createTokenStoreForPath(runtime.paths.tokenStore, context);
      const adminClient = createShopifyAdminGraphqlClient({
        apiVersion: runtime.mergedEnv.SHOPIFY_HERMES_API_VERSION ?? DEFAULT_SHOPIFY_HERMES_API_VERSION,
        fetch: context.fetch,
      });
      const token = await store.getToken(normalizedShop);
      if (token === undefined) {
        throw new Error(`No stored OAuth token found for ${normalizedShop}.`);
      }
      const result = await generateStoreDiagnostics({
        shop: normalizedShop,
        tokenStore: store,
        configuredScopes: parseScopeList(runtime.mergedEnv.SHOPIFY_HERMES_SCOPES ?? DEFAULT_SHOPIFY_HERMES_SCOPES),
        client: {
          query: (query, variables, options) => adminClient.query({
            shop: normalizedShop,
            accessToken: token.accessToken,
            query,
            variables,
            operationName: options?.operationName,
          }),
        },
      });

      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'shops.diagnostics',
        shop: normalizedShop,
        result: 'success',
        metadata: auditMetadata({ mode: 'read-only', privacyStatus: result.privacy.status }),
      });
      context.stdout(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'shops.diagnostics',
        shop: normalizedShop,
        result: 'failure',
        metadata: auditMetadata({ mode: 'read-only', reason: 'diagnostics_failed' }),
      });
      context.stderr(error instanceof Error ? redactSensitiveErrorMessage(error.message) : 'Could not read shop diagnostics.');
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
        appendAuditEvent: async (event) => appendAuditEventBestEffort(context, runtime.paths.auditLog, enrichAuditEvent(event, 'cli', 'read-only')),
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

  let parsedReportArgs: ReportArgsParseResult;
  try {
    parsedReportArgs = parseReportArgs(subcommand, args.slice(2));
  } catch (error) {
    context.stderr(error instanceof Error ? error.message : 'Invalid inventory report options.');
    return 2;
  }

  if (parsedReportArgs === 'invalid-format') {
    context.stderr('Invalid report format. Use markdown, json, or csv.');
    return 2;
  }

  if (parsedReportArgs === undefined) {
    context.stderr(reportUsage());
    return 2;
  }

  if (subcommand === 'orders') {
    try {
      parseOrdersReportWindow(parsedReportArgs.ordersWindowInput);
    } catch (error) {
      context.stderr(error instanceof Error ? error.message : 'Invalid orders report date window.');
      return 2;
    }
  }

  const parsedFormat = parsedReportArgs.format;
  const ordersWindowInput = parsedReportArgs.ordersWindowInput;
  const lowStockThreshold = parsedReportArgs.lowStockThreshold;

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
      throw new Error(`No stored OAuth token found for ${normalizedShop}.`);
    }

    const requiredScopes = requiredReportScopes(subcommand);
    const missingScopes = missingShopifyScopes(token.scopes, requiredScopes);
    if (missingScopes.length > 0) {
      throw new MissingShopifyScopesError(normalizedShop, missingScopes);
    }

    const adminClient = createShopifyAdminGraphqlClient({
      apiVersion: runtime.mergedEnv.SHOPIFY_HERMES_API_VERSION ?? DEFAULT_SHOPIFY_HERMES_API_VERSION,
      fetch: context.fetch,
    });

    if (subcommand === 'products') {
      const report = await generateProductsReport({
        client: {
          query: (query, variables, options) => adminClient.query({
            shop: normalizedShop,
            accessToken: token.accessToken,
            query,
            variables,
            operationName: options?.operationName,
          }),
        },
      });

      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'report.products',
        shop: normalizedShop,
        result: 'success',
        metadata: auditMetadata({ mode: 'read-only', format: parsedFormat, productCount: report.products.length }),
      });
      context.stdout(formatProductsReport(report, parsedFormat));
      return 0;
    }

    if (subcommand === 'inventory') {
      const report = await generateInventoryReport({
        client: {
          query: (query, variables, options) => adminClient.query({
            shop: normalizedShop,
            accessToken: token.accessToken,
            query,
            variables,
            operationName: options?.operationName,
          }),
        },
        lowStockThreshold,
      });

      await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
        action: 'report.inventory',
        shop: normalizedShop,
        result: 'success',
        metadata: auditMetadata({ mode: 'read-only', format: parsedFormat, rowCount: report.rows.length, threshold: lowStockThreshold }),
      });
      context.stdout(formatInventoryReport(report, parsedFormat));
      return 0;
    }

    const report = await generateOrdersReport({
      client: {
        query: (query, variables, options) => adminClient.query({
          shop: normalizedShop,
          accessToken: token.accessToken,
          query,
          variables,
          operationName: options?.operationName,
        }),
      },
      window: ordersWindowInput,
    });

    await appendAuditEventBestEffort(context, runtime.paths.auditLog, {
      action: 'report.orders',
      shop: normalizedShop,
      result: 'success',
      metadata: auditMetadata({ mode: 'read-only', format: parsedFormat, from: report.window.from, to: report.window.to, orderCount: report.orders.length }),
    });
    context.stdout(formatOrdersReport(report, parsedFormat));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? redactSensitiveErrorMessage(error.message) : `Could not generate ${subcommand} report.`;
    try {
      await context.appendAuditEvent(runtime.paths.auditLog, {
        action: `report.${subcommand}`,
        shop: normalizedShop,
        result: 'failure',
        metadata: auditMetadata(subcommand === 'inventory'
          ? { mode: 'read-only', reason: 'report_failed', threshold: lowStockThreshold }
          : { mode: 'read-only', reason: 'report_failed' }),
      });
    } catch {
      // Preserve the original report error; audit logging must not expose or mask it.
    }
    context.stderr(message);
    return 1;
  }
}

function enrichAuditEvent(event: AuditEventInput, source: 'cli' | 'mcp', mode: 'read-only' | 'write'): AuditEventInput {
  return {
    ...event,
    metadata: auditMetadata({ mode, ...(event.metadata ?? {}) }, source),
  };
}

function auditMetadata(metadata: Readonly<Record<string, unknown>> = {}, source: 'cli' | 'mcp' = 'cli'): Record<string, unknown> {
  return { source, actor: source, ...metadata };
}

async function appendAuditEventBestEffort(context: CliContext, path: string, event: AuditEventInput): Promise<void> {
  try {
    await context.appendAuditEvent(path, event);
  } catch {
    // Audit logging is best-effort for successful primary operations and must not mask failures.
  }
}

async function runMcp(args: readonly string[], context: CliContext): Promise<number> {
  if (args[0] !== 'serve') {
    context.stderr(mcpUsage());
    return 2;
  }

  try {
    await startStdioMcpServer(await createMcpServerDependencies(context), {
      lifecycleLogger: (event) => {
        logMcpLifecycleEvent(context, event);
      },
    });
    return 0;
  } catch (error) {
    context.stderr(error instanceof Error ? redactSensitiveErrorMessage(error.message) : 'MCP server failed.');
    return 1;
  }
}

function logMcpLifecycleEvent(context: CliContext, event: McpLifecycleEvent): void {
  context.stderr(JSON.stringify(event));
}

const DEV_HOST = '127.0.0.1';
const DEV_PORT = '3456';
const DEV_LOCAL_URL = `http://${DEV_HOST}:${DEV_PORT}`;

async function runDev(args: readonly string[], context: CliContext): Promise<number> {
  if (args.length !== 1 || args[0] !== '--tunnel') {
    context.stderr(devUsage());
    return 2;
  }

  const cloudflaredOk = await context.commandExists('cloudflared');
  const ngrokOk = await context.commandExists('ngrok');

  if (cloudflaredOk) {
    return startTunnelBackedDevServer(context, 'cloudflared', ['tunnel', '--url', DEV_LOCAL_URL]);
  }

  if (ngrokOk) {
    return startTunnelBackedDevServer(context, 'ngrok', ['http', DEV_LOCAL_URL]);
  }

  printManualTunnelInstructions(context);
  return 0;
}

async function startTunnelBackedDevServer(context: CliContext, provider: string, tunnelArgs: readonly string[]): Promise<number> {
  const tunnel = await context.startProcess(provider, tunnelArgs);
  const publicUrl = extractPublicHttpsUrl(tunnel.stdout ?? '', provider);

  if (publicUrl === undefined) {
    await closeStartedProcesses(tunnel);

    if (processExitedUnsuccessfully(tunnel)) {
      context.stderr(`${provider} failed before printing a public HTTPS URL. Check ${provider} setup, then rerun \`shopify-hermes-oauth dev --tunnel\`.`);
      return 1;
    }

    context.stderr(`${provider} did not print a public HTTPS URL during startup. Rerun \`shopify-hermes-oauth dev --tunnel\`, or expose ${DEV_LOCAL_URL} yourself and run \`shopify-hermes-oauth serve --host ${DEV_HOST} --port ${DEV_PORT} --app-url <your-public-https-url>\`.`);
    return 1;
  }

  context.stdout(`Tunnel provider: ${provider}`);
  context.stdout(`Starting local OAuth callback server at ${DEV_LOCAL_URL} with app URL ${publicUrl}`);
  const server = await context.startProcess('shopify-hermes-oauth', devServerArgs(publicUrl));

  if (processExitedUnsuccessfully(server)) {
    await closeStartedProcesses(server, tunnel);
    context.stderr(`Local OAuth callback server failed to start. Run \`shopify-hermes-oauth serve --host ${DEV_HOST} --port ${DEV_PORT} --app-url ${publicUrl}\` for details.`);
    return 1;
  }

  if (!hasCallbackServerReadiness(server.stdout ?? '')) {
    await closeStartedProcesses(server, tunnel);
    context.stderr(`Local OAuth callback server did not become ready within 5 seconds. Run \`shopify-hermes-oauth serve --host ${DEV_HOST} --port ${DEV_PORT} --app-url ${publicUrl}\` for details.`);
    return 1;
  }

  printTunnelUrls(context, publicUrl);

  const health = await checkPublicTunnelHealth(context, publicUrl);
  if (!health.ok) {
    await closeStartedProcesses(server, tunnel);
    context.stderr(`Health status: ${health.status} (${health.url})`);
    context.stderr('Public tunnel health check failed. The tunnel is reachable, but the OAuth callback server is not responding through it.');
    context.stderr('Make sure the callback server is still running, then rerun `shopify-hermes-oauth dev --tunnel`.');
    return 1;
  }

  context.stdout(`Health status: OK (${health.url})`);
  context.stdout(`Install URL: ${installUrl(publicUrl)}`);
  context.stdout('Keep this command running while completing the Shopify install.');
  return 0;
}

async function closeStartedProcesses(...processes: readonly StartedProcessResult[]): Promise<void> {
  for (const process of processes) {
    if (process.close === undefined) {
      continue;
    }

    try {
      await process.close();
    } catch {
      // Best-effort cleanup: preserve the original startup/health failure.
    }
  }
}

interface PublicTunnelHealthResult {
  readonly ok: boolean;
  readonly status: string;
  readonly url: string;
}

async function checkPublicTunnelHealth(context: CliContext, publicUrl: string): Promise<PublicTunnelHealthResult> {
  const url = new URL('/health', ensureTrailingSlash(publicUrl)).toString();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutRace = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Public tunnel health check timed out.'));
    }, context.healthCheckTimeoutMs);
  });

  try {
    const response = await Promise.race([
      context.fetch(url, { signal: controller.signal }),
      timeoutRace,
    ]);
    if (!response.ok) {
      return { ok: false, status: response.status.toString(10), url };
    }

    return { ok: true, status: 'OK', url };
  } catch {
    return { ok: false, status: 'unreachable', url };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function hasCallbackServerReadiness(output: string): boolean {
  return output.includes(`OAuth callback server listening: ${DEV_LOCAL_URL}`);
}

function devServerArgs(publicUrl: string): readonly string[] {
  return ['serve', '--host', DEV_HOST, '--port', DEV_PORT, '--app-url', publicUrl];
}

function processExitedUnsuccessfully(process: StartedProcessResult): boolean {
  return process.status !== undefined && process.status !== 0;
}

function printManualTunnelInstructions(context: CliContext): void {
  context.stdout('No tunnel tool detected.');
  context.stdout('Install cloudflared or ngrok, then run `shopify-hermes-oauth dev --tunnel` again.');
  context.stdout(`Or expose ${DEV_LOCAL_URL} with your own HTTPS tunnel, then run:`);
  context.stdout(`shopify-hermes-oauth serve --host ${DEV_HOST} --port ${DEV_PORT} --app-url <your-public-https-url>`);
  context.stdout('Use this in Shopify:');
  context.stdout('Application URL: <your-public-https-url>');
  context.stdout('Allowed redirection URL: <your-public-https-url>/auth/callback');
}

interface ServeArgs {
  readonly host: string;
  readonly port: number;
  readonly appUrl?: string;
}

async function runServe(args: readonly string[], context: CliContext): Promise<number> {
  const parsedArgs = parseServeArgs(args);

  if (parsedArgs === undefined) {
    context.stderr(serveUsage());
    return 2;
  }

  try {
    const runtime = await resolveRuntimeConfiguration(context);
    const appUrl = parsedArgs.appUrl ?? runtime.mergedEnv.SHOPIFY_HERMES_APP_URL;
    const clientId = runtime.mergedEnv.SHOPIFY_HERMES_CLIENT_ID;
    const clientSecret = runtime.mergedEnv.SHOPIFY_HERMES_CLIENT_SECRET;
    const oldClientSecret = runtime.mergedEnv.SHOPIFY_HERMES_OLD_CLIENT_SECRET;

    if (!isPresent(clientId) || !isPresent(clientSecret) || !isPresent(appUrl)) {
      context.stderr('Missing required configuration. Set SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, and SHOPIFY_HERMES_APP_URL or pass --app-url.');
      return 1;
    }

    const localUrl = `http://${parsedArgs.host}:${String(parsedArgs.port)}`;
    const callback = new URL('/auth/callback', ensureTrailingSlash(appUrl)).toString();
    const scopes = parseScopeList(runtime.mergedEnv.SHOPIFY_HERMES_SCOPES ?? DEFAULT_SHOPIFY_HERMES_SCOPES);
    const tokenStore = createTokenStoreForPath(runtime.paths.tokenStore, context);
    const server = createOAuthHttpServer({
      config: {
        clientId,
        clientSecret,
        ...(isPresent(oldClientSecret) ? { oldClientSecret } : {}),
        appUrl,
        scopes,
      },
      stateStore: new InMemoryOAuthStateStore(),
      tokenStore,
      tokenExchange: async ({ shop, code, redirectUri }) => exchangeShopifyOAuthToken({
        fetch: context.fetch,
        shop,
        code,
        redirectUri,
        clientId,
        clientSecret,
      }),
    });

    await context.listenServer(server, { host: parsedArgs.host, port: parsedArgs.port });
    context.stdout(`OAuth callback server listening: ${localUrl}`);
    context.stdout(`OAuth callback URL: ${callback}`);
    return 0;
  } catch (error) {
    context.stderr(error instanceof Error ? redactSensitiveErrorMessage(error.message) : 'OAuth callback server failed.');
    return 1;
  }
}

function printTunnelUrls(context: CliContext, publicUrl: string): void {
  context.stdout(`Application URL: ${publicUrl}`);
  context.stdout(`Allowed redirection URL: ${new URL('/auth/callback', ensureTrailingSlash(publicUrl)).toString()}`);
}

function installUrl(publicUrl: string): string {
  return `${new URL('/auth/start', ensureTrailingSlash(publicUrl)).toString()}?shop=<shop>.myshopify.com`;
}

function extractPublicHttpsUrl(output: string, provider: string): string | undefined {
  const matches = output.matchAll(/https:\/\/[^\s"'<>]+/gu);

  for (const match of matches) {
    const candidate = match[0].replace(/[).,;]+$/u, '');

    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && isProviderPublicTunnelUrl(url, provider)) {
        return url.toString().replace(/\/$/u, '');
      }
    } catch {
      // Ignore malformed URLs and continue looking for a provider public URL.
    }
  }

  return undefined;
}

function isProviderPublicTunnelUrl(url: URL, provider: string): boolean {
  const hostname = url.hostname.toLowerCase();

  if (provider === 'cloudflared') {
    return hostname.endsWith('.trycloudflare.com');
  }

  if (provider === 'ngrok') {
    return hostname.endsWith('.ngrok-free.app')
      || hostname.endsWith('.ngrok.app')
      || hostname.endsWith('.ngrok.io');
  }

  return false;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseServeArgs(args: readonly string[]): ServeArgs | undefined {
  let host: string | undefined;
  let port: number | undefined;
  let appUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if ((arg === '--host' || arg === '--port' || arg === '--app-url') && (!isPresent(value) || value.startsWith('--'))) {
      return undefined;
    }

    if (arg === '--host') {
      host = value;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      if (!/^\d+$/u.test(value ?? '')) {
        return undefined;
      }

      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
        return undefined;
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    if (arg === '--app-url') {
      try {
        appUrl = new URL(value ?? '').toString().replace(/\/$/u, '');
      } catch {
        return undefined;
      }
      index += 1;
      continue;
    }

    return undefined;
  }

  if (!isPresent(host) || port === undefined) {
    return undefined;
  }

  return appUrl === undefined ? { host, port } : { host, port, appUrl };
}

function parseScopeList(value: string): readonly string[] {
  const scopes = normalizeShopifyScopes(value);

  if (scopes.length > MAX_SHOPIFY_HERMES_SCOPES) {
    throw new Error('Invalid Shopify OAuth scope configuration.');
  }

  return scopes;
}

function requiredReportScopes(report: string): readonly string[] {
  if (report === 'products') {
    return ['read_products'];
  }

  if (report === 'orders') {
    return ['read_orders'];
  }

  if (report === 'inventory') {
    return ['read_inventory', 'read_products', 'read_locations'];
  }

  return [];
}

async function runHermes(args: readonly string[], context: CliContext): Promise<number> {
  if (args[0] !== 'install') {
    context.stderr(hermesUsage());
    return 2;
  }

  return runHermesInstall(context);
}

const HERMES_MCP_SERVER_NAME = 'shopify-hermes-oauth';
const HERMES_MCP_COMMAND = 'hermes mcp add shopify-hermes-oauth --command "shopify-hermes-oauth" --args mcp serve';
const HERMES_MCP_ARGS = ['mcp', 'add', HERMES_MCP_SERVER_NAME, '--command', 'shopify-hermes-oauth', '--args', 'mcp', 'serve'] as const;

async function runHermesInstall(context: CliContext): Promise<number> {
  const paths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
  const skillDir = join(paths.hermesHome, 'skills', 'productivity', HERMES_MCP_SERVER_NAME);
  const skillPath = join(skillDir, 'SKILL.md');
  const hermesOk = await context.commandExists('hermes');
  const alreadyConfigured = await hasDetectableHermesMcpConfig(context, paths.hermesHome);

  await context.mkdir(skillDir);
  await context.writeJsonFile(skillPath, localHermesSkillContent());

  if (alreadyConfigured) {
    context.stdout('Hermes MCP server already configured: shopify-hermes-oauth.');
  } else if (hermesOk) {
    const result = await context.executeCommand('hermes', HERMES_MCP_ARGS);

    if (result.status !== 0) {
      context.stderr(`Hermes MCP configuration failed. Run manually: ${HERMES_MCP_COMMAND}`);
      return 1;
    }

    context.stdout('Configured Hermes MCP server: shopify-hermes-oauth.');
  } else {
    context.stdout('Hermes CLI not found. Run this command after installing Hermes:');
    context.stdout(HERMES_MCP_COMMAND);
  }

  context.stdout(`Installed local Hermes skill: ${skillPath}`);
  return 0;
}

async function hasDetectableHermesMcpConfig(context: CliContext, hermesHome: string): Promise<boolean> {
  const candidatePaths = [
    join(hermesHome, 'config.yaml'),
    join(hermesHome, 'mcp.json'),
    join(hermesHome, 'mcp_servers.json'),
    join(hermesHome, 'config', 'mcp.json'),
    join(hermesHome, 'config.json'),
  ];

  for (const candidatePath of candidatePaths) {
    const content = await context.readFile(candidatePath);
    if (content === undefined) {
      continue;
    }

    if (candidatePath.endsWith('.json') ? hasHermesMcpJsonConfig(content) : hasHermesMcpYamlConfig(content)) {
      return true;
    }
  }

  return false;
}

function hasHermesMcpJsonConfig(content: string): boolean {
  try {
    return hasHermesMcpConfigShape(JSON.parse(content) as unknown);
  } catch {
    return false;
  }
}

const HERMES_MCP_CONFIG_CONTAINER_KEYS = ['mcp_servers', 'mcpServers', 'servers'] as const;

function hasHermesMcpConfigShape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return HERMES_MCP_CONFIG_CONTAINER_KEYS.some((key) => hasHermesMcpConfigContainer(value[key]));
}

function hasHermesMcpConfigContainer(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => isHermesMcpServerConfig(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (isHermesMcpServerConfig(value)) {
    return true;
  }

  return Object.values(value).some((item) => isHermesMcpServerConfig(item));
}

function isHermesMcpServerConfig(value: unknown): boolean {
  return isRecord(value) && value.command === HERMES_MCP_SERVER_NAME && hasHermesMcpArgs(value.args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasHermesMcpArgs(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string') && value.some((arg, index) => arg === 'mcp' && value[index + 1] === 'serve');
  }

  return typeof value === 'string' && /(?:^|\s)mcp\s+serve(?:\s|$)/u.test(value);
}

interface OnboardArgs {
  readonly shop: string;
  readonly appName: string;
}

async function runOnboard(args: readonly string[], context: CliContext): Promise<number> {
  const parsedArgs = parseOnboardArgs(args);
  if (parsedArgs === undefined) {
    context.stderr(onboardUsage());
    return 2;
  }

  const initialPaths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
  const envFileContent = await context.readFile(initialPaths.envFile);
  const envFileValues = parseShopifyHermesEnv(envFileContent ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });
  const missingConfigKeys = missingRequiredConfigKeys(mergedEnv);
  const appUrl = mergedEnv.SHOPIFY_HERMES_APP_URL?.trim();
  const knownAppUrl = normalizeOnboardPublicAppUrl(appUrl);
  const hasTunnelTool = await context.commandExists('cloudflared') || await context.commandExists('ngrok');
  const mcpConfigured = await hasDetectableHermesMcpConfig(context, paths.hermesHome);
  const shopState = await readOnboardShopState(context, paths.tokenStore, parsedArgs.shop);

  context.stdout('Shopify Hermes OAuth chat-first onboarding');
  context.stdout(`Shop: ${parsedArgs.shop}`);
  context.stdout(`App name: ${parsedArgs.appName}`);
  context.stdout('');
  context.stdout('Current state:');
  context.stdout(`- Configuration: ${missingConfigKeys.length === 0 ? 'present' : `missing ${missingConfigKeys.join(', ')}`}`);
  context.stdout(`- Tunnel/app URL: ${knownAppUrl === undefined ? 'missing/public HTTPS URL needed' : 'configured'}`);
  context.stdout(`- Tunnel CLI: ${hasTunnelTool ? 'available' : 'not detected (manual public HTTPS URL is okay)'}`);
  context.stdout(`- MCP server: ${mcpConfigured ? 'configured' : 'not configured'}`);
  context.stdout(formatOnboardShopState(parsedArgs.shop, shopState));
  context.stdout('');
  context.stdout('Agent can do:');
  context.stdout('1. Run local safe setup/status commands:');
  context.stdout('   shopify-hermes-oauth init');
  context.stdout('   shopify-hermes-oauth doctor');
  context.stdout('   shopify-hermes-oauth hermes install');
  context.stdout('2. Start a development tunnel and callback server when needed:');
  context.stdout('   shopify-hermes-oauth dev --tunnel');
  context.stdout('3. Ask the user to enter app credentials locally, never in chat:');
  context.stdout('   shopify-hermes-oauth credentials set');
  context.stdout('');
  context.stdout('Human must do in Shopify:');
  context.stdout(`1. Create or open the Shopify app named: ${parsedArgs.appName}`);
  context.stdout('2. Configure app URLs:');
  context.stdout(`   Application URL: ${knownAppUrl ?? 'https://<public-app-url>'}`);
  context.stdout(`   Allowed redirection URL: ${knownAppUrl === undefined ? 'https://<public-app-url>/auth/callback' : `${knownAppUrl}/auth/callback`}`);
  context.stdout('3. Set Required Admin API Scopes: read_products, read_orders, read_inventory, read_locations');
  context.stdout('4. Copy the Client ID and Client secret into the local credential prompt only. Do not paste secrets into chat.');
  context.stdout('5. Open the install URL while the callback server/tunnel is running:');
  context.stdout(`   Install URL: ${knownAppUrl === undefined ? `https://<public-app-url>/auth/start?shop=${parsedArgs.shop}` : `${knownAppUrl}/auth/start?shop=${parsedArgs.shop}`}`);
  context.stdout('');
  context.stdout('Post-install verification:');
  context.stdout('shopify-hermes-oauth shops list');
  context.stdout(`shopify-hermes-oauth shops verify ${parsedArgs.shop}`);
  context.stdout('After MCP install or first store install, reset/restart the Hermes session so new MCP tools are visible.');
  context.stdout('Safety: this checklist never prints Shopify client secrets, access tokens, or token-store contents.');
  return 0;
}

function parseOnboardArgs(args: readonly string[]): OnboardArgs | undefined {
  let shopInput: string | undefined;
  let appName = 'shopify-hermes-oauth';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--shop') {
      shopInput = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--app-name') {
      appName = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    return undefined;
  }

  if (!isPresent(shopInput) || !isPresent(appName)) {
    return undefined;
  }

  try {
    const trimmedShopInput = shopInput.trim();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/iu.test(trimmedShopInput)) {
      return undefined;
    }

    const normalizedShop = normalizeTokenStoreShopDomain(trimmedShopInput);
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/iu.test(normalizedShop)) {
      return undefined;
    }

    return { shop: normalizedShop, appName: appName.trim() };
  } catch {
    return undefined;
  }
}

type OnboardShopState = 'none-installed' | 'target-installed' | 'other-shops-installed' | 'token-store-invalid' | 'token-store-unreadable';

async function readOnboardShopState(context: CliContext, tokenStorePath: string, shop: string): Promise<OnboardShopState> {
  let content: string | undefined;
  try {
    content = await context.readFile(tokenStorePath);
  } catch {
    return 'token-store-unreadable';
  }

  if (content === undefined) {
    return 'none-installed';
  }

  try {
    const parsed = parseLocalJsonTokenStoreFile(JSON.parse(content) as unknown);
    const shops = Object.keys(parsed.shops);
    if (shops.includes(shop)) {
      return 'target-installed';
    }

    return shops.length === 0 ? 'none-installed' : 'other-shops-installed';
  } catch {
    return 'token-store-invalid';
  }
}

function formatOnboardShopState(shop: string, state: OnboardShopState): string {
  if (state === 'target-installed') {
    return `- Shop ${shop}: installed locally (verify with command below)`;
  }

  if (state === 'other-shops-installed') {
    return `- Shop ${shop}: not installed locally (other shops are installed)`;
  }

  if (state === 'token-store-invalid') {
    return '- Shops: token store is invalid; run doctor for safe details';
  }

  if (state === 'token-store-unreadable') {
    return '- Shops: token store is unreadable; run doctor for safe details';
  }

  return '- Shops: none installed';
}

function hasHermesMcpYamlConfig(content: string): boolean {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => stripYamlComment(line))
    .filter((line) => line.trim().length > 0);

  for (const [index, line] of lines.entries()) {
    const commandMatch = /^(\s*)command:\s*['"]?shopify-hermes-oauth['"]?\s*$/u.exec(line);
    if (commandMatch === null) {
      continue;
    }

    if (yamlBlockHasMcpServeArgs(lines.slice(index + 1), commandMatch[1]?.length ?? 0)) {
      return true;
    }
  }

  return false;
}

function stripYamlComment(line: string): string {
  const commentIndex = line.indexOf('#');
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function yamlBlockHasMcpServeArgs(lines: readonly string[], propertyIndent: number): boolean {
  const args: string[] = [];
  let inArgs = false;
  let argsIndent = -1;

  for (const line of lines) {
    const indent = line.search(/\S/u);
    if (indent < propertyIndent) {
      break;
    }

    if (!inArgs) {
      const argsMatch = /^(\s*)args:\s*(.*)$/u.exec(line);
      if (argsMatch === null) {
        continue;
      }

      inArgs = true;
      argsIndent = argsMatch[1]?.length ?? indent;
      const inlineArgs = parseYamlInlineArgs(argsMatch[2] ?? '');
      if (inlineArgs.length > 0) {
        args.push(...inlineArgs);
        break;
      }
      continue;
    }

    if (indent <= argsIndent) {
      break;
    }

    const listItem = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line)?.[1];
    if (listItem !== undefined) {
      args.push(listItem);
    }
  }

  return hasHermesMcpArgs(args);
}

function parseYamlInlineArgs(value: string): readonly string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/gu, ''))
      .filter((item) => item.length > 0);
  }

  return trimmed.split(/\s+/u);
}

function localHermesSkillContent(): string {
  return [
    "---",
    "name: shopify-hermes-oauth",
    "description: Safe Shopify OAuth connector for Hermes: setup, health checks, store verification, read-only reports, MCP tools, and when to prefer the direct-token shopify skill.",
    "version: 0.1.0",
    "author: Nous Research",
    "license: MIT",
    "metadata:",
    "  hermes:",
    "    tags: [shopify, oauth, mcp, ecommerce, reports]",
    "    related_skills: [shopify]",
    "---",
    "",
    "# OAuth",
    "",
    "Use this for Shopify OAuth app installs, multi-store access, reports, MCP, or safer long-running workflows.",
    "",
    "Prefer the direct-token `shopify` skill for one-off custom Admin GraphQL or curl work where the user already has a short-lived/direct-token workflow. For durable access, multiple stores, scheduled reports, or avoiding pasted per-store tokens, use this OAuth connector.",
    "",
    "## Safety rules",
    "",
    "- Do not ask users to paste Shopify access tokens into chat.",
    "- Do not ask users to paste Shopify client secrets into chat.",
    "- Do not print OAuth secrets, access tokens, or token stores.",
    "- Keep operations read-only unless the user explicitly requests otherwise through a safe command or MCP tool.",
    "- Default OAuth installs should request only the v0.1 least-privilege Required Admin API Scopes: `read_products`, `read_orders`, `read_inventory`, and `read_locations`; Optional Shopify scopes alone are insufficient.",
    "- Verify the target shop before reports or MCP calls.",
    "- Use the store's canonical Admin `*.myshopify.com` domain; do not guess store domains from brand names. If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain.",
    "",
    "## Setup and health checks",
    "",
    "For chat-first live onboarding, start with the non-interactive guided checklist:",
    "",
    "```bash",
    "shopify-hermes-oauth onboard --shop <shop>.myshopify.com --app-name <app-name>",
    "```",
    "",
    "Output has `Agent can do:` and `Human must do in Shopify:` sections: current state, dashboard URLs, install URL, credential handoff, MCP install, and verification without printing secrets or token-store contents.",
    "",
    "Run local commands via the terminal:",
    "",
    "```bash",
    "shopify-hermes-oauth init",
    "shopify-hermes-oauth doctor",
    "shopify-hermes-oauth hermes install",
    "```",
    "",
    "`init` writes missing `.env` keys from current environment values or safe placeholders without printing secrets; it is not an interactive prompt. `doctor` checks local config. `hermes install` registers the MCP server, equivalent to `mcp serve`.",
    "",
    "For non-Bitwarden chat-first credential setup, use `shopify-hermes-oauth credentials set`: the agent sends the exact command, the user runs it locally or over SSH/Termius, then replies `done` without sharing secrets. The prompt hides the client secret while typing and updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`.",
    "",
    "For VPS/chat-first use, recommend Hermes Bitwarden Secrets Manager instead of secrets in chat. Store `SHOPIFY_HERMES_CLIENT_ID`, `SHOPIFY_HERMES_CLIENT_SECRET`, and `SHOPIFY_HERMES_APP_URL` as Bitwarden project variables (`BWS_PROJECT_ID`); include `--server-url <self-hosted-url>` for a self-hosted endpoint. Check `hermes secrets bitwarden status` and `hermes secrets bitwarden sync`, then run `shopify-hermes-oauth doctor`. Do not write secrets back to `.env`.",
    "",
    "For source installs, prefer `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz` over `npm link`. Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell; if needed run `export PATH=\"$HERMES_HOME/node/bin:$PATH\"`. If `shopify-hermes-oauth doctor` prints `Connector CLI: installed but not on PATH`, use its PATH export or wrapper.",
    "",
    "For OAuth callback setup during development, start a public HTTPS tunnel and local callback server:",
    "",
    "```bash",
    "shopify-hermes-oauth dev --tunnel",
    "```",
    "",
    "If you provide your own tunnel instead, run the callback server explicitly:",
    "",
    "```bash",
    "shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 --app-url <public-https-url>",
    "```",
    "",
    "Configure the Shopify app with the public Application URL and `<public-https-url>/auth/callback` redirect URL. To approve an install, open `/auth/start?shop=<shop>.myshopify.com` on the public app URL while the callback server is running.",
    "",
    "## Shop verification",
    "",
    "Before reading data, list and verify stores:",
    "",
    "```bash",
    "shopify-hermes-oauth shops list",
    "shopify-hermes-oauth shops verify <shop>",
    "shopify-hermes-oauth shops diagnostics <shop>",
    "```",
    "",
    "If verification fails, stop and report the connector error. Do not ask for raw tokens as a workaround. `shops diagnostics <shop>` prints safe store/app/access/privacy JSON; privacy policy presence/title/URL requires `read_content`, otherwise privacy returns `missing_scope` without querying policy fields.",
    "",
    "## Read-only reports",
    "",
    "Use built-in reports for summaries and exports:",
    "",
    "```bash",
    "shopify-hermes-oauth report products <shop> --format markdown",
    "shopify-hermes-oauth report orders <shop> --since 30d --format markdown",
    "shopify-hermes-oauth report inventory <shop> --format markdown",
    "```",
    "",
    "Prefer Markdown for user-facing summaries and JSON only when a downstream tool needs structure. Avoid unnecessary customer details.",
    "",
    "## Limits",
    "",
    "v0.1 reports have explicit nested-connection ceilings:",
    "",
    "- Products report: shows at most the first 100 variants per product and marks the variants summary when additional variants are omitted.",
    "- Orders report: shows at most the first 50 line items per order and marks the line-item summary when additional line items are omitted.",
    "- Inventory report: hard-fails when a product has more than 100 variants or a variant has more than 50 inventory levels, including safe affected GIDs.",
    "",
    "If a report hits these limits, narrow the report scope or use a custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports.",
    "",
    "## MCP tools",
    "",
    "After `shopify-hermes-oauth hermes install`, use the MCP server for agent workflows. Expected read-oriented tools include:",
    "",
    "- `shopify.health`",
    "- `shopify.list_shops`",
    "- `shopify.verify_shop`",
    "- `shopify.store.diagnostics` (safe store/app install status/access/privacy JSON; no tokens, raw GraphQL, owner/contact/billing/customer data, or policy bodies)",
    "- `shopify.report_products`",
    "- `shopify.report_orders`",
    "- `shopify.report_inventory`",
    "- `shopify.products.get`",
    "- `shopify.collections.list`",
    "- `shopify.collections.get`",
    "- `shopify.locations.list`",
    "- `shopify.locations.get`",
    "- `shopify.inventory.items.get`",
    "- `shopify.inventory.levels.list`",
    "- `shopify.orders.get`",
    "- `shopify.fulfillment_orders.list` (requires `read_orders`, `read_merchant_managed_fulfillment_orders`, `read_assigned_fulfillment_orders`, and `read_third_party_fulfillment_orders`; page cap 50, line items 25)",
    "- `shopify.fulfillment_orders.get` (same fulfillment-order scopes; omits destination address, tracking numbers/URLs, customer contact, notes/tags, metafields, and transactions)",
    "- `shopify.webhooks.list` (requires `read_webhooks`; no create/update/delete until gated)",
    "- `shopify.webhooks.get` (requires `read_webhooks`)",
    "- `shopify.customers.list` (requires `read_customers`; returns bounded pages with email domains only, phone presence only, and aggregate order/spend summaries)",
    "- `shopify.customers.get` (requires `read_customers`; returns one customer by GID with the same minimal PII policy)",
    "- `shopify.discounts.list/get` (requires `read_discounts`; omits individual codes/customer/order/attribution/customerSelection details)",
    "- `shopify.marketing_events.list` (requires `read_marketing_events`; redacts manage/preview URL query strings)",
    "- `shopify.markets.list` (requires `read_markets`; bounded market/region/currency summary; Shopify may gate Markets by plan/API/app approval)",
    "- `shopify.localization.locales.list` (requires `read_locales`; locale names/status only, no translations; unsupported stores return a safe limitation object)",
    "- `shopify.metafield_definitions.list/get` and `shopify.resource_metafields.list` (require `read_products`; validate owner type/namespace/key and return no raw values)",
    "- `shopify.metaobject_definitions.list/get` (requires `read_metaobject_definitions`) and `shopify.metaobjects.list/get` (requires `read_metaobjects`; value presence/length only)",
    "",
    "`shopify.health` returns lightweight process memory diagnostics for reconnect/OOM triage without token-store contents. `mcp serve` also emits start/stop lifecycle JSON to stderr, keeping JSON-RPC stdout clean.",
    "",
    "If MCP is unavailable, fall back to matching CLI commands and include output without secrets.",
    "",
    "## References",
    "",
    "- Docs: `README.md`, `docs/shopify-app-setup.md`, `docs/shopify-cli-assisted-setup.md`",
    "- Shopify app setup belongs in Shopify's app/admin UI; the connector stores local Hermes configuration under the user's Hermes home.",
    "",
  ].join('\n');
}

async function runDoctor(context: CliContext): Promise<number> {
  const initialPaths = resolveShopifyHermesPaths({
    env: context.env,
    homeDir: context.homeDir,
  });
  const envFileContent = await context.readFile(initialPaths.envFile);
  const envFileValues = parseShopifyHermesEnv(envFileContent ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });
  const missingConfigKeys = missingRequiredConfigKeys(mergedEnv);
  const hermesBitwardenEnabled = missingConfigKeys.length > 0
    ? hermesBitwardenSecretsManagerAppearsConfigured(context.env, await readOptionalFile(context, join(initialPaths.hermesHome, 'config.yaml')))
    : false;
  const nodeOk = getNodeMajor(context.nodeVersion) >= 20;
  const hermesOk = await context.commandExists('hermes');
  const connectorPathStatus = await checkConnectorPathStatus(context, paths.hermesHome);
  const cloudflaredOk = await context.commandExists('cloudflared');
  const ngrokOk = await context.commandExists('ngrok');
  const tokenStoreStatus = await checkTokenStoreStatus(context, paths.tokenStore);
  const scopeDriftWarnings = tokenStoreStatus === 'ok'
    ? await readScopeDriftWarnings(context, paths.tokenStore, mergedEnv.SHOPIFY_HERMES_SCOPES ?? DEFAULT_SHOPIFY_HERMES_SCOPES)
    : [];
  const auditWritable = await checkAuditWritable(context, paths.auditLog);

  context.stdout('Shopify Hermes OAuth doctor');
  context.stdout(`Node.js >=20: ${nodeOk ? 'ok' : `missing (found ${context.nodeVersion}; install Node.js 20 or newer)`}`);
  context.stdout(`Hermes CLI: ${hermesOk ? 'ok' : 'missing (install Hermes Agent CLI before connecting this OAuth helper)'}`);
  context.stdout(formatConnectorPathStatus(connectorPathStatus));
  context.stdout(`cloudflared: ${cloudflaredOk ? 'ok' : 'optional, not found'}`);
  context.stdout(`ngrok: ${ngrokOk ? 'ok' : 'optional, not found'}`);
  context.stdout(`Hermes home: ${paths.hermesHome}`);
  context.stdout(`Data directory: ${paths.dataDir}`);
  context.stdout(formatTokenStoreStatus(tokenStoreStatus));
  context.stdout(auditWritable ? 'Audit log: writable' : `Audit log: not writable. Check audit log path: ${paths.auditLog}`);

  if (missingConfigKeys.length === 0) {
    context.stdout('Required configuration: ok');
  } else {
    context.stdout(`Missing required configuration: ${missingConfigKeys.join(', ')}`);
  }

  context.stdout(formatClientSecretRotationStatus(mergedEnv));

  for (const warning of clientSecretRotationWarnings(mergedEnv)) {
    context.stdout(warning);
  }

  for (const warning of scopeDriftWarnings) {
    context.stdout(warning);
  }

  if (tokenStoreStatus === 'corrupted') {
    context.stderr(`Token store is corrupted or invalid JSON. Fix or remove ${paths.tokenStore} before continuing.`);
  }

  if (tokenStoreStatus === 'unreadable') {
    context.stderr(`Token store is unreadable. Check token store path: ${paths.tokenStore}`);
  }

  if (!auditWritable) {
    context.stderr(`Audit log is not writable. Check audit log path: ${paths.auditLog}`);
  }

  if (connectorPathStatus.kind === 'installed-not-on-path') {
    context.stderr(`Connector CLI is installed at ${connectorPathStatus.executable} but its npm bin directory is not on PATH.`);
    context.stderr(`Add the Hermes profile-local npm bin directory to your shell PATH: export PATH="${connectorPathStatus.binDir}:$PATH"`);
    context.stderr('or install globally from source with `npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz`.');
  }

  if (!nodeOk || !hermesOk || connectorPathStatus.kind === 'installed-not-on-path' || missingConfigKeys.length > 0 || tokenStoreStatus === 'corrupted' || tokenStoreStatus === 'unreadable' || !auditWritable) {
    printNextSteps(context, missingConfigKeys, { nodeOk, hermesOk, hasTunnel: cloudflaredOk || ngrokOk, hermesBitwardenEnabled });
    return 1;
  }

  if (!cloudflaredOk && !ngrokOk) {
    context.stdout('No tunnel CLI detected. Install cloudflared or ngrok, or provide your own public HTTPS URL for SHOPIFY_HERMES_APP_URL.');
  }

  return 0;
}

type TokenStoreDoctorStatus = 'not-initialized' | 'ok' | 'corrupted' | 'unreadable';

type ConnectorPathStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'installed-not-on-path'; readonly binDir: string; readonly executable: string };

async function checkConnectorPathStatus(context: CliContext, hermesHome: string): Promise<ConnectorPathStatus> {
  if (await context.commandExists('shopify-hermes-oauth')) {
    return { kind: 'ok' };
  }

  for (const binDir of connectorCandidateBinDirs(context, hermesHome)) {
    const executable = join(binDir, 'shopify-hermes-oauth');
    if (await context.fileIsExecutable(executable)) {
      return { kind: 'installed-not-on-path', binDir, executable };
    }
  }

  return { kind: 'not-found' };
}

function connectorCandidateBinDirs(context: CliContext, hermesHome: string): readonly string[] {
  return [...new Set([
    join(hermesHome, 'node', 'bin'),
    context.homeDir === undefined ? undefined : join(context.homeDir, '.hermes', 'node', 'bin'),
  ].filter((path): path is string => path !== undefined))];
}

function formatConnectorPathStatus(status: ConnectorPathStatus): string {
  if (status.kind === 'ok') {
    return 'Connector CLI: ok';
  }

  if (status.kind === 'installed-not-on-path') {
    return `Connector CLI: installed but not on PATH (${status.executable})`;
  }

  return 'Connector CLI: not found on PATH';
}

async function readOptionalFile(context: CliContext, path: string): Promise<string | undefined> {
  try {
    return await context.readFile(path);
  } catch {
    return undefined;
  }
}

function hasHermesBitwardenSecretsManagerEnabled(configContent: string | undefined): boolean {
  if (configContent === undefined) {
    return false;
  }

  const stack: { readonly indent: number; readonly key: string }[] = [];

  for (const rawLine of configContent.split(/\r?\n/u)) {
    const line = stripYamlComment(rawLine);
    if (line.trim().length === 0) {
      continue;
    }

    const match = /^(\s*)([^:]+):\s*(.*?)\s*$/u.exec(line);
    if (match === null) {
      continue;
    }

    const indent = match[1]?.length ?? 0;
    const key = (match[2] ?? '').trim();
    const value = (match[3] ?? '').trim();
    while (stack.length > 0 && indent <= (stack.at(-1)?.indent ?? -1)) {
      stack.pop();
    }

    const nestedPath = [...stack.map((entry) => entry.key), key].join('.');
    const flatPath = key;
    if ((nestedPath === 'secrets.bitwarden.enabled' || flatPath === 'secrets.bitwarden.enabled') && /^true$/iu.test(value)) {
      return true;
    }

    if (value.length === 0) {
      stack.push({ indent, key });
    }
  }

  return false;
}

function hermesBitwardenSecretsManagerAppearsConfigured(
  env: Readonly<Record<string, string | undefined>>,
  configContent: string | undefined,
): boolean {
  return isPresent(env.BWS_ACCESS_TOKEN)
    || isPresent(env.BWS_PROJECT_ID)
    || hasHermesBitwardenSecretsManagerEnabled(configContent);
}

async function checkTokenStoreStatus(context: CliContext, tokenStorePath: string): Promise<TokenStoreDoctorStatus> {
  let content: string | undefined;

  try {
    content = await context.readFile(tokenStorePath);
  } catch {
    return 'unreadable';
  }

  if (content === undefined) {
    return 'not-initialized';
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    parseLocalJsonTokenStoreFile(parsed);
    return 'ok';
  } catch {
    return 'corrupted';
  }
}

async function checkAuditWritable(context: CliContext, auditLogPath: string): Promise<boolean> {
  try {
    await context.mkdir(dirname(auditLogPath));
    await context.writeJsonFile(auditLogPath, '', { flag: 'a' });
    await context.chmod(auditLogPath, 0o600);
    return true;
  } catch {
    return false;
  }
}

async function readScopeDriftWarnings(context: CliContext, tokenStorePath: string, configuredScopesInput: string): Promise<readonly string[]> {
  try {
    const content = await context.readFile(tokenStorePath);
    if (content === undefined) {
      return [];
    }

    const tokenStoreFile = parseLocalJsonTokenStoreFile(JSON.parse(content) as unknown);
    const configuredScopes = parseScopeList(configuredScopesInput);
    const warnings: string[] = [];

    for (const token of Object.values(tokenStoreFile.shops)) {
      const extraScopes = compareShopifyScopes({ granted: token.scopes, configured: configuredScopes }).extra;
      if (extraScopes.length > 0) {
        warnings.push(`Scope drift warning: ${sanitizeCliField(token.shop)} has granted scopes outside current configuration: ${sanitizeCliField(extraScopes.join(','))}. Reinstall or re-authorize the shop to return to least privilege.`);
      }
    }

    return warnings;
  } catch {
    return [];
  }
}

function formatTokenStoreStatus(status: TokenStoreDoctorStatus): string {
  if (status === 'not-initialized') {
    return 'Token store: not initialized';
  }

  if (status === 'ok') {
    return 'Token store: parseable/ok';
  }

  if (status === 'unreadable') {
    return 'Token store: unreadable';
  }

  return 'Token store: corrupted/invalid JSON';
}

function formatClientSecretRotationStatus(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (!isPresent(env.SHOPIFY_HERMES_OLD_CLIENT_SECRET)) {
    return 'OAuth client secret rotation fallback: disabled';
  }

  return 'OAuth client secret rotation fallback: enabled (current secret first, then old secret; does not report which secret matched)';
}

function clientSecretRotationWarnings(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (!isPresent(env.SHOPIFY_HERMES_OLD_CLIENT_SECRET)) {
    return [];
  }

  const rotatedAt = env.SHOPIFY_HERMES_OLD_CLIENT_SECRET_ROTATED_AT;
  const cleanup = 'remove SHOPIFY_HERMES_OLD_CLIENT_SECRET after the transition window';

  if (isPresent(rotatedAt)) {
    return [`Old client secret configured since ${sanitizeCliField(rotatedAt)}; ${cleanup}.`];
  }

  return [`Old client secret fallback is temporary; ${cleanup}.`];
}

async function runCredentials(args: readonly string[], context: CliContext): Promise<number> {
  if (args[0] !== 'set' || args.length !== 1) {
    context.stderr(credentialsUsage());
    return 2;
  }

  let clientId: string;
  let clientSecret: string;

  try {
    clientId = await context.promptCredential('Shopify client ID');
    clientSecret = await context.promptCredential('Shopify client secret');
  } catch (error) {
    if (error instanceof NoInteractiveCredentialInputError) {
      context.stderr(error.message);
      context.stderr('Run `shopify-hermes-oauth credentials set` from your local terminal or SSH/Termius shell.');
      context.stderr('Do not paste Shopify client secrets into chat or a heredoc.');
      return 2;
    }

    throw error;
  }

  const credentials: Record<CredentialEnvKey, string> = {
    SHOPIFY_HERMES_CLIENT_ID: clientId,
    SHOPIFY_HERMES_CLIENT_SECRET: clientSecret,
  };

  try {
    const paths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
    const existingEnvFile = await context.readFile(paths.envFile);
    const updatedEnvFile = updateCredentialEnvKeys(existingEnvFile ?? '', credentials);

    await context.writeEnvFile(paths.envFile, updatedEnvFile);
    context.stdout(`Updated ${paths.envFile} with Shopify app credentials.`);
    context.stdout('Success: credential handoff complete. Reply `done` in chat; do not share secrets.');
    return 0;
  } catch (error) {
    if (error instanceof UnsafeEnvValueError) {
      context.stderr(error.message.replace('running init again', 'running credentials set again'));
      return 1;
    }

    throw error;
  }
}

async function runInit(context: CliContext): Promise<number> {
  const initialPaths = resolveShopifyHermesPaths({ env: context.env, homeDir: context.homeDir });
  const existingEnvFile = await context.readFile(initialPaths.envFile);
  const envFileValues = parseShopifyHermesEnv(existingEnvFile ?? '');
  const mergedEnv = mergeShopifyHermesEnv(envFileValues, context.env);
  const paths = resolveShopifyHermesPaths({ env: mergedEnv, homeDir: context.homeDir });
  const hermesBitwardenConfigured = hermesBitwardenSecretsManagerAppearsConfigured(
    context.env,
    await readOptionalFile(context, join(initialPaths.hermesHome, 'config.yaml')),
  );
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
      updatedEnvFile = updateMissingEnvKeys(existingEnvFile ?? '', keysNeedingWrite, mergedEnv, paths.dataDir, hermesBitwardenConfigured);
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
  if (hermesBitwardenConfigured) {
    printInitBitwardenGuidance(context);
  } else {
    context.stdout('Manual Shopify setup is still required: create a Shopify app in your Shopify Partner dashboard, set the app URL to SHOPIFY_HERMES_APP_URL, and add the OAuth callback URL below.');
    context.stdout('For local .env setup, replace placeholders with Shopify app values; do not paste Shopify client secrets into chat.');
  }
  printCallbackInstructions(context, mergedEnv);
  context.stdout('Next Hermes MCP step: run `shopify-hermes-oauth hermes install` to configure MCP when available.');
  context.stdout('Run `shopify-hermes-oauth doctor` after filling in any placeholder values.');

  return 0;
}

function createCliContext(dependencies: CliDependencies): CliContext {
  const renameFile = dependencies.renameFile ?? fsRename;
  const unlinkFile = dependencies.unlinkFile ?? fsUnlink;
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
    executeCommand: async (command, args) => dependencies.executeCommand?.(command, args) ?? defaultExecuteCommand(command, args),
    startProcess: async (command, args) => dependencies.startProcess?.(command, args) ?? defaultStartProcess(command, args),
    listenServer: async (server, options) => dependencies.listenServer?.(server, options) ?? defaultListenServer(server, options),
    readFile: async (path) => {
      if (dependencies.readFile !== undefined) {
        return dependencies.readFile(path);
      }

      if (!existsSync(path)) {
        return undefined;
      }

      return fsReadFile(path, 'utf8');
    },
    fileIsExecutable: async (path) => dependencies.fileIsExecutable?.(path) ?? defaultFileIsExecutable(path),
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
    writeJsonFile: async (path, content, options) => {
      if (dependencies.writeFile !== undefined) {
        await dependencies.writeFile(path, content, { mode: 0o600, flag: options?.flag });
        return;
      }

      await fsWriteFile(path, content, { encoding: 'utf8', mode: 0o600, flag: options?.flag });
    },
    renameFile: async (from, to) => {
      await renameFile(from, to);
    },
    unlinkFile: async (path) => {
      await unlinkFile(path);
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
    promptCredential: async (label) => dependencies.promptCredential?.(label) ?? defaultPromptCredential(label),
    fetch: dependencies.fetch ?? globalThis.fetch,
    healthCheckTimeoutMs: dependencies.healthCheckTimeoutMs ?? 3_000,
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
    'Usage: shopify-hermes-oauth <doctor|init|onboard|credentials|dev|serve|shops|report|mcp|hermes>',
    '',
    'Commands:',
    '  doctor       Check Node, Hermes CLI, tunnel tools, paths, and required Shopify config.',
    '  init         Create the data directory and append missing SHOPIFY_HERMES_* .env keys.',
    '  onboard      Print a guided chat-first onboarding checklist and local status.',
    '  credentials  Safely prompt for Shopify app credentials and update $HERMES_HOME/.env.',
    '  dev          Start a local callback server and optional dev tunnel.',
    '  serve        Listen for Shopify OAuth start/callback HTTP requests.',
    '  shops        List or remove locally stored shop OAuth tokens (never prints token values).',
    '  report       Generate read-only Shopify reports.',
    '  mcp          Serve curated read-only Shopify MCP tools over stdio.',
    '  hermes       Configure Hermes MCP and optional local skill integration.',
  ].join('\n');
}

function onboardUsage(): string {
  return [
    'Usage: shopify-hermes-oauth onboard --shop <shop.myshopify.com> [--app-name <name>]',
    '',
    'Commands:',
    '  onboard  Print a non-interactive chat-first onboarding checklist and local status without secrets.',
  ].join('\n');
}

function credentialsUsage(): string {
  return [
    'Usage: shopify-hermes-oauth credentials set',
    '',
    'Commands:',
    '  credentials set  Prompt for Shopify client ID and client secret without echoing secrets.',
  ].join('\n');
}

function devUsage(): string {
  return [
    'Usage: shopify-hermes-oauth dev --tunnel',
    '',
    'Commands:',
    '  dev --tunnel  Start the local OAuth callback server and a cloudflared/ngrok tunnel when available.',
  ].join('\n');
}

function serveUsage(): string {
  return [
    'Usage: shopify-hermes-oauth serve --host 127.0.0.1 --port 3456 [--app-url URL]',
    '',
    'Commands:',
    '  serve  Listen for Shopify OAuth start/callback HTTP requests and store local OAuth tokens.',
  ].join('\n');
}

function hermesUsage(): string {
  return [
    'Usage: shopify-hermes-oauth hermes install',
    '',
    'Commands:',
    '  hermes install  Configure Hermes MCP and install/update the local Hermes skill.',
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

interface ParsedReportArgs {
  readonly format: ProductsReportFormat;
  readonly ordersWindowInput: OrdersReportWindowInput;
  readonly lowStockThreshold: number;
}

type ReportSubcommand = 'products' | 'orders' | 'inventory';
type ReportArgsParseResult = ParsedReportArgs | 'invalid-format' | undefined;

function parseReportArgs(subcommand: ReportSubcommand, args: readonly string[]): ReportArgsParseResult {
  let format: ProductsReportFormat = 'markdown';
  const ordersWindowInput: { since?: string; from?: string; to?: string } = {};
  let lowStockThreshold = 5;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--format') {
      const value = args[index + 1];

      if (value !== 'markdown' && value !== 'json' && value !== 'csv') {
        return 'invalid-format';
      }

      format = value;
      index += 1;
      continue;
    }

    if (arg === '--since' || arg === '--from' || arg === '--to') {
      if (subcommand !== 'orders') {
        return undefined;
      }

      const value = args[index + 1];
      if (!isPresent(value) || value.startsWith('--')) {
        return undefined;
      }

      if (arg === '--since') {
        ordersWindowInput.since = value;
      } else if (arg === '--from') {
        ordersWindowInput.from = value;
      } else {
        ordersWindowInput.to = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--low-stock-threshold') {
      if (subcommand !== 'inventory') {
        return undefined;
      }

      const value = args[index + 1];
      if (!isPresent(value) || value.startsWith('--')) {
        return undefined;
      }

      if (!/^\d+$/u.test(value)) {
        throw new InventoryReportError('Inventory report low-stock threshold must be a non-negative integer.');
      }

      lowStockThreshold = Number(value);
      index += 1;
      continue;
    }

    return undefined;
  }

  return { format, ordersWindowInput, lowStockThreshold };
}

function shopsUsage(): string {
  return [
    'Usage: shopify-hermes-oauth shops <list|remove|verify|diagnostics>',
    '',
    'Commands:',
    '  shops list                List installed shop domains and non-secret metadata.',
    '  shops remove <shop>       Delete the local OAuth token for a shop.',
    '  shops verify <shop>       Verify a stored shop token with safe Admin GraphQL metadata.',
    '  shops diagnostics <shop>  Print safe store/app/access/privacy diagnostics as JSON.',
  ].join('\n');
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
      writeFile: async (path, content, options) => {
        await context.writeJsonFile(path, content, { flag: options.flag });
      },
      rename: context.renameFile,
      unlink: context.unlinkFile,
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

    const missingScopes = missingShopifyScopes(token.scopes, requiredScopes);
    if (missingScopes.length > 0) {
      throw new MissingShopifyScopesError(shop, missingScopes);
    }

    return {
      shop,
      client: {
        query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => adminClient.query({
          shop,
          accessToken: token.accessToken,
          query,
          variables,
          operationName: options?.operationName,
        }),
      },
    };
  };

  return {
    tokenStore: store,
    appendAuditEvent: async (event) => context.appendAuditEvent(runtime.paths.auditLog, event),
    verifyShop: ({ shop }) => verifyShop({
      shop,
      tokenStore: store,
      adminClient,
      appendAuditEvent: async (event) => appendAuditEventBestEffort(context, runtime.paths.auditLog, enrichAuditEvent(event, 'mcp', 'read-only')),
    }),
    storeDiagnostics: async ({ shop }) => {
      const reportRuntime = await reportClientFor(shop);
      return generateStoreDiagnostics({
        shop: reportRuntime.shop,
        tokenStore: store,
        configuredScopes: parseScopeList(runtime.mergedEnv.SHOPIFY_HERMES_SCOPES ?? DEFAULT_SHOPIFY_HERMES_SCOPES),
        client: reportRuntime.client,
      });
    },
    summarizeOnlineStore: async ({ shop }) => {
      const reportRuntime = await reportClientFor(shop);
      return summarizeOnlineStore({ shop: reportRuntime.shop, tokenStore: store, client: reportRuntime.client });
    },
    reportProducts: async ({ shop, format }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
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
      const reportRuntime = await reportClientFor(shop, ['read_inventory', 'read_products', 'read_locations']);
      const report = await generateInventoryReport({ client: reportRuntime.client, lowStockThreshold: threshold });
      return { shop: reportRuntime.shop, format, lowStockThreshold: threshold, report, formatted: formatInventoryReport(report, format) };
    },
    analyticsShopifyqlSummary: async ({ shop, report: reportId, format, from, to, granularity, limit }) => {
      if (!parseBooleanGate(runtime.mergedEnv.SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS)) {
        throw new ShopifyqlAnalyticsError(analyticsReportsDisabledMessage());
      }
      const reportRuntime = await reportClientFor(shop, ['read_reports']);
      try {
        const report = await generateShopifyqlAnalyticsReport({ client: reportRuntime.client, report: reportId, from, to, granularity, limit });
        return { shop: reportRuntime.shop, format, report, formatted: formatShopifyqlAnalyticsReport(report, format) };
      } catch (error) {
        if (error instanceof ShopifyAdminGraphqlError) {
          throw new ShopifyqlAnalyticsError(analyticsReportsDisabledMessage());
        }
        throw error;
      }
    },
    startBulkOperation: async ({ shop, templateId }) => {
      const template = getBulkOperationTemplate(templateId);
      if (template === undefined) {
        throw new BulkOperationError('Bulk operation template is not allowed.', 'BULK_OPERATION_INVALID_TEMPLATE');
      }
      const reportRuntime = await reportClientFor(shop, template.requiredScopes);
      return { shop: reportRuntime.shop, ...(await startBulkOperation({ client: reportRuntime.client, templateId })) };
    },
    getCurrentBulkOperation: async ({ shop }) => {
      const reportRuntime = await reportClientFor(shop);
      return { shop: reportRuntime.shop, ...(await getCurrentBulkOperation({ client: reportRuntime.client })) };
    },
    fetchBulkOperationResult: async ({ shop, url, maxLines, maxBytes }) => {
      const reportRuntime = await reportClientFor(shop);
      return { shop: reportRuntime.shop, ...(await fetchBulkOperationResult({ fetch: context.fetch, url, maxLines, maxBytes })) };
    },
    cancelBulkOperation: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop);
      return { shop: reportRuntime.shop, ...(await cancelBulkOperation({ client: reportRuntime.client, id })) };
    },
    listWebhookSubscriptions: async ({ shop, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_webhooks']);
      const report = await listWebhookSubscriptions({ client: reportRuntime.client, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getWebhookSubscription: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_webhooks']);
      const report = await getWebhookSubscription({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    getProductDetail: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await getProductDetail({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listCollections: async ({ shop, first, after, query }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await listCollections({ client: reportRuntime.client, first, after, query });
      return { shop: reportRuntime.shop, ...report };
    },
    getCollection: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await getCollection({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listLocations: async ({ shop, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_locations']);
      const report = await listLocations({ client: reportRuntime.client, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getLocation: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_locations']);
      const report = await getLocation({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    getInventoryItem: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_inventory']);
      const report = await getInventoryItem({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listInventoryLevels: async ({ shop, inventoryItemId, locationId, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_inventory', 'read_locations']);
      const report = await listInventoryLevels({ client: reportRuntime.client, inventoryItemId, locationId, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getOrder: async ({ shop, id, name }) => {
      const reportRuntime = await reportClientFor(shop, ['read_orders']);
      const report = await getOrderDetail({ client: reportRuntime.client, id, name });
      return { shop: reportRuntime.shop, ...report };
    },
    listFulfillmentOrders: async ({ shop, orderId, orderName, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_orders', 'read_merchant_managed_fulfillment_orders', 'read_assigned_fulfillment_orders', 'read_third_party_fulfillment_orders']);
      const report = await listFulfillmentOrders({ client: reportRuntime.client, orderId, orderName, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getFulfillmentOrder: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_orders', 'read_merchant_managed_fulfillment_orders', 'read_assigned_fulfillment_orders', 'read_third_party_fulfillment_orders']);
      const report = await getFulfillmentOrder({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listCustomers: async ({ shop, first, after, query }) => {
      const reportRuntime = await reportClientFor(shop, ['read_customers']);
      const report = await listCustomers({ client: reportRuntime.client, first, after, query });
      return { shop: reportRuntime.shop, ...report };
    },
    getCustomer: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_customers']);
      const report = await getCustomer({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listDiscounts: async ({ shop, first, after, query }) => {
      const reportRuntime = await reportClientFor(shop, ['read_discounts']);
      const report = await listDiscounts({ client: reportRuntime.client, first, after, query });
      return { shop: reportRuntime.shop, ...report };
    },
    getDiscount: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_discounts']);
      const report = await getDiscount({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
    },
    listMarketingEvents: async ({ shop, first, after, query }) => {
      const reportRuntime = await reportClientFor(shop, ['read_marketing_events']);
      const report = await listMarketingEvents({ client: reportRuntime.client, first, after, query });
      return { shop: reportRuntime.shop, ...report };
    },
    listMarkets: async ({ shop, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_markets']);
      const report = await listMarkets({ client: reportRuntime.client, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    listShopLocales: async ({ shop }) => {
      const reportRuntime = await reportClientFor(shop, ['read_locales']);
      const report = await listShopLocales({ client: reportRuntime.client });
      return { shop: reportRuntime.shop, ...report };
    },
    listMetafieldDefinitions: async ({ shop, ownerType, namespace, key, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await listMetafieldDefinitions({ client: reportRuntime.client, ownerType, namespace, key, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getMetafieldDefinition: async ({ shop, ownerType, namespace, key }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await getMetafieldDefinition({ client: reportRuntime.client, ownerType, namespace, key });
      return { shop: reportRuntime.shop, ...report };
    },
    listResourceMetafields: async ({ shop, ownerId, namespace, key, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_products']);
      const report = await listResourceMetafields({ client: reportRuntime.client, ownerId, namespace, key, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    listMetaobjectDefinitions: async ({ shop, type, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_metaobject_definitions']);
      const report = await listMetaobjectDefinitions({ client: reportRuntime.client, type, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getMetaobjectDefinition: async ({ shop, type }) => {
      const reportRuntime = await reportClientFor(shop, ['read_metaobject_definitions']);
      const report = await getMetaobjectDefinition({ client: reportRuntime.client, type });
      return { shop: reportRuntime.shop, ...report };
    },
    listMetaobjects: async ({ shop, type, first, after }) => {
      const reportRuntime = await reportClientFor(shop, ['read_metaobjects']);
      const report = await listMetaobjects({ client: reportRuntime.client, type, first, after });
      return { shop: reportRuntime.shop, ...report };
    },
    getMetaobject: async ({ shop, id }) => {
      const reportRuntime = await reportClientFor(shop, ['read_metaobjects']);
      const report = await getMetaobject({ client: reportRuntime.client, id });
      return { shop: reportRuntime.shop, ...report };
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

function defaultExecuteCommand(command: string, args: readonly string[]): { readonly status: number | null } {
  const result = spawnSync(command, [...args], { stdio: 'inherit' });
  return { status: result.status };
}

export async function defaultStartProcess(command: string, args: readonly string[]): Promise<StartedProcessResult> {
  const child = spawn(command, [...args], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    output += text;
    process.stderr.write(text);
  });

  return new Promise((resolve) => {
    let settled = false;
    const closeSpawnedProcess = (): void => {
      child.stdout.destroy();
      child.stderr.destroy();

      if (!child.killed) {
        child.kill();
      }
    };
    const settle = (result: StartedProcessResult, options: { readonly closeChild?: boolean } = {}): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (options.closeChild === true) {
        closeSpawnedProcess();
      }

      const resolvedResult = options.closeChild === true || result.status !== undefined
        ? result
        : { ...result, close: closeSpawnedProcess };
      resolve(resolvedResult);
    };
    const timeout = setTimeout(() => {
      settle({ stdout: output }, { closeChild: command === 'shopify-hermes-oauth' });
    }, 5_000);

    const settleIfReadyOrFailed = (): void => {
      if (command === 'shopify-hermes-oauth') {
        if (hasCallbackServerReadiness(output)) {
          settle({ stdout: output });
          return;
        }

        if (hasExplicitCallbackServerStartupError(output)) {
          settle({ stdout: output, status: 1 }, { closeChild: true });
          return;
        }
      }

      if (extractPublicHttpsUrl(output, command) !== undefined) {
        settle({ stdout: output });
      }
    };

    child.on('error', () => {
      settle({ stdout: output, status: 1 });
    });
    child.on('exit', (status) => {
      settle({ stdout: output, status });
    });
    child.stdout.on('data', settleIfReadyOrFailed);
    child.stderr.on('data', settleIfReadyOrFailed);
  });
}

function hasExplicitCallbackServerStartupError(output: string): boolean {
  return /(?:^|\n)(?:Error:|error:|OAuth callback server failed\.|Missing required configuration\.|.*\bEADDRINUSE\b)/u.test(output);
}

function defaultListenServer(server: Server, options: { readonly host: string; readonly port: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });
}

function getNodeMajor(version: string): number {
  const match = /^v?(\d+)/u.exec(version.trim());
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
}

function missingRequiredConfigKeys(
  values: Readonly<Record<string, string | undefined>>,
): RequiredConfigKey[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => !isConfiguredRequiredValue(key, values[key]));
}

function isConfiguredRequiredValue(key: RequiredConfigKey, value: string | undefined): boolean {
  if (!isPresent(value)) {
    return false;
  }

  const trimmedValue = value.trim();

  switch (key) {
    case 'SHOPIFY_HERMES_CLIENT_ID':
      return trimmedValue !== 'replace-with-shopify-client-id';
    case 'SHOPIFY_HERMES_CLIENT_SECRET':
      return trimmedValue !== 'replace-with-shopify-client-secret';
    case 'SHOPIFY_HERMES_APP_URL':
      return isKnownAppUrl(trimmedValue);
  }
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
  useSafeShopifyPlaceholders: boolean,
): string {
  const remainingKeys = new Set(keysNeedingWrite);
  const updatedLines = existingContent.split(/\r?\n/u).map((rawLine) => {
    const parsedLine = parseEnvLine(rawLine);

    if (parsedLine === undefined || !isInitEnvKey(parsedLine.key) || isPresent(parsedLine.value)) {
      return rawLine;
    }

    remainingKeys.delete(parsedLine.key);
    return formatDotEnvAssignment(parsedLine.key, getInitEnvValue(parsedLine.key, mergedEnv, dataDir, useSafeShopifyPlaceholders));
  });
  const linesToAppend = [...remainingKeys].map((key) => formatDotEnvAssignment(key, getInitEnvValue(key, mergedEnv, dataDir, useSafeShopifyPlaceholders)));

  if (linesToAppend.length === 0) {
    return `${updatedLines.join('\n').replace(/\n*$/u, '')}\n`;
  }

  const prefix = existingContent.length === 0 ? '' : `${updatedLines.join('\n').replace(/\n*$/u, '')}\n\n`;
  return `${prefix}${linesToAppend.join('\n')}\n`;
}

function updateCredentialEnvKeys(existingContent: string, credentials: Readonly<Record<CredentialEnvKey, string>>): string {
  const remainingKeys = new Set<CredentialEnvKey>(['SHOPIFY_HERMES_CLIENT_ID', 'SHOPIFY_HERMES_CLIENT_SECRET']);
  const existingLines = existingContent.length === 0 ? [] : existingContent.split(/\r?\n/u);
  const updatedLines = existingLines.map((rawLine) => {
    const parsedLine = parseEnvLine(rawLine);

    if (parsedLine === undefined || !isCredentialEnvKey(parsedLine.key)) {
      return rawLine;
    }

    remainingKeys.delete(parsedLine.key);
    return formatDotEnvAssignment(parsedLine.key, credentials[parsedLine.key]);
  });
  const linesToAppend = [...remainingKeys].map((key) => formatDotEnvAssignment(key, credentials[key]));

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
  useSafeShopifyPlaceholders: boolean,
): string {
  const configuredValue = mergedEnv[key];

  if ((!useSafeShopifyPlaceholders || !isRequiredConfigKey(key)) && isPresent(configuredValue)) {
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

function printInitBitwardenGuidance(context: CliContext): void {
  context.stdout('Hermes Bitwarden Secrets Manager appears configured.');
  context.stdout('For VPS/chat-first Hermes deployments, prefer Hermes Bitwarden Secrets Manager instead of storing real Shopify credentials in `.env` or pasting client secrets into chat.');
  context.stdout('Store SHOPIFY_HERMES_CLIENT_ID, SHOPIFY_HERMES_CLIENT_SECRET, and SHOPIFY_HERMES_APP_URL as Bitwarden project variables, then run `hermes secrets bitwarden status` and `hermes secrets bitwarden sync`.');
  context.stdout('The generated `.env` uses safe placeholders for Shopify app credentials and should not be overwritten with synced secret values.');
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

function normalizeOnboardPublicAppUrl(value: string | undefined): string | undefined {
  if (!isKnownAppUrl(value)) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return undefined;
    }

    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString().replace(/\/+$/u, '');
  } catch {
    return undefined;
  }
}

function printNextSteps(
  context: CliContext,
  missingConfigKeys: readonly RequiredConfigKey[],
  status: { readonly nodeOk: boolean; readonly hermesOk: boolean; readonly hasTunnel: boolean; readonly hermesBitwardenEnabled?: boolean },
): void {
  context.stdout('Next steps:');

  if (!status.nodeOk) {
    context.stdout('- Install Node.js 20 or newer.');
  }

  if (!status.hermesOk) {
    context.stdout('- Install the Hermes CLI and make sure `hermes` is on PATH.');
  }

  if (missingConfigKeys.length > 0) {
    if (status.hermesBitwardenEnabled === true) {
      context.stdout('- Hermes Bitwarden Secrets Manager appears enabled, but the current process environment does not include required Shopify connector variables:');
      context.stdout(`  ${missingConfigKeys.join(', ')}`);
      context.stdout('- Launch the connector from Hermes after secrets are loaded, or run `hermes secrets bitwarden status` and `hermes secrets bitwarden sync` to verify/sync them.');
      context.stdout('- Do not paste Shopify client secrets into chat; status output lists variable names only.');
    } else {
      context.stdout('- Create a Shopify app in your Shopify Partner dashboard to get the client ID and client secret.');
      context.stdout('- Run `shopify-hermes-oauth init` to create missing .env keys, then replace placeholders with Shopify app values.');
    }
  }

  if (!status.hasTunnel) {
    context.stdout('- Install cloudflared or ngrok, or manually provide a public HTTPS URL for SHOPIFY_HERMES_APP_URL.');
  }
}

function isCredentialEnvKey(key: string): key is CredentialEnvKey {
  return key === 'SHOPIFY_HERMES_CLIENT_ID' || key === 'SHOPIFY_HERMES_CLIENT_SECRET';
}

function isInitEnvKey(key: string): key is InitEnvKey {
  return (INIT_ENV_KEYS as readonly string[]).includes(key);
}

function isRequiredConfigKey(key: string): key is RequiredConfigKey {
  return (REQUIRED_CONFIG_KEYS as readonly string[]).includes(key);
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

async function defaultPromptCredential(label: string): Promise<string> {
  if (!processStdin.isTTY || !processStdout.isTTY || typeof processStdin.setRawMode !== 'function') {
    throw new NoInteractiveCredentialInputError();
  }

  processStdout.write(`${label}: `);

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const wasRaw = processStdin.isRaw;

    const cleanup = (): void => {
      processStdin.off('data', onData);
      processStdin.setRawMode(wasRaw);
      processStdin.pause();
    };

    const finish = (): void => {
      cleanup();
      processStdout.write('\n');
      resolve(value);
    };

    const fail = (error: Error): void => {
      cleanup();
      processStdout.write('\n');
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');

      for (const character of text) {
        if (character === '\u0003') {
          fail(new NoInteractiveCredentialInputError());
          return;
        }

        if (character === '\r' || character === '\n') {
          finish();
          return;
        }

        if (character === '\u007F' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }

        value += character;
      }
    };

    processStdin.setRawMode(true);
    processStdin.resume();
    processStdin.on('data', onData);
  });
}

export async function isDirectCliRun(
  argv1: string | undefined,
  moduleUrl: string,
  realpath: (path: string) => string | Promise<string> = fsRealpath,
): Promise<boolean> {
  if (argv1 === undefined) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);
  const [realArgv1, realModulePath] = await Promise.all([
    resolveRealpathOrSelf(argv1, realpath),
    resolveRealpathOrSelf(modulePath, realpath),
  ]);

  return realArgv1 === realModulePath;
}

async function resolveRealpathOrSelf(path: string, realpath: (path: string) => string | Promise<string>): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function defaultFileIsExecutable(path: string): Promise<boolean> {
  try {
    await fsAccess(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

if (await isDirectCliRun(process.argv[1], import.meta.url)) {
  const exitCode = await runShopifyHermesOauthCli();
  process.exitCode = exitCode;
}
