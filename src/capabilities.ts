export type CapabilityAccess = 'read' | 'write' | 'diagnostic';
export type CapabilityRiskLevel = 'read_low' | 'read_pii' | 'read_financial' | 'write_medium' | 'write_high' | 'protected_data' | 'diagnostic_low';
export type CapabilityDomain = 'mcp' | 'shops' | 'reports' | 'webhooks' | 'customers' | 'products' | 'collections' | 'locations' | 'inventory' | 'orders' | 'fulfillment' | 'discounts' | 'marketing' | 'custom_data' | 'localization' | 'online_store';
export type CapabilityRequiredGate = 'dry_run' | 'explicit_confirmation' | 'audit_logging' | 'rollback_notes';

export type McpToolName =
  | 'shopify.health'
  | 'shopify.list_shops'
  | 'shopify.verify_shop'
  | 'shopify.store.diagnostics'
  | 'shopify.online_store.summary'
  | 'shopify.report_products'
  | 'shopify.report_orders'
  | 'shopify.report_inventory'
  | 'shopify.analytics.shopifyql.summary'
  | 'shopify.bulk.start'
  | 'shopify.bulk.status'
  | 'shopify.bulk.result'
  | 'shopify.bulk.cancel'
  | 'shopify.webhooks.list'
  | 'shopify.webhooks.get'
  | 'shopify.customers.list'
  | 'shopify.customers.get'
  | 'shopify.products.get'
  | 'shopify.collections.list'
  | 'shopify.collections.get'
  | 'shopify.locations.list'
  | 'shopify.locations.get'
  | 'shopify.inventory.items.get'
  | 'shopify.inventory.levels.list'
  | 'shopify.orders.get'
  | 'shopify.fulfillment_orders.list'
  | 'shopify.fulfillment_orders.get'
  | 'shopify.discounts.list'
  | 'shopify.discounts.get'
  | 'shopify.marketing_events.list'
  | 'shopify.markets.list'
  | 'shopify.localization.locales.list'
  | 'shopify.metafield_definitions.list'
  | 'shopify.metafield_definitions.get'
  | 'shopify.resource_metafields.list'
  | 'shopify.metaobject_definitions.list'
  | 'shopify.metaobject_definitions.get'
  | 'shopify.metaobjects.list'
  | 'shopify.metaobjects.get';

export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties: boolean;
}

export interface McpToolDefinition {
  readonly name: McpToolName;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface CapabilitySurfaceDefinition {
  readonly cli?: {
    readonly command: string;
  };
  readonly mcp?: {
    readonly toolName: McpToolName;
    readonly description: string;
    readonly inputSchema: JsonSchema;
  };
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly operationName: string;
  readonly requiredScopes: readonly string[];
  readonly access: CapabilityAccess;
  readonly riskLevel: CapabilityRiskLevel;
  readonly pagination: string;
  readonly cost: string;
  readonly auditEvent: string;
  readonly surfaces: CapabilitySurfaceDefinition;
  readonly requiredGates?: readonly CapabilityRequiredGate[];
}

const NO_ARGS_SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const SHOP_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { shop: { type: 'string', description: 'Shopify myshopify.com domain.' } },
  required: ['shop'],
  additionalProperties: false,
};
const REPORT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    format: { type: 'string', enum: ['markdown', 'json', 'csv'], default: 'markdown' },
  },
  required: ['shop'],
  additionalProperties: false,
};
const ORDERS_REPORT_SCHEMA: JsonSchema = {
  ...REPORT_SCHEMA,
  properties: {
    ...REPORT_SCHEMA.properties,
    since: { type: 'string', description: 'Relative window such as 30d.' },
    from: { type: 'string', description: 'Inclusive YYYY-MM-DD start date.' },
    to: { type: 'string', description: 'Inclusive YYYY-MM-DD end date.' },
  },
};
const INVENTORY_REPORT_SCHEMA: JsonSchema = {
  ...REPORT_SCHEMA,
  properties: {
    ...REPORT_SCHEMA.properties,
    lowStockThreshold: { type: 'integer', minimum: 0, description: 'Low-stock threshold. Defaults to 5.' },
  },
};
const SHOPIFYQL_ANALYTICS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    report: { type: 'string', enum: ['sales_summary_by_period', 'top_products_by_sales'], description: 'Curated ShopifyQL analytics report template. Raw ShopifyQL is not accepted.' },
    format: { type: 'string', enum: ['markdown', 'json', 'csv'], default: 'markdown' },
    from: { type: 'string', description: 'Inclusive YYYY-MM-DD start date.' },
    to: { type: 'string', description: 'Inclusive YYYY-MM-DD end date.' },
    granularity: { type: 'string', enum: ['day', 'week', 'month'], default: 'day', description: 'Only used by sales_summary_by_period.' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum rows to return. Defaults to 25 and is capped at 100.' },
  },
  required: ['shop', 'report', 'from', 'to'],
  additionalProperties: false,
};
const BULK_START_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    templateId: { type: 'string', enum: ['products-basic', 'orders-basic', 'inventory-items-basic'], description: 'Curated read-only bulk operation template.' },
  },
  required: ['shop', 'templateId'],
  additionalProperties: false,
};
const BULK_STATUS_SCHEMA: JsonSchema = SHOP_SCHEMA;
const BULK_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    url: { type: 'string', description: 'HTTPS Shopify bulk operation result URL or opaque bulk-result handle returned by status.' },
    maxLines: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum JSONL rows to preview. Defaults to 100 and is capped at 100.' },
    maxBytes: { type: 'integer', minimum: 1, maximum: 1000000, description: 'Maximum response bytes to process. Defaults to 1000000 and is capped at 1000000.' },
  },
  required: ['shop', 'url'],
  additionalProperties: false,
};
const BULK_CANCEL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'BulkOperation GID to cancel.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const WEBHOOK_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size. Defaults to 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
  },
};
const WEBHOOK_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'WebhookSubscription GID.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const CUSTOMER_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
    query: { type: 'string', description: 'Explicit Shopify customer search string; omitted means Shopify default customer ordering.' },
  },
};
const CUSTOMER_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'Customer GID, e.g. gid://shopify/Customer/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const PRODUCT_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'Product GID, e.g. gid://shopify/Product/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const COLLECTION_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
    query: { type: 'string', description: 'Explicit Shopify collection search string; omitted means Shopify default collection ordering.' },
  },
};
const COLLECTION_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'Collection GID, e.g. gid://shopify/Collection/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const LOCATION_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
  },
};
const LOCATION_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'Location GID, e.g. gid://shopify/Location/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const INVENTORY_ITEM_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'InventoryItem GID, e.g. gid://shopify/InventoryItem/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const INVENTORY_LEVEL_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    inventoryItemId: { type: 'string', description: 'InventoryItem GID. Provide exactly one of inventoryItemId or locationId.' },
    locationId: { type: 'string', description: 'Location GID. Provide exactly one of inventoryItemId or locationId.' },
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
  },
};
const ORDER_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'Order GID, e.g. gid://shopify/Order/123. Provide exactly one of id or name.' },
    name: { type: 'string', description: 'Shopify order name such as #1001. Provide exactly one of id or name.' },
  },
  required: ['shop'],
  additionalProperties: false,
};
const FULFILLMENT_ORDERS_LIST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    orderId: { type: 'string', description: 'Order GID, e.g. gid://shopify/Order/123. Provide exactly one of orderId or orderName.' },
    orderName: { type: 'string', description: 'Shopify order name such as #1001. Provide exactly one of orderId or orderName.' },
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
  },
  required: ['shop'],
  additionalProperties: false,
};
const FULFILLMENT_ORDER_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'FulfillmentOrder GID, e.g. gid://shopify/FulfillmentOrder/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const DISCOUNT_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
    query: { type: 'string', description: 'Explicit Shopify discount search string; omitted means Shopify default discount ordering.' },
  },
};
const DISCOUNT_GET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    shop: { type: 'string', description: 'Shopify myshopify.com domain.' },
    id: { type: 'string', description: 'DiscountNode GID, e.g. gid://shopify/DiscountNode/123.' },
  },
  required: ['shop', 'id'],
  additionalProperties: false,
};
const MARKETING_EVENTS_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
    query: { type: 'string', description: 'Explicit Shopify marketing event search string; omitted means Shopify default event ordering.' },
  },
};
const MARKETS_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: {
    ...SHOP_SCHEMA.properties,
    first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' },
    after: { type: 'string', description: 'Optional Shopify cursor for the next page.' },
  },
};
const SHOP_LOCALES_LIST_SCHEMA: JsonSchema = SHOP_SCHEMA;

const METAFIELD_DEFINITIONS_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: { ...SHOP_SCHEMA.properties, ownerType: { type: 'string', description: 'Metafield owner type enum, e.g. PRODUCT.' }, namespace: { type: 'string', description: 'Optional metafield namespace filter.' }, key: { type: 'string', description: 'Optional metafield key filter.' }, first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' }, after: { type: 'string', description: 'Optional Shopify cursor for the next page.' } },
  required: ['shop', 'ownerType'],
};
const METAFIELD_DEFINITIONS_GET_SCHEMA: JsonSchema = { type: 'object', properties: { shop: { type: 'string', description: 'Shopify myshopify.com domain.' }, ownerType: { type: 'string', description: 'Metafield owner type enum, e.g. PRODUCT.' }, namespace: { type: 'string', description: 'Metafield namespace.' }, key: { type: 'string', description: 'Metafield key.' } }, required: ['shop', 'ownerType', 'namespace', 'key'], additionalProperties: false };
const RESOURCE_METAFIELDS_LIST_SCHEMA: JsonSchema = {
  ...SHOP_SCHEMA,
  properties: { ...SHOP_SCHEMA.properties, ownerId: { type: 'string', description: 'Supported resource GID, e.g. gid://shopify/Product/123.' }, namespace: { type: 'string', description: 'Optional metafield namespace filter.' }, key: { type: 'string', description: 'Optional metafield key filter.' }, first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' }, after: { type: 'string', description: 'Optional Shopify cursor for the next page.' } },
  required: ['shop', 'ownerId'],
};
const METAOBJECT_DEFINITIONS_LIST_SCHEMA: JsonSchema = { ...SHOP_SCHEMA, properties: { ...SHOP_SCHEMA.properties, type: { type: 'string', description: 'Optional metaobject type filter.' }, first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' }, after: { type: 'string', description: 'Optional Shopify cursor for the next page.' } } };
const METAOBJECT_DEFINITIONS_GET_SCHEMA: JsonSchema = { type: 'object', properties: { shop: { type: 'string', description: 'Shopify myshopify.com domain.' }, type: { type: 'string', description: 'Metaobject type.' } }, required: ['shop', 'type'], additionalProperties: false };
const METAOBJECTS_LIST_SCHEMA: JsonSchema = { ...SHOP_SCHEMA, properties: { ...SHOP_SCHEMA.properties, type: { type: 'string', description: 'Metaobject type.' }, first: { type: 'integer', minimum: 1, maximum: 50, description: 'Page size. Defaults to 25 and is capped at 50.' }, after: { type: 'string', description: 'Optional Shopify cursor for the next page.' } }, required: ['shop', 'type'] };
const METAOBJECTS_GET_SCHEMA: JsonSchema = { type: 'object', properties: { shop: { type: 'string', description: 'Shopify myshopify.com domain.' }, id: { type: 'string', description: 'Metaobject GID, e.g. gid://shopify/Metaobject/123.' } }, required: ['shop', 'id'], additionalProperties: false };

export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = [
  {
    id: 'mcp.health.read',
    domain: 'mcp',
    operationName: 'McpHealth',
    requiredScopes: [],
    access: 'diagnostic',
    riskLevel: 'diagnostic_low',
    pagination: 'No Shopify Admin GraphQL pagination; local process diagnostic only.',
    cost: 'No Shopify Admin GraphQL cost; local process diagnostic only.',
    auditEvent: 'mcp.health',
    surfaces: {
      mcp: {
        toolName: 'shopify.health',
        description: 'Return lightweight MCP process health and memory diagnostics without secrets.',
        inputSchema: NO_ARGS_SCHEMA,
      },
    },
  },
  {
    id: 'shops.list.read',
    domain: 'shops',
    operationName: 'ListInstalledShops',
    requiredScopes: [],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Reads local token-store shop records only; no Shopify Admin GraphQL pagination.',
    cost: 'No Shopify Admin GraphQL cost; local metadata summary only.',
    auditEvent: 'shops.list',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth shops list' },
      mcp: {
        toolName: 'shopify.list_shops',
        description: 'List installed Shopify shops with non-secret metadata only.',
        inputSchema: NO_ARGS_SCHEMA,
      },
    },
  },
  {
    id: 'shops.verify.read',
    domain: 'shops',
    operationName: 'ShopMetadata',
    requiredScopes: [],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single shop metadata query; no nested connections.',
    cost: 'Low-cost shop metadata query through the Admin GraphQL client.',
    auditEvent: 'shops.verify',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth shops verify <shop>' },
      mcp: {
        toolName: 'shopify.verify_shop',
        description: 'Verify a stored Shopify shop token and return safe shop metadata.',
        inputSchema: SHOP_SCHEMA,
      },
    },
  },
  {
    id: 'shops.store_diagnostics.read',
    domain: 'shops',
    operationName: 'StoreAppDiagnostics',
    requiredScopes: [],
    access: 'diagnostic',
    riskLevel: 'diagnostic_low',
    pagination: 'Single curated store/app diagnostics query plus optional policy presence query when read_content is granted; no raw GraphQL input.',
    cost: 'Low-cost shop/currentAppInstallation query; optional low-cost policy URL/title presence query only.',
    auditEvent: 'shops.diagnostics',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth shops diagnostics <shop>' },
      mcp: {
        toolName: 'shopify.store.diagnostics',
        description: 'Return safe Shopify store, app access, scope drift, and policy-presence diagnostics.',
        inputSchema: SHOP_SCHEMA,
      },
    },
  },
  {
    id: 'online_store.summary.read',
    domain: 'online_store',
    operationName: 'OnlineStoreSummary',
    requiredScopes: ['read_themes', 'read_content'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single curated read-only online store summary query with themes capped at 5 and pages/blogs capped at 10; no raw GraphQL input and no theme assets, template bodies, HTML, scripts, checkout write operations, or branding writes.',
    cost: 'Low-cost bounded theme/page/blog summary query; checkout, customer-account, and branding configuration gaps are returned as structured documented limitations when unavailable through the safe read-only surface.',
    auditEvent: 'online_store.summary',
    surfaces: {
      mcp: {
        toolName: 'shopify.online_store.summary',
        description: 'Return bounded read-only online store theme/page/blog summaries plus checkout/account/branding limitation statuses.',
        inputSchema: SHOP_SCHEMA,
      },
    },
  },
  {
    id: 'reports.products.read',
    domain: 'reports',
    operationName: 'ProductsReport',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates products with a bounded page size and reports omitted nested variants when limits are reached.',
    cost: 'Uses a bounded curated report query and relies on Admin GraphQL client failures for unsafe cost responses.',
    auditEvent: 'reports.products',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth report products <shop>' },
      mcp: {
        toolName: 'shopify.report_products',
        description: 'Generate a read-only Shopify products report.',
        inputSchema: REPORT_SCHEMA,
      },
    },
  },
  {
    id: 'reports.orders.read',
    domain: 'reports',
    operationName: 'OrdersReport',
    requiredScopes: ['read_orders'],
    access: 'read',
    riskLevel: 'read_pii',
    pagination: 'Paginates orders by explicit time window and bounds nested line items.',
    cost: 'Uses a bounded curated report query; future telemetry should parse GraphQL cost extensions centrally.',
    auditEvent: 'reports.orders',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth report orders <shop>' },
      mcp: {
        toolName: 'shopify.report_orders',
        description: 'Generate a read-only Shopify orders report.',
        inputSchema: ORDERS_REPORT_SCHEMA,
      },
    },
  },
  {
    id: 'reports.inventory.read',
    domain: 'reports',
    operationName: 'InventoryReport',
    requiredScopes: ['read_products', 'read_inventory', 'read_locations'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates products and bounded inventory levels; hard-fails rather than silently truncating unsafe nested inventory levels.',
    cost: 'Surfaces MAX_COST_EXCEEDED with safe remediation and keeps inventory dimensions bounded.',
    auditEvent: 'reports.inventory',
    surfaces: {
      cli: { command: 'shopify-hermes-oauth report inventory <shop>' },
      mcp: {
        toolName: 'shopify.report_inventory',
        description: 'Generate a read-only Shopify inventory report.',
        inputSchema: INVENTORY_REPORT_SCHEMA,
      },
    },
  },
  {
    id: 'analytics.shopifyql.summary.read',
    domain: 'reports',
    operationName: 'CuratedShopifyqlAnalytics',
    requiredScopes: ['read_reports'],
    access: 'read',
    riskLevel: 'protected_data',
    pagination: 'Single curated ShopifyQL analytics query from an allowlisted template; no raw ShopifyQL or arbitrary analytics query input is exposed. Limit is capped at 100 rows.',
    cost: 'Uses ShopifyQL through Admin GraphQL only when SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true and read_reports/protected customer data analytics approval are in place.',
    auditEvent: 'analytics.shopifyql.summary',
    requiredGates: ['explicit_confirmation', 'audit_logging'],
    surfaces: {
      mcp: {
        toolName: 'shopify.analytics.shopifyql.summary',
        description: 'Generate an opt-in curated ShopifyQL analytics report (sales summary by period or top products by sales). Requires read_reports and protected customer data/analytics approval.',
        inputSchema: SHOPIFYQL_ANALYTICS_SCHEMA,
      },
    },
  },
  {
    id: 'bulk.operations.read.start',
    domain: 'reports',
    operationName: 'BulkOperationRunQuery',
    requiredScopes: ['read_products', 'read_orders', 'read_inventory', 'read_locations'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Starts a Shopify Admin GraphQL bulk operation from a curated read-only template; no arbitrary GraphQL input is exposed.',
    cost: 'Uses Shopify bulkOperationRunQuery to avoid normal nested pagination and query-cost ceilings for large exports.',
    auditEvent: 'bulk.start',
    surfaces: {
      mcp: {
        toolName: 'shopify.bulk.start',
        description: 'Start a curated read-only Shopify Admin GraphQL bulk export.',
        inputSchema: BULK_START_SCHEMA,
      },
    },
  },
  {
    id: 'bulk.operations.read.status',
    domain: 'reports',
    operationName: 'CurrentBulkOperation',
    requiredScopes: [],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Reads currentBulkOperation status only.',
    cost: 'Low-cost status query.',
    auditEvent: 'bulk.status',
    surfaces: {
      mcp: {
        toolName: 'shopify.bulk.status',
        description: 'Poll the current Shopify Admin GraphQL bulk operation status.',
        inputSchema: BULK_STATUS_SCHEMA,
      },
    },
  },
  {
    id: 'bulk.operations.read.result',
    domain: 'reports',
    operationName: 'BulkOperationResultPreview',
    requiredScopes: [],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Fetches a bounded JSONL preview from a Shopify bulk operation result URL.',
    cost: 'No Admin GraphQL cost; bounded HTTPS result download.',
    auditEvent: 'bulk.result',
    surfaces: {
      mcp: {
        toolName: 'shopify.bulk.result',
        description: 'Fetch a bounded JSONL preview from a Shopify bulk operation result URL.',
        inputSchema: BULK_RESULT_SCHEMA,
      },
    },
  },
  {
    id: 'bulk.operations.read.cancel',
    domain: 'reports',
    operationName: 'BulkOperationCancel',
    requiredScopes: [],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Cancels a running curated read-only bulk operation by ID.',
    cost: 'Low-cost bulk operation cancellation request used only to stop read-only exports.',
    auditEvent: 'bulk.cancel',
    surfaces: {
      mcp: {
        toolName: 'shopify.bulk.cancel',
        description: 'Cancel a running curated read-only Shopify bulk operation.',
        inputSchema: BULK_CANCEL_SCHEMA,
      },
    },
  },
  {
    id: 'webhooks.list.read',
    domain: 'webhooks',
    operationName: 'WebhookSubscriptions',
    requiredScopes: ['read_webhooks'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates webhookSubscriptions with a bounded page size and explicit cursor.',
    cost: 'Uses a bounded curated webhookSubscriptions query; future telemetry should parse GraphQL cost extensions centrally.',
    auditEvent: 'webhooks.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.webhooks.list',
        description: 'List read-only webhook subscriptions for a Shopify shop.',
        inputSchema: WEBHOOK_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'webhooks.get.read',
    domain: 'webhooks',
    operationName: 'WebhookSubscription',
    requiredScopes: ['read_webhooks'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single webhookSubscription lookup by GID; no nested connections.',
    cost: 'Low-cost single webhookSubscription query.',
    auditEvent: 'webhooks.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.webhooks.get',
        description: 'Inspect one read-only webhook subscription by GID.',
        inputSchema: WEBHOOK_GET_SCHEMA,
      },
    },
  },

  {
    id: 'products.get.read',
    domain: 'products',
    operationName: 'ProductDetail',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single product lookup by stable Product GID; variants capped at 25, media at 10, and metafields at 20.',
    cost: 'Uses a bounded curated product detail query separate from the aggregate products report.',
    auditEvent: 'products.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.products.get',
        description: 'Inspect one Shopify product by stable ID with bounded variants, media, options, publication status, and metafield previews.',
        inputSchema: PRODUCT_GET_SCHEMA,
      },
    },
  },
  {
    id: 'collections.list.read',
    domain: 'collections',
    operationName: 'Collections',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates collections with explicit cursor and page size 1..50 (default 25).',
    cost: 'Uses a bounded curated collections query with no raw GraphQL input.',
    auditEvent: 'collections.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.collections.list',
        description: 'List/search Shopify collections with bounded pagination.',
        inputSchema: COLLECTION_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'collections.get.read',
    domain: 'collections',
    operationName: 'CollectionDetail',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single collection lookup by stable Collection GID; products capped at 25 and metafields at 20.',
    cost: 'Low-cost bounded collection detail query separate from products report.',
    auditEvent: 'collections.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.collections.get',
        description: 'Inspect one Shopify collection by stable ID with bounded product and metafield previews.',
        inputSchema: COLLECTION_GET_SCHEMA,
      },
    },
  },
  {
    id: 'locations.list.read',
    domain: 'locations',
    operationName: 'Locations',
    requiredScopes: ['read_locations'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates locations with explicit cursor and page size 1..50 (default 25); address/contact fields omitted.',
    cost: 'Uses a bounded curated locations query with no raw GraphQL input.',
    auditEvent: 'locations.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.locations.list',
        description: 'List Shopify locations with bounded pagination and no address/contact fields.',
        inputSchema: LOCATION_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'locations.get.read',
    domain: 'locations',
    operationName: 'LocationDetail',
    requiredScopes: ['read_locations'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single location lookup by stable Location GID; no nested connections, address, phone, or contact fields.',
    cost: 'Low-cost single location detail query.',
    auditEvent: 'locations.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.locations.get',
        description: 'Inspect one Shopify location by stable ID without address/contact fields.',
        inputSchema: LOCATION_GET_SCHEMA,
      },
    },
  },
  {
    id: 'inventory.items.get.read',
    domain: 'inventory',
    operationName: 'InventoryItemDetail',
    requiredScopes: ['read_inventory'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single inventory item lookup by stable InventoryItem GID; no nested inventory levels, metafields, or adjustment history.',
    cost: 'Low-cost single inventory item detail query.',
    auditEvent: 'inventory.items.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.inventory.items.get',
        description: 'Inspect one Shopify inventory item by stable ID with minimal product variant context.',
        inputSchema: INVENTORY_ITEM_GET_SCHEMA,
      },
    },
  },
  {
    id: 'inventory.levels.list.read',
    domain: 'inventory',
    operationName: 'InventoryLevels',
    requiredScopes: ['read_inventory', 'read_locations'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Lists inventory levels for exactly one of inventoryItemId or locationId with page size 1..50 (default 25).',
    cost: 'Keeps inventory level lookup cost safe by querying a single dimension and bounded page size with variables for IDs/cursors.',
    auditEvent: 'inventory.levels.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.inventory.levels.list',
        description: 'List Shopify inventory levels by exactly one inventory item or location with bounded pagination.',
        inputSchema: INVENTORY_LEVEL_LIST_SCHEMA,
      },
    },
  },

  {
    id: 'orders.get.read',
    domain: 'orders',
    operationName: 'OrderDetail',
    requiredScopes: ['read_orders'],
    access: 'read',
    riskLevel: 'read_pii',
    pagination: 'Single order lookup by stable Order GID or bounded name lookup; line items capped at 25, fulfillments at 10, and refunds at 10.',
    cost: 'Uses curated bounded order lookup/detail queries separate from the aggregate orders report; older orders may require read_all_orders.',
    auditEvent: 'orders.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.orders.get',
        description: 'Inspect one Shopify order by GID or order name with minimized PII and bounded line item, fulfillment, and refund summaries.',
        inputSchema: ORDER_GET_SCHEMA,
      },
    },
  },
  {
    id: 'fulfillment.orders.list.read',
    domain: 'fulfillment',
    operationName: 'FulfillmentOrdersByOrder',
    requiredScopes: ['read_orders', 'read_merchant_managed_fulfillment_orders', 'read_assigned_fulfillment_orders', 'read_third_party_fulfillment_orders'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates fulfillmentOrders for exactly one order by orderId or safe orderName with page size 1..50 (default 25); line items are capped at 25.',
    cost: 'Uses bounded curated order fulfillmentOrders visibility query; no raw GraphQL input or destination/tracking/customer fields.',
    auditEvent: 'fulfillment.orders.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.fulfillment_orders.list',
        description: 'List read-only Shopify fulfillment orders for one order with safe non-contact fulfillment status fields only.',
        inputSchema: FULFILLMENT_ORDERS_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'fulfillment.orders.get.read',
    domain: 'fulfillment',
    operationName: 'FulfillmentOrderDetail',
    requiredScopes: ['read_orders', 'read_merchant_managed_fulfillment_orders', 'read_assigned_fulfillment_orders', 'read_third_party_fulfillment_orders'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single fulfillmentOrder lookup by stable FulfillmentOrder GID; line items are capped at 25.',
    cost: 'Low-cost curated fulfillmentOrder visibility query with no raw GraphQL input or destination/tracking/customer fields.',
    auditEvent: 'fulfillment.orders.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.fulfillment_orders.get',
        description: 'Inspect one read-only Shopify fulfillment order by GID with destination, tracking, contact, notes/tags, and metafields omitted.',
        inputSchema: FULFILLMENT_ORDER_GET_SCHEMA,
      },
    },
  },
  {
    id: 'customers.list.read',
    domain: 'customers',
    operationName: 'Customers',
    requiredScopes: ['read_customers'],
    access: 'read',
    riskLevel: 'read_pii',
    pagination: 'Paginates customers with explicit cursor and page size 1..50 (default 25); no nested connections.',
    cost: 'Uses a bounded curated customers query with minimal fields and no raw GraphQL input.',
    auditEvent: 'customers.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.customers.list',
        description: 'List/search Shopify customers with minimal PII and safe aggregate summaries.',
        inputSchema: CUSTOMER_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'customers.get.read',
    domain: 'customers',
    operationName: 'Customer',
    requiredScopes: ['read_customers'],
    access: 'read',
    riskLevel: 'read_pii',
    pagination: 'Single customer lookup by stable Customer GID; no nested connections.',
    cost: 'Low-cost single customer query with minimal fields only.',
    auditEvent: 'customers.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.customers.get',
        description: 'Inspect one Shopify customer by stable ID with minimal PII fields.',
        inputSchema: CUSTOMER_GET_SCHEMA,
      },
    },
  },
  {
    id: 'discounts.list.read',
    domain: 'discounts',
    operationName: 'Discounts',
    requiredScopes: ['read_discounts'],
    access: 'read',
    riskLevel: 'read_financial',
    pagination: 'Paginates discountNodes with explicit cursor and page size 1..50 (default 25); returns safe discount summaries and aggregate counts only.',
    cost: 'Uses a bounded curated discountNodes query with codesCount only; no raw GraphQL input, individual codes, customer/order data, attribution, or customerSelection.',
    auditEvent: 'discounts.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.discounts.list',
        description: 'List Shopify discounts with bounded pagination and safe aggregate summaries only.',
        inputSchema: DISCOUNT_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'discounts.get.read',
    domain: 'discounts',
    operationName: 'Discount',
    requiredScopes: ['read_discounts'],
    access: 'read',
    riskLevel: 'read_financial',
    pagination: 'Single DiscountNode lookup by stable DiscountNode GID; no nested connections except codesCount.',
    cost: 'Low-cost curated discountNode query; no raw GraphQL input, individual codes, customer/order data, attribution, or customerSelection.',
    auditEvent: 'discounts.get',
    surfaces: {
      mcp: {
        toolName: 'shopify.discounts.get',
        description: 'Inspect one Shopify discount by stable ID with codesCount only and no individual codes or attribution data.',
        inputSchema: DISCOUNT_GET_SCHEMA,
      },
    },
  },
  {
    id: 'marketing.events.list.read',
    domain: 'marketing',
    operationName: 'MarketingEvents',
    requiredScopes: ['read_marketing_events'],
    access: 'read',
    riskLevel: 'read_financial',
    pagination: 'Paginates marketingEvents with explicit cursor and page size 1..50 (default 25); shallow fields only.',
    cost: 'Uses a bounded curated marketingEvents query; omits customer/order/conversion attribution and redacts URL query strings.',
    auditEvent: 'marketing.events.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.marketing_events.list',
        description: 'List Shopify marketing events with shallow fields and redacted URL query strings.',
        inputSchema: MARKETING_EVENTS_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'localization.markets.list.read',
    domain: 'localization',
    operationName: 'Markets',
    requiredScopes: ['read_markets'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates markets with explicit cursor and page size 1..50 (default 25); nested regions are capped at 10 and marked when truncated.',
    cost: 'Uses a bounded curated Markets query. Shopify may gate Markets APIs by plan, API version, feature availability, or approved app scopes; unsupported responses are normalized without raw GraphQL errors.',
    auditEvent: 'localization.markets.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.markets.list',
        description: 'Summarize Shopify Markets with bounded pagination and safe region/currency metadata when the shop supports Markets APIs.',
        inputSchema: MARKETS_LIST_SCHEMA,
      },
    },
  },
  {
    id: 'localization.locales.list.read',
    domain: 'localization',
    operationName: 'ShopLocales',
    requiredScopes: ['read_locales'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Reads shopLocales as a bounded top-level array returned by Shopify; no nested connections or raw translations.',
    cost: 'Low-cost curated shopLocales query. Shopify may gate localization APIs by plan, API version, feature availability, or approved app scopes; unsupported responses are normalized without raw GraphQL errors.',
    auditEvent: 'localization.locales.list',
    surfaces: {
      mcp: {
        toolName: 'shopify.localization.locales.list',
        description: 'List published and primary Shopify shop locales without translations or market-localized content.',
        inputSchema: SHOP_LOCALES_LIST_SCHEMA,
      },
    },
  },

  {
    id: 'custom_data.metafield_definitions.list.read',
    domain: 'custom_data',
    operationName: 'MetafieldDefinitions',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates metafieldDefinitions by required ownerType and optional namespace/key with page size 1..50 (default 25).',
    cost: 'Uses bounded curated schema-aware metafield definition query; no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metafield_definitions.list',
    surfaces: { mcp: { toolName: 'shopify.metafield_definitions.list', description: 'List metafield definitions by owner type with optional namespace/key filters.', inputSchema: METAFIELD_DEFINITIONS_LIST_SCHEMA } },
  },
  {
    id: 'custom_data.metafield_definitions.get.read',
    domain: 'custom_data',
    operationName: 'MetafieldDefinition',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single metafield definition lookup by ownerType, namespace, and key.',
    cost: 'Low-cost curated schema lookup; no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metafield_definitions.get',
    surfaces: { mcp: { toolName: 'shopify.metafield_definitions.get', description: 'Get one metafield definition by owner type, namespace, and key.', inputSchema: METAFIELD_DEFINITIONS_GET_SCHEMA } },
  },
  {
    id: 'custom_data.resource_metafields.list.read',
    domain: 'custom_data',
    operationName: 'ResourceMetafields',
    requiredScopes: ['read_products'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates metafields for one supported owner GID with optional namespace/key and page size 1..50.',
    cost: 'Uses schema-aware value presence/length summaries only and omits jsonValue; no raw GraphQL input or writes.',
    auditEvent: 'custom_data.resource_metafields.list',
    surfaces: { mcp: { toolName: 'shopify.resource_metafields.list', description: 'List metafields for one supported product/catalog resource without raw values.', inputSchema: RESOURCE_METAFIELDS_LIST_SCHEMA } },
  },
  {
    id: 'custom_data.metaobject_definitions.list.read',
    domain: 'custom_data',
    operationName: 'MetaobjectDefinitions',
    requiredScopes: ['read_metaobject_definitions'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates metaobjectDefinitions with optional type and page size 1..50.',
    cost: 'Bounded curated schema query; no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metaobject_definitions.list',
    surfaces: { mcp: { toolName: 'shopify.metaobject_definitions.list', description: 'List metaobject definitions with bounded field definition summaries.', inputSchema: METAOBJECT_DEFINITIONS_LIST_SCHEMA } },
  },
  {
    id: 'custom_data.metaobject_definitions.get.read',
    domain: 'custom_data',
    operationName: 'MetaobjectDefinition',
    requiredScopes: ['read_metaobject_definitions'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single metaobject definition lookup by type.',
    cost: 'Low-cost curated schema query; no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metaobject_definitions.get',
    surfaces: { mcp: { toolName: 'shopify.metaobject_definitions.get', description: 'Get one metaobject definition by type.', inputSchema: METAOBJECT_DEFINITIONS_GET_SCHEMA } },
  },
  {
    id: 'custom_data.metaobjects.list.read',
    domain: 'custom_data',
    operationName: 'Metaobjects',
    requiredScopes: ['read_metaobjects'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Paginates metaobjects for one type with page size 1..50 and field value presence/length only.',
    cost: 'Bounded curated metaobject query; omits jsonValue and exposes no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metaobjects.list',
    surfaces: { mcp: { toolName: 'shopify.metaobjects.list', description: 'List metaobjects of one type with schema-aware field summaries and no raw values.', inputSchema: METAOBJECTS_LIST_SCHEMA } },
  },
  {
    id: 'custom_data.metaobjects.get.read',
    domain: 'custom_data',
    operationName: 'Metaobject',
    requiredScopes: ['read_metaobjects'],
    access: 'read',
    riskLevel: 'read_low',
    pagination: 'Single metaobject lookup by stable Metaobject GID with field value presence/length only.',
    cost: 'Low-cost curated metaobject query; omits jsonValue and exposes no raw GraphQL input or writes.',
    auditEvent: 'custom_data.metaobjects.get',
    surfaces: { mcp: { toolName: 'shopify.metaobjects.get', description: 'Get one metaobject by GID with schema-aware field summaries and no raw values.', inputSchema: METAOBJECTS_GET_SCHEMA } },
  },
];

export const CAPABILITY_MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = CAPABILITY_REGISTRY.flatMap((capability) => {
  if (capability.surfaces.mcp === undefined) {
    return [];
  }
  return [{
    name: capability.surfaces.mcp.toolName,
    description: capability.surfaces.mcp.description,
    inputSchema: capability.surfaces.mcp.inputSchema,
  }];
});

export function listCapabilities(): readonly CapabilityDefinition[] {
  return CAPABILITY_REGISTRY;
}

export function getCapabilityByMcpToolName(toolName: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY.find((capability) => capability.surfaces.mcp?.toolName === toolName);
}

export function validateCapabilityRegistry(registry: readonly CapabilityDefinition[]): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const mcpToolNames = new Set<string>();

  for (const capability of registry) {
    if (ids.has(capability.id)) {
      errors.push(`${capability.id} is duplicated in the capability registry.`);
    }
    ids.add(capability.id);

    const mcp = capability.surfaces.mcp;
    if (mcp === undefined) {
      continue;
    }

    if (mcpToolNames.has(mcp.toolName)) {
      errors.push(`${mcp.toolName} is exposed by more than one capability.`);
    }
    mcpToolNames.add(mcp.toolName);

    if (/raw[_-]?graphql|mutation/iu.test(mcp.toolName) || /raw[_-]?graphql|mutation/iu.test(mcp.description)) {
      errors.push(`${capability.id} exposes a raw GraphQL or mutation-like MCP surface.`);
    }

    if (capability.access === 'write' && !hasRequiredWriteGates(capability.requiredGates ?? [])) {
      errors.push(`${capability.id} exposes a write MCP tool without required gates.`);
    }
  }

  return errors;
}

function hasRequiredWriteGates(gates: readonly CapabilityRequiredGate[]): boolean {
  return gates.includes('dry_run')
    && gates.includes('explicit_confirmation')
    && gates.includes('audit_logging')
    && gates.includes('rollback_notes');
}
