import { describe, expect, it } from 'vitest';

import {
  ORDER_DETAIL_QUERY,
  ORDER_LOOKUP_BY_NAME_QUERY,
  ORDER_PII_POLICY,
  OrderSurfaceError,
  getOrderDetail,
} from '../src/orders/details.js';

describe('order Admin GraphQL detail helper', () => {
  it('gets one order by stable GID with bounded status/payment/fulfillment/refund summaries and minimized PII', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        return Promise.resolve({ data: { order: orderNode() } });
      },
    };

    await expect(getOrderDetail({ client, id: 'gid://shopify/Order/1' })).resolves.toEqual({
      order: {
        id: 'gid://shopify/Order/1',
        name: '#1001',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        processedAt: '2026-01-01T00:01:00Z',
        cancelledAt: null,
        cancelReason: null,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'FULFILLED',
        totalPrice: { amount: '42.00', currencyCode: 'GBP' },
        subtotalPrice: { amount: '35.00', currencyCode: 'GBP' },
        totalShippingPrice: { amount: '5.00', currencyCode: 'GBP' },
        totalTax: { amount: '2.00', currencyCode: 'GBP' },
        lineItems: [{ title: 'T-Shirt', quantity: 2, sku: 'TS-S', variantId: 'gid://shopify/ProductVariant/1', productId: 'gid://shopify/Product/1' }],
        lineItemsTruncated: true,
        fulfillments: [{ id: 'gid://shopify/Fulfillment/1', status: 'SUCCESS', displayStatus: 'FULFILLED', createdAt: '2026-01-01T00:02:00Z', deliveredAt: '2026-01-03T00:00:00Z', trackingCompany: 'Royal Mail' }],
        fulfillmentsTruncated: false,
        refunds: [{ id: 'gid://shopify/Refund/1', createdAt: '2026-01-04T00:00:00Z', totalRefunded: { amount: '5.00', currencyCode: 'GBP' } }],
        refundsTruncated: false,
      },
      pii: ORDER_PII_POLICY,
    });
    expect(queries).toEqual([{ query: ORDER_DETAIL_QUERY, variables: { id: 'gid://shopify/Order/1' }, options: { operationName: 'OrderDetail' } }]);
    const serialized = JSON.stringify(await getOrderDetail({ client, id: 'gid://shopify/Order/1' }));
    expect(serialized).not.toContain('ada@example.test');
    expect(serialized).not.toContain('221B Baker Street');
    expect(serialized).not.toContain('TRACK123');
  });

  it('resolves one order by safe Shopify order name with an ambiguity guard', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: Record<string, unknown>, options?: unknown) => {
        queries.push({ query, variables, options });
        if (query === ORDER_LOOKUP_BY_NAME_QUERY) {
          return Promise.resolve({ data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/1' } }] } } });
        }
        return Promise.resolve({ data: { order: orderNode() } });
      },
    };

    await expect(getOrderDetail({ client, name: '#1001' })).resolves.toMatchObject({ order: { id: 'gid://shopify/Order/1', name: '#1001' } });
    expect(queries[0]).toEqual({ query: ORDER_LOOKUP_BY_NAME_QUERY, variables: { query: 'name:#1001' }, options: { operationName: 'OrderLookupByName' } });
    expect(queries[1]).toEqual({ query: ORDER_DETAIL_QUERY, variables: { id: 'gid://shopify/Order/1' }, options: { operationName: 'OrderDetail' } });
  });

  it('rejects unsafe ids/names, ambiguous lookup, and malformed responses safely', async () => {
    const emptyLookupClient = { query: () => Promise.resolve({ data: { orders: { edges: [] } } }) };
    const ambiguousLookupClient = { query: () => Promise.resolve({ data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/1' } }, { node: { id: 'gid://shopify/Order/2' } }] } } }) };
    const malformedClient = { query: () => Promise.resolve({ data: { order: { id: 'gid://shopify/Order/1', name: '#1001' } } }) };

    await expect(getOrderDetail({ client: malformedClient, id: 'gid://shopify/Product/1' })).rejects.toThrow('Order id must be a Shopify Order GID.');
    await expect(getOrderDetail({ client: malformedClient, name: 'query { orders { edges { node { id } } } }' })).rejects.toThrow('Order name is invalid.');
    await expect(getOrderDetail({ client: malformedClient, name: '#1001 OR email:*' })).rejects.toThrow('Order name is invalid.');
    await expect(getOrderDetail({ client: malformedClient, name: '#1001 financial_status:paid' })).rejects.toThrow('Order name is invalid.');
    await expect(getOrderDetail({ client: malformedClient, id: 'gid://shopify/Order/1', name: '#1001' })).rejects.toThrow('Provide exactly one of order id or order name.');
    await expect(getOrderDetail({ client: emptyLookupClient, name: '#404' })).rejects.toThrow('Order was not found.');
    await expect(getOrderDetail({ client: ambiguousLookupClient, name: '#1001' })).rejects.toThrow('Order name matched multiple orders. Use a stable Order GID.');
    await expect(getOrderDetail({ client: malformedClient, id: 'gid://shopify/Order/1' })).rejects.toThrow(OrderSurfaceError);
  });

  it('keeps the query curated and away from customer/address/payment/tracking PII', () => {
    for (const blocked of ['email', 'phone', 'billingAddress', 'shippingAddress', 'customer', 'transactions', 'trackingNumber', 'trackingUrl']) {
      expect(ORDER_DETAIL_QUERY).not.toContain(blocked);
    }
    expect(ORDER_DETAIL_QUERY).toContain('lineItems(first: 25)');
    expect(ORDER_DETAIL_QUERY).toContain('fulfillments(first: 10)');
    expect(ORDER_DETAIL_QUERY).toContain('refunds(first: 10)');
  });
});

function orderNode() {
  return {
    id: 'gid://shopify/Order/1',
    name: '#1001',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    processedAt: '2026-01-01T00:01:00Z',
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    totalPriceSet: { shopMoney: { amount: '42.00', currencyCode: 'GBP' } },
    subtotalPriceSet: { shopMoney: { amount: '35.00', currencyCode: 'GBP' } },
    totalShippingPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'GBP' } },
    totalTaxSet: { shopMoney: { amount: '2.00', currencyCode: 'GBP' } },
    lineItems: {
      edges: [{ node: { title: 'T-Shirt', quantity: 2, sku: 'TS-S', variant: { id: 'gid://shopify/ProductVariant/1', product: { id: 'gid://shopify/Product/1' } } } }],
      pageInfo: { hasNextPage: true },
    },
    fulfillments: [{ id: 'gid://shopify/Fulfillment/1', status: 'SUCCESS', displayStatus: 'FULFILLED', createdAt: '2026-01-01T00:02:00Z', deliveredAt: '2026-01-03T00:00:00Z', trackingInfo: [{ company: 'Royal Mail', number: 'TRACK123' }] }],
    refunds: [{ id: 'gid://shopify/Refund/1', createdAt: '2026-01-04T00:00:00Z', totalRefundedSet: { shopMoney: { amount: '5.00', currencyCode: 'GBP' } } }],
    email: 'ada@example.test',
    shippingAddress: { address1: '221B Baker Street' },
  };
}
