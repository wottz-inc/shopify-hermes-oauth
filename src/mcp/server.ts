import { createInterface } from 'node:readline';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { type Readable, type Writable } from 'node:stream';

import { type AuditEventInput } from '../audit.js';
import { CAPABILITY_MCP_TOOL_DEFINITIONS, type McpToolDefinition } from '../capabilities.js';
import { InventoryReportError, INVENTORY_MAX_COST_REMEDIATION_MESSAGE } from '../reports/inventory.js';
import { type ProductsReportFormat } from '../reports/products.js';
import { type VerifyShopResult } from '../shops/verify.js';
import { summarizeShopMetadata, type AllowedShopMetadata } from '../shops/metadata.js';
import { redactSensitiveText } from '../shopify/admin-client.js';
import { type StoredShopToken, type TokenStore } from '../tokens/local-token-store.js';
import { isJsonPlainRecord as isRecord } from '../util/json.js';

export type { JsonSchema, McpToolDefinition, McpToolName } from '../capabilities.js';

export interface ReportToolArgs {
  readonly shop: string;
  readonly format: ProductsReportFormat;
  readonly since?: string;
  readonly from?: string;
  readonly to?: string;
  readonly lowStockThreshold?: number;
}

export interface WebhookListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
}

export interface WebhookGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export type McpToolOutput = Record<string, unknown>;

export interface McpServerDependencies {
  readonly tokenStore: Pick<TokenStore, 'listTokens'>;
  readonly verifyShop: (args: { readonly shop: string }) => Promise<VerifyShopResult> | VerifyShopResult;
  readonly reportProducts: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportOrders: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportInventory: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listWebhookSubscriptions: (args: WebhookListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getWebhookSubscription: (args: WebhookGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly appendAuditEvent?: (event: AuditEventInput) => Promise<void> | void;
}

export interface McpShopSummary {
  readonly shop: string;
  readonly scopes: readonly string[];
  readonly storedAt: string;
  readonly updatedAt: string;
  readonly metadata?: AllowedShopMetadata;
}

export interface McpMemoryDiagnostics {
  readonly rssBytes: number;
  readonly heapTotalBytes: number;
  readonly heapUsedBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
}

export interface McpHealthResult {
  readonly service: 'shopify-hermes-oauth';
  readonly transport: 'stdio';
  readonly status: 'ok';
  readonly process: {
    readonly pid: number;
    readonly uptimeSeconds: number;
    readonly memory: McpMemoryDiagnostics;
  };
}

export interface McpLifecycleEvent {
  readonly event: 'mcp.stdio.start' | 'mcp.stdio.stop';
  readonly service: 'shopify-hermes-oauth';
  readonly transport: 'stdio';
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly memory: McpMemoryDiagnostics;
  readonly reason?: 'input-ended';
  readonly lifetimeMs?: number;
}

export class McpToolError extends Error {
  public constructor(message = 'Tool is not allowed.') {
    super(message);
    this.name = 'McpToolError';
  }
}

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = CAPABILITY_MCP_TOOL_DEFINITIONS;

const ALLOWED_TOOL_NAMES = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));
const MCP_SUMMARY_MAX_KEYS = 5;
const MCP_SUMMARY_MAX_KEY_LENGTH = 40;
const MCP_SUMMARY_MAX_KEYS_TEXT_LENGTH = 160;

export function listTools(): readonly McpToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export async function callTool(name: string, args: unknown, deps: McpServerDependencies): Promise<unknown> {
  const auditEvent = (result: 'success' | 'failure', reason?: string): AuditEventInput => ({
    action: 'mcp.tool',
    ...readAuditShop(args),
    result,
    metadata: buildMcpAuditMetadata(name, args, reason),
  });

  if (!ALLOWED_TOOL_NAMES.has(name)) {
    const error = new McpToolError();
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', error.message));
    throw error;
  }

  try {
    let result: unknown;
    switch (name) {
      case 'shopify.health':
        validateExactArgs(args, []);
        result = readMcpHealth();
        break;
      case 'shopify.list_shops':
        validateExactArgs(args, []);
        result = await callDependency(() => listShops(deps.tokenStore));
        break;
      case 'shopify.verify_shop': {
        validateExactArgs(args, ['shop']);
        const shop = readRequiredString(args, 'shop');
        result = sanitizeToolOutput(await callDependency(() => deps.verifyShop({ shop })));
        break;
      }
      case 'shopify.report_products': {
        validateExactArgs(args, ['shop', 'format']);
        const reportArgs = readReportArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.reportProducts(reportArgs)));
        break;
      }
      case 'shopify.report_orders': {
        validateExactArgs(args, ['shop', 'format', 'since', 'from', 'to']);
        const reportArgs = readReportArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.reportOrders(reportArgs)));
        break;
      }
      case 'shopify.report_inventory': {
        validateExactArgs(args, ['shop', 'format', 'lowStockThreshold']);
        const reportArgs = readReportArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.reportInventory(reportArgs)));
        break;
      }
      case 'shopify.webhooks.list': {
        validateExactArgs(args, ['shop', 'first', 'after']);
        const webhookArgs = readWebhookListArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.listWebhookSubscriptions(webhookArgs)));
        break;
      }
      case 'shopify.webhooks.get': {
        validateExactArgs(args, ['shop', 'id']);
        const webhookArgs = readWebhookGetArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.getWebhookSubscription(webhookArgs)));
        break;
      }
      default:
        throw new McpToolError();
    }
    await appendMcpAuditEventBestEffort(deps, auditEvent('success'));
    return result;
  } catch (error) {
    if (error instanceof McpToolError) {
      const safeMessage = sanitizeMcpErrorMessage(error.message);
      await appendMcpAuditEventBestEffort(deps, auditEvent('failure', safeMessage));
      throw safeMessage === error.message ? error : new McpToolError(safeMessage);
    }
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', 'Tool call failed.'));
    throw new McpToolError('Tool call failed.');
  }
}

async function callDependency<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InventoryReportError && error.code === 'MAX_COST_EXCEEDED') {
      throw new McpToolError(INVENTORY_MAX_COST_REMEDIATION_MESSAGE);
    }
    throw new Error('Tool call failed.', { cause: error });
  }
}

async function appendMcpAuditEventBestEffort(deps: McpServerDependencies, event: AuditEventInput): Promise<void> {
  try {
    await deps.appendAuditEvent?.(event);
  } catch {
    // MCP audit logging must never mask tool results or the original tool error.
  }
}

function buildMcpAuditMetadata(name: string, args: unknown, reason?: string): Record<string, unknown> {
  return {
    source: 'mcp',
    actor: 'mcp',
    mode: 'read-only',
    toolName: sanitizeAuditString(name),
    ...(isReportToolName(name) ? readAuditFormat(args) : {}),
    ...(name === 'shopify.report_inventory' ? readAuditThreshold(args) : {}),
    ...(reason === undefined ? {} : { reason: sanitizeAuditString(reason) }),
  };
}

function readMcpHealth(): McpHealthResult {
  return {
    service: 'shopify-hermes-oauth',
    transport: 'stdio',
    status: 'ok',
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: readMcpMemoryDiagnostics(),
    },
  };
}

function readMcpMemoryDiagnostics(): McpMemoryDiagnostics {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

function logMcpLifecycle(
  logger: ((event: McpLifecycleEvent) => void) | undefined,
  event: McpLifecycleEvent['event'],
  details: Pick<McpLifecycleEvent, 'lifetimeMs' | 'reason'> = {},
): void {
  if (logger === undefined) {
    return;
  }

  try {
    logger({
      event,
      service: 'shopify-hermes-oauth',
      transport: 'stdio',
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: readMcpMemoryDiagnostics(),
      ...details,
    });
  } catch {
    // Lifecycle diagnostics must never affect JSON-RPC serving or shutdown.
  }
}

function isReportToolName(name: string): boolean {
  return name === 'shopify.report_products' || name === 'shopify.report_orders' || name === 'shopify.report_inventory';
}

function readAuditShop(args: unknown): { readonly shop?: string } {
  if (!isRecord(args) || typeof args.shop !== 'string') {
    return {};
  }

  const shop = args.shop.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(shop) ? { shop } : {};
}

function readAuditFormat(args: unknown): { readonly format?: ProductsReportFormat } {
  if (!isRecord(args)) {
    return {};
  }
  if (args.format === 'json' || args.format === 'csv' || args.format === 'markdown') {
    return { format: args.format };
  }
  return Object.hasOwn(args, 'shop') ? { format: 'markdown' } : {};
}

function readAuditThreshold(args: unknown): { readonly threshold?: number } {
  return isRecord(args) && Number.isInteger(args.lowStockThreshold) ? { threshold: args.lowStockThreshold as number } : {};
}

function sanitizeAuditString(value: string): string {
  const sanitized = sanitizeMcpErrorMessage(value);

  return sanitized.length > 200 ? `${sanitized.slice(0, 199)}…` : sanitized;
}

function sanitizeMcpErrorMessage(value: string): string {
  return redactSensitiveText(value).replace(/[\r\n\t]/gu, ' ');
}

export async function startStdioMcpServer(
  deps: McpServerDependencies,
  streams: { readonly input?: Readable; readonly output?: Writable; readonly lifecycleLogger?: (event: McpLifecycleEvent) => void } = {},
): Promise<void> {
  const input = streams.input ?? processStdin;
  const output = streams.output ?? processStdout;
  const lines = createInterface({ input, crlfDelay: Infinity });
  const startedAt = Date.now();
  logMcpLifecycle(streams.lifecycleLogger, 'mcp.stdio.start');

  try {
    for await (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      const response = await handleJsonRpcMessage(line, deps);
      if (response !== undefined) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    }
  } finally {
    lines.close();
    logMcpLifecycle(streams.lifecycleLogger, 'mcp.stdio.stop', { lifetimeMs: Date.now() - startedAt, reason: 'input-ended' });
  }
}

async function handleJsonRpcMessage(line: string, deps: McpServerDependencies): Promise<unknown> {
  let request: unknown;
  try {
    request = JSON.parse(line) as unknown;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    if (isNotification(request)) {
      return undefined;
    }
    return jsonRpcError(readJsonRpcId(request), -32600, 'Invalid Request');
  }

  const id = readJsonRpcId(request);
  if (isNotification(request)) {
    if (request.method === 'notifications/initialized') {
      return undefined;
    }
    return undefined;
  }
  try {
    switch (request.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'shopify-hermes-oauth', version: '0.1.0' }, capabilities: { tools: {} } } };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: listTools() } };
      case 'tools/call': {
        const params = isRecord(request.params) ? request.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        const result = await callTool(name, params.arguments, deps);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: summarizeToolResult(result) }], structuredContent: result } };
      }
      default:
        return jsonRpcError(id, -32601, 'Method not found');
    }
  } catch (error) {
    return jsonRpcError(id, -32000, error instanceof McpToolError ? error.message : 'Tool call failed.');
  }
}

async function listShops(tokenStore: Pick<TokenStore, 'listTokens'>): Promise<{ readonly shops: readonly McpShopSummary[] }> {
  const tokens = await tokenStore.listTokens();
  return sanitizeToolOutput({ shops: tokens.map(summarizeShop) }) as { readonly shops: readonly McpShopSummary[] };
}

function summarizeShop(token: StoredShopToken): McpShopSummary {
  return {
    shop: token.shop,
    scopes: [...token.scopes],
    storedAt: token.storedAt,
    updatedAt: token.updatedAt,
    ...(token.metadata === undefined ? {} : { metadata: summarizeShopMetadata(token.metadata) }),
  };
}

function validateExactArgs(args: unknown, allowedKeys: readonly string[]): void {
  if (args === undefined && allowedKeys.length === 0) {
    return;
  }
  if (!isRecord(args)) {
    throw new McpToolError('Invalid tool arguments.');
  }

  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new McpToolError(`Unknown argument: ${key}.`);
    }
  }
}

function summarizeToolResult(result: unknown): string {
  if (!isRecord(result)) {
    return 'Tool result available in structuredContent.';
  }

  const keys = summarizeToolResultKeys(Object.keys(result));
  if (keys.length === 0) {
    return 'Tool result available in structuredContent.';
  }

  return `Tool result available in structuredContent (keys: ${keys.join(', ')}${Object.keys(result).length > MCP_SUMMARY_MAX_KEYS ? ', …' : ''}).`;
}

function summarizeToolResultKeys(rawKeys: readonly string[]): readonly string[] {
  const keys: string[] = [];
  let textLength = 0;

  for (const rawKey of rawKeys) {
    const key = truncateText(sanitizeMcpErrorMessage(rawKey), MCP_SUMMARY_MAX_KEY_LENGTH);
    if (key.length === 0) {
      continue;
    }
    const separatorLength = keys.length === 0 ? 0 : 2;
    if (keys.length >= MCP_SUMMARY_MAX_KEYS || textLength + separatorLength + key.length > MCP_SUMMARY_MAX_KEYS_TEXT_LENGTH) {
      break;
    }
    keys.push(key);
    textLength += separatorLength + key.length;
  }

  return keys;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function sanitizeToolOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeToolOutput);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretOutputKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeToolOutput(entry);
  }
  return sanitized;
}

function isSecretOutputKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/gu, '');
  return normalized === 'token' || normalized.endsWith('token') || normalized === 'authorization';
}

function readReportArgs(args: unknown): ReportToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    format: readFormat(args),
    ...readOptionalStringProperty(args, 'since'),
    ...readOptionalStringProperty(args, 'from'),
    ...readOptionalStringProperty(args, 'to'),
    ...readOptionalIntegerProperty(args, 'lowStockThreshold'),
  };
}

function readWebhookListArgs(args: unknown): WebhookListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalIntegerProperty(args, 'first'),
    ...readOptionalStringProperty(args, 'after'),
  };
}

function readWebhookGetArgs(args: unknown): WebhookGetToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    id: readRequiredString(args, 'id'),
  };
}

function readRequiredString(args: unknown, key: string): string {
  if (!isRecord(args) || typeof args[key] !== 'string' || args[key].trim().length === 0) {
    throw new McpToolError(`Missing required argument: ${key}.`);
  }
  return args[key];
}

function readFormat(args: unknown): ProductsReportFormat {
  if (!isRecord(args) || args.format === undefined) {
    return 'markdown';
  }
  if (args.format === 'markdown' || args.format === 'json' || args.format === 'csv') {
    return args.format;
  }
  throw new McpToolError('Invalid report format.');
}

function readOptionalStringProperty(args: unknown, key: string): Record<string, string> {
  if (!isRecord(args) || args[key] === undefined) {
    return {};
  }
  if (typeof args[key] !== 'string' || args[key].trim().length === 0) {
    throw new McpToolError(`Invalid argument: ${key}.`);
  }
  return { [key]: args[key] };
}

function readOptionalIntegerProperty(args: unknown, key: string): Record<string, number> {
  if (!isRecord(args) || args[key] === undefined) {
    return {};
  }
  if (!Number.isInteger(args[key]) || (args[key] as number) < 0) {
    throw new McpToolError(`Invalid argument: ${key}.`);
  }
  return { [key]: args[key] as number };
}

function jsonRpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function readJsonRpcId(value: unknown): string | number | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.id === 'string' || typeof value.id === 'number' ? value.id : null;
}

function isNotification(value: unknown): boolean {
  return isRecord(value) && !Object.hasOwn(value, 'id');
}
