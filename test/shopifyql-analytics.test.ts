import { describe, expect, it } from 'vitest';

import {
  ShopifyqlAnalyticsError,
  type ShopifyqlAnalyticsGraphqlClient,
  formatShopifyqlAnalyticsReport,
  generateShopifyqlAnalyticsReport,
} from '../src/reports/shopifyql-analytics.js';

describe('curated ShopifyQL analytics reports', () => {
  it('rejects reports outside the allowlist before querying', async () => {
    const calls: unknown[] = [];

    await expect(generateShopifyqlAnalyticsReport({
      client: { query: (...args) => { calls.push(args); return Promise.resolve({}); } },
      report: 'raw query',
      from: '2026-01-01',
      to: '2026-01-31',
    })).rejects.toThrow(ShopifyqlAnalyticsError);

    expect(calls).toHaveLength(0);
  });

  it('builds a bounded native Admin GraphQL ShopifyQL query for sales summaries', async () => {
    const calls: { query: string; variables: unknown; operationName?: string }[] = [];
    const client: ShopifyqlAnalyticsGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, operationName: options?.operationName });
        return Promise.resolve({
          data: {
            shopifyqlQuery: {
              __typename: 'TableResponse',
              tableData: {
                columns: [{ name: 'day' }, { name: 'total_sales' }],
                rowData: [['2026-01-01', '100.00'], ['2026-01-02', '50.00']],
              },
            },
          },
        });
      },
    };

    const report = await generateShopifyqlAnalyticsReport({
      client,
      report: 'sales_summary_by_period',
      from: '2026-01-01',
      to: '2026-01-31',
      granularity: 'day',
      limit: 5,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.operationName).toBe('CuratedShopifyqlAnalytics');
    expect(calls[0]?.query).toContain('shopifyqlQuery');
    expect(calls[0]?.variables).toMatchObject({
      query: 'FROM sales SHOW total_sales, net_sales, gross_sales, discounts, returns, orders GROUP BY day SINCE 2026-01-01 UNTIL 2026-01-31 LIMIT 5',
    });
    expect(report).toMatchObject({
      report: 'sales_summary_by_period',
      status: 'ok',
      from: '2026-01-01',
      to: '2026-01-31',
      granularity: 'day',
      rows: [
        { day: '2026-01-01', total_sales: '100.00' },
        { day: '2026-01-02', total_sales: '50.00' },
      ],
    });
  });

  it('builds top products ShopifyQL from the allowlisted template only', async () => {
    let generatedQuery = '';
    const client: ShopifyqlAnalyticsGraphqlClient = {
      query: (_query, variables) => {
        generatedQuery = variables.query;
        return Promise.resolve({ data: { shopifyqlQuery: { tableData: { columns: [{ name: 'product_title' }], rowData: [['Hat']] } } } });
      },
    };

    await generateShopifyqlAnalyticsReport({
      client,
      report: 'top_products_by_sales',
      from: '2026-02-01',
      to: '2026-02-28',
      limit: 10,
    });

    expect(generatedQuery).toBe('FROM sales SHOW product_title, total_sales, net_sales, quantity_ordered GROUP BY product_title SINCE 2026-02-01 UNTIL 2026-02-28 ORDER BY total_sales DESC LIMIT 10');
    expect(generatedQuery).not.toMatch(/DROP|mutation|\{|\}/iu);
  });

  it('returns structured safe guidance for ShopifyQL parse or unsupported responses', async () => {
    const report = await generateShopifyqlAnalyticsReport({
      client: { query: () => Promise.resolve({ data: { shopifyqlQuery: { parseErrors: [{ message: 'No such column: customer_email' }] } } }) },
      report: 'sales_summary_by_period',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(report.status).toBe('unsupported');
    expect(report.guidance).toContain('read_reports');
    expect(JSON.stringify(report)).not.toContain('customer_email');
  });

  it('validates date window, granularity, and limit bounds', async () => {
    const client: ShopifyqlAnalyticsGraphqlClient = { query: () => Promise.resolve({}) };
    await expect(generateShopifyqlAnalyticsReport({ client, report: 'sales_summary_by_period', from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow('from date must be on or before');
    await expect(generateShopifyqlAnalyticsReport({ client, report: 'sales_summary_by_period', from: '2026-01-01', to: '2026-01-31', granularity: 'hour' })).rejects.toThrow('granularity');
    await expect(generateShopifyqlAnalyticsReport({ client, report: 'top_products_by_sales', from: '2026-01-01', to: '2026-01-31', limit: 101 })).rejects.toThrow('limit');
  });

  it('defensively bounds provider rows, columns, and cell length', async () => {
    const overlongTitle = 'A'.repeat(1_200);
    const report = await generateShopifyqlAnalyticsReport({
      client: {
        query: () => Promise.resolve({
          data: {
            shopifyqlQuery: {
              tableData: {
                columns: [{ name: 'product_title' }, { name: 'customer_email' }, { name: 'total_sales' }],
                rowData: [
                  [overlongTitle, 'customer@example.test', '25.00'],
                  ['Second', 'second@example.test', '15.00'],
                ],
              },
            },
          },
        }),
      },
      report: 'top_products_by_sales',
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 1,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).not.toHaveProperty('customer_email');
    expect(report.rows[0]?.product_title).toHaveLength(1_001);
    expect(report.rows[0]?.product_title).toMatch(/…$/u);
    expect(JSON.stringify(report)).not.toContain('customer@example.test');
  });

  it('formats bounded markdown, json, and csv output', () => {
    const report = {
      report: 'top_products_by_sales' as const,
      status: 'ok' as const,
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 2,
      rows: [{ product_title: '=cmd', total_sales: '25.00' }],
    };

    expect(formatShopifyqlAnalyticsReport(report, 'markdown')).toContain('| product_title | total_sales |');
    expect(formatShopifyqlAnalyticsReport(report, 'csv')).toBe(`"product_title","total_sales"\n"'=cmd","25.00"`);
    expect(formatShopifyqlAnalyticsReport(report, 'json')).toContain('"report": "top_products_by_sales"');
  });
});
