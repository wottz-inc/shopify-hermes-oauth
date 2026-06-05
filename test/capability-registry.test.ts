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
      'orders.get.read',
      'customers.list.read',
      'customers.get.read',
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

    expect(expectCapability('orders.get.read')).toMatchObject({
      domain: 'orders',
      operationName: 'OrderDetail',
      requiredScopes: ['read_orders'],
      access: 'read',
      riskLevel: 'read_pii',
      auditEvent: 'orders.get',
      surfaces: { mcp: { toolName: 'shopify.orders.get' } },
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
