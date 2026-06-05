import { describe, expect, it } from 'vitest';

import {
  COLLECTION_DETAIL_QUERY,
  COLLECTIONS_QUERY,
  CatalogSurfaceError,
  PRODUCT_DETAIL_QUERY,
  getCollection,
  getProductDetail,
  listCollections,
} from '../src/catalog/details.js';

describe('product and collection Admin GraphQL helpers', () => {
  it('gets product details with bounded variants/media/metafield summaries', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            product: {
              id: 'gid://shopify/Product/1',
              title: 'T-Shirt',
              handle: 't-shirt',
              status: 'ACTIVE',
              vendor: 'Wottz',
              productType: 'Apparel',
              publishedAt: '2026-01-01T00:00:00Z',
              onlineStoreUrl: 'https://example.test/products/t-shirt',
              options: [{ name: 'Size', values: ['S', 'M'] }],
              variants: { edges: [{ node: { id: 'gid://shopify/ProductVariant/1', title: 'Small', sku: 'TS-S', price: '12.00', inventoryQuantity: 4 } }], pageInfo: { hasNextPage: true } },
              media: { edges: [{ node: { mediaContentType: 'IMAGE', alt: 'Front', status: 'READY', preview: { image: { url: 'https://cdn.example.test/front.jpg' } } } }], pageInfo: { hasNextPage: false } },
              metafields: { edges: [{ node: { namespace: 'custom', key: 'material', type: 'single_line_text_field', value: 'cotton' } }], pageInfo: { hasNextPage: false } },
            },
          },
        });
      },
    };

    await expect(getProductDetail({ client, id: 'gid://shopify/Product/1' })).resolves.toEqual({
      product: {
        id: 'gid://shopify/Product/1',
        title: 'T-Shirt',
        handle: 't-shirt',
        status: 'ACTIVE',
        vendor: 'Wottz',
        productType: 'Apparel',
        publishedAt: '2026-01-01T00:00:00Z',
        onlineStoreUrl: 'https://example.test/products/t-shirt',
        options: [{ name: 'Size', values: ['S', 'M'] }],
        variants: [{ id: 'gid://shopify/ProductVariant/1', title: 'Small', sku: 'TS-S', price: '12.00', inventoryQuantity: 4 }],
        variantsTruncated: true,
        media: [{ mediaContentType: 'IMAGE', alt: 'Front', status: 'READY', previewImageUrl: 'https://cdn.example.test/front.jpg' }],
        mediaTruncated: false,
        metafields: [{ namespace: 'custom', key: 'material', type: 'single_line_text_field', valuePresent: true, valueLength: 6 }],
        metafieldsTruncated: false,
      },
    });
    expect(queries).toEqual([{ query: PRODUCT_DETAIL_QUERY, variables: { id: 'gid://shopify/Product/1' }, options: { operationName: 'ProductDetail' } }]);
  });

  it('lists and gets collections with bounded product/metafield summaries', async () => {
    const listQueries: unknown[] = [];
    const listClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        listQueries.push({ query, variables, options });
        return Promise.resolve({
        data: {
          collections: {
            edges: [{ cursor: 'cursor-1', node: { id: 'gid://shopify/Collection/1', title: 'Summer', handle: 'summer', updatedAt: '2026-01-02T00:00:00Z', sortOrder: 'ALPHA_ASC' } }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      });
      },
    };
    await expect(listCollections({ client: listClient, first: 10, after: 'cursor-0', query: 'title:Summer' })).resolves.toEqual({
      collections: [{ id: 'gid://shopify/Collection/1', title: 'Summer', handle: 'summer', updatedAt: '2026-01-02T00:00:00Z', sortOrder: 'ALPHA_ASC' }],
      pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
    });
    expect(listQueries).toEqual([{ query: COLLECTIONS_QUERY, variables: { first: 10, after: 'cursor-0', query: 'title:Summer' }, options: { operationName: 'Collections' } }]);

    const getClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        expect({ query, variables, options }).toEqual({ query: COLLECTION_DETAIL_QUERY, variables: { id: 'gid://shopify/Collection/1' }, options: { operationName: 'CollectionDetail' } });
        return Promise.resolve({
          data: {
            collection: {
              id: 'gid://shopify/Collection/1',
              title: 'Summer',
              handle: 'summer',
              updatedAt: '2026-01-02T00:00:00Z',
              sortOrder: 'ALPHA_ASC',
              products: { edges: [{ node: { id: 'gid://shopify/Product/1', title: 'T-Shirt', handle: 't-shirt', status: 'ACTIVE' } }], pageInfo: { hasNextPage: true } },
              metafields: { edges: [{ node: { namespace: 'custom', key: 'season', type: 'single_line_text_field', value: 'summer' } }], pageInfo: { hasNextPage: false } },
            },
          },
        });
      },
    };
    await expect(getCollection({ client: getClient, id: 'gid://shopify/Collection/1' })).resolves.toEqual({
      collection: {
        id: 'gid://shopify/Collection/1',
        title: 'Summer',
        handle: 'summer',
        updatedAt: '2026-01-02T00:00:00Z',
        sortOrder: 'ALPHA_ASC',
        products: [{ id: 'gid://shopify/Product/1', title: 'T-Shirt', handle: 't-shirt', status: 'ACTIVE' }],
        productsTruncated: true,
        metafields: [{ namespace: 'custom', key: 'season', type: 'single_line_text_field', valuePresent: true, valueLength: 6 }],
        metafieldsTruncated: false,
      },
    });
  });

  it('rejects unsafe IDs, page sizes, and malformed responses safely', async () => {
    const client = { query: () => Promise.resolve({ data: { collections: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(getProductDetail({ client, id: 'gid://shopify/Order/1' })).rejects.toThrow('Product id must be a Shopify Product GID.');
    await expect(getCollection({ client, id: 'gid://shopify/Product/1' })).rejects.toThrow('Collection id must be a Shopify Collection GID.');
    await expect(listCollections({ client, first: 0 })).rejects.toThrow(CatalogSurfaceError);
    await expect(listCollections({ client, first: 51 })).rejects.toThrow('Collection page size must be an integer between 1 and 50.');
    await expect(getProductDetail({ client, id: 'gid://shopify/Product/1' })).rejects.toThrow(CatalogSurfaceError);
  });

  it('keeps the existing products report separate from lookup/detail queries', () => {
    expect(PRODUCT_DETAIL_QUERY).toContain('product(id: $id)');
    expect(PRODUCT_DETAIL_QUERY).toContain('variants(first: 25)');
    expect(PRODUCT_DETAIL_QUERY).toContain('media(first: 10)');
    expect(PRODUCT_DETAIL_QUERY).toContain('metafields(first: 20)');
    expect(COLLECTIONS_QUERY).toContain('collections(first: $first, after: $after, query: $query)');
  });
});
