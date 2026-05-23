import { describe, expect, it } from 'vitest';

import {
  formatInventoryReport,
  generateInventoryReport,
  INVENTORY_REPORT_QUERY,
  type InventoryReportGraphqlClient,
  type InventoryReportRow,
} from '../src/reports/inventory.js';

describe('inventory report service', () => {
  it('paginates products and maps product, variant, inventory item, multi-location quantities, and low-stock flags', async () => {
    const calls: { readonly after: string | null; readonly first: number }[] = [];
    const client: InventoryReportGraphqlClient = {
      query: (_query, variables) => {
        calls.push({ after: variables.after, first: variables.first });
        if (variables.after === null) {
          return Promise.resolve({
            data: {
              products: {
                edges: [{ cursor: 'cursor-1', node: inventoryProductNode() }],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          });
        }

        return Promise.resolve({
          data: {
            products: {
              edges: [{ cursor: 'cursor-2', node: inventoryProductNode({ id: 'gid://shopify/Product/1002', title: 'B Mug', variantId: 'gid://shopify/ProductVariant/2002', variantTitle: 'Default Title', sku: null, inventoryItemId: 'gid://shopify/InventoryItem/3002', inventoryLevels: { edges: [{ node: { location: { name: 'Main Warehouse' }, quantities: [{ name: 'available', quantity: 9 }] } }] } }) }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-2' },
            },
          },
        });
      },
    };

    await expect(generateInventoryReport({ client, lowStockThreshold: 5 })).resolves.toEqual({
      lowStockThreshold: 5,
      rows: [
        {
          productGid: 'gid://shopify/Product/1001',
          productId: '1001',
          productTitle: 'A Shirt',
          variantGid: 'gid://shopify/ProductVariant/2001',
          variantId: '2001',
          variantTitle: 'Red / S',
          sku: 'SKU-RED-S',
          inventoryItemGid: 'gid://shopify/InventoryItem/3001',
          inventoryItemId: '3001',
          locationName: 'Main Warehouse',
          available: 3,
          onHand: 7,
          committed: 4,
          lowStock: true,
        },
        expect.objectContaining({
          locationName: 'Retail Store',
          available: 12,
          onHand: 12,
          committed: 0,
          lowStock: false,
        }),
        expect.objectContaining({
          productGid: 'gid://shopify/Product/1002',
          variantGid: 'gid://shopify/ProductVariant/2002',
          sku: '',
          inventoryItemGid: 'gid://shopify/InventoryItem/3002',
          locationName: 'Main Warehouse',
          available: 9,
          lowStock: false,
        }),
      ],
    });
    expect(calls).toEqual([{ after: null, first: 50 }, { after: 'cursor-1', first: 50 }]);
  });

  it('formats markdown, json, and csv deterministically including missing SKU and formula-safe cells', () => {
    const report = {
      lowStockThreshold: 5,
      rows: [
        inventoryRow({ productTitle: 'A | Shirt', available: 5, lowStock: true }),
        inventoryRow({ productGid: 'gid://shopify/Product/1002', productId: '1002', productTitle: ' =1+1', variantGid: 'gid://shopify/ProductVariant/2002', variantId: '2002', variantTitle: '\t=Variant', sku: ' +SKU', inventoryItemGid: 'gid://shopify/InventoryItem/3002', inventoryItemId: '3002', locationName: '\tRetail', available: null, onHand: null, committed: null, lowStock: false }),
      ],
    };

    expect(formatInventoryReport(report, 'markdown')).toBe([
      '| Product ID | Product GID | Product | Variant ID | Variant GID | Variant | SKU | Inventory Item GID | Location | Available | On Hand | Committed | Low Stock |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
      '| 1001 | gid://shopify/Product/1001 | A \\| Shirt | 2001 | gid://shopify/ProductVariant/2001 | Red / S | SKU-RED-S | gid://shopify/InventoryItem/3001 | Main Warehouse | 5 | 7 | 2 | yes |',
      '| 1002 | gid://shopify/Product/1002 |  =1+1 | 2002 | gid://shopify/ProductVariant/2002 | \\t=Variant |  +SKU | gid://shopify/InventoryItem/3002 | \\tRetail |  |  |  | no |',
    ].join('\n'));
    expect(formatInventoryReport(report, 'json')).toBe(JSON.stringify(report, null, 2));
    expect(formatInventoryReport(report, 'csv')).toBe([
      'productId,productGid,productTitle,variantId,variantGid,variantTitle,sku,inventoryItemGid,locationName,available,onHand,committed,lowStock',
      '"1001","gid://shopify/Product/1001","A | Shirt","2001","gid://shopify/ProductVariant/2001","Red / S","SKU-RED-S","gid://shopify/InventoryItem/3001","Main Warehouse","5","7","2","true"',
      '"1002","gid://shopify/Product/1002","\' =1+1","2002","gid://shopify/ProductVariant/2002","\'\\t=Variant","\' +SKU","gid://shopify/InventoryItem/3002","\'\\tRetail","","","","false"',
    ].join('\n'));
  });

  it('handles quantity maps and missing quantity values without low-stock false positives', async () => {
    const client: InventoryReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          products: {
            edges: [{
              cursor: 'cursor-1',
              node: inventoryProductNode({
                inventoryLevels: {
                  edges: [{
                    node: {
                      location: { name: 'No Quantity Location' },
                      available: undefined,
                      quantities: [{ name: 'on_hand', quantity: 8 }, { name: 'committed', quantity: 2 }],
                    },
                  }],
                },
              }),
            }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateInventoryReport({ client, lowStockThreshold: 5 })).resolves.toEqual(expect.objectContaining({
      rows: [expect.objectContaining({ available: null, onHand: 8, committed: 2, lowStock: false })],
    }));
  });

  it('fails safely with GID-only product context instead of silently truncating products with more than 100 variants', async () => {
    const product = inventoryProductNode({ title: 'Sensitive Shirt \u0000 Drop' });
    const variants = product.variants as { readonly edges: readonly unknown[]; readonly pageInfo?: unknown };
    const client: InventoryReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          products: {
            edges: [{
              cursor: 'cursor-1',
              node: { ...product, variants: { ...variants, pageInfo: { hasNextPage: true, endCursor: 'variant-cursor-1' } } },
            }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateInventoryReport({ client })).rejects.toThrow(
      'Shopify Admin GraphQL variants connection was truncated for product gid://shopify/Product/1001. v0.1 inventory reports support at most 100 variants per product.',
    );
    await expect(generateInventoryReport({ client })).rejects.not.toThrow('Sensitive Shirt');
  });

  it('fails safely with GID-only product and variant context instead of silently truncating more than 50 inventory levels', async () => {
    const client: InventoryReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          products: {
            edges: [{
              cursor: 'cursor-1',
              node: inventoryProductNode({
                title: 'Sensitive Shirt \u0000 Drop',
                inventoryLevels: {
                  edges: [{ node: { location: { name: 'Main Warehouse' }, quantities: [{ name: 'available', quantity: 3 }] } }],
                  pageInfo: { hasNextPage: true, endCursor: 'level-cursor-1' },
                },
              }),
            }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateInventoryReport({ client })).rejects.toThrow(
      'Shopify Admin GraphQL inventory levels connection was truncated for product gid://shopify/Product/1001, variant gid://shopify/ProductVariant/2001, inventory item gid://shopify/InventoryItem/3001. v0.1 inventory reports support at most 50 inventory levels per variant.',
    );
    await expect(generateInventoryReport({ client })).rejects.not.toThrow('Sensitive Shirt');
  });

  it.each([
    ['product', (node: unknown) => node, 'invalid product node'],
    ['variant', (node: unknown) => inventoryProductNode({ variantNode: node }), 'invalid variant node'],
    ['inventory level', (node: unknown) => inventoryProductNode({ inventoryLevels: { edges: [{ node }] } }), 'invalid inventory level node'],
  ] as const)('rejects non-plain inventory %s nodes before reading report fields', async (_name, buildNode, errorDetail) => {
    class InventoryNode {
      public readonly id = 'gid://shopify/Product/1001';
    }

    const invalidNodes = [
      new Date('2026-01-02T03:04:05.000Z'),
      new Map([['id', 'gid://shopify/Product/1001']]),
      [],
      null,
      new InventoryNode(),
    ];

    for (const invalidNode of invalidNodes) {
      const client: InventoryReportGraphqlClient = {
        query: () => Promise.resolve({
          data: {
            products: {
              edges: [{ cursor: 'cursor-1', node: buildNode(invalidNode) }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
            },
          },
        }),
      };

      await expect(generateInventoryReport({ client })).rejects.toThrow(
        `Shopify Admin GraphQL response included an ${errorDetail}.`,
      );
    }
  });

  it('fails safely for repeated cursors, max pages, and invalid page sizes/thresholds', async () => {
    const repeated: InventoryReportGraphqlClient = {
      query: () => Promise.resolve({ data: { products: { edges: [{ cursor: 'cursor-1', node: inventoryProductNode() }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } }),
    };
    await expect(generateInventoryReport({ client: repeated })).rejects.toThrow('Shopify Admin GraphQL products pagination did not advance.');

    const empty: InventoryReportGraphqlClient = {
      query: () => Promise.resolve({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }),
    };
    await expect(generateInventoryReport({ client: empty, pageSize: 0 })).rejects.toThrow('Inventory report page size must be an integer between 1 and 250.');
    await expect(generateInventoryReport({ client: empty, lowStockThreshold: -1 })).rejects.toThrow('Inventory report low-stock threshold must be a non-negative integer.');

    let page = 0;
    const advancing: InventoryReportGraphqlClient = {
      query: () => {
        page += 1;
        const pageString = page.toString(10);
        return Promise.resolve({ data: { products: { edges: [{ cursor: `cursor-${pageString}`, node: inventoryProductNode() }], pageInfo: { hasNextPage: true, endCursor: `cursor-${pageString}` } } } });
      },
    };
    await expect(generateInventoryReport({ client: advancing, maxPages: 1 })).rejects.toThrow('Shopify Admin GraphQL products pagination exceeded the maximum page count.');
  });

  it('uses read-only product variant inventory item inventory level fields', () => {
    expect(INVENTORY_REPORT_QUERY).toContain('products(');
    expect(INVENTORY_REPORT_QUERY).toContain('inventoryItem');
    expect(INVENTORY_REPORT_QUERY).toContain('inventoryLevels');
    expect(INVENTORY_REPORT_QUERY).toContain('quantities(names: ["available", "on_hand", "committed"])');
    expect(INVENTORY_REPORT_QUERY).toContain('pageInfo');
    expect(INVENTORY_REPORT_QUERY).not.toMatch(/^\s+available\s*$/mu);
    expect(INVENTORY_REPORT_QUERY).not.toMatch(/^\s+onHand\s*$/mu);
    expect(INVENTORY_REPORT_QUERY).not.toMatch(/^\s+committed\s*$/mu);
    expect(INVENTORY_REPORT_QUERY).not.toContain('mutation');
  });
});

function inventoryRow(overrides: Partial<InventoryReportRow> = {}) {
  return { ...inventoryRowBase(), ...overrides };
}

function inventoryRowBase() {
  return {
    productGid: 'gid://shopify/Product/1001',
    productId: '1001',
    productTitle: 'A Shirt',
    variantGid: 'gid://shopify/ProductVariant/2001',
    variantId: '2001',
    variantTitle: 'Red / S',
    sku: 'SKU-RED-S',
    inventoryItemGid: 'gid://shopify/InventoryItem/3001',
    inventoryItemId: '3001',
    locationName: 'Main Warehouse',
    available: 5,
    onHand: 7,
    committed: 2,
    lowStock: true,
  };
}

function inventoryProductNode(overrides: Partial<{
  readonly id: string;
  readonly title: string;
  readonly variantId: string;
  readonly variantTitle: string;
  readonly sku: string | null;
  readonly inventoryItemId: string;
  readonly available: number;
  readonly inventoryLevels: unknown;
  readonly variantNode: unknown;
}> = {}) {
  const variantNode = Object.hasOwn(overrides, 'variantNode')
    ? overrides.variantNode
    : {
      id: overrides.variantId ?? 'gid://shopify/ProductVariant/2001',
      title: overrides.variantTitle ?? 'Red / S',
      sku: Object.hasOwn(overrides, 'sku') ? overrides.sku : 'SKU-RED-S',
      inventoryItem: {
        id: overrides.inventoryItemId ?? 'gid://shopify/InventoryItem/3001',
        inventoryLevels: overrides.inventoryLevels ?? {
          edges: [
            { node: { location: { name: 'Main Warehouse' }, quantities: [{ name: 'available', quantity: overrides.available ?? 3 }, { name: 'on_hand', quantity: 7 }, { name: 'committed', quantity: 4 }] } },
            { node: { location: { name: 'Retail Store' }, available: 12, onHand: 12, committed: 0 } },
          ],
          pageInfo: { hasNextPage: false, endCursor: 'level-cursor-1' },
        },
      },
    };

  return {
    id: overrides.id ?? 'gid://shopify/Product/1001',
    title: overrides.title ?? 'A Shirt',
    variants: {
      edges: [{
        node: variantNode,
      }],
      pageInfo: { hasNextPage: false, endCursor: 'variant-cursor-1' },
    },
  };
}
