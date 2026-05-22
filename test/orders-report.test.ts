import { describe, expect, it } from 'vitest';

import {
  formatOrdersReport,
  generateOrdersReport,
  ORDERS_REPORT_QUERY,
  parseOrdersReportWindow,
  type OrdersReportGraphqlClient,
} from '../src/reports/orders.js';

describe('orders report service', () => {
  it('parses --since windows and explicit date ranges semantically', () => {
    expect(parseOrdersReportWindow({ since: '30d', now: new Date('2026-05-22T12:00:00.000Z') })).toEqual({
      from: '2026-04-22',
      to: '2026-05-22',
      query: 'created_at:>=2026-04-22 created_at:<=2026-05-22',
    });
    expect(parseOrdersReportWindow({ from: '2026-02-28', to: '2026-03-01' })).toEqual({
      from: '2026-02-28',
      to: '2026-03-01',
      query: 'created_at:>=2026-02-28 created_at:<=2026-03-01',
    });
  });

  it('rejects invalid dates, windows, and mixed date modes', () => {
    expect(() => parseOrdersReportWindow({ from: '2026-02-30', to: '2026-03-01' })).toThrow('Invalid orders report date: 2026-02-30. Use YYYY-MM-DD.');
    expect(() => parseOrdersReportWindow({ from: '2026-03-02', to: '2026-03-01' })).toThrow('Orders report --from date must be on or before --to date.');
    expect(() => parseOrdersReportWindow({ since: '0d' })).toThrow('Orders report --since must be a positive day window like 30d.');
    expect(() => parseOrdersReportWindow({ since: '30d', from: '2026-01-01', to: '2026-01-31' })).toThrow('Use either --since or --from/--to for orders report, not both.');
  });

  it('paginates orders and maps order fields deterministically', async () => {
    const calls: { readonly after: string | null; readonly query: string }[] = [];
    const client: OrdersReportGraphqlClient = {
      query: (_query, variables) => {
        calls.push({ after: variables.after, query: variables.query });
        if (variables.after === null) {
          return Promise.resolve({ data: { orders: { edges: [{ cursor: 'cursor-1', node: orderNode({ id: 'gid://shopify/Order/2001', name: '#1001' }) }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } });
        }
        return Promise.resolve({ data: { orders: { edges: [{ cursor: 'cursor-2', node: orderNode({ id: 'gid://shopify/Order/2002', name: '#1002', displayFulfillmentStatus: 'FULFILLED' }) }], pageInfo: { hasNextPage: false, endCursor: 'cursor-2' } } } });
      },
    };

    await expect(generateOrdersReport({ client, window: { from: '2026-04-22', to: '2026-05-22' } })).resolves.toEqual({
      window: { from: '2026-04-22', to: '2026-05-22', query: 'created_at:>=2026-04-22 created_at:<=2026-05-22' },
      orders: [
        expect.objectContaining({ id: '2001', gid: 'gid://shopify/Order/2001', name: '#1001', customerDisplayName: 'Ada Lovelace', customerEmail: 'ada@example.test', lineItemsSummary: '2 items: T-Shirt x2; Mug x1' }),
        expect.objectContaining({ id: '2002', gid: 'gid://shopify/Order/2002', name: '#1002', fulfillmentStatus: 'FULFILLED' }),
      ],
    });
    expect(calls).toEqual([
      { after: null, query: 'created_at:>=2026-04-22 created_at:<=2026-05-22' },
      { after: 'cursor-1', query: 'created_at:>=2026-04-22 created_at:<=2026-05-22' },
    ]);
  });

  it('returns empty reports and formats markdown, json, and csv deterministically', async () => {
    const client: OrdersReportGraphqlClient = {
      query: () => Promise.resolve({ data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
    };
    const empty = await generateOrdersReport({ client, window: { from: '2026-05-01', to: '2026-05-02' } });
    expect(empty.orders).toEqual([]);

    const report = { window: empty.window, orders: [orderItem()] };
    expect(formatOrdersReport(report, 'markdown')).toBe([
      '| ID | GID | Name | Created At | Financial Status | Fulfillment Status | Total | Currency | Customer | Email | Line Items |',
      '| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |',
      '| 2001 | gid://shopify/Order/2001 | #1001 | 2026-05-20T10:30:00Z | PAID | UNFULFILLED | 42.50 | USD | Ada Lovelace | ada@example.test | 2 items: T-Shirt x2; Mug x1 |',
    ].join('\n'));
    expect(formatOrdersReport(report, 'json')).toBe(JSON.stringify(report, null, 2));
    expect(formatOrdersReport(report, 'csv')).toBe([
      'id,gid,name,createdAt,financialStatus,fulfillmentStatus,totalAmount,currencyCode,customerDisplayName,customerEmail,lineItemsSummary',
      '"2001","gid://shopify/Order/2001","#1001","2026-05-20T10:30:00Z","PAID","UNFULFILLED","42.50","USD","Ada Lovelace","ada@example.test","2 items: T-Shirt x2; Mug x1"',
    ].join('\n'));
  });

  it('fails safely for repeated cursors and max pages', async () => {
    const repeated: OrdersReportGraphqlClient = {
      query: () => Promise.resolve({ data: { orders: { edges: [{ cursor: 'cursor-1', node: orderNode() }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } }),
    };
    await expect(generateOrdersReport({ client: repeated, window: { since: '30d', now: new Date('2026-05-22T00:00:00.000Z') } })).rejects.toThrow('Shopify Admin GraphQL orders pagination did not advance.');

    const advancing: OrdersReportGraphqlClient = {
      query: (_query, variables) => Promise.resolve({ data: { orders: { edges: [{ cursor: variables.after ?? 'cursor-1', node: orderNode() }], pageInfo: { hasNextPage: true, endCursor: variables.after === null ? 'cursor-1' : 'cursor-2' } } } }),
    };
    await expect(generateOrdersReport({ client: advancing, window: { from: '2026-05-01', to: '2026-05-02' }, maxPages: 1 })).rejects.toThrow('Shopify Admin GraphQL orders pagination exceeded the maximum page count.');
  });

  it('requests read-only order/customer fields and neutralizes CSV formula injection', () => {
    expect(ORDERS_REPORT_QUERY).toContain('orders(');
    expect(ORDERS_REPORT_QUERY).toContain('customer {');
    expect(ORDERS_REPORT_QUERY).not.toContain('mutation');

    const csv = formatOrdersReport({
      window: { from: '2026-05-01', to: '2026-05-02', query: 'created_at:>=2026-05-01 created_at:<=2026-05-02' },
      orders: [{
        ...orderItem(),
        name: ' =cmd',
        customerDisplayName: '  @evil',
        customerEmail: '\t=cmd',
        lineItemsSummary: ' -bad x1',
      }],
    }, 'csv');

    expect(csv).toContain('"\' =cmd"');
    expect(csv).toContain('"\'  @evil"');
    expect(csv).toContain('"\'\\t=cmd"');
    expect(csv).toContain('"\' -bad x1"');
  });

  it('treats absent customer email and display name as optional', async () => {
    const client: OrdersReportGraphqlClient = {
      query: () => Promise.resolve({
        data: {
          orders: {
            edges: [{ cursor: 'cursor-1', node: { ...orderNode(), customer: null } }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          },
        },
      }),
    };

    await expect(generateOrdersReport({ client, window: { from: '2026-05-01', to: '2026-05-02' } })).resolves.toEqual(expect.objectContaining({
      orders: [expect.objectContaining({ customerDisplayName: '', customerEmail: '' })],
    }));
  });
});

function orderItem() {
  return {
    id: '2001',
    gid: 'gid://shopify/Order/2001',
    name: '#1001',
    createdAt: '2026-05-20T10:30:00Z',
    financialStatus: 'PAID',
    fulfillmentStatus: 'UNFULFILLED',
    totalAmount: '42.50',
    currencyCode: 'USD',
    customerDisplayName: 'Ada Lovelace',
    customerEmail: 'ada@example.test',
    lineItemsSummary: '2 items: T-Shirt x2; Mug x1',
  };
}

function orderNode(overrides: Partial<{ readonly id: string; readonly name: string; readonly displayFulfillmentStatus: string }> = {}) {
  return {
    id: overrides.id ?? 'gid://shopify/Order/2001',
    name: overrides.name ?? '#1001',
    createdAt: '2026-05-20T10:30:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: overrides.displayFulfillmentStatus ?? 'UNFULFILLED',
    totalPriceSet: { shopMoney: { amount: '42.50', currencyCode: 'USD' } },
    customer: { displayName: 'Ada Lovelace', email: 'ada@example.test' },
    lineItems: { edges: [{ node: { title: 'T-Shirt', quantity: 2 } }, { node: { title: 'Mug', quantity: 1 } }], pageInfo: { hasNextPage: false } },
  };
}
