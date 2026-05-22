import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { callTool, listTools, McpToolError, startStdioMcpServer, type McpServerDependencies } from '../src/mcp/server.js';

function createDeps(): McpServerDependencies {
  return {
    tokenStore: {
      listTokens: () => [
        {
          shop: 'alpha.myshopify.com',
          accessToken: 'shpat_never-print-me',
          scopes: ['read_products', 'read_orders'],
          storedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          metadata: {
            shopName: 'Alpha',
            currencyCode: 'USD',
            myshopifyDomain: 'alpha.myshopify.com',
            accessToken: 'metadata-token-must-not-leak',
            authorization: 'Bearer metadata-bearer-must-not-leak',
          },
        },
      ],
    },
    verifyShop: ({ shop }) => ({
      shop,
      metadata: { name: 'Alpha', myshopifyDomain: shop, currencyCode: 'USD' },
    }),
    reportProducts: ({ shop, format }) => ({
      shop,
      format,
      report: { products: [{ id: '1', title: 'Tee' }] },
      formatted: '# products',
    }),
    reportOrders: ({ shop, format, since, from, to }) => ({
      shop,
      format,
      since,
      from,
      to,
      report: { orders: [{ id: '10' }] },
      formatted: '# orders',
    }),
    reportInventory: ({ shop, format, lowStockThreshold }) => ({
      shop,
      format,
      lowStockThreshold,
      report: { rows: [{ sku: 'SKU', available: 3 }] },
      formatted: '# inventory',
    }),
  };
}

describe('curated MCP server', () => {
  it('lists the exact curated read-only Shopify tool allowlist', () => {
    expect(listTools().map((tool) => tool.name)).toEqual([
      'shopify.list_shops',
      'shopify.verify_shop',
      'shopify.report_products',
      'shopify.report_orders',
      'shopify.report_inventory',
    ]);
  });

  it('dispatches allowed tools to service dependencies with structured token-free outputs', async () => {
    const deps = createDeps();

    await expect(callTool('shopify.verify_shop', { shop: 'alpha.myshopify.com' }, deps)).resolves.toEqual({
      shop: 'alpha.myshopify.com',
      metadata: { name: 'Alpha', myshopifyDomain: 'alpha.myshopify.com', currencyCode: 'USD' },
    });
    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', format: 'json' }, deps)).resolves.toMatchObject({
      shop: 'alpha.myshopify.com',
      format: 'json',
      report: { products: [{ id: '1', title: 'Tee' }] },
    });
    await expect(callTool('shopify.report_orders', { shop: 'alpha.myshopify.com', since: '30d' }, deps)).resolves.toMatchObject({
      shop: 'alpha.myshopify.com',
      format: 'markdown',
      since: '30d',
      report: { orders: [{ id: '10' }] },
    });
    await expect(callTool('shopify.report_inventory', { shop: 'alpha.myshopify.com', lowStockThreshold: 7 }, deps)).resolves.toMatchObject({
      shop: 'alpha.myshopify.com',
      format: 'markdown',
      lowStockThreshold: 7,
      report: { rows: [{ sku: 'SKU', available: 3 }] },
    });
  });

  it('lists shops as metadata only and never returns token material', async () => {
    const result = await callTool('shopify.list_shops', {}, createDeps());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      shops: [
        {
          shop: 'alpha.myshopify.com',
          scopes: ['read_products', 'read_orders'],
          storedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          metadata: { shopName: 'Alpha', currencyCode: 'USD', myshopifyDomain: 'alpha.myshopify.com' },
        },
      ],
    });
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('shpat_never-print-me');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('metadata-token-must-not-leak');
    expect(serialized).not.toContain('metadata-bearer-must-not-leak');
  });

  it('rejects extra, raw GraphQL, mutation-looking, and unknown arguments per tool', async () => {
    const badArgs = [
      { query: '{ shop { name } }' },
      { mutation: 'mutation { productDelete(input: {}) { deletedProductId } }' },
      { graphql: 'query { shop { name } }' },
      { unknown: 'value' },
    ];

    for (const args of badArgs) {
      await expect(callTool('shopify.list_shops', args, createDeps())).rejects.toThrow(McpToolError);
      await expect(callTool('shopify.verify_shop', { shop: 'alpha.myshopify.com', ...args }, createDeps())).rejects.toThrow(McpToolError);
      await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', ...args }, createDeps())).rejects.toThrow(McpToolError);
      await expect(callTool('shopify.report_orders', { shop: 'alpha.myshopify.com', ...args }, createDeps())).rejects.toThrow(McpToolError);
      await expect(callTool('shopify.report_inventory', { shop: 'alpha.myshopify.com', ...args }, createDeps())).rejects.toThrow(McpToolError);
    }
  });

  it('serves lightweight stdio JSON-RPC requests and suppresses notifications', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });

    const server = startStdioMcpServer(createDeps(), { input, output });
    input.write('{bad-json\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'shopify.list_shops', arguments: {} } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' })}\n`);
    input.end();
    await server;

    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    expect(lines[1]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } });
    expect(lines[2]).toMatchObject({ jsonrpc: '2.0', id: 2, result: { tools: listTools() } });
    expect(lines[3]).toMatchObject({ jsonrpc: '2.0', id: 3, result: { structuredContent: {
      shops: [{
        shop: 'alpha.myshopify.com',
        scopes: ['read_products', 'read_orders'],
        storedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        metadata: { shopName: 'Alpha', currencyCode: 'USD', myshopifyDomain: 'alpha.myshopify.com' },
      }],
    } } });
  });

  it('fails safely for unknown, raw GraphQL, and write-like tool names', async () => {
    for (const name of ['shopify.raw_graphql', 'shopify.mutate_product', 'shopify.refund_order', 'shopify.delete_shop']) {
      await expect(callTool(name, {}, createDeps())).rejects.toThrow(McpToolError);
      await expect(callTool(name, {}, createDeps())).rejects.toThrow('Tool is not allowed.');
    }
  });

  it('does not expose token-bearing dependency errors', async () => {
    const deps = {
      ...createDeps(),
      reportProducts: () => {
        throw new Error('upstream failed with shpat_never-print-me');
      },
    };

    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com' }, deps)).rejects.toThrow('Tool call failed.');
    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com' }, deps)).rejects.not.toThrow('shpat_never-print-me');
  });
});
