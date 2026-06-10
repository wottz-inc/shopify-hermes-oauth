import { describe, expect, it } from 'vitest';

import {
  LOCALES_API_LIMITATION,
  MARKETS_API_LIMITATION,
  MARKETS_QUERY,
  SHOP_LOCALES_QUERY,
  listMarkets,
  listShopLocales,
  type MarketsLocalizationGraphqlClient,
} from '../src/markets-localization/index.js';

describe('markets and localization Admin GraphQL read helpers', () => {
  it('lists markets with bounded safe region and currency summaries', async () => {
    const calls: unknown[] = [];
    const client: MarketsLocalizationGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        return Promise.resolve({
          data: {
            markets: {
              edges: [{ node: {
                id: 'gid://shopify/Market/1',
                name: 'North America',
                handle: 'north-america',
                status: 'ACTIVE',
                currencySettings: { baseCurrency: { currencyCode: 'USD', currencyName: 'US Dollar', enabled: true } },
                regions: {
                  edges: [{ node: { id: 'gid://shopify/MarketRegionCountry/1', name: 'United States', code: 'US' } }],
                  pageInfo: { hasNextPage: true, endCursor: 'region-cursor' },
                },
                webPresences: [{ secret: 'must-not-copy-unknown-fields' }],
              } }],
              pageInfo: { hasNextPage: true, endCursor: 'market-cursor' },
            },
          },
        });
      },
    };

    await expect(listMarkets({ client, first: 1, after: 'cursor' })).resolves.toEqual({
      supported: true,
      markets: [{
        id: 'gid://shopify/Market/1',
        name: 'North America',
        handle: 'north-america',
        status: 'ACTIVE',
        baseCurrency: { currencyCode: 'USD', currencyName: 'US Dollar', enabled: true },
        regions: [{ id: 'gid://shopify/MarketRegionCountry/1', name: 'United States', code: 'US' }],
        regionsTruncated: true,
      }],
      summary: { marketCount: 1, activeCount: 1, regionCount: 1, regionsTruncatedCount: 1 },
      pageInfo: { hasNextPage: true, endCursor: 'market-cursor' },
    });
    expect(calls).toEqual([{ query: MARKETS_QUERY, variables: { first: 1, after: 'cursor' }, options: { operationName: 'Markets' } }]);
    expect(MARKETS_QUERY).not.toMatch(/mutation|translations|marketLocalizations/iu);
  });

  it('returns an empty supported market summary for stores with no markets', async () => {
    const client: MarketsLocalizationGraphqlClient = { query: () => Promise.resolve({ data: { markets: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(listMarkets({ client })).resolves.toEqual({
      supported: true,
      markets: [],
      summary: { marketCount: 0, activeCount: 0, regionCount: 0, regionsTruncatedCount: 0 },
      pageInfo: { hasNextPage: false },
    });
  });

  it('normalizes unsupported market API responses without raw GraphQL errors', async () => {
    const client: MarketsLocalizationGraphqlClient = { query: () => Promise.reject(new Error('Cannot query field "markets" on type "QueryRoot". access denied for shpat_secret')) };
    const result = await listMarkets({ client });
    expect(result).toEqual({
      supported: false,
      markets: [],
      summary: { marketCount: 0, activeCount: 0, regionCount: 0, regionsTruncatedCount: 0 },
      pageInfo: { hasNextPage: false },
      limitation: MARKETS_API_LIMITATION,
    });
    expect(JSON.stringify(result)).not.toContain('shpat_secret');
    expect(JSON.stringify(result)).not.toContain('Cannot query field');
  });

  it('lists shop locales without translations or localized content', async () => {
    const calls: unknown[] = [];
    const client: MarketsLocalizationGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        return Promise.resolve({ data: { shopLocales: [
          { locale: 'en', name: 'English', primary: true, published: true, translations: [{ value: 'secret' }] },
          { locale: 'fr', name: 'French', primary: false, published: false },
        ] } });
      },
    };

    await expect(listShopLocales({ client })).resolves.toEqual({
      supported: true,
      locales: [
        { locale: 'en', name: 'English', primary: true, published: true },
        { locale: 'fr', name: 'French', primary: false, published: false },
      ],
      summary: { localeCount: 2, publishedCount: 1, primaryLocale: 'en' },
    });
    expect(calls).toEqual([{ query: SHOP_LOCALES_QUERY, variables: {}, options: { operationName: 'ShopLocales' } }]);
    expect(SHOP_LOCALES_QUERY).not.toMatch(/translation|marketLocalizations|mutation/iu);
  });

  it('returns empty/unsupported locale results safely', async () => {
    await expect(listShopLocales({ client: { query: () => Promise.resolve({ data: { shopLocales: [] } }) } })).resolves.toEqual({
      supported: true,
      locales: [],
      summary: { localeCount: 0, publishedCount: 0 },
    });
    await expect(listShopLocales({ client: { query: () => Promise.reject(new Error('Access denied for shopLocales. token=shpat_secret')) } })).resolves.toEqual({
      supported: false,
      locales: [],
      summary: { localeCount: 0, publishedCount: 0 },
      limitation: LOCALES_API_LIMITATION,
    });
  });

  it('does not normalize unrelated client failures as unsupported', async () => {
    const client: MarketsLocalizationGraphqlClient = { query: () => Promise.reject(new Error('network timeout while running Markets operation')) };
    await expect(listMarkets({ client })).rejects.toThrow('network timeout while running Markets operation');
    await expect(listShopLocales({ client })).rejects.toThrow('network timeout while running Markets operation');
  });

  it('enforces page size cap and cursor safety', async () => {
    const client: MarketsLocalizationGraphqlClient = { query: () => Promise.resolve({ data: { markets: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(listMarkets({ client, first: 0 })).rejects.toThrow('integer between 1 and 50');
    await expect(listMarkets({ client, first: 51 })).rejects.toThrow('integer between 1 and 50');
    await expect(listMarkets({ client, after: 'query { shop { name } }' })).rejects.toThrow('Cursor is invalid');
  });

  it('accepts opaque market cursors containing query-like substrings', async () => {
    const calls: unknown[] = [];
    const cursor = 'bWFya2V0OjEyMzpRdWVyeXF1ZXJ5-Query-query==';
    const client: MarketsLocalizationGraphqlClient = {
      query: (_query, variables, options) => {
        calls.push({ variables, options });
        return Promise.resolve({ data: { markets: { edges: [], pageInfo: { hasNextPage: false } } } });
      },
    };

    await expect(listMarkets({ client, after: cursor })).resolves.toMatchObject({ pageInfo: { hasNextPage: false } });
    expect(calls).toEqual([{ variables: { first: 25, after: cursor }, options: { operationName: 'Markets' } }]);
  });
});
