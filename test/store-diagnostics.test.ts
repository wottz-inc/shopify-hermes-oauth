import { describe, expect, it } from 'vitest';

import { generateStoreDiagnostics } from '../src/shops/diagnostics.js';
import { type StoredShopToken, type TokenStore } from '../src/tokens/local-token-store.js';

function token(scopes: readonly string[], extras: Partial<StoredShopToken> = {}): StoredShopToken {
  return {
    shop: 'alpha.myshopify.com',
    accessToken: 'shpat_do-not-leak',
    scopes,
    grantedScopes: scopes,
    requestedScopes: ['read_products', 'read_content'],
    storedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...extras,
  };
}

function store(record: StoredShopToken | undefined): Pick<TokenStore, 'getToken'> {
  return { getToken: () => record };
}

describe('safe store diagnostics', () => {
  it('returns curated store/app/access details and skips privacy query when read_content is missing', async () => {
    const queries: readonly string[] = [];
    const seenQueries: string[] = [];
    const result = await generateStoreDiagnostics({
      shop: 'Alpha.MyShopify.com',
      tokenStore: store(token(['read_products'], { grantedScopes: ['read_products', 'write_products'] })),
      configuredScopes: ['read_products', 'read_content'],
      client: {
        query: (query: string) => {
          seenQueries.push(query);
          expect(query).not.toContain('privacyPolicy');
          expect(query).not.toContain('body');
          return Promise.resolve({
            data: {
              shop: {
                name: 'Alpha',
                myshopifyDomain: 'alpha.myshopify.com',
                currencyCode: 'USD',
                plan: { displayName: 'Basic' },
                primaryDomain: { host: 'alpha.example', url: 'https://alpha.example' },
                ianaTimezone: 'America/New_York',
                enabledPresentmentCurrencies: ['USD', 'CAD'],
              },
              currentAppInstallation: {
                app: { title: 'Hermes OAuth', handle: 'hermes-oauth' },
                accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
              },
            },
          });
        },
      },
    });

    expect(queries).toEqual([]);
    expect(seenQueries).toHaveLength(1);
    expect(result).toEqual({
      shop: 'alpha.myshopify.com',
      store: {
        name: 'Alpha',
        myshopifyDomain: 'alpha.myshopify.com',
        currencyCode: 'USD',
        planName: 'Basic',
        primaryDomain: { host: 'alpha.example', url: 'https://alpha.example' },
        ianaTimezone: 'America/New_York',
        presentmentCurrencies: ['USD', 'CAD'],
      },
      app: {
        installationStatus: 'installed',
        title: 'Hermes OAuth',
        handle: 'hermes-oauth',
        accessScopes: ['read_products', 'write_products'],
      },
      access: {
        storedScopes: ['read_products'],
        grantedScopes: ['read_products', 'write_products'],
        configuredScopes: ['read_products', 'read_content'],
        missingConfiguredScopes: ['read_content'],
        extraGrantedScopes: ['write_products'],
      },
      privacy: { status: 'missing_scope', requiredScope: 'read_content' },
    });
    expect(JSON.stringify(result)).not.toContain('shpat_do-not-leak');
  });

  it('queries only privacy policy presence/url/title when read_content is granted', async () => {
    const seenQueries: string[] = [];
    const result = await generateStoreDiagnostics({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_products', 'read_content'])),
      configuredScopes: ['read_products', 'read_content'],
      client: {
        query: (query: string) => {
          seenQueries.push(query);
          expect(query).not.toMatch(/body|customerPrivacy|customers|billing|owner|email|phone/iu);
          if (seenQueries.length === 1) {
            return Promise.resolve({ data: { shop: { name: 'Alpha', myshopifyDomain: 'alpha.myshopify.com', currencyCode: 'USD' }, currentAppInstallation: { app: { title: 'Hermes OAuth' }, accessScopes: [{ handle: 'read_content' }] } } });
          }
          return Promise.resolve({ data: { shop: { privacyPolicy: { title: 'Privacy', url: 'https://alpha.example/policies/privacy-policy' }, refundPolicy: null, termsOfService: { title: 'Terms', url: null } } } });
        },
      },
    });

    expect(seenQueries).toHaveLength(2);
    expect(result.privacy).toEqual({
      status: 'ok',
      policies: [
        { type: 'privacyPolicy', present: true, title: 'Privacy', url: 'https://alpha.example/policies/privacy-policy' },
        { type: 'refundPolicy', present: false },
        { type: 'termsOfService', present: true, title: 'Terms' },
      ],
    });
  });

  it('uses current app granted scopes, not stale token scopes, to gate privacy queries', async () => {
    const seenQueries: string[] = [];
    const result = await generateStoreDiagnostics({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_products', 'read_content'])),
      configuredScopes: ['read_products', 'read_content'],
      client: {
        query: (query: string) => {
          seenQueries.push(query);
          expect(query).not.toContain('privacyPolicy');
          return Promise.resolve({
            data: {
              shop: { name: 'Alpha', myshopifyDomain: 'alpha.myshopify.com', currencyCode: 'USD' },
              currentAppInstallation: { app: { title: 'Hermes OAuth' }, accessScopes: [{ handle: 'read_products' }] },
            },
          });
        },
      },
    });

    expect(seenQueries).toHaveLength(1);
    expect(result.access).toMatchObject({
      storedScopes: ['read_products', 'read_content'],
      grantedScopes: ['read_products'],
      missingConfiguredScopes: ['read_content'],
      extraGrantedScopes: [],
    });
    expect(result.privacy).toEqual({ status: 'missing_scope', requiredScope: 'read_content' });
  });

  it('returns structured privacy unsupported status without raw provider errors', async () => {
    const result = await generateStoreDiagnostics({
      shop: 'alpha.myshopify.com',
      tokenStore: store(token(['read_content'])),
      configuredScopes: ['read_content'],
      client: {
        query: (query: string) => {
          if (query.includes('StorePrivacyDiagnostics')) {
            return Promise.reject(new Error('GraphQL Errors: Cannot query field "privacyPolicy" on type "Shop" with token shpat_secret'));
          }
          return Promise.resolve({ data: { shop: { name: 'Alpha', myshopifyDomain: 'alpha.myshopify.com', currencyCode: 'USD' }, currentAppInstallation: { app: { title: 'Hermes OAuth' }, accessScopes: [{ handle: 'read_content' }] } } });
        },
      },
    });

    expect(result.privacy).toEqual({
      status: 'unsupported',
      reason: 'policy_fields_unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('Cannot query field');
    expect(JSON.stringify(result)).not.toContain('shpat_secret');
  });
});
