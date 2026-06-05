export type CapabilityAccess = 'read' | 'write' | 'diagnostic';
export type CapabilityRiskLevel = 'read_low' | 'read_pii' | 'read_financial' | 'write_medium' | 'write_high' | 'protected_data' | 'diagnostic_low';
export type CapabilityDomain = 'mcp' | 'shops' | 'reports' | 'webhooks' | 'customers' | 'products' | 'collections';
export type CapabilityRequiredGate = 'dry_run' | 'explicit_confirmation' | 'audit_logging' | 'rollback_notes';

export type McpToolName =
  | 'shopify.health'
  | 'shopify.list_shops'
  | 'shopify.verify_shop'
  | 'shopify.report_products'
  | 'shopify.report_orders'
  | 'shopify.report_inventory'
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
  | 'shopify.collections.get';

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
