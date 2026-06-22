import { createInterface } from 'node:readline';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { type Readable, type Writable } from 'node:stream';

import { type AuditEventInput } from '../audit.js';
import { CAPABILITY_MCP_TOOL_DEFINITIONS, CAPABILITY_REGISTRY, type CapabilityDefinition, type McpToolDefinition, type McpToolName } from '../capabilities.js';
import { InventoryReportError, INVENTORY_MAX_COST_REMEDIATION_MESSAGE } from '../reports/inventory.js';
import { type ShopifyqlAnalyticsFormat, ShopifyqlAnalyticsError, type ShopifyqlAnalyticsGranularity, type ShopifyqlAnalyticsReportId } from '../reports/shopifyql-analytics.js';
import { safeErrorCode, type SafeErrorCode } from '../safe-errors.js';
import { type ProductsReportFormat } from '../reports/products.js';
import { redactSensitiveText } from '../shopify/admin-client.js';
import { MissingShopifyScopesError } from '../shopify/scopes.js';
import { type StoreDiagnosticsResult } from '../shops/diagnostics.js';
import { type OnlineStoreSummaryResult } from '../online-store/summary.js';
import { type B2bCatalogsSummaryResult, type B2bCompaniesSummaryResult } from '../b2b/summary.js';
import { type VerifyShopResult } from '../shops/verify.js';
import { summarizeShopMetadata, type AllowedShopMetadata } from '../shops/metadata.js';
import { type StoredShopToken, type TokenStore } from '../tokens/local-token-store.js';
import { hasGraphqlLikeSearchSyntax, isValidOpaqueCursor } from '../input-validation.js';
import { isJsonPlainRecord as isRecord } from '../util/json.js';
import { packageVersion } from '../version.js';

export type { JsonSchema, McpToolDefinition, McpToolName } from '../capabilities.js';

export interface ReportToolArgs {
  readonly shop: string;
  readonly format: ProductsReportFormat;
  readonly since?: string;
  readonly from?: string;
  readonly to?: string;
  readonly lowStockThreshold?: number;
}

export interface ShopifyqlAnalyticsToolArgs {
  readonly shop: string;
  readonly report: ShopifyqlAnalyticsReportId;
  readonly format: ShopifyqlAnalyticsFormat;
  readonly from: string;
  readonly to: string;
  readonly granularity?: ShopifyqlAnalyticsGranularity;
  readonly limit?: number;
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

export interface DiscountListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface DiscountGetToolArgs {
  readonly shop: string;
  readonly id: string;
}

export interface MarketingEventsListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface MarketsListToolArgs {
  readonly shop: string;
  readonly first?: number;
  readonly after?: string;
}

export interface ShopLocalesListToolArgs {
  readonly shop: string;
}

export interface OnlineStoreSummaryToolArgs {
  readonly shop: string;
}

export interface B2bSummaryToolArgs {
  readonly shop: string;
}

export interface MetafieldDefinitionsListToolArgs { readonly shop: string; readonly ownerType: string; readonly namespace?: string; readonly key?: string; readonly first?: number; readonly after?: string }
export interface MetafieldDefinitionGetToolArgs { readonly shop: string; readonly ownerType: string; readonly namespace: string; readonly key: string }
export interface ResourceMetafieldsListToolArgs { readonly shop: string; readonly ownerId: string; readonly namespace?: string; readonly key?: string; readonly first?: number; readonly after?: string }
export interface MetaobjectDefinitionsListToolArgs { readonly shop: string; readonly type?: string; readonly first?: number; readonly after?: string }
export interface MetaobjectDefinitionGetToolArgs { readonly shop: string; readonly type: string }
export interface MetaobjectsListToolArgs { readonly shop: string; readonly type: string; readonly first?: number; readonly after?: string }
export interface MetaobjectGetToolArgs { readonly shop: string; readonly id: string }

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
  readonly storeDiagnostics: (args: { readonly shop: string }) => Promise<StoreDiagnosticsResult> | StoreDiagnosticsResult;
  readonly summarizeOnlineStore: (args: OnlineStoreSummaryToolArgs) => Promise<OnlineStoreSummaryResult> | OnlineStoreSummaryResult;
  readonly summarizeB2bCompanies: (args: B2bSummaryToolArgs) => Promise<B2bCompaniesSummaryResult> | B2bCompaniesSummaryResult;
  readonly summarizeB2bCatalogs: (args: B2bSummaryToolArgs) => Promise<B2bCatalogsSummaryResult> | B2bCatalogsSummaryResult;
  readonly reportProducts: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportOrders: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly reportInventory: (args: ReportToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly analyticsShopifyqlSummary: (args: ShopifyqlAnalyticsToolArgs) => Promise<McpToolOutput> | McpToolOutput;
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
  readonly listDiscounts: (args: DiscountListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getDiscount: (args: DiscountGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listMarketingEvents: (args: MarketingEventsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listMarkets: (args: MarketsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listShopLocales: (args: ShopLocalesListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listMetafieldDefinitions: (args: MetafieldDefinitionsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getMetafieldDefinition: (args: MetafieldDefinitionGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listResourceMetafields: (args: ResourceMetafieldsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listMetaobjectDefinitions: (args: MetaobjectDefinitionsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getMetaobjectDefinition: (args: MetaobjectDefinitionGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly listMetaobjects: (args: MetaobjectsListToolArgs) => Promise<McpToolOutput> | McpToolOutput;
  readonly getMetaobject: (args: MetaobjectGetToolArgs) => Promise<McpToolOutput> | McpToolOutput;
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

type McpToolHandler = (args: unknown, deps: McpServerDependencies) => unknown;
type McpAuditMetadataExtractor = (args: unknown, result?: unknown) => Record<string, unknown>;

export interface McpDispatchAuditDefinition {
  readonly handler: McpToolHandler;
  readonly auditMetadata: McpAuditMetadataExtractor;
}

function noAuditMetadata(): Record<string, unknown> {
  return {};
}

function combineAuditMetadata(...extractors: readonly McpAuditMetadataExtractor[]): McpAuditMetadataExtractor {
  return (args, result) => {
    const metadata: Record<string, unknown> = {};
    for (const extractor of extractors) {
      Object.assign(metadata, extractor(args, result));
    }
    return metadata;
  };
}

export const MCP_DISPATCH_AUDIT_DEFINITIONS = {
  'shopify.health': { handler: () => readMcpHealth(), auditMetadata: noAuditMetadata },
  'shopify.list_shops': { handler: async (_args, deps) => sanitizeToolOutput(await callDependency(() => listShops(deps.tokenStore))), auditMetadata: noAuditMetadata },
  'shopify.verify_shop': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.verifyShop); }, auditMetadata: noAuditMetadata },
  'shopify.store.diagnostics': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.storeDiagnostics); }, auditMetadata: noAuditMetadata },
  'shopify.online_store.summary': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.summarizeOnlineStore); }, auditMetadata: noAuditMetadata },
  'shopify.b2b.companies.summary': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.summarizeB2bCompanies); }, auditMetadata: noAuditMetadata },
  'shopify.b2b.catalogs.summary': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.summarizeB2bCatalogs); }, auditMetadata: noAuditMetadata },
  'shopify.report_products': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'format']); return callToolDependency(readReportArgs(args), deps.reportProducts); }, auditMetadata: readAuditFormat },
  'shopify.report_orders': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'format', 'since', 'from', 'to']); return callToolDependency(readReportArgs(args), deps.reportOrders); }, auditMetadata: readAuditFormat },
  'shopify.report_inventory': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'format', 'lowStockThreshold']); return callToolDependency(readReportArgs(args), deps.reportInventory); }, auditMetadata: combineAuditMetadata(readAuditFormat, readAuditThreshold) },
  'shopify.analytics.shopifyql.summary': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'report', 'format', 'from', 'to', 'granularity', 'limit']); return callToolDependency(readShopifyqlAnalyticsArgs(args), deps.analyticsShopifyqlSummary); }, auditMetadata: readAuditFormat },
  'shopify.bulk.start': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'templateId']); return callToolDependency({ shop: readRequiredString(args, 'shop'), templateId: readRequiredString(args, 'templateId') }, deps.startBulkOperation); }, auditMetadata: readAuditTemplate },
  'shopify.bulk.status': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.getCurrentBulkOperation); }, auditMetadata: noAuditMetadata },
  'shopify.bulk.result': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'url', 'maxLines', 'maxBytes']); return callToolDependency(readBulkResultArgs(args), deps.fetchBulkOperationResult); }, auditMetadata: readAuditResultLimits },
  'shopify.bulk.cancel': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.cancelBulkOperation); }, auditMetadata: noAuditMetadata },
  'shopify.webhooks.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after']); return callToolDependency(readWebhookListArgs(args), deps.listWebhookSubscriptions); }, auditMetadata: noAuditMetadata },
  'shopify.webhooks.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency(readWebhookGetArgs(args), deps.getWebhookSubscription); }, auditMetadata: noAuditMetadata },
  'shopify.products.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getProductDetail); }, auditMetadata: noAuditMetadata },
  'shopify.collections.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after', 'query']); return callToolDependency(readCollectionListArgs(args), deps.listCollections); }, auditMetadata: readAuditBoundedList },
  'shopify.collections.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getCollection); }, auditMetadata: noAuditMetadata },
  'shopify.locations.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after']); return callToolDependency(readLocationListArgs(args), deps.listLocations); }, auditMetadata: readAuditBoundedList },
  'shopify.locations.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getLocation); }, auditMetadata: noAuditMetadata },
  'shopify.inventory.items.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getInventoryItem); }, auditMetadata: noAuditMetadata },
  'shopify.inventory.levels.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'inventoryItemId', 'locationId', 'first', 'after']); return callToolDependency(readInventoryLevelsListArgs(args), deps.listInventoryLevels); }, auditMetadata: readAuditInventoryLevelsList },
  'shopify.orders.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id', 'name']); return callToolDependency(readOrderGetArgs(args), deps.getOrder); }, auditMetadata: readAuditOrderGet },
  'shopify.fulfillment_orders.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'orderId', 'orderName', 'first', 'after']); return callToolDependency(readFulfillmentOrdersListArgs(args), deps.listFulfillmentOrders); }, auditMetadata: readAuditFulfillmentOrdersList },
  'shopify.fulfillment_orders.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getFulfillmentOrder); }, auditMetadata: noAuditMetadata },
  'shopify.customers.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after', 'query']); return callToolDependency(readCustomerListArgs(args), deps.listCustomers); }, auditMetadata: readAuditBoundedList },
  'shopify.customers.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency(readCustomerGetArgs(args), deps.getCustomer); }, auditMetadata: noAuditMetadata },
  'shopify.discounts.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after', 'query']); return callToolDependency(readDiscountListArgs(args), deps.listDiscounts); }, auditMetadata: readAuditBoundedList },
  'shopify.discounts.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency(readDiscountGetArgs(args), deps.getDiscount); }, auditMetadata: readAuditDiscountGet },
  'shopify.marketing_events.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after', 'query']); return callToolDependency(readMarketingEventsListArgs(args), deps.listMarketingEvents); }, auditMetadata: readAuditBoundedList },
  'shopify.markets.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'first', 'after']); return callToolDependency(readMarketsListArgs(args), deps.listMarkets); }, auditMetadata: combineAuditMetadata(readAuditBoundedList, (_args, result) => readMarketsLocalizationAuditResult('shopify.markets.list', result)) },
  'shopify.localization.locales.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop']); return callToolDependency({ shop: readRequiredString(args, 'shop') }, deps.listShopLocales); }, auditMetadata: (_args, result) => readMarketsLocalizationAuditResult('shopify.localization.locales.list', result) },
  'shopify.metafield_definitions.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'ownerType', 'namespace', 'key', 'first', 'after']); return callToolDependency(readMetafieldDefinitionsListArgs(args), deps.listMetafieldDefinitions); }, auditMetadata: combineAuditMetadata(readAuditBoundedList, readAuditMetafieldFilters) },
  'shopify.metafield_definitions.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'ownerType', 'namespace', 'key']); return callToolDependency(readMetafieldDefinitionGetArgs(args), deps.getMetafieldDefinition); }, auditMetadata: readAuditMetafieldGet },
  'shopify.resource_metafields.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'ownerId', 'namespace', 'key', 'first', 'after']); return callToolDependency(readResourceMetafieldsListArgs(args), deps.listResourceMetafields); }, auditMetadata: combineAuditMetadata(readAuditBoundedList, readAuditMetafieldFilters) },
  'shopify.metaobject_definitions.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'type', 'first', 'after']); return callToolDependency(readMetaobjectDefinitionsListArgs(args), deps.listMetaobjectDefinitions); }, auditMetadata: combineAuditMetadata(readAuditBoundedList, readAuditMetaobjectList) },
  'shopify.metaobject_definitions.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'type']); return callToolDependency({ shop: readRequiredString(args, 'shop'), type: readRequiredString(args, 'type') }, deps.getMetaobjectDefinition); }, auditMetadata: readAuditMetaobjectDefinitionGet },
  'shopify.metaobjects.list': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'type', 'first', 'after']); return callToolDependency(readMetaobjectsListArgs(args), deps.listMetaobjects); }, auditMetadata: combineAuditMetadata(readAuditBoundedList, readAuditMetaobjectList) },
  'shopify.metaobjects.get': { handler: async (args, deps) => { validateExactArgs(args, ['shop', 'id']); return callToolDependency({ shop: readRequiredString(args, 'shop'), id: readRequiredString(args, 'id') }, deps.getMetaobject); }, auditMetadata: readAuditMetaobjectGet },
} satisfies Record<McpToolName, McpDispatchAuditDefinition>;

export function validateMcpDispatchAuditDefinitions(
  registry: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY,
  definitions: Readonly<Record<string, Partial<McpDispatchAuditDefinition> | undefined>> = MCP_DISPATCH_AUDIT_DEFINITIONS,
): readonly string[] {
  const errors: string[] = [];
  const registryToolNames = new Set<string>(registry.flatMap((capability) => capability.surfaces.mcp === undefined ? [] : [capability.surfaces.mcp.toolName]));

  for (const toolName of registryToolNames) {
    const definition = definitions[toolName];
    if (definition === undefined) {
      errors.push(`${toolName} is missing an MCP dispatch/audit definition.`);
      continue;
    }
    if (typeof definition.handler !== 'function') {
      errors.push(`${toolName} is missing an MCP dispatch handler.`);
    }
    if (typeof definition.auditMetadata !== 'function') {
      errors.push(`${toolName} is missing an MCP audit metadata extractor.`);
    }
  }

  for (const toolName of Object.keys(definitions)) {
    if (!registryToolNames.has(toolName)) {
      errors.push(`${toolName} has an MCP dispatch/audit definition but is not exposed by the capability registry.`);
    }
  }

  return errors;
}

const DISPATCH_AUDIT_VALIDATION_ERRORS = validateMcpDispatchAuditDefinitions();
if (DISPATCH_AUDIT_VALIDATION_ERRORS.length > 0) {
  throw new Error(`Invalid MCP dispatch/audit definitions: ${DISPATCH_AUDIT_VALIDATION_ERRORS.join(' ')}`);
}

export function listTools(): readonly McpToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export async function callTool(name: string, args: unknown, deps: McpServerDependencies): Promise<unknown> {
  const auditEvent = (result: 'success' | 'failure', reason?: string, errorCode?: SafeErrorCode, toolResult?: unknown): AuditEventInput => ({
    action: 'mcp.tool',
    ...readAuditShop(args),
    result,
    metadata: buildMcpAuditMetadata(name, args, reason, errorCode, toolResult),
  });

  if (!ALLOWED_TOOL_NAMES.has(name)) {
    const error = new McpToolError();
    await appendMcpAuditEventBestEffort(deps, auditEvent('failure', error.message, error.code));
    throw error;
  }

  try {
    const definition = (MCP_DISPATCH_AUDIT_DEFINITIONS as Readonly<Record<string, McpDispatchAuditDefinition | undefined>>)[name];
    if (definition === undefined) {
      throw new McpToolError();
    }
    if (name === 'shopify.health' || name === 'shopify.list_shops') {
      validateExactArgs(args, []);
    }
    const result = await definition.handler(args, deps);
    await appendMcpAuditEventBestEffort(deps, auditEvent('success', undefined, undefined, result));
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
    if (error instanceof ShopifyqlAnalyticsError) {
      throw new McpToolError(error.message, 'MCP_TOOL_CALL_FAILED');
    }
    throw new McpToolError('Tool call failed.', safeErrorCode(error, 'MCP_TOOL_CALL_FAILED'));
  }
}

async function callToolDependency<TArgs, TResult>(args: TArgs, operation: (args: TArgs) => Promise<TResult> | TResult): Promise<unknown> {
  return sanitizeToolOutput(await callDependency(() => operation(args)));
}

async function appendMcpAuditEventBestEffort(deps: McpServerDependencies, event: AuditEventInput): Promise<void> {
  try {
    await deps.appendAuditEvent?.(event);
  } catch {
    // MCP audit logging must never mask tool results or the original tool error.
  }
}

function buildMcpAuditMetadata(name: string, args: unknown, reason?: string, errorCode?: SafeErrorCode, result?: unknown): Record<string, unknown> {
  const definition = (MCP_DISPATCH_AUDIT_DEFINITIONS as Readonly<Record<string, McpDispatchAuditDefinition | undefined>>)[name];
  const safeMetadata = definition !== undefined ? definition.auditMetadata(args, result) : {};

  return {
    source: 'mcp',
    actor: 'mcp',
    mode: 'read-only',
    toolName: sanitizeAuditString(name),
    ...safeMetadata,
    ...(reason === undefined ? {} : { reason: sanitizeAuditString(reason) }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function readMarketsLocalizationAuditResult(name: string, result: unknown): Record<string, unknown> {
  if (!isRecord(result)) {
    return {};
  }

  if (name === 'shopify.markets.list') {
    const summary = isRecord(result.summary) ? result.summary : {};
    return {
      ...(typeof result.supported === 'boolean' ? { supported: result.supported } : {}),
      ...(Number.isInteger(summary.marketCount) ? { marketCount: summary.marketCount } : {}),
      ...(Number.isInteger(summary.activeCount) ? { activeCount: summary.activeCount } : {}),
      ...(Number.isInteger(summary.regionCount) ? { regionCount: summary.regionCount } : {}),
      ...(Number.isInteger(summary.regionsTruncatedCount) ? { regionsTruncatedCount: summary.regionsTruncatedCount } : {}),
      pageSizeCap: 50,
      regionCap: 10,
    };
  }

  if (name === 'shopify.localization.locales.list') {
    const summary = isRecord(result.summary) ? result.summary : {};
    return {
      ...(typeof result.supported === 'boolean' ? { supported: result.supported } : {}),
      ...(Number.isInteger(summary.localeCount) ? { localeCount: summary.localeCount } : {}),
      ...(Number.isInteger(summary.publishedCount) ? { publishedCount: summary.publishedCount } : {}),
      ...(typeof summary.primaryLocale === 'string' ? { primaryLocalePresent: true } : {}),
    };
  }

  return {};
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

function readAuditDiscountGet(args: unknown): { readonly idPresent?: boolean } {
  return isRecord(args) && typeof args.id === 'string' ? { idPresent: true } : {};
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

function readAuditMetafieldFilters(args: unknown): { readonly ownerType?: string; readonly ownerIdPresent?: boolean; readonly namespacePresent?: boolean; readonly keyPresent?: boolean } {
  return {
    ...(isRecord(args) && typeof args.ownerType === 'string' ? { ownerType: sanitizeAuditString(args.ownerType) } : {}),
    ...(isRecord(args) && typeof args.ownerId === 'string' ? { ownerIdPresent: true } : {}),
    ...(isRecord(args) && typeof args.namespace === 'string' ? { namespacePresent: true } : {}),
    ...(isRecord(args) && typeof args.key === 'string' ? { keyPresent: true } : {}),
  };
}

function readAuditMetafieldGet(args: unknown): { readonly ownerType?: string; readonly namespacePresent?: boolean; readonly keyPresent?: boolean } {
  return {
    ...(isRecord(args) && typeof args.ownerType === 'string' ? { ownerType: sanitizeAuditString(args.ownerType) } : {}),
    ...(isRecord(args) && typeof args.namespace === 'string' ? { namespacePresent: true } : {}),
    ...(isRecord(args) && typeof args.key === 'string' ? { keyPresent: true } : {}),
  };
}

function readAuditMetaobjectList(args: unknown): { readonly typePresent?: boolean } {
  return isRecord(args) && typeof args.type === 'string' ? { typePresent: true } : {};
}

function readAuditMetaobjectDefinitionGet(args: unknown): { readonly typePresent?: boolean } {
  return readAuditMetaobjectList(args);
}

function readAuditMetaobjectGet(args: unknown): { readonly idPresent?: boolean } {
  return isRecord(args) && typeof args.id === 'string' ? { idPresent: true } : {};
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
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'shopify-hermes-oauth', version: packageVersion }, capabilities: { tools: {} } } };
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

function readShopifyqlAnalyticsArgs(args: unknown): ShopifyqlAnalyticsToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    report: readShopifyqlAnalyticsReport(args),
    format: readFormat(args),
    from: readRequiredString(args, 'from'),
    to: readRequiredString(args, 'to'),
    ...readOptionalGranularity(args),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'limit', 100),
  };
}

function readShopifyqlAnalyticsReport(args: unknown): ShopifyqlAnalyticsReportId {
  const report = readRequiredString(args, 'report');
  if (report === 'sales_summary_by_period' || report === 'top_products_by_sales') {
    return report;
  }
  throw new McpToolError('Invalid argument: report. Raw ShopifyQL is not accepted.');
}

function readOptionalGranularity(args: unknown): Record<string, ShopifyqlAnalyticsGranularity> {
  if (!isRecord(args) || args.granularity === undefined) {
    return {};
  }
  if (args.granularity === 'day' || args.granularity === 'week' || args.granularity === 'month') {
    return { granularity: args.granularity };
  }
  throw new McpToolError('Invalid argument: granularity.');
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
  if (query.query !== undefined && hasGraphqlLikeSearchSyntax(query.query)) {
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
  if (name !== undefined && hasGraphqlLikeSearchSyntax(name)) {
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
  if (orderName !== undefined && hasGraphqlLikeSearchSyntax(orderName)) {
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
    ...readOptionalSafeCursor(args, 'after'),
    ...readOptionalCustomerSearchQuery(args),
  };
}

function readOptionalCustomerSearchQuery(args: unknown): Record<string, string> {
  const query = readOptionalStringProperty(args, 'query');
  if (query.query !== undefined && hasGraphqlLikeSearchSyntax(query.query)) {
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

function readDiscountListArgs(args: unknown): DiscountListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalSafeCursor(args, 'after'),
    ...readOptionalSafeSearchQuery(args),
  };
}

function readDiscountGetArgs(args: unknown): DiscountGetToolArgs {
  const id = readRequiredString(args, 'id');
  if (!/^gid:\/\/shopify\/DiscountNode\/[0-9]+$/u.test(id)) {
    throw new McpToolError('Invalid argument: id.');
  }
  return { shop: readRequiredString(args, 'shop'), id };
}

function readMarketingEventsListArgs(args: unknown): MarketingEventsListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalSafeCursor(args, 'after'),
    ...readOptionalSafeSearchQuery(args),
  };
}

function readMarketsListArgs(args: unknown): MarketsListToolArgs {
  return {
    shop: readRequiredString(args, 'shop'),
    ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50),
    ...readOptionalSafeCursor(args, 'after'),
  };
}

function readOptionalSafeCursor(args: unknown, key: string): Record<string, string> {
  const cursor = readOptionalStringProperty(args, key);
  if (cursor[key] !== undefined && !isValidOpaqueCursor(cursor[key])) {
    throw new McpToolError(`Invalid argument: ${key}.`);
  }
  return cursor;
}

function readOptionalSafeSearchQuery(args: unknown): Record<string, string> {
  const query = readOptionalStringProperty(args, 'query');
  if (query.query !== undefined && hasGraphqlLikeSearchSyntax(query.query)) {
    throw new McpToolError('Invalid argument: query.');
  }
  return query;
}


function readMetafieldDefinitionsListArgs(args: unknown): MetafieldDefinitionsListToolArgs {
  return { shop: readRequiredString(args, 'shop'), ownerType: readRequiredString(args, 'ownerType'), ...readOptionalStringProperty(args, 'namespace'), ...readOptionalStringProperty(args, 'key'), ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50), ...readOptionalSafeCursor(args, 'after') };
}
function readMetafieldDefinitionGetArgs(args: unknown): MetafieldDefinitionGetToolArgs {
  return { shop: readRequiredString(args, 'shop'), ownerType: readRequiredString(args, 'ownerType'), namespace: readRequiredString(args, 'namespace'), key: readRequiredString(args, 'key') };
}
function readResourceMetafieldsListArgs(args: unknown): ResourceMetafieldsListToolArgs {
  return { shop: readRequiredString(args, 'shop'), ownerId: readRequiredString(args, 'ownerId'), ...readOptionalStringProperty(args, 'namespace'), ...readOptionalStringProperty(args, 'key'), ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50), ...readOptionalSafeCursor(args, 'after') };
}
function readMetaobjectDefinitionsListArgs(args: unknown): MetaobjectDefinitionsListToolArgs {
  return { shop: readRequiredString(args, 'shop'), ...readOptionalStringProperty(args, 'type'), ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50), ...readOptionalSafeCursor(args, 'after') };
}
function readMetaobjectsListArgs(args: unknown): MetaobjectsListToolArgs {
  return { shop: readRequiredString(args, 'shop'), type: readRequiredString(args, 'type'), ...readOptionalBoundedPositiveIntegerProperty(args, 'first', 50), ...readOptionalSafeCursor(args, 'after') };
}
function readBulkResultArgs(args: unknown): BulkResultToolArgs {
  const url = readRequiredString(args, 'url');
  if (!/^bulk-result:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(url)) {
    throw new McpToolError('Invalid argument: url.');
  }
  return {
    shop: readRequiredString(args, 'shop'),
    url,
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
