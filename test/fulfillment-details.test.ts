import { describe, expect, it } from 'vitest';

import {
  FULFILLMENT_ORDER_DETAIL_QUERY,
  FULFILLMENT_ORDERS_BY_ORDER_QUERY,
  FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY,
  FULFILLMENT_ORDER_PII_POLICY,
  FulfillmentOrderVisibilityError,
  getFulfillmentOrder,
  listFulfillmentOrders,
} from '../src/fulfillment/details.js';

describe('fulfillment order Admin GraphQL visibility helpers', () => {
  it('lists fulfillment orders by stable order GID with bounded safe fields and minimized PII', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        return Promise.resolve({ data: { order: { fulfillmentOrders: fulfillmentOrderConnection() } } });
      },
    };

    await expect(listFulfillmentOrders({ client, orderId: 'gid://shopify/Order/1', first: 10, after: 'cursor-1' })).resolves.toEqual({
      fulfillmentOrders: [fulfillmentOrderSummary()],
      pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
      pii: FULFILLMENT_ORDER_PII_POLICY,
    });
    expect(queries).toEqual([{ query: FULFILLMENT_ORDERS_BY_ORDER_QUERY, variables: { id: 'gid://shopify/Order/1', first: 10, after: 'cursor-1' }, options: { operationName: 'FulfillmentOrdersByOrder' } }]);

    const serialized = JSON.stringify(await listFulfillmentOrders({ client, orderId: 'gid://shopify/Order/1' }));
    expect(serialized).not.toContain('ada@example.test');
    expect(serialized).not.toContain('221B Baker Street');
    expect(serialized).not.toContain('TRACK123');
    expect(serialized).not.toContain('https://tracking.example.test');
    expect(serialized).not.toContain('leave at door');
  });

  it('resolves one order by safe Shopify order name before listing fulfillment orders', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        if (query === FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY) {
          return Promise.resolve({ data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/1' } }] } } });
        }
        return Promise.resolve({ data: { order: { fulfillmentOrders: fulfillmentOrderConnection() } } });
      },
    };

    await expect(listFulfillmentOrders({ client, orderName: '#1001' })).resolves.toMatchObject({ fulfillmentOrders: [{ id: 'gid://shopify/FulfillmentOrder/10' }] });
    expect(queries[0]).toEqual({ query: FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY, variables: { query: 'name:#1001' }, options: { operationName: 'FulfillmentOrderLookupOrderByName' } });
    expect(queries[1]).toEqual({ query: FULFILLMENT_ORDERS_BY_ORDER_QUERY, variables: { id: 'gid://shopify/Order/1', first: 25, after: null }, options: { operationName: 'FulfillmentOrdersByOrder' } });
  });

  it('gets one fulfillment order by stable GID with only curated safe fields', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        return Promise.resolve({ data: { fulfillmentOrder: fulfillmentOrderNode() } });
      },
    };

    await expect(getFulfillmentOrder({ client, id: 'gid://shopify/FulfillmentOrder/10' })).resolves.toEqual({
      fulfillmentOrder: fulfillmentOrderSummary(),
      pii: FULFILLMENT_ORDER_PII_POLICY,
    });
    expect(queries).toEqual([{ query: FULFILLMENT_ORDER_DETAIL_QUERY, variables: { id: 'gid://shopify/FulfillmentOrder/10' }, options: { operationName: 'FulfillmentOrderDetail' } }]);
  });

  it('returns an empty fulfillment order list when an order has no fulfillment records', async () => {
    const client = { query: () => Promise.resolve({ data: { order: { fulfillmentOrders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }) };

    await expect(listFulfillmentOrders({ client, orderId: 'gid://shopify/Order/1' })).resolves.toEqual({
      fulfillmentOrders: [],
      pageInfo: { hasNextPage: false },
      pii: FULFILLMENT_ORDER_PII_POLICY,
    });
  });

  it('rejects unsafe ids/names/page sizes and missing records safely', async () => {
    const emptyLookupClient = { query: () => Promise.resolve({ data: { orders: { edges: [] } } }) };
    const ambiguousLookupClient = { query: () => Promise.resolve({ data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/1' } }, { node: { id: 'gid://shopify/Order/2' } }] } } }) };
    const missingOrderClient = { query: () => Promise.resolve({ data: { order: null } }) };
    const missingFulfillmentOrderClient = { query: () => Promise.resolve({ data: { fulfillmentOrder: null } }) };

    await expect(listFulfillmentOrders({ client: missingOrderClient, orderId: 'gid://shopify/Product/1' })).rejects.toThrow('Order id must be a Shopify Order GID.');
    await expect(listFulfillmentOrders({ client: missingOrderClient, orderName: '#1001', orderId: 'gid://shopify/Order/1' })).rejects.toThrow('Provide exactly one of orderId or orderName.');
    await expect(listFulfillmentOrders({ client: missingOrderClient })).rejects.toThrow('Provide exactly one of orderId or orderName.');
    await expect(listFulfillmentOrders({ client: missingOrderClient, orderName: '#1001 OR email:*' })).rejects.toThrow('Order name is invalid.');
    await expect(listFulfillmentOrders({ client: missingOrderClient, orderId: 'gid://shopify/Order/1', first: 51 })).rejects.toThrow('Fulfillment order page size must be an integer between 1 and 50.');
    await expect(listFulfillmentOrders({ client: emptyLookupClient, orderName: '#404' })).rejects.toThrow('Order was not found.');
    await expect(listFulfillmentOrders({ client: ambiguousLookupClient, orderName: '#1001' })).rejects.toThrow('Order name matched multiple orders. Use a stable Order GID.');
    await expect(listFulfillmentOrders({ client: missingOrderClient, orderId: 'gid://shopify/Order/1' })).rejects.toThrow('Order was not found.');
    await expect(getFulfillmentOrder({ client: missingFulfillmentOrderClient, id: 'gid://shopify/Order/1' })).rejects.toThrow('Fulfillment order id must be a Shopify FulfillmentOrder GID.');
    await expect(getFulfillmentOrder({ client: missingFulfillmentOrderClient, id: 'gid://shopify/FulfillmentOrder/404' })).rejects.toThrow('Fulfillment order was not found.');
    await expect(getFulfillmentOrder({ client: { query: () => Promise.resolve({ data: { fulfillmentOrder: { id: 'gid://shopify/FulfillmentOrder/10' } } }) }, id: 'gid://shopify/FulfillmentOrder/10' })).rejects.toThrow(FulfillmentOrderVisibilityError);
  });

  it('keeps fulfillment order queries curated and away from address/contact/tracking/raw GraphQL fields', () => {
    const queries = [FULFILLMENT_ORDER_DETAIL_QUERY, FULFILLMENT_ORDERS_BY_ORDER_QUERY, FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY].join('\n');
    for (const blocked of ['destination', 'address', 'email', 'phone', 'customer', 'trackingNumber', 'trackingUrl', 'label', 'note', 'tags', 'metafields', 'transactions', 'mutation']) {
      expect(queries).not.toContain(blocked);
    }
    expect(FULFILLMENT_ORDERS_BY_ORDER_QUERY).toContain('fulfillmentOrders(first: $first, after: $after)');
    expect(FULFILLMENT_ORDER_DETAIL_QUERY).toContain('lineItems(first: 25)');
    expect(FULFILLMENT_ORDERS_BY_ORDER_QUERY).toContain('lineItems(first: 25)');
  });
});

function fulfillmentOrderConnection() {
  return {
    edges: [{ cursor: 'cursor-1', node: fulfillmentOrderNode() }],
    pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
  };
}

function fulfillmentOrderNode() {
  return {
    id: 'gid://shopify/FulfillmentOrder/10',
    status: 'OPEN',
    requestStatus: 'UNSUBMITTED',
    deliveryMethod: { methodType: 'SHIPPING' },
    assignedLocation: { location: { id: 'gid://shopify/Location/1', name: 'Main' } },
    lineItems: {
      edges: [{ node: { id: 'gid://shopify/FulfillmentOrderLineItem/20', totalQuantity: 2, remainingQuantity: 1 } }],
      pageInfo: { hasNextPage: false },
    },
    destination: { address1: '221B Baker Street', email: 'ada@example.test', phone: '+15551234567' },
    trackingInfo: [{ number: 'TRACK123', url: 'https://tracking.example.test' }],
    note: 'leave at door',
    tags: ['vip'],
  };
}

function fulfillmentOrderSummary() {
  return {
    id: 'gid://shopify/FulfillmentOrder/10',
    status: 'OPEN',
    requestStatus: 'UNSUBMITTED',
    deliveryMethod: { methodType: 'SHIPPING' },
    assignedLocation: { location: { id: 'gid://shopify/Location/1', name: 'Main' } },
    lineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/20', totalQuantity: 2, remainingQuantity: 1 }],
    lineItemsTruncated: false,
  };
}
