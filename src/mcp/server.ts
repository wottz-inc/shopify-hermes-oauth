import { createInterface } from 'node:readline';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { type Readable, type Writable } from 'node:stream';

import { type AuditEventInput } from '../audit.js';
import { type ProductsReportFormat } from '../reports/products.js';
import { type VerifyShopResult } from '../shops/verify.js';
import { type StoredShopToken, type TokenStore } from '../tokens/local-token-store.js';

export type McpToolName =
  | 'shopify.list_shops'
  | 'shopify.verify_shop'
  | 'shopify.report_products'
  | 'shopify.report_orders'
  | 'shopify.report_inventory';

export interface McpToolDefinition {
  readonly name: McpToolName;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties: boolean;
}

export interface ReportToolArgs {
  readonly shop: string;
  readonly format: ProductsReportFormat;
  readonly since?: string;
  readonly from?: string;
  readonly to?: string;
  readonly lowStockThreshold?: number;
}

export type McpToolOutput = Record<string, unknown>;

export interface McpServerDependencies {
  readonly tokenStore: Pick<TokenStore, 'listTokens'>;
  readonly verifyShop: (args: { readonly shop: string }) => Promise<VerifyShopResult> | VerifyShopResult;
  readonly reportProducts: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportOrders: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportInventory: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly appendAuditEvent?: (event: AuditEventInput) => Promise<void> | void;
}

export interface McpShopSummary {
  readonly shop: string;
  readonly scopes: readonly string[];
  readonly storedAt: string;
  readonly updatedAt: string;
  readonly metadata?: StoredShopToken['metadata'];
}

export class McpToolError extends Error {
  public constructor(message = 'Tool is not allowed.') {
    super(message);
    this.name = 'McpToolError';
  }
}

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'shopify.list_shops',
    description: 'List installed Shopify shops with non-secret metadata only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'shopify.verify_shop',
    description: 'Verify a stored Shopify shop token and return safe shop metadata.',
    inputSchema: shopSchema(),
  },
  {
    name: 'shopify.report_products',
    description: 'Generate a read-only Shopify products report.',
    inputSchema: reportSchema(),
  },
  {
    name: 'shopify.report_orders',
    description: 'Generate a read-only Shopify orders report.',
    inputSchema: {
      ...reportSchema(),
      properties: {
        ...reportSchema().properties,
        since: { type: 'string', description: 'Relative window such as 30d.' },
        from: { type: 'string', description: 'Inclusive YYYY-MM-DD start date.' },
        to: { type: 'string', description: 'Inclusive YYYY-MM-DD end date.' },
      },
    },
  },
  {
    name: 'shopify.report_inventory',
    description: 'Generate a read-only Shopify inventory report.',
    inputSchema: {
      ...reportSchema(),
      properties: {
        ...reportSchema().properties,
        lowStockThreshold: { type: 'integer', minimum: 0, description: 'Low-stock threshold. Defaults to 5.' },
      },
    },
  },
];

const ALLOWED_TOOL_NAMES = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));

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
      case 'shopify.list_shops':
        validateExactArgs(args, []);
        result = await listShops(deps.tokenStore);
        break;
      case 'shopify.verify_shop':
        validateExactArgs(args, ['shop']);
        result = sanitizeToolOutput(await deps.verifyShop({ shop: readRequiredString(args, 'shop') }));
        break;
      case 'shopify.report_products':
        validateExactArgs(args, ['shop', 'format']);
        result = sanitizeToolOutput(await deps.reportProducts(readReportArgs(args)));
        break;
      case 'shopify.report_orders':
        validateExactArgs(args, ['shop', 'format', 'since', 'from', 'to']);
        result = sanitizeToolOutput(await deps.reportOrders(readReportArgs(args)));
        break;
      case 'shopify.report_inventory':
        validateExactArgs(args, ['shop', 'format', 'lowStockThreshold']);
        result = sanitizeToolOutput(await deps.reportInventory(readReportArgs(args)));
        break;
      default:
        throw new McpToolError();
    }
    await appendMcpAuditEventBestEffort(deps, auditEvent('success'));
    return result;
  } catch (error) {
    if (error instanceof McpToolError) {
      await appendMcpAuditEventBestEffort(deps, auditEvent('failure', error.message));
      throw error;
    }
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', 'Tool call failed.'));
    throw new McpToolError('Tool call failed.');
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
  return value
    .replace(/X-Shopify-Access-Token/giu, '[REDACTED]')
    .replace(/shpat_[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/access_token\s*[=:]\s*[^\s,;]+/giu, 'access_token=[REDACTED]')
    .replace(/[\r\n\t]/gu, ' ')
    .slice(0, 200);
}

export async function startStdioMcpServer(
  deps: McpServerDependencies,
  streams: { readonly input?: Readable; readonly output?: Writable } = {},
): Promise<void> {
  const input = streams.input ?? processStdin;
  const output = streams.output ?? processStdout;
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const response = await handleJsonRpcMessage(line, deps);
    if (response !== undefined) {
      output.write(`${JSON.stringify(response)}\n`);
    }
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
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } };
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

function summarizeShopMetadata(metadata: NonNullable<StoredShopToken['metadata']>): StoredShopToken['metadata'] {
  return {
    ...(metadata.shopName === undefined ? {} : { shopName: metadata.shopName }),
    ...(metadata.currencyCode === undefined ? {} : { currencyCode: metadata.currencyCode }),
    ...(metadata.myshopifyDomain === undefined ? {} : { myshopifyDomain: metadata.myshopifyDomain }),
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

function shopSchema(): JsonSchema {
  return {
    type: 'object',
    properties: { shop: { type: 'string', description: 'Shopify myshopify.com domain.' } },
    required: ['shop'],
    additionalProperties: false,
  };
}

function reportSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
      format: { type: 'string', enum: ['markdown', 'json', 'csv'], default: 'markdown' },
    },
    required: ['shop'],
    additionalProperties: false,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
