import { createInterface } from 'node:readline';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { type Readable, type Writable } from 'node:stream';

import { type AuditEventInput } from '../audit.js';
import { CAPABILITY_MCP_TOOL_DEFINITIONS, type McpToolDefinition } from '../capabilities.js';
import { InventoryReportError, INVENTORY_MAX_COST_REMEDIATION_MESSAGE } from '../reports/inventory.js';
import { safeErrorCode, type SafeErrorCode } from '../safe-errors.js';
import { type ProductsReportFormat } from '../reports/products.js';
import { redactSensitiveText } from '../shopify/admin-client.js';
import { MissingShopifyScopesError } from '../shopify/scopes.js';
import { type VerifyShopResult } from '../shops/verify.js';
import { summarizeShopMetadata, type AllowedShopMetadata } from '../shops/metadata.js';
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

export interface ProductGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface CollectionListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface CollectionGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface LocationListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
}

export interface LocationGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface InventoryItemGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface InventoryLevelsListToolArgs {
  readonly shop: string;
  readonly inventoryItemId?: string;
  readonly locationId?: string;
  readonly first?: number;
  readonly after?: string;
}

export interface OrderGetToolArgs {
  readonly shop: string;
  readonly id?: string;
  readonly name?: string;
}

export interface FulfillmentOrdersListToolArgs {
  readonly shop: string;
  readonly orderId?: string;
  readonly orderName?: string;
  readonly first?: number;
  readonly after?: string;
}

export interface FulfillmentOrderGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface CustomerListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface CustomerGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface BulkStartToolArgs {
  readonly shop: string;
  readonly templateId: string;
}

export interface BulkStatusToolArgs {
  readonly shop: string;
}

export interface BulkResultToolArgs {
  readonly shop: string;
  readonly url: string;
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

export interface BulkCancelToolArgs {
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
  readonly getProductDetail: (args: ProductGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listCollections: (args: CollectionListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getCollection: (args: CollectionGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listLocations: (args: LocationListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getLocation: (args: LocationGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getInventoryItem: (args: InventoryItemGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listInventoryLevels: (args: InventoryLevelsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getOrder: (args: OrderGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listFulfillmentOrders: (args: FulfillmentOrdersListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getFulfillmentOrder: (args: FulfillmentOrderGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listCustomers: (args: CustomerListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getCustomer: (args: CustomerGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly startBulkOperation: (args: BulkStartToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getCurrentBulkOperation: (args: BulkStatusToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly fetchBulkOperationResult: (args: BulkResultToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly cancelBulkOperation: (args: BulkCancelToolArgs) => Promise<McpToolOutput> | McpToolOutput;
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
  public readonly code: SafeErrorCode;

  public constructor(message = 'Tool is not allowed.', code?: SafeErrorCode) {
    super(message);
    this.name = 'McpToolError';
    this.code = code ?? (message === 'Tool is not allowed.' ? 'MCP_TOOL_NOT_ALLOWED' : 'MCP_TOOL_CALL_FAILED');
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
  const auditEvent = (result: 'success' | 'failure', reason?: string, errorCode?: SafeErrorCode): AuditEventInput => ({
    action: 'mcp.tool',
    ...readAuditShop(args),
    result,
    metadata: buildMcpAuditMetadata(name, args, reason, errorCode),
  });

  if (!ALLOWED_TOOL_NAMES.has(name)) {
    const error = new McpToolError();
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', error.message, error.code));
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
      case 'shopify.bulk.start': {
        validateExactArgs(args, ['shop', 'templateId']);
        result = sanitizeToolOutput(await callDependency(() => deps.startBulkOperation({
          shop: readRequiredString(args, 'shop'),
          templateId: readRequiredString(args, 'templateId'),
        })));
        break;
      }
      case 'shopify.bulk.status': {
        validateExactArgs(args, ['shop']);
        result = sanitizeToolOutput(await callDependency(() => deps.getCurrentBulkOperation({ shop: readRequiredString(args, 'shop') })));
        break;
      }
      case 'shopify.bulk.result': {
        validateExactArgs(args, ['shop', 'url', 'maxLines', 'maxBytes']);
        result = sanitizeToolOutput(await callDependency(() => deps.fetchBulkOperationResult(readBulkResultArgs(args))));
        break;
      }
      case 'shopify.bulk.cancel': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.cancelBulkOperation({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
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
      case 'shopify.products.get': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.getProductDetail({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
        break;
      }
      case 'shopify.collections.list': {
        validateExactArgs(args, ['shop', 'first', 'after', 'query']);
        const collectionArgs = readCollectionListArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.listCollections(collectionArgs)));
        break;
      }
      case 'shopify.collections.get': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.getCollection({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
        break;
      }
      case 'shopify.locations.list': {
        validateExactArgs(args, ['shop', 'first', 'after']);
        result = sanitizeToolOutput(await callDependency(() => deps.listLocations(readLocationListArgs(args))));
        break;
      }
      case 'shopify.locations.get': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.getLocation({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
        break;
      }
      case 'shopify.inventory.items.get': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.getInventoryItem({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
        break;
      }
      case 'shopify.inventory.levels.list': {
        validateExactArgs(args, ['shop', 'inventoryItemId', 'locationId', 'first', 'after']);
        result = sanitizeToolOutput(await callDependency(() => deps.listInventoryLevels(readInventoryLevelsListArgs(args))));
        break;
      }
      case 'shopify.orders.get': {
        validateExactArgs(args, ['shop', 'id', 'name']);
        result = sanitizeToolOutput(await callDependency(() => deps.getOrder(readOrderGetArgs(args))));
        break;
      }
      case 'shopify.fulfillment_orders.list': {
        validateExactArgs(args, ['shop', 'orderId', 'orderName', 'first', 'after']);
        result = sanitizeToolOutput(await callDependency(() => deps.listFulfillmentOrders(readFulfillmentOrdersListArgs(args))));
        break;
      }
      case 'shopify.fulfillment_orders.get': {
        validateExactArgs(args, ['shop', 'id']);
        result = sanitizeToolOutput(await callDependency(() => deps.getFulfillmentOrder({
          shop: readRequiredString(args, 'shop'),
          id: readRequiredString(args, 'id'),
        })));
        break;
      }
      case 'shopify.customers.list': {
        validateExactArgs(args, ['shop', 'first', 'after', 'query']);
        const customerArgs = readCustomerListArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.listCustomers(customerArgs)));
        break;
      }
      case 'shopify.customers.get': {
        validateExactArgs(args, ['shop', 'id']);
        const customerArgs = readCustomerGetArgs(args);
        result = sanitizeToolOutput(await callDependency(() => deps.getCustomer(customerArgs)));
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
      await appendMcpAuditEventBestEffort(deps, auditEvent('failure', safeMessage, error.code));
      throw safeMessage === error.message ? error : new McpToolError(safeMessage, error.code);
    }
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', 'Tool call failed.', 'MCP_TOOL_CALL_FAILED'));
    throw new McpToolError('Tool call failed.', 'MCP_TOOL_CALL_FAILED');
  }
}

async function callDependency<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InventoryReportError && error.code === 'MAX_COST_EXCEEDED') {
      throw new McpToolError(INVENTORY_MAX_COST_REMEDIATION_MESSAGE, 'MCP_TOOL_CALL_FAILED');
    }
    if (error instanceof MissingShopifyScopesError) {
      throw new McpToolError(error.message, 'MCP_TOOL_CALL_FAILED');
    }
    throw new McpToolError('Tool call failed.', safeErrorCode(error, 'MCP_TOOL_CALL_FAILED'));
  }
}

async function appendMcpAuditEventBestEffort(deps: McpServerDependencies, event: AuditEventInput): Promise<void> {
  try {
    await deps.appendAuditEvent?.(event);
  } catch {
    // MCP audit logging must never mask tool results or the original tool error.
  }
}

function buildMcpAuditMetadata(name: string, args: unknown, reason?: string, errorCode?: SafeErrorCode): Record<string, unknown> {
  return {
    source: 'mcp',
    actor: 'mcp',
    mode: 'read-only',
    toolName: sanitizeAuditString(name),
    ...(isReportToolName(name) ? readAuditFormat(args) : {}),
    ...(name === 'shopify.bulk.start' ? readAuditTemplate(args) : {}),
    ...(name === 'shopify.bulk.result' ? readAuditResultLimits(args) : {}),
    ...(name === 'shopify.report_inventory' ? readAuditThreshold(args) : {}),
    ...(name === 'shopify.customers.list' || name === 'shopify.collections.list' || name === 'shopify.locations.list' ? readAuditBoundedList(args) : {}),
    ...(name === 'shopify.inventory.levels.list' ? readAuditInventoryLevelsList(args) : {}),
    ...(name === 'shopify.orders.get' ? readAuditOrderGet(args) : {}),
    ...(name === 'shopify.fulfillment_orders.list' ? readAuditFulfillmentOrdersList(args) : {}),
    ...(reason === undefined ? {} : { reason: sanitizeAuditString(reason) }),
    ...(errorCode === undefined ? {} : { errorCode }),
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

function readAuditTemplate(args: unknown): { readonly templateId?: string } {
  return isRecord(args) && typeof args.templateId === 'string' ? { templateId: sanitizeAuditString(args.templateId) } : {};
}

function readAuditResultLimits(args: unknown): { readonly maxLines?: number; readonly maxBytes?: number } {
  return {
    ...(isRecord(args) && Number.isInteger(args.maxLines) ? { maxLines: args.maxLines as number } : {}),
    ...(isRecord(args) && Number.isInteger(args.maxBytes) ? { maxBytes: args.maxBytes as number } : {}),
  };
}

function readAuditOrderGet(args: unknown): { readonly idPresent?: boolean; readonly namePresent?: boolean } {
  return {
    ...(isRecord(args) && typeof args.id === 'string' ? { idPresent: true } : {}),
    ...(isRecord(args) && typeof args.name === 'string' ? { namePresent: true } : {}),
  };
}

function readAuditFulfillmentOrdersList(args: unknown): { readonly first?: number; readonly queryPresent?: boolean; readonly afterPresent?: boolean; readonly orderIdPresent?: boolean; readonly orderNamePresent?: boolean } {
  return {
    ...readAuditBoundedList(args),
    ...(isRecord(args) && typeof args.orderId === 'string' ? { orderIdPresent: true } : {}),
    ...(isRecord(args) && typeof args.orderName === 'string' ? { orderNamePresent: true } : {}),
  };
}

function readAuditBoundedList(args: unknown): { readonly first?: number; readonly queryPresent?: boolean; readonly afterPresent?: boolean } {
  return {
    ...(isRecord(args) && Number.isInteger(args.first) ? { first: args.first as number } : {}),
    ...(isRecord(args) && typeof args.query === 'string' ? { queryPresent: true } : {}),
    ...(isRecord(args) && typeof args.after === 'string' ? { afterPresent: true } : {}),
  };
}

function readAuditInventoryLevelsList(args: unknown): { readonly first?: number; readonly afterPresent?: boolean; readonly itemIdPresent?: boolean; readonly locationIdPresent?: boolean } {
  return {
    ...(isRecord(args) && Number.isInteger(args.first) ? { first: args.first as number } : {}),
    ...(isRecord(args) && typeof args.after === 'string' ? { afterPresent: true } : {}),
    ...(isRecord(args) && typeof args.inventoryItemId === 'string' ? { itemIdPresent: true } : {}),
    ...(isRecord(args) && typeof args.locationId === 'string' ? { locationIdPresent: true } : {}),
  };
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
    return error instanceof McpToolError
      ? jsonRpcError(id, -32000, error.message, error.code)
      : jsonRpcError(id, -32000, 'Tool call failed.', 'MCP_TOOL_CALL_FAILED');
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

function readCollectionListArgs(args: unknown): CollectionListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalStringProperty(args, 'after'),
    ...readOptionalCollectionSearchQuery(args),
  };
}

function readOptionalCollectionSearchQuery(args: unknown): Record<string, string> {
  const query = readOptionalStringProperty(args, 'query');
  if (query.query !== undefined && /[{}]|\b(?:mutation|query)\b/iu.test(query.query)) {
    throw new McpToolError('Invalid argument: query.');
  }
  return query;
}

function readLocationListArgs(args: unknown): LocationListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalStringProperty(args, 'after'),
  };
}

function readInventoryLevelsListArgs(args: unknown): InventoryLevelsListToolArgs {
  const inventoryItemId = readOptionalStringProperty(args, 'inventoryItemId').inventoryItemId;
  const locationId = readOptionalStringProperty(args, 'locationId').locationId;
  if ((inventoryItemId === undefined && locationId === undefined) || (inventoryItemId !== undefined && locationId !== undefined)) {
    throw new McpToolError('Provide exactly one of inventoryItemId or locationId.');
  }
  return {
    shop: readRequiredString(args, 'shop'),
    ...(inventoryItemId === undefined ? {} : { inventoryItemId }),
    ...(locationId === undefined ? {} : { locationId }),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalStringProperty(args, 'after'),
  };
}

function readOrderGetArgs(args: unknown): OrderGetToolArgs {
  const id = readOptionalStringProperty(args, 'id').id;
  const name = readOptionalStringProperty(args, 'name').name;
  if ((id === undefined && name === undefined) || (id !== undefined && name !== undefined)) {
    throw new McpToolError('Provide exactly one of order id or order name.');
  }
  if (name !== undefined && /[{}]|\b(?:mutation|query)\b/iu.test(name)) {
    throw new McpToolError('Invalid argument: name.');
  }
  return { shop: readRequiredString(args, 'shop'), ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) };
}

function readFulfillmentOrdersListArgs(args: unknown): FulfillmentOrdersListToolArgs {
  const orderId = readOptionalStringProperty(args, 'orderId').orderId;
  const orderName = readOptionalStringProperty(args, 'orderName').orderName;
  if ((orderId === undefined && orderName === undefined) || (orderId !== undefined && orderName !== undefined)) {
    throw new McpToolError('Provide exactly one of orderId or orderName.');
  }
  if (orderName !== undefined && /[{}]|\b(?:mutation|query)\b/iu.test(orderName)) {
    throw new McpToolError('Invalid argument: orderName.');
  }
  return {
    shop: readRequiredString(args, 'shop'),
    ...(orderId === undefined ? {} : { orderId }),
    ...(orderName === undefined ? {} : { orderName }),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalStringProperty(args, 'after'),
  };
}

function readCustomerListArgs(args: unknown): CustomerListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalStringProperty(args, 'after'),
    ...readOptionalCustomerSearchQuery(args),
  };
}

function readOptionalCustomerSearchQuery(args: unknown): Record<string, string> {
  const query = readOptionalStringProperty(args, 'query');
  if (query.query !== undefined && /[{}]|\b(?:mutation|query)\b/iu.test(query.query)) {
    throw new McpToolError('Invalid argument: query.');
  }
  return query;
}

function readCustomerGetArgs(args: unknown): CustomerGetToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    id: readRequiredString(args, 'id'),
  };
}

function readBulkResultArgs(args: unknown): BulkResultToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    url: readRequiredString(args, 'url'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'maxLines', 100),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'maxBytes', 1_000_000),
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

function readOptionalPositiveIntegerProperty(args: unknown, key: string): Record<string, number> {
  if (!isRecord(args) || args[key] === undefined) {
    return {};
  }
  if (!Number.isInteger(args[key]) || (args[key] as number) < 1) {
    throw new McpToolError(`Invalid argument: ${key}.`);
  }
  return { [key]: args[key] as number };
}

function readOptionalBoundedPositiveIntegerProperty(args: unknown, key: string, max: number): Record<string, number> {
  const value = readOptionalPositiveIntegerProperty(args, key);
  if (value[key] !== undefined && value[key] > max) {
    throw new McpToolError(`Invalid argument: ${key}.`);
  }
  return value;
}

function jsonRpcError(id: string | number | null, code: number, message: string, errorCode?: SafeErrorCode): unknown {
  return { jsonrpc: '2.0', id, error: { code, message, ...(errorCode === undefined ? {} : { data: { errorCode } }) } };
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
