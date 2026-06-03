import { describe, expect, it } from 'vitest';

import {
  formatProductsReport,
  generateProductsReport,
  PRODUCTS_REPORT_QUERY,
  type ProductsReportGraphqlClient,
} from '../src/reports/products.js';

describe('products report service', () => {
  it('paginates products and maps report fields deterministically', async () => {
    const calls: { readonly after: string | null }[] = [];
    const client: ProductsReportGraphqlClient = {
      query: (_query, variables) => {
        calls.push({ after: variables.after });
        if (variables.after === null) {
          return Promise.resolve({
            data: {
              products: {
                edges: [{ cursor: 'cursor-1', node: productNode({ id: 'gid://shopify/Product/1001', title: 'A Shirt', handle: 'a-shirt', totalInventory: 7 }) }],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          });
        }

        return Promise.resolve({
          data: {
            products: {
              edges: [{ cursor: 'cursor-2', node: productNode({ id: 'gid://shopify/Product/1002', title: 'B Mug', handle: 'b-mug', status: 'DRAFT', vendor: 'Acme', productType: 'Drinkware', totalInventory: null }) }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-2' },
            },
          },
        });
      },
    };

    await expect(generateProductsReport({ client })).resolves.toEqual({
      products: [
        {
          gid: 'gid://shopify/Product/1001',
          id: '1001',
          title: 'A Shirt',
          handle: 'a-shirt',
          status: 'ACTIVE',
          vendor: 'Example Vendor',
          productType: 'Apparel',
          totalInventory: 7,
          variantsSummary: '2 variants: Red / S (sku=SKU-RED-S, inventory=3); Blue / M (sku=SKU-BLUE-M, inventory=4)',
        },
        {
          gid: 'gid://shopify/Product/1002',
          id: '1002',
          title: 'B Mug',
          handle: 'b-mug',
          status: 'DRAFT',
          vendor: 'Acme',
          productType: 'Drinkware',
          totalInventory: null,
          variantsSummary: '2 variants: Red / S (sku=SKU-RED-S, inventory=3); Blue / M (sku=SKU-BLUE-M, inventory=4)',
        },
      ],
    });
    expect(calls).toEqual([{ after: null }, { after: 'cursor-1' }]);
  });

  it('passes the ProductsReport operation name with each query', async () => {
    const operationNames: unknown[] = [];
    const client: ProductsReportGraphqlClient = {
      query: (_query, _variables, options) => {
        operationNames.push(options?.operationName);
        return Promise.resolve({
          data: {
            products: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      },
    };

    await generateProductsReport({ client });

    expect(operationNames).toEqual(['ProductsReport']);
  });

  it('formats markdown, json, and csv without nondeterministic fields', () => {
    const report = {
      products: [
        {
          gid: 'gid://shopify/Product/1001',
          id: '1001',
          title: 'A | Shirt',
          handle: 'a-shirt',
          status: 'ACTIVE',
          vendor: 'Example Vendor',
          productType: 'Apparel',
          totalInventory: 7,
          variantsSummary: '1 variant: Red / S (sku=SKU-RED-S, inventory=7)',
        },
      ],
    };

    expect(formatProductsReport(report, 'markdown')).toBe([
      '| ID | GID | Title | Handle | Status | Vendor | Type | Inventory | Variants |',
      '| --- | --- | --- | --- | --- | --- | --- | ---: | --- |',
      '| 1001 | gid://shopify/Product/1001 | A \\| Shirt | a-shirt | ACTIVE | Example Vendor | Apparel | 7 | 1 variant: Red / S (sku=SKU-RED-S, inventory=7) |',
    ].join('\n'));
    expect(formatProductsReport(report, 'json')).toBe(JSON.stringify(report, null, 2));
    expect(formatProductsReport(report, 'csv')).toBe([
      'id,gid,title,handle,status,vendor,productType,totalInventory,variantsSummary',
      '"1001","gid://shopify/Product/1001","A | Shirt","a-shirt","ACTIVE","Example Vendor","Apparel","7","1 variant: Red / S (sku=SKU-RED-S, inventory=7)"',
    ].join('\n'));
  });

  it('fails safely when product pagination returns a repeated cursor', async () => {
    const client: ProductsReportGraphqlClient = {
      query: (_query, variables) => Promise.resolve({
        data: {
          products: {
            edges: [{ cursor: variables.after ?? 'cursor-1', node: productNode() }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateProductsReport({ client })).rejects.toThrow(
      'Shopify Admin GraphQL products pagination did not advance.',
    );
  });

  it('fails safely when product pagination exceeds the maximum page count', async () => {
    let page = 0;
    const client: ProductsReportGraphqlClient = {
      query: () => {
        page += 1;

        const pageString = page.toString(10);

        return Promise.resolve({
          data: {
            products: {
              edges: [{ cursor: `cursor-${pageString}`, node: productNode({ id: `gid://shopify/Product/${pageString}` }) }],
              pageInfo: { hasNextPage: true, endCursor: `cursor-${pageString}` },
            },
          },
        });
      },
    };

    await expect(generateProductsReport({ client, maxPages: 2 })).rejects.toThrow(
      'Shopify Admin GraphQL products pagination exceeded the maximum page count.',
    );
  });

  it('requests up to 100 variants and explicitly marks products with more than 100 variants as truncated', async () => {
    expect(PRODUCTS_REPORT_QUERY).toContain('pageInfo');
    expect(PRODUCTS_REPORT_QUERY).toContain('hasNextPage');
    expect(PRODUCTS_REPORT_QUERY).toContain('variants(first: 100)');
    const variantEdges = Array.from({ length: 100 }, (_, index) => ({
      node: { title: `Variant ${(index + 1).toString(10)}`, sku: `SKU-${(index + 1).toString(10)}`, inventoryQuantity: index + 1 },
    }));

    const client: ProductsReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          products: {
            edges: [{
              cursor: 'cursor-1',
              node: productNode({
                variants: {
                  edges: variantEdges,
                  pageInfo: { hasNextPage: true },
                },
              }),
            }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    const report = await generateProductsReport({ client });
    expect(report.products[0]?.variantsSummary).toContain('Showing first 100 variants; additional variants omitted');
  });

  it('uses clear wording when a truncated variants connection has no shown variants', async () => {
    const client: ProductsReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          products: {
            edges: [{
              cursor: 'cursor-1',
              node: productNode({ variants: { edges: [], pageInfo: { hasNextPage: true } } }),
            }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateProductsReport({ client })).resolves.toEqual(expect.objectContaining({
      products: [expect.objectContaining({ variantsSummary: 'No variants shown; additional variants omitted: …' })],
    }));
  });

  it('rejects non-plain product nodes before reading report fields', async () => {
    class ProductNode {
      public readonly id = 'gid://shopify/Product/1001';
      public readonly title = 'A Shirt';
      public readonly handle = 'a-shirt';
      public readonly status = 'ACTIVE';
      public readonly vendor = 'Example Vendor';
      public readonly productType = 'Apparel';
      public readonly totalInventory = 7;
      public readonly variants = { edges: [], pageInfo: { hasNextPage: false } };
    }

    const invalidNodes = [
      new Date('2026-01-02T03:04:05.000Z'),
      new Map([['id', 'gid://shopify/Product/1001']]),
      [],
      null,
      new ProductNode(),
    ];

    for (const node of invalidNodes) {
      const client: ProductsReportGraphqlClient = {
        query: () => Promise.resolve({
          data: {
            products: {
              edges: [{ cursor: 'cursor-1', node }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
            },
          },
        }),
      };

      await expect(generateProductsReport({ client })).rejects.toThrow('Shopify Admin GraphQL response included an invalid product node.');
    }
  });

  it('neutralizes CSV spreadsheet formula injection cells', () => {
    const report = {
      products: [
        {
          gid: 'gid://shopify/Product/1001',
          id: ' =1+1',
          title: '\t=1+1',
          handle: ' +SUM(A1:A2)',
          status: '@ACTIVE',
          vendor: '\tTabbed Vendor',
          productType: '\rCarriage Type',
          totalInventory: null,
          variantsSummary: '\nVariant (sku==SKU, inventory=1)',
        },
      ],
    };

    expect(formatProductsReport(report, 'csv')).toBe([
      'id,gid,title,handle,status,vendor,productType,totalInventory,variantsSummary',
      '"\' =1+1","gid://shopify/Product/1001","\'\\t=1+1","\' +SUM(A1:A2)","\'@ACTIVE","\'\\tTabbed Vendor","\'\\rCarriage Type","","\'\\nVariant (sku==SKU, inventory=1)"',
    ].join('\n'));
  });

  it('rejects invalid product page sizes', async () => {
    const client: ProductsReportGraphqlClient = {
      query: () => Promise.resolve({ data: { products: { edges: [], pageInfo: { hasNextPage: false } } } }),
    };

    await expect(generateProductsReport({ client, pageSize: 0 })).rejects.toThrow(
      'Products report page size must be an integer between 1 and 250.',
    );
    await expect(generateProductsReport({ client, pageSize: 251 })).rejects.toThrow(
      'Products report page size must be an integer between 1 and 250.',
    );
  });
});

function productNode(overrides: Partial<{
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly status: string;
  readonly vendor: string;
  readonly productType: string;
  readonly totalInventory: number | null;
  readonly variants: unknown;
}> = {}) {
  return {
    id: overrides.id ?? 'gid://shopify/Product/1001',
    title: overrides.title ?? 'A Shirt',
    handle: overrides.handle ?? 'a-shirt',
    status: overrides.status ?? 'ACTIVE',
    vendor: overrides.vendor ?? 'Example Vendor',
    productType: overrides.productType ?? 'Apparel',
    totalInventory: Object.hasOwn(overrides, 'totalInventory') ? (overrides.totalInventory ?? null) : 7,
    variants: overrides.variants ?? {
      edges: [
        { node: { title: 'Red / S', sku: 'SKU-RED-S', inventoryQuantity: 3 } },
        { node: { title: 'Blue / M', sku: 'SKU-BLUE-M', inventoryQuantity: 4 } },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
}
