import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_REGISTRY,
  getCapabilityByMcpToolName,
  listCapabilities,
  validateCapabilityRegistry,
  type CapabilityDefinition,
} from '../src/capabilities.js';
import { listTools } from '../src/mcp/server.js';

function expectCapability(id: string): CapabilityDefinition {
  const capability = CAPABILITY_REGISTRY.find((entry) => entry.id === id);
  expect(capability).toBeDefined();
  if (capability === undefined) {
    throw new Error(`Missing capability: ${id}`);
  }
  return capability;
}

describe('Admin Graph capability registry and tool policy model', () => {
  it('represents the existing curated MCP tools and reports with policy metadata', () => {
    expect(listCapabilities().map((capability) => capability.id)).toEqual([
      'mcp.health.read',
      'shops.list.read',
      'shops.verify.read',
      'shops.store_diagnostics.read',
      'online_store.summary.read',
      'reports.products.read',
      'reports.orders.read',
      'reports.inventory.read',
      'bulk.operations.read.start',
      'bulk.operations.read.status',
      'bulk.operations.read.result',
      'bulk.operations.read.cancel',
      'webhooks.list.read',
      'webhooks.get.read',
      'products.get.read',
      'collections.list.read',
      'collections.get.read',
      'locations.list.read',
      'locations.get.read',
      'inventory.items.get.read',
      'inventory.levels.list.read',
      'orders.get.read',
      'fulfillment.orders.list.read',
      'fulfillment.orders.get.read',
      'customers.list.read',
      'customers.get.read',
      'discounts.list.read',
      'discounts.get.read',
      'marketing.events.list.read',
      'localization.markets.list.read',
      'localization.locales.list.read',
      'custom_data.metafield_definitions.list.read',
      'custom_data.metafield_definitions.get.read',
      'custom_data.resource_metafields.list.read',
      'custom_data.metaobject_definitions.list.read',
      'custom_data.metaobject_definitions.get.read',
      'custom_data.metaobjects.list.read',
      'custom_data.metaobjects.get.read',
    ]);

    expect(expectCapability('shops.verify.read')).toMatchObject({
      domain: 'shops',
      operationName: 'ShopMetadata',
      requiredScopes: [],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'shops.verify',
      surfaces: {
        cli: { command: 'shopify-hermes-oauth shops verify <shop>' },
        mcp: { toolName: 'shopify.verify_shop' },
      },
    });

    const storeDiagnostics = expectCapability('shops.store_diagnostics.read');
    expect(storeDiagnostics).toMatchObject({
      domain: 'shops',
      operationName: 'StoreAppDiagnostics',
      requiredScopes: [],
      access: 'diagnostic',
      riskLevel: 'diagnostic_low',
      auditEvent: 'shops.diagnostics',
      surfaces: {
        cli: { command: 'shopify-hermes-oauth shops diagnostics <shop>' },
        mcp: { toolName: 'shopify.store.diagnostics' },
      },
    });
    expect(storeDiagnostics.pagination).toContain('optional policy presence query');
    expect(storeDiagnostics.pagination).toContain('no raw GraphQL input');

    const onlineStore = expectCapability('online_store.summary.read');
    expect(onlineStore).toMatchObject({
      domain: 'online_store',
      operationName: 'OnlineStoreSummary',
      requiredScopes: ['read_themes', 'read_content'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'online_store.summary',
      surfaces: { mcp: { toolName: 'shopify.online_store.summary' } },
    });
    expect(onlineStore.pagination).toContain('no raw GraphQL input');
    expect(onlineStore.pagination).toContain('no theme assets');
    expect(onlineStore.cost).toContain('documented limitations');

    const productsReport = expectCapability('reports.products.read');
    expect(productsReport).toMatchObject({
      domain: 'reports',
      operationName: 'ProductsReport',
      requiredScopes: ['read_products'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'reports.products',
      surfaces: {
        cli: { command: 'shopify-hermes-oauth report products <shop>' },
        mcp: { toolName: 'shopify.report_products' },
      },
    });
    expect(productsReport.pagination).toContain('products');
    expect(productsReport.cost).toContain('bounded');

    const inventoryReport = expectCapability('reports.inventory.read');
    expect(inventoryReport).toMatchObject({
      requiredScopes: ['read_products', 'read_inventory', 'read_locations'],
      riskLevel: 'read_low',
    });
    expect(inventoryReport.pagination).toContain('inventory levels');
    expect(inventoryReport.cost).toContain('MAX_COST_EXCEEDED');

    const bulkStart = expectCapability('bulk.operations.read.start');
    expect(bulkStart).toMatchObject({
      domain: 'reports',
      operationName: 'BulkOperationRunQuery',
      requiredScopes: ['read_products', 'read_orders', 'read_inventory', 'read_locations'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'bulk.start',
      surfaces: { mcp: { toolName: 'shopify.bulk.start' } },
    });
    expect(bulkStart.pagination).toContain('curated read-only template');
    expect(bulkStart.pagination).toContain('no arbitrary GraphQL input');
    expect(expectCapability('bulk.operations.read.result')).toMatchObject({
      operationName: 'BulkOperationResultPreview',
      surfaces: { mcp: { toolName: 'shopify.bulk.result' } },
    });
    expect(expectCapability('bulk.operations.read.cancel')).toMatchObject({
      operationName: 'BulkOperationCancel',
      access: 'read',
      surfaces: { mcp: { toolName: 'shopify.bulk.cancel' } },
    });

    const webhookList = expectCapability('webhooks.list.read');
    expect(webhookList).toMatchObject({
      domain: 'webhooks',
      operationName: 'WebhookSubscriptions',
      requiredScopes: ['read_webhooks'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'webhooks.list',
      surfaces: { mcp: { toolName: 'shopify.webhooks.list' } },
    });
    expect(webhookList.pagination).toContain('bounded page size');
    expect(webhookList.cost).toContain('bounded');

    expect(expectCapability('webhooks.get.read')).toMatchObject({
      domain: 'webhooks',
      operationName: 'WebhookSubscription',
      requiredScopes: ['read_webhooks'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'webhooks.get',
      surfaces: { mcp: { toolName: 'shopify.webhooks.get' } },
    });

    expect(expectCapability('products.get.read')).toMatchObject({
      domain: 'products',
      operationName: 'ProductDetail',
      requiredScopes: ['read_products'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'products.get',
      surfaces: { mcp: { toolName: 'shopify.products.get' } },
    });

    const collectionList = expectCapability('collections.list.read');
    expect(collectionList).toMatchObject({
      domain: 'collections',
      operationName: 'Collections',
      requiredScopes: ['read_products'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'collections.list',
      surfaces: { mcp: { toolName: 'shopify.collections.list' } },
    });
    expect(collectionList.pagination).toContain('1..50');
    expect(collectionList.cost).toContain('bounded');

    expect(expectCapability('collections.get.read')).toMatchObject({
      domain: 'collections',
      operationName: 'CollectionDetail',
      requiredScopes: ['read_products'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'collections.get',
      surfaces: { mcp: { toolName: 'shopify.collections.get' } },
    });

    const locationsList = expectCapability('locations.list.read');
    expect(locationsList).toMatchObject({
      domain: 'locations',
      operationName: 'Locations',
      requiredScopes: ['read_locations'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'locations.list',
      surfaces: { mcp: { toolName: 'shopify.locations.list' } },
    });
    expect(locationsList.pagination).toContain('1..50');
    expect(locationsList.cost).toContain('bounded');

    expect(expectCapability('locations.get.read')).toMatchObject({
      domain: 'locations',
      operationName: 'LocationDetail',
      requiredScopes: ['read_locations'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'locations.get',
      surfaces: { mcp: { toolName: 'shopify.locations.get' } },
    });

    expect(expectCapability('inventory.items.get.read')).toMatchObject({
      domain: 'inventory',
      operationName: 'InventoryItemDetail',
      requiredScopes: ['read_inventory'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'inventory.items.get',
      surfaces: { mcp: { toolName: 'shopify.inventory.items.get' } },
    });

    const inventoryLevelsList = expectCapability('inventory.levels.list.read');
    expect(inventoryLevelsList).toMatchObject({
      domain: 'inventory',
      operationName: 'InventoryLevels',
      requiredScopes: ['read_inventory', 'read_locations'],
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'inventory.levels.list',
      surfaces: { mcp: { toolName: 'shopify.inventory.levels.list' } },
    });
    expect(inventoryLevelsList.pagination).toContain('exactly one');
    expect(inventoryLevelsList.cost).toContain('single dimension');

    expect(expectCapability('orders.get.read')).toMatchObject({
      domain: 'orders',
      operationName: 'OrderDetail',
      requiredScopes: ['read_orders'],
      access: 'read',
      riskLevel: 'read_pii',
      auditEvent: 'orders.get',
      surfaces: { mcp: { toolName: 'shopify.orders.get' } },
    });

    const fulfillmentScopes = ['read_orders', 'read_merchant_managed_fulfillment_orders', 'read_assigned_fulfillment_orders', 'read_third_party_fulfillment_orders'];
    expect(expectCapability('fulfillment.orders.list.read')).toMatchObject({
      domain: 'fulfillment',
      operationName: 'FulfillmentOrdersByOrder',
      requiredScopes: fulfillmentScopes,
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'fulfillment.orders.list',
      surfaces: { mcp: { toolName: 'shopify.fulfillment_orders.list' } },
    });
    expect(expectCapability('fulfillment.orders.get.read')).toMatchObject({
      domain: 'fulfillment',
      operationName: 'FulfillmentOrderDetail',
      requiredScopes: fulfillmentScopes,
      access: 'read',
      riskLevel: 'read_low',
      auditEvent: 'fulfillment.orders.get',
      surfaces: { mcp: { toolName: 'shopify.fulfillment_orders.get' } },
    });

    const customerList = expectCapability('customers.list.read');
    expect(customerList).toMatchObject({
      domain: 'customers',
      operationName: 'Customers',
      requiredScopes: ['read_customers'],
      access: 'read',
      riskLevel: 'read_pii',
      auditEvent: 'customers.list',
      surfaces: { mcp: { toolName: 'shopify.customers.list' } },
    });
    expect(customerList.pagination).toContain('1..50');
    expect(customerList.cost).toContain('bounded');
    expect(customerList.surfaces.mcp?.inputSchema.additionalProperties).toBe(false);
    expect(customerList.surfaces.mcp?.inputSchema.properties).not.toHaveProperty('graphql');
    expect(customerList.surfaces.mcp?.inputSchema.properties).not.toHaveProperty('mutation');

    expect(expectCapability('customers.get.read')).toMatchObject({
      domain: 'customers',
      operationName: 'Customer',
      requiredScopes: ['read_customers'],
      access: 'read',
      riskLevel: 'read_pii',
      auditEvent: 'customers.get',
      surfaces: { mcp: { toolName: 'shopify.customers.get' } },
    });

    const discountsList = expectCapability('discounts.list.read');
    expect(discountsList).toMatchObject({
      domain: 'discounts',
      operationName: 'Discounts',
      requiredScopes: ['read_discounts'],
      access: 'read',
      riskLevel: 'read_financial',
      auditEvent: 'discounts.list',
      surfaces: { mcp: { toolName: 'shopify.discounts.list' } },
    });
    expect(discountsList.pagination).toContain('1..50');
    expect(discountsList.cost).toContain('codesCount only');
    expect(discountsList.cost).toContain('no raw GraphQL input');
    expect(discountsList.cost).toContain('individual codes');

    expect(expectCapability('discounts.get.read')).toMatchObject({
      domain: 'discounts',
      operationName: 'Discount',
      requiredScopes: ['read_discounts'],
      access: 'read',
      riskLevel: 'read_financial',
      auditEvent: 'discounts.get',
      surfaces: { mcp: { toolName: 'shopify.discounts.get' } },
    });

    const marketingEvents = expectCapability('marketing.events.list.read');
    expect(marketingEvents).toMatchObject({
      domain: 'marketing',
      operationName: 'MarketingEvents',
      requiredScopes: ['read_marketing_events'],
      access: 'read',
      riskLevel: 'read_financial',
      auditEvent: 'marketing.events.list',
      surfaces: { mcp: { toolName: 'shopify.marketing_events.list' } },
    });
    expect(marketingEvents.pagination).toContain('1..50');
    expect(marketingEvents.cost).toContain('redacts URL query strings');

    const metafieldDefinitions = expectCapability('custom_data.metafield_definitions.list.read');
    expect(metafieldDefinitions).toMatchObject({ domain: 'custom_data', operationName: 'MetafieldDefinitions', requiredScopes: ['read_products'], access: 'read', riskLevel: 'read_low', surfaces: { mcp: { toolName: 'shopify.metafield_definitions.list' } } });
    expect(metafieldDefinitions.pagination).toContain('ownerType');
    expect(metafieldDefinitions.pagination).toContain('namespace/key');
    expect(metafieldDefinitions.surfaces.mcp?.inputSchema.properties).not.toHaveProperty('graphql');
    expect(expectCapability('custom_data.metafield_definitions.get.read')).toMatchObject({ surfaces: { mcp: { toolName: 'shopify.metafield_definitions.get' } } });
    expect(expectCapability('custom_data.resource_metafields.list.read')).toMatchObject({ operationName: 'ResourceMetafields', surfaces: { mcp: { toolName: 'shopify.resource_metafields.list' } } });
    expect(expectCapability('custom_data.resource_metafields.list.read').cost).toContain('omits jsonValue');
    expect(expectCapability('custom_data.metaobject_definitions.list.read')).toMatchObject({ requiredScopes: ['read_metaobject_definitions'], surfaces: { mcp: { toolName: 'shopify.metaobject_definitions.list' } } });
    expect(expectCapability('custom_data.metaobject_definitions.get.read')).toMatchObject({ surfaces: { mcp: { toolName: 'shopify.metaobject_definitions.get' } } });
    expect(expectCapability('custom_data.metaobjects.list.read')).toMatchObject({ requiredScopes: ['read_metaobjects'], surfaces: { mcp: { toolName: 'shopify.metaobjects.list' } } });
    expect(expectCapability('custom_data.metaobjects.get.read')).toMatchObject({ surfaces: { mcp: { toolName: 'shopify.metaobjects.get' } } });
  });

  it('keeps MCP tool registration backed by the registry allowlist', () => {
    const registeredTools = listTools().map((tool) => tool.name);
    const registeredRegistryTools = CAPABILITY_REGISTRY.flatMap((capability) => capability.surfaces.mcp === undefined ? [] : [capability.surfaces.mcp.toolName]);

    expect(registeredTools).toEqual(registeredRegistryTools);
    for (const tool of listTools()) {
      const capability = getCapabilityByMcpToolName(tool.name);
      expect(capability).toBeDefined();
      expect(capability?.surfaces.mcp?.description).toBe(tool.description);
      expect(capability?.surfaces.mcp?.inputSchema).toEqual(tool.inputSchema);
    }
  });

  it('fails closed for unsafe policy drift and accidental write/raw GraphQL exposure', () => {
    expect(validateCapabilityRegistry(CAPABILITY_REGISTRY)).toEqual([]);
    expect(JSON.stringify(CAPABILITY_REGISTRY)).not.toMatch(/raw[_-]?graphql|mutation/iu);

    const unsafeWrite: CapabilityDefinition = {
      ...expectCapability('reports.products.read'),
      id: 'unsafe.products.write',
      access: 'write',
      requiredGates: [],
      surfaces: {
        mcp: {
          toolName: 'shopify.products.update' as never,
          description: 'Unsafe write tool.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    };

    expect(validateCapabilityRegistry([...CAPABILITY_REGISTRY, unsafeWrite])).toContain(
      'unsafe.products.write exposes a write MCP tool without required gates.',
    );
  });
});
