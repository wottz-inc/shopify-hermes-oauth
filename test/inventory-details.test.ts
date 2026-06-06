import { describe, expect, it } from 'vitest';

import {
  INVENTORY_ITEM_DETAIL_QUERY,
  INVENTORY_LEVELS_BY_ITEM_QUERY,
  INVENTORY_LEVELS_BY_LOCATION_QUERY,
  LOCATION_DETAIL_QUERY,
  LOCATIONS_QUERY,
  InventoryDetailsError,
  getInventoryItem,
  getLocation,
  listInventoryLevels,
  listLocations,
} from '../src/inventory/details.js';

describe('location and inventory Admin GraphQL helpers', () => {
  it('lists and gets locations without address or contact fields', async () => {
    const listQueries: unknown[] = [];
    const listClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        listQueries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            locations: {
              edges: [{ cursor: 'cursor-1', node: { id: 'gid://shopify/Location/1', name: 'Main', isActive: true, fulfillsOnlineOrders: true, legacyResourceId: '1' } }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
            },
          },
        });
      },
    };

    await expect(listLocations({ client: listClient, first: 10, after: 'cursor-0' })).resolves.toEqual({
      locations: [{ id: 'gid://shopify/Location/1', name: 'Main', isActive: true, fulfillsOnlineOrders: true, legacyResourceId: '1' }],
      pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
    });
    expect(listQueries).toEqual([{ query: LOCATIONS_QUERY, variables: { first: 10, after: 'cursor-0' }, options: { operationName: 'Locations' } }]);

    const getClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        expect({ query, variables, options }).toEqual({ query: LOCATION_DETAIL_QUERY, variables: { id: 'gid://shopify/Location/1' }, options: { operationName: 'LocationDetail' } });
        return Promise.resolve({
          data: { location: { id: 'gid://shopify/Location/1', name: 'Main', isActive: true, fulfillsOnlineOrders: false, legacyResourceId: '1' } },
        });
      },
    };
    await expect(getLocation({ client: getClient, id: 'gid://shopify/Location/1' })).resolves.toEqual({
      location: { id: 'gid://shopify/Location/1', name: 'Main', isActive: true, fulfillsOnlineOrders: false, legacyResourceId: '1' },
    });

    expect(LOCATIONS_QUERY).not.toMatch(/address|phone|contact|metafields|inventoryAdjustment/iu);
    expect(LOCATION_DETAIL_QUERY).not.toMatch(/address|phone|contact|metafields|inventoryAdjustment/iu);
  });

  it('gets inventory item detail with normalized tracked and sku fields only', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            inventoryItem: {
              id: 'gid://shopify/InventoryItem/2',
              sku: 'ABC-123',
              tracked: true,
              requiresShipping: false,
              variant: { id: 'gid://shopify/ProductVariant/9', title: 'Small', product: { id: 'gid://shopify/Product/8', title: 'T-Shirt' } },
            },
          },
        });
      },
    };

    await expect(getInventoryItem({ client, id: 'gid://shopify/InventoryItem/2' })).resolves.toEqual({
      inventoryItem: {
        id: 'gid://shopify/InventoryItem/2',
        sku: 'ABC-123',
        tracked: true,
        requiresShipping: false,
        variant: { id: 'gid://shopify/ProductVariant/9', title: 'Small', product: { id: 'gid://shopify/Product/8', title: 'T-Shirt' } },
      },
    });
    expect(queries).toEqual([{ query: INVENTORY_ITEM_DETAIL_QUERY, variables: { id: 'gid://shopify/InventoryItem/2' }, options: { operationName: 'InventoryItemDetail' } }]);
    expect(INVENTORY_ITEM_DETAIL_QUERY).not.toMatch(/metafields|inventoryAdjustment/iu);
  });

  it('lists inventory levels by exactly one inventory item or location with bounded cost-safe dimensions', async () => {
    const itemQueries: unknown[] = [];
    const itemClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        itemQueries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            inventoryItem: {
              inventoryLevels: {
                edges: [{ cursor: 'level-cursor-1', node: { id: 'gid://shopify/InventoryLevel/1?inventory_item_id=2', quantities: [{ name: 'available', quantity: 7 }], location: { id: 'gid://shopify/Location/1', name: 'Main' }, item: { id: 'gid://shopify/InventoryItem/2', sku: 'ABC-123' } } }],
                pageInfo: { hasNextPage: true, endCursor: 'level-cursor-1' },
              },
            },
          },
        });
      },
    };

    await expect(listInventoryLevels({ client: itemClient, inventoryItemId: 'gid://shopify/InventoryItem/2', first: 25, after: 'cursor-0' })).resolves.toEqual({
      inventoryLevels: [{ id: 'gid://shopify/InventoryLevel/1?inventory_item_id=2', quantities: [{ name: 'available', quantity: 7 }], location: { id: 'gid://shopify/Location/1', name: 'Main' }, inventoryItem: { id: 'gid://shopify/InventoryItem/2', sku: 'ABC-123' } }],
      pageInfo: { hasNextPage: true, endCursor: 'level-cursor-1' },
    });
    expect(itemQueries).toEqual([{ query: INVENTORY_LEVELS_BY_ITEM_QUERY, variables: { first: 25, after: 'cursor-0', inventoryItemId: 'gid://shopify/InventoryItem/2' }, options: { operationName: 'InventoryLevelsByItem' } }]);

    const locationQueries: unknown[] = [];
    const locationClient = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        locationQueries.push({ query, variables, options });
        return Promise.resolve({
        data: {
          location: {
            inventoryLevels: {
              edges: [{ cursor: 'level-cursor-2', node: { id: 'gid://shopify/InventoryLevel/2?inventory_item_id=3', quantities: [{ name: 'on_hand', quantity: 9 }], location: { id: 'gid://shopify/Location/4', name: 'Warehouse' }, item: { id: 'gid://shopify/InventoryItem/3' } } }],
              pageInfo: { hasNextPage: false, endCursor: 'level-cursor-2' },
            },
          },
        },
      });
      },
    };
    await expect(listInventoryLevels({ client: locationClient, locationId: 'gid://shopify/Location/4' })).resolves.toEqual({
      inventoryLevels: [{ id: 'gid://shopify/InventoryLevel/2?inventory_item_id=3', quantities: [{ name: 'on_hand', quantity: 9 }], location: { id: 'gid://shopify/Location/4', name: 'Warehouse' }, inventoryItem: { id: 'gid://shopify/InventoryItem/3' } }],
      pageInfo: { hasNextPage: false, endCursor: 'level-cursor-2' },
    });

    expect(locationQueries).toEqual([{ query: INVENTORY_LEVELS_BY_LOCATION_QUERY, variables: { first: 25, after: null, locationId: 'gid://shopify/Location/4' }, options: { operationName: 'InventoryLevelsByLocation' } }]);
    expect(INVENTORY_LEVELS_BY_ITEM_QUERY).toContain('inventoryItem(id: $inventoryItemId)');
    expect(INVENTORY_LEVELS_BY_LOCATION_QUERY).toContain('location(id: $locationId)');
    for (const query of [INVENTORY_LEVELS_BY_ITEM_QUERY, INVENTORY_LEVELS_BY_LOCATION_QUERY]) {
      expect(query).toContain('inventoryLevels(first: $first, after: $after)');
      expect(query).not.toMatch(/inventoryItems\(|locations\(/u);
      expect(query).not.toMatch(/metafields|inventoryAdjustment|address|phone|contact/iu);
    }
  });

  it('rejects unsafe IDs, ambiguous level filters, page sizes, and malformed responses safely', async () => {
    const client = { query: () => Promise.resolve({ data: { locations: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(getLocation({ client, id: 'gid://shopify/Product/1' })).rejects.toThrow('Location id must be a Shopify Location GID.');
    await expect(getInventoryItem({ client, id: 'gid://shopify/InventoryItem/not-digits' })).rejects.toThrow('InventoryItem id must be a Shopify InventoryItem GID.');
    await expect(listLocations({ client, first: 0 })).rejects.toThrow(InventoryDetailsError);
    await expect(listLocations({ client, first: 51 })).rejects.toThrow('Location page size must be an integer between 1 and 50.');
    await expect(listInventoryLevels({ client })).rejects.toThrow('Provide exactly one of inventoryItemId or locationId.');
    await expect(listInventoryLevels({ client, inventoryItemId: 'gid://shopify/InventoryItem/2', locationId: 'gid://shopify/Location/1' })).rejects.toThrow('Provide exactly one of inventoryItemId or locationId.');
    await expect(listInventoryLevels({ client, inventoryItemId: 'gid://shopify/InventoryItem/2', first: 51 })).rejects.toThrow('Inventory level page size must be an integer between 1 and 50.');
    await expect(getLocation({ client, id: 'gid://shopify/Location/1' })).rejects.toThrow(InventoryDetailsError);
  });
});
