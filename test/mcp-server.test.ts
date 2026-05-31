import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { callTool, listTools, McpToolError, startStdioMcpServer, type McpServerDependencies } from '../src/mcp/server.js';
import { InventoryReportError } from '../src/reports/inventory.js';
import { ALLOWED_SHOP_METADATA } from '../src/shops/metadata.js';

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
    const auditEvents: unknown[] = [];
    const deps = { ...createDeps(), appendAuditEvent: (event: unknown) => { auditEvents.push(event); } };
    const result = await callTool('shopify.list_shops', {}, deps);
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
    const [shopSummary] = (result as { readonly shops: readonly { readonly metadata?: Record<string, string> }[] }).shops;
    expect(Object.keys(shopSummary?.metadata ?? {}).sort()).toEqual([...ALLOWED_SHOP_METADATA].sort());
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('shpat_never-print-me');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('metadata-token-must-not-leak');
    expect(serialized).not.toContain('metadata-bearer-must-not-leak');
    expect(auditEvents).toEqual([{
      action: 'mcp.tool',
      result: 'success',
      metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.list_shops' },
    }]);
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_never-print-me');
  });

  it('audits every public allowlisted MCP tool at least once with safe metadata', async () => {
    const auditEvents: unknown[] = [];
    const deps = { ...createDeps(), appendAuditEvent: (event: unknown) => { auditEvents.push(event); } };

    await expect(callTool('shopify.list_shops', {}, deps)).resolves.toMatchObject({ shops: [{ shop: 'alpha.myshopify.com' }] });
    await expect(callTool('shopify.verify_shop', { shop: 'alpha.myshopify.com' }, deps)).resolves.toMatchObject({ shop: 'alpha.myshopify.com' });
    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', format: 'json' }, deps)).resolves.toMatchObject({ shop: 'alpha.myshopify.com', format: 'json' });
    await expect(callTool('shopify.report_orders', { shop: 'alpha.myshopify.com', since: '30d' }, deps)).resolves.toMatchObject({ shop: 'alpha.myshopify.com', format: 'markdown' });
    await expect(callTool('shopify.report_inventory', { shop: 'alpha.myshopify.com', lowStockThreshold: 7 }, deps)).resolves.toMatchObject({
      shop: 'alpha.myshopify.com',
      lowStockThreshold: 7,
    });

    expect(auditEvents).toEqual([
      {
        action: 'mcp.tool',
        result: 'success',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.list_shops' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'success',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.verify_shop' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'success',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_products', format: 'json' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'success',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_orders', format: 'markdown' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'success',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_inventory', format: 'markdown', threshold: 7 },
      },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('SKU');
    expect(JSON.stringify(auditEvents)).not.toContain('inventoryItem');
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_never-print-me');
  });

  it('does not let MCP success audit failures mask tool results', async () => {
    const deps = {
      ...createDeps(),
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
    };

    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', format: 'json' }, deps)).resolves.toMatchObject({
      shop: 'alpha.myshopify.com',
      format: 'json',
    });
  });

  it('audits MCP tool failures without leaking dependency error details, row/order/customer details, or arguments with secrets', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
      reportProducts: () => {
        throw new Error('upstream failed with X-Shopify-Access-Token: shpat_never-print-me SKU-RED-S');
      },
      reportOrders: () => {
        throw new Error('truncated order gid://shopify/Order/2001 #1001 Ada Lovelace ada@example.test');
      },
    };

    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', format: 'json' }, deps)).rejects.toThrow('Tool call failed.');
    await expect(callTool('shopify.report_orders', { shop: 'alpha.myshopify.com', format: 'json', since: '30d' }, deps)).rejects.toThrow('Tool call failed.');

    expect(auditEvents).toEqual([
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_products', format: 'json', reason: 'Tool call failed.' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_orders', format: 'json', reason: 'Tool call failed.' },
      },
    ]);
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain('shpat_never-print-me');
    expect(serializedAudit).not.toContain('X-Shopify-Access-Token');
    expect(serializedAudit).not.toContain('SKU-RED-S');
    expect(serializedAudit).not.toContain('gid://shopify/Order/2001');
    expect(serializedAudit).not.toContain('#1001');
    expect(serializedAudit).not.toContain('Ada Lovelace');
    expect(serializedAudit).not.toContain('ada@example.test');
  });

  it('surfaces inventory max query cost report errors as safe MCP tool failures with a remediation hint', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
      reportInventory: () => {
        throw new InventoryReportError('unsafe internal details shpat_never-print-me SKU-RED-S', 'MAX_COST_EXCEEDED');
      },
    };

    await expect(callTool('shopify.report_inventory', { shop: 'alpha.myshopify.com', format: 'json' }, deps)).rejects.toThrow(
      'Shopify rejected the inventory report because query cost exceeded its single-query limit. Retry with safer pagination; if it continues, reduce page size or contact support with issue #56.',
    );

    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).toContain('issue #56');
    expect(serializedAudit).not.toContain('shpat_never-print-me');
    expect(serializedAudit).not.toContain('SKU-RED-S');
  });

  it('does not let MCP failure audit failures mask original allowed-tool errors', async () => {
    const deps = {
      ...createDeps(),
      appendAuditEvent: () => {
        throw new Error('audit sink unavailable');
      },
      reportProducts: () => {
        throw new Error('upstream failed with X-Shopify-Access-Token: shpat_never-print-me');
      },
    };

    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com', access_token: 'shpat_secret' }, deps)).rejects.toThrow('Unknown argument: access_token.');
    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com' }, deps)).rejects.toThrow('Tool call failed.');
  });

  it('audits unknown and write-like MCP tool calls best-effort with safe metadata', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
    };

    await expect(callTool('shopify.raw_graphql', { shop: 'shpat_secret', query: 'mutation { productDelete { id } }' }, deps)).rejects.toThrow('Tool is not allowed.');
    await expect(callTool('shopify.delete_shop', { shop: 'alpha.myshopify.com', accessToken: 'shpat_secret' }, deps)).rejects.toThrow('Tool is not allowed.');

    expect(auditEvents).toEqual([
      {
        action: 'mcp.tool',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.raw_graphql', reason: 'Tool is not allowed.' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.delete_shop', reason: 'Tool is not allowed.' },
      },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_secret');
    expect(JSON.stringify(auditEvents)).not.toContain('mutation');
    expect(JSON.stringify(auditEvents)).not.toContain('accessToken');
  });

  it('redacts canonical generic authorization and token-like text from MCP failure audit metadata', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
      reportProducts: () => {
        const bearerPlaceholder = ['synthetic', 'bearer', 'placeholder'].join('-');
        throw new McpToolError(`dependency denied Authorization: Bearer ${bearerPlaceholder}`);
      },
    };
    const providerPlaceholder = ['xoxb', 'synthetic', 'placeholder'].join('-');
    const toolName = `shopify.${providerPlaceholder}`;

    await expect(callTool(toolName, {}, deps)).rejects.toThrow('Tool is not allowed.');
    await expect(callTool('shopify.report_products', { shop: 'alpha.myshopify.com' }, deps)).rejects.toThrow(McpToolError);

    const serializedAudit = JSON.stringify(auditEvents);
    expect(auditEvents).toEqual([
      {
        action: 'mcp.tool',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.[REDACTED]', reason: 'Tool is not allowed.' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_products', format: 'markdown', reason: 'Tool call failed.' },
      },
    ]);
    expect(serializedAudit).not.toContain(providerPlaceholder);
    expect(serializedAudit).not.toContain('synthetic-bearer-placeholder');
    expect(serializedAudit).not.toContain('Bearer synthetic');
  });

  it('redacts canonical generic authorization and token-like text from MCP JSON-RPC errors', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });
    const bearerPlaceholder = ['synthetic', 'bearer', 'placeholder'].join('-');
    const providerPlaceholder = ['ya29', 'synthetic', 'placeholder'].join('.');
    const deps = {
      ...createDeps(),
      reportProducts: () => {
        throw new McpToolError(`dependency denied Authorization: Bearer ${bearerPlaceholder}`);
      },
    };

    const server = startStdioMcpServer(deps, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shopify.report_products', arguments: { shop: 'alpha.myshopify.com' } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: `shopify.${providerPlaceholder}`, arguments: {} } })}\n`);
    input.end();
    await server;

    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Tool call failed.' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Tool is not allowed.' } },
    ]);
    const serializedLines = JSON.stringify(lines);
    expect(serializedLines).not.toContain(bearerPlaceholder);
    expect(serializedLines).not.toContain(providerPlaceholder);
    expect(serializedLines).not.toContain('Bearer synthetic');
  });

  it('returns and audits generic failures when dependencies throw McpToolError with internal non-token details', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    const auditEvents: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });
    const internalDetail = 'tenant=acme-corp customer=ada@example.test db=primary-writer shard=eu-7 trace=9f86d081';
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
      reportProducts: () => {
        throw new McpToolError(`dependency rejected request: ${internalDetail}`);
      },
    };

    const server = startStdioMcpServer(deps, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shopify.report_products', arguments: { shop: 'alpha.myshopify.com' } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'shopify.report_products', arguments: { shop: 'alpha.myshopify.com', internal: internalDetail } } })}\n`);
    input.end();
    await server;

    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Tool call failed.' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Unknown argument: internal.' } },
    ]);
    expect(auditEvents).toEqual([
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_products', format: 'markdown', reason: 'Tool call failed.' },
      },
      {
        action: 'mcp.tool',
        shop: 'alpha.myshopify.com',
        result: 'failure',
        metadata: { source: 'mcp', actor: 'mcp', mode: 'read-only', toolName: 'shopify.report_products', format: 'markdown', reason: 'Unknown argument: internal.' },
      },
    ]);
    const serialized = JSON.stringify({ lines, auditEvents });
    expect(serialized).not.toContain(internalDetail);
    expect(serialized).not.toContain('ada@example.test');
    expect(serialized).not.toContain('primary-writer');
    expect(serialized).not.toContain('eu-7');
  });

  it('marks over-boundary sanitized audit strings with an ellipsis only when truncated', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
    };
    const underBoundaryName = 'u'.repeat(199);
    const exactBoundaryName = 'e'.repeat(200);
    const overBoundaryName = 'o'.repeat(201);

    await expect(callTool(underBoundaryName, {}, deps)).rejects.toThrow('Tool is not allowed.');
    await expect(callTool(exactBoundaryName, {}, deps)).rejects.toThrow('Tool is not allowed.');
    await expect(callTool(overBoundaryName, {}, deps)).rejects.toThrow('Tool is not allowed.');

    expect(auditEvents.map((event) => (event as { metadata: { toolName: string } }).metadata.toolName)).toEqual([
      underBoundaryName,
      exactBoundaryName,
      `${'o'.repeat(199)}…`,
    ]);
  });

  it('preserves control-character sanitization and secret redaction when adding truncation ellipses', async () => {
    const auditEvents: unknown[] = [];
    const deps = {
      ...createDeps(),
      appendAuditEvent: (event: unknown) => { auditEvents.push(event); },
    };
    const secret = 'shpat_this-secret-must-not-leak';
    const name = `unsafe\nname\twith\r${secret} ${'x'.repeat(220)}`;

    await expect(callTool(name, {}, deps)).rejects.toThrow('Tool is not allowed.');

    const serializedAudit = JSON.stringify(auditEvents);
    const toolName = (auditEvents[0] as { metadata: { toolName: string } }).metadata.toolName;
    expect(toolName).toContain('unsafe name with [REDACTED]');
    expect(toolName).toHaveLength(200);
    expect(toolName.endsWith('…')).toBe(true);
    expect(serializedAudit).not.toContain(secret);
    expect(serializedAudit).not.toContain('shpat_');
    expect(serializedAudit).not.toContain('unsafe\\nname');
    expect(serializedAudit).not.toContain('unsafe\\tname');
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

  it.each([
    ['Date', new Date('2026-01-02T03:04:05.000Z')],
    ['Map', new Map([['shop', 'alpha.myshopify.com']])],
    ['array', []],
    ['null', null],
    ['class instance', new (class CustomArgs { public readonly shop = 'alpha.myshopify.com'; })()],
  ] as const)('rejects non-plain MCP arguments: %s', async (_name, args) => {
    await expect(callTool('shopify.list_shops', args, createDeps())).rejects.toThrow(McpToolError);
    await expect(callTool('shopify.verify_shop', args, createDeps())).rejects.toThrow(McpToolError);
    await expect(callTool('shopify.report_products', args, createDeps())).rejects.toThrow(McpToolError);
    await expect(callTool('shopify.report_orders', args, createDeps())).rejects.toThrow(McpToolError);
    await expect(callTool('shopify.report_inventory', args, createDeps())).rejects.toThrow(McpToolError);
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
    expect(lines[3]).toMatchObject({ jsonrpc: '2.0', id: 3, result: {
      content: [{ type: 'text', text: 'Tool result available in structuredContent (keys: shops).' }],
      structuredContent: {
        shops: [{
          shop: 'alpha.myshopify.com',
          scopes: ['read_products', 'read_orders'],
          storedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          metadata: { shopName: 'Alpha', currencyCode: 'USD', myshopifyDomain: 'alpha.myshopify.com' },
        }],
      },
    } });
    const toolResult = lines[3] as { result: { content: readonly [{ text: string }]; structuredContent: unknown } };
    const text = toolResult.result.content[0].text;
    expect(text).not.toBe(JSON.stringify(toolResult.result.structuredContent));
    expect(text).not.toContain('alpha.myshopify.com');
    expect(text).not.toContain('accessToken');
    expect(text).not.toContain('authorization');
    expect(JSON.stringify(lines[3])).not.toContain('shpat_never-print-me');
    expect(JSON.stringify(lines[3])).not.toContain('metadata-token-must-not-leak');
  });

  it('omits deeply nested token-like dependency keys from tools/call structured content and text', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });
    const deps = {
      ...createDeps(),
      reportProducts: () => ({
        safe: {
          nested: {
            accessToken: 'nested-access-token-must-not-leak',
            refresh_token: 'nested-refresh-token-must-not-leak',
            authorization: 'Bearer nested-authorization-must-not-leak',
            rows: [{ id: '1', apiToken: 'nested-array-token-must-not-leak', title: 'Tee' }],
          },
        },
      }),
    };

    const server = startStdioMcpServer(deps, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shopify.report_products', arguments: { shop: 'alpha.myshopify.com' } } })}\n`);
    input.end();
    await server;

    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, result: {
        content: [{ type: 'text', text: 'Tool result available in structuredContent (keys: safe).' }],
        structuredContent: { safe: { nested: { rows: [{ id: '1', title: 'Tee' }] } } },
      } },
    ]);
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('refresh_token');
    expect(serialized).not.toContain('apiToken');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('nested-access-token-must-not-leak');
    expect(serialized).not.toContain('nested-refresh-token-must-not-leak');
    expect(serialized).not.toContain('nested-array-token-must-not-leak');
    expect(serialized).not.toContain('nested-authorization-must-not-leak');
  });

  it('length-caps tools/call text summaries for maliciously large top-level keys', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });
    const hugeKey = `safe-${'x'.repeat(1_000)}`;
    const deps = {
      ...createDeps(),
      reportProducts: () => ({ [hugeKey]: true, second: true, third: true, fourth: true, fifth: true, sixth: true }),
    };

    const server = startStdioMcpServer(deps, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shopify.report_products', arguments: { shop: 'alpha.myshopify.com' } } })}\n`);
    input.end();
    await server;

    expect(lines).toHaveLength(1);
    const text = (lines[0] as { result: { content: readonly [{ text: string }] } }).result.content[0].text;
    expect(text).toBe(`Tool result available in structuredContent (keys: safe-${'x'.repeat(34)}…, second, third, fourth, fifth, …).`);
    expect(text).toHaveLength(125);
    expect(text).not.toContain(hugeKey);
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
