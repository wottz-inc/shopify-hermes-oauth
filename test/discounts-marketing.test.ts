import { describe, expect, it } from 'vitest';

import {
  DISCOUNT_NODE_QUERY,
  DISCOUNTS_QUERY,
  MARKETING_EVENTS_QUERY,
  getDiscount,
  listDiscounts,
  listMarketingEvents,
  type DiscountsMarketingGraphqlClient,
} from '../src/discounts-marketing/index.js';

describe('discounts and marketing Admin GraphQL read helpers', () => {
  it('lists discount nodes with safe summary fields and aggregate counts only', async () => {
    const calls: unknown[] = [];
    const client: DiscountsMarketingGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        return Promise.resolve({
          data: {
            discountNodes: {
              edges: [
                { cursor: 'cursor-1', node: { id: 'gid://shopify/DiscountNode/1', discount: discountNode('SUMMER10') } },
                { cursor: 'cursor-2', node: { id: 'gid://shopify/DiscountNode/2', discount: { __typename: 'DiscountAutomaticBasic', title: 'Auto 5', status: 'EXPIRED', startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-02-07T00:00:00Z', usageCount: 8, summary: '5% off' } } },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
            },
          },
        });
      },
    };

    await expect(listDiscounts({ client, first: 2, after: 'opaque-cursor', query: 'status:active' })).resolves.toEqual({
      discounts: [
        { id: 'gid://shopify/DiscountNode/1', type: 'DiscountCodeBasic', title: 'Summer 10', status: 'ACTIVE', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-31T00:00:00Z', usageCount: 42, codesCount: { count: 3 }, summary: '10% off' },
        { id: 'gid://shopify/DiscountNode/2', type: 'DiscountAutomaticBasic', title: 'Auto 5', status: 'EXPIRED', startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-02-07T00:00:00Z', usageCount: 8, summary: '5% off' },
      ],
      summary: { discountCount: 2, activeCount: 1, expiredCount: 1, scheduledCount: 0, withCodesCount: 1, usageCount: 50 },
      pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
    });
    expect(calls).toEqual([{ query: DISCOUNTS_QUERY, variables: { first: 2, after: 'opaque-cursor', query: 'status:active' }, options: { operationName: 'Discounts' } }]);
    expect(DISCOUNTS_QUERY).toContain('codesCount {');
    expect(DISCOUNTS_QUERY).not.toMatch(/codes\s*\(/u);
    expect(DISCOUNTS_QUERY).not.toContain('customerSelection');
    expect(DISCOUNTS_QUERY).not.toContain('customers');
    expect(DISCOUNTS_QUERY).not.toContain('orders');
  });

  it('gets one discount by stable GID without exposing codes, customer selection, or attribution data', async () => {
    const client: DiscountsMarketingGraphqlClient = {
      query: (_query, variables) => Promise.resolve({ data: { discountNode: { id: variables.id, discount: discountNode('WELCOME') } } }),
    };

    const result = await getDiscount({ client, id: 'gid://shopify/DiscountNode/1' });
    expect(result).toEqual({ discount: { id: 'gid://shopify/DiscountNode/1', type: 'DiscountCodeBasic', title: 'Summer 10', status: 'ACTIVE', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-31T00:00:00Z', usageCount: 42, codesCount: { count: 3 }, summary: '10% off' } });
    expect(JSON.stringify(result)).not.toContain('WELCOME');
    expect(DISCOUNT_NODE_QUERY).not.toMatch(/codes\s*\(/u);
    expect(DISCOUNT_NODE_QUERY).not.toContain('customerSelection');
    expect(DISCOUNT_NODE_QUERY).not.toContain('orders');
  });

  it('lists marketing events shallowly and redacts URL query strings', async () => {
    const calls: unknown[] = [];
    const client: DiscountsMarketingGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        return Promise.resolve({
          data: {
            marketingEvents: {
              edges: [{ cursor: 'cursor-1', node: {
                id: 'gid://shopify/MarketingEvent/1',
                eventType: 'ad',
                marketingChannelType: 'social',
                sourceAndMedium: 'meta / paid',
                sourceType: 'EXTERNAL',
                startedAt: '2026-01-01T00:00:00Z',
                endedAt: '2026-01-02T00:00:00Z',
                scheduledToEndAt: '2026-01-03T00:00:00Z',
                budget: { amount: '100.00', currencyCode: 'USD' },
                manageUrl: 'https://ads.example.test/manage?token=secret&utm_campaign=x',
                previewUrl: 'https://ads.example.test/preview?customer=ada@example.test',
                customer: { email: 'ada@example.test' },
                orders: { edges: [{ node: { name: '#1001' } }] },
              } }],
              pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
            },
          },
        });
      },
    };

    await expect(listMarketingEvents({ client, first: 1, after: 'cursor', query: 'event_type:ad' })).resolves.toEqual({
      marketingEvents: [{
        id: 'gid://shopify/MarketingEvent/1',
        eventType: 'ad',
        marketingChannelType: 'social',
        sourceAndMedium: 'meta / paid',
        sourceType: 'EXTERNAL',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-02T00:00:00Z',
        scheduledToEndAt: '2026-01-03T00:00:00Z',
        budget: { amount: '100.00', currencyCode: 'USD' },
        manageUrl: 'https://ads.example.test/manage',
        previewUrl: 'https://ads.example.test/preview',
      }],
      summary: { marketingEventCount: 1, byChannel: { social: 1 }, withBudgetCount: 1 },
      pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
      pii: { redactedFields: ['customer', 'orders', 'conversions', 'utm/query parameters'], urls: 'query_redacted' },
    });
    expect(calls).toEqual([{ query: MARKETING_EVENTS_QUERY, variables: { first: 1, after: 'cursor', query: 'event_type:ad' }, options: { operationName: 'MarketingEvents' } }]);
    expect(JSON.stringify(await listMarketingEvents({ client }))).not.toContain('ada@example.test');
    expect(MARKETING_EVENTS_QUERY).not.toContain('customer');
    expect(MARKETING_EVENTS_QUERY).not.toContain('orders');
    expect(MARKETING_EVENTS_QUERY).not.toContain('conversions');
  });

  it('enforces stable IDs, safe query strings, and page size cap', async () => {
    const client: DiscountsMarketingGraphqlClient = { query: () => Promise.resolve({ data: { discountNodes: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(listDiscounts({ client, first: 0 })).rejects.toThrow('integer between 1 and 50');
    await expect(listDiscounts({ client, first: 51 })).rejects.toThrow('integer between 1 and 50');
    await expect(listDiscounts({ client, query: 'query { shop { name } }' })).rejects.toThrow('query is invalid');
    await expect(getDiscount({ client, id: 'gid://shopify/PriceRule/1' })).rejects.toThrow('Discount id must be a Shopify DiscountNode GID');
    await expect(listMarketingEvents({ client, query: 'mutation { x }' })).rejects.toThrow('query is invalid');
  });

  it('accepts opaque discount and marketing cursors containing query-like substrings while query filters stay strict', async () => {
    const calls: unknown[] = [];
    const cursor = 'YXJyYXljb25uZWN0aW9uOjEwOjEw-Query-query==';
    const client: DiscountsMarketingGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        const key = query === DISCOUNTS_QUERY ? 'discountNodes' : 'marketingEvents';
        return Promise.resolve({ data: { [key]: { edges: [], pageInfo: { hasNextPage: false } } } });
      },
    };

    await expect(listDiscounts({ client, after: cursor, query: 'status:active' })).resolves.toMatchObject({ pageInfo: { hasNextPage: false } });
    await expect(listMarketingEvents({ client, after: cursor, query: 'event_type:ad' })).resolves.toMatchObject({ pageInfo: { hasNextPage: false } });
    expect(calls.map((call) => (call as { variables: unknown }).variables)).toEqual([
      { first: 25, after: cursor, query: 'status:active' },
      { first: 25, after: cursor, query: 'event_type:ad' },
    ]);
    await expect(listDiscounts({ client, query: 'query { shop { name } }' })).rejects.toThrow('query is invalid');
  });
});

function discountNode(code: string): Record<string, unknown> {
  return {
    __typename: 'DiscountCodeBasic',
    title: 'Summer 10',
    status: 'ACTIVE',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-01-31T00:00:00Z',
    usageCount: 42,
    codesCount: { count: 3 },
    summary: '10% off',
    customerSelection: { allCustomers: true },
    codes: { edges: [{ node: { code } }] },
  };
}
