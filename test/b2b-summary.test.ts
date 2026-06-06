import { describe, expect, it } from 'vitest';

import { summarizeB2bCatalogs, summarizeB2bCompanies } from '../src/b2b/summary.js';
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

describe('curated B2B summaries', () => {
  it('returns bounded company and location summaries without contact/customer/address fields', async () => {
    const queries: string[] = [];
    const result = await summarizeB2bCompanies({
      shop: 'Alpha.MyShopify.com',
      tokenStore: store(token(['read_companies'])),
      client: {
        query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => {
          queries.push(query);
          expect(options?.operationName).toBe('B2bCompaniesSummary');
          expect(variables).toEqual({ companiesFirst: 25, locationsFirst: 10 });
          expect(query).not.toMatch(/contact|customer|email|phone|address|note|tags|paymentTerms|externalId|catalogsCount|catalogAssignmentsCount|mutation/iu);
          return Promise.resolve({
            data: {
              companies: {
                nodes: [
                  {
                    id: 'gid://shopify/Company/1',
                    name: 'Acme Wholesale',
                    locationsCount: { count: 2 },
                    locations: {
                      nodes: [
                        { id: 'gid://shopify/CompanyLocation/10', name: 'Acme HQ' },
                        { id: 'gid://shopify/CompanyLocation/11', name: 'Acme West' },
                      ],
                      pageInfo: { hasNextPage: false },
                    },
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'company-cursor' },
              },
            },
          });
        },
      },
    });

    expect(queries).toHaveLength(1);
    expect(result).toEqual({
      shop: 'alpha.myshopify.com',
      limits: { companiesFirst: 25, locationsFirst: 10, catalogsFirst: 25, priceListsFirst: 25 },
      companies: {
        status: 'ok',
        nodes: [
          {
            id: 'gid://shopify/Company/1',
            name: 'Acme Wholesale',
            locationCount: 2,
            locations: [
              { id: 'gid://shopify/CompanyLocation/10', name: 'Acme HQ' },
              { id: 'gid://shopify/CompanyLocation/11', name: 'Acme West' },
            ],
            locationsTruncated: false,
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'company-cursor' },
        truncated: true,
      },
      pii: { redactedFields: ['contacts', 'customers', 'emails', 'phones', 'addresses', 'notes', 'tags', 'paymentTerms'] },
    });
    expect(JSON.stringify(result)).not.toContain('shpat_do-not-leak');
  });

  it('returns bounded catalog, company-location assignment count, and price-list summaries without product or variant price dumps', async () => {
    const result = await summarizeB2bCatalogs({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_products'])),
      client: {
        query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => {
          expect(options?.operationName).toBe('B2bCatalogsSummary');
          expect(variables).toEqual({ catalogsFirst: 25, priceListsFirst: 25 });
          expect(query).not.toMatch(/products\s*\(|variants\s*\(|fixedPrices\s*\{|quantityRule|contact|customer|email|phone|address|mutation/iu);
          return Promise.resolve({
            data: {
              catalogs: {
                nodes: [
                  {
                    id: 'gid://shopify/Catalog/1',
                    title: 'Wholesale Active',
                    status: 'ACTIVE',
                    catalogType: 'COMPANY_LOCATION',
                    publication: { catalog: { id: 'gid://shopify/Catalog/1' } },
                    companyLocationsCount: { count: 3 },
                    priceList: { id: 'gid://shopify/PriceList/1', name: 'USD Wholesale', currency: 'USD', fixedPricesCount: { count: 42 } },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
              priceLists: {
                nodes: [{ id: 'gid://shopify/PriceList/2', name: 'CAD Wholesale', currency: 'CAD', fixedPricesCount: { count: 7 } }],
                pageInfo: { hasNextPage: true },
              },
            },
          });
        },
      },
    });

    expect(result).toMatchObject({
      shop: 'alpha.myshopify.com',
      catalogs: {
        status: 'ok',
        nodes: [{ id: 'gid://shopify/Catalog/1', title: 'Wholesale Active', status: 'ACTIVE', type: 'COMPANY_LOCATION', companyLocationAssignmentCount: 3, priceList: { id: 'gid://shopify/PriceList/1', name: 'USD Wholesale', currency: 'USD', fixedPriceCount: 42 } }],
      },
      priceLists: {
        status: 'ok',
        nodes: [{ id: 'gid://shopify/PriceList/2', name: 'CAD Wholesale', currency: 'CAD', fixedPriceCount: 7 }],
        truncated: true,
      },
    });
  });

  it('returns safe structured statuses for missing scopes and unavailable B2B/catalog APIs', async () => {
    await expect(summarizeB2bCompanies({ shop: 'alpha.myshopify.com', tokenStore: store(token(['read_products'])), client: { query: () => Promise.reject(new Error('must not call')) } })).resolves.toMatchObject({
      companies: { status: 'missing_scope', requiredScope: 'read_companies' },
    });
    await expect(summarizeB2bCatalogs({ shop: 'alpha.myshopify.com', tokenStore: store(token(['read_companies'])), client: { query: () => Promise.reject(new Error('must not call')) } })).resolves.toMatchObject({
      catalogs: { status: 'catalog_permission_required', requiredScope: 'read_products' },
      priceLists: { status: 'catalog_permission_required', requiredScope: 'read_products' },
    });
    await expect(summarizeB2bCompanies({ shop: 'alpha.myshopify.com', tokenStore: store(token(['read_companies'])), client: { query: () => Promise.reject(new Error('Cannot query field "companies" on type QueryRoot shpat_secret')) } })).resolves.toMatchObject({
      companies: { status: 'b2b_unavailable', reason: 'b2b_fields_unavailable' },
    });
    await expect(summarizeB2bCatalogs({ shop: 'alpha.myshopify.com', tokenStore: store(token(['read_products'])), client: { query: () => Promise.reject(new Error('Access denied for catalogs field shpat_secret')) } })).resolves.toMatchObject({
      catalogs: { status: 'catalog_permission_required', reason: 'catalog_fields_unavailable_or_permission_required' },
      priceLists: { status: 'catalog_permission_required', reason: 'catalog_fields_unavailable_or_permission_required' },
    });
  });
});
