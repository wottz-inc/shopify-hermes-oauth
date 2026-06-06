import { describe, expect, it } from 'vitest';

import { summarizeOnlineStore } from '../src/online-store/summary.js';
import { type StoredShopToken, type TokenStore } from '../src/tokens/local-token-store.js';

function token(scopes: readonly string[]): StoredShopToken {
  return {
    shop: 'alpha.myshopify.com',
    accessToken: 'shpat_do-not-leak',
    scopes,
    storedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function store(record: StoredShopToken | undefined): Pick<TokenStore, 'getToken'> {
  return { getToken: () => record };
}

describe('curated online store summary', () => {
  it('returns bounded theme, page, and blog summaries without asset/body/html dumps', async () => {
    const seenQueries: string[] = [];
    const seenVariables: unknown[] = [];
    const result = await summarizeOnlineStore({
      shop: 'Alpha.MyShopify.com',
      tokenStore: store(token(['read_themes', 'read_content'])),
      client: {
        query: (query: string, variables: unknown) => {
          seenQueries.push(query);
          seenVariables.push(variables);
          expect(query).not.toMatch(/\b(asset|assets|body|bodyHtml|html|scriptTag|checkoutProfile)\b/iu);
          return Promise.resolve({
            data: {
              themes: {
                nodes: [
                  { id: 'gid://shopify/Theme/1', name: 'Dawn', role: 'MAIN', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
                  { id: 'gid://shopify/Theme/2', name: 'Draft', role: 'UNPUBLISHED' },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'theme-cursor' },
              },
              pages: {
                nodes: [
                  { id: 'gid://shopify/Page/1', title: 'About', handle: 'about', isVisible: true, createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z' },
                ],
                pageInfo: { hasNextPage: false },
              },
              blogs: {
                nodes: [{ id: 'gid://shopify/Blog/1', title: 'News', handle: 'news' }],
                pageInfo: { hasNextPage: false },
              },
            },
          });
        },
      },
    });

    expect(seenQueries).toHaveLength(1);
    expect(seenVariables).toEqual([{ themesFirst: 5, contentFirst: 10 }]);
    expect(result).toEqual({
      shop: 'alpha.myshopify.com',
      limits: { themesFirst: 5, contentFirst: 10 },
      onlineStore: {
        themes: {
          status: 'ok',
          nodes: [
            { id: 'gid://shopify/Theme/1', name: 'Dawn', role: 'MAIN', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
            { id: 'gid://shopify/Theme/2', name: 'Draft', role: 'UNPUBLISHED' },
          ],
          pageInfo: { hasNextPage: true, endCursor: 'theme-cursor' },
          truncated: true,
        },
        pages: {
          status: 'ok',
          nodes: [
            { id: 'gid://shopify/Page/1', title: 'About', handle: 'about', isVisible: true, createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z' },
          ],
          pageInfo: { hasNextPage: false },
          truncated: false,
        },
        blogs: {
          status: 'ok',
          nodes: [{ id: 'gid://shopify/Blog/1', title: 'News', handle: 'news' }],
          pageInfo: { hasNextPage: false },
          truncated: false,
        },
      },
      checkout: { status: 'documented_limitation', reason: 'checkout_configuration_not_exposed_read_only_by_curated_admin_graphql' },
      customerAccounts: { status: 'documented_limitation', reason: 'customer_account_configuration_not_exposed_read_only_by_curated_admin_graphql' },
      branding: { status: 'documented_limitation', reason: 'branding_configuration_not_exposed_read_only_without_checkout_branding_write_surface' },
    });
    expect(JSON.stringify(result)).not.toContain('shpat_do-not-leak');
  });

  it('validates stored OAuth scopes before making scoped online-store calls', async () => {
    const calls: string[] = [];
    const result = await summarizeOnlineStore({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_products'])),
      client: {
        query: () => {
          calls.push('query');
          return Promise.resolve({ data: {} });
        },
      },
    });

    expect(calls).toEqual([]);
    expect(result.onlineStore.themes).toEqual({ status: 'missing_scope', requiredScope: 'read_themes' });
    expect(result.onlineStore.pages).toEqual({ status: 'missing_scope', requiredScope: 'read_content' });
    expect(result.onlineStore.blogs).toEqual({ status: 'missing_scope', requiredScope: 'read_content' });
  });

  it('does not query content fields when only read_themes is granted', async () => {
    const seenQueries: string[] = [];
    const result = await summarizeOnlineStore({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_themes'])),
      client: {
        query: (query: string) => {
          seenQueries.push(query);
          expect(query).toContain('themes');
          expect(query).not.toMatch(/\b(pages|blogs)\b/iu);
          return Promise.resolve({ data: { themes: { nodes: [{ id: 'gid://shopify/Theme/1', name: 'Dawn' }], pageInfo: { hasNextPage: false } } } });
        },
      },
    });

    expect(seenQueries).toHaveLength(1);
    expect(result.onlineStore.themes).toMatchObject({ status: 'ok', nodes: [{ id: 'gid://shopify/Theme/1', name: 'Dawn' }] });
    expect(result.onlineStore.pages).toEqual({ status: 'missing_scope', requiredScope: 'read_content' });
    expect(result.onlineStore.blogs).toEqual({ status: 'missing_scope', requiredScope: 'read_content' });
  });

  it('does not query theme fields when only read_content is granted', async () => {
    const seenQueries: string[] = [];
    const result = await summarizeOnlineStore({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_content'])),
      client: {
        query: (query: string) => {
          seenQueries.push(query);
          expect(query).not.toContain('themes');
          expect(query).toMatch(/\b(pages|blogs)\b/iu);
          return Promise.resolve({ data: { pages: { nodes: [{ id: 'gid://shopify/Page/1', title: 'About' }], pageInfo: { hasNextPage: false } }, blogs: { nodes: [{ id: 'gid://shopify/Blog/1', title: 'News' }], pageInfo: { hasNextPage: false } } } });
        },
      },
    });

    expect(seenQueries).toHaveLength(1);
    expect(result.onlineStore.themes).toEqual({ status: 'missing_scope', requiredScope: 'read_themes' });
    expect(result.onlineStore.pages).toMatchObject({ status: 'ok', nodes: [{ id: 'gid://shopify/Page/1', title: 'About' }] });
    expect(result.onlineStore.blogs).toMatchObject({ status: 'ok', nodes: [{ id: 'gid://shopify/Blog/1', title: 'News' }] });
  });

  it('returns structured unsupported statuses when Shopify fields are unavailable', async () => {
    const result = await summarizeOnlineStore({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_themes', 'read_content'])),
      client: {
        query: () => Promise.reject(new Error('GraphQL Errors: Cannot query field "themes" on type QueryRoot with token shpat_secret')),
      },
    });

    expect(result.onlineStore.themes).toEqual({ status: 'unsupported', reason: 'online_store_fields_unavailable' });
    expect(result.onlineStore.pages).toEqual({ status: 'unsupported', reason: 'online_store_fields_unavailable' });
    expect(result.onlineStore.blogs).toEqual({ status: 'unsupported', reason: 'online_store_fields_unavailable' });
    expect(JSON.stringify(result)).not.toContain('Cannot query field');
    expect(JSON.stringify(result)).not.toContain('shpat_secret');
  });
});
