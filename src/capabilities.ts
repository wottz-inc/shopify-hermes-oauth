export type CapabilityAccess = 'read' | 'write' | 'diagnostic';
export type CapabilityRiskLevel = 'read_low' | 'read_pii' | 'read_financial' | 'write_medium' | 'write_high' | 'protected_data' | 'diagnostic_low';
export type CapabilityDomain = 'mcp' | 'shops' | 'reports';
export type CapabilityRequiredGate = 'dry_run' | 'explicit_confirmation' | 'audit_logging' | 'rollback_notes';

export type McpToolName =
  | 'shopify.health'
  | 'shopify.list_shops'
  | 'shopify.verify_shop'
  | 'shopify.report_products'
  | 'shopify.report_orders'
  | 'shopify.report_inventory';

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
