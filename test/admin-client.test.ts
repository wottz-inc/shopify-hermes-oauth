import { describe, expect, it } from 'vitest';

import { ShopifyAdminGraphqlError, createShopifyAdminGraphqlClient, redactSensitiveText } from '../src/shopify/admin-client.js';

const SHOP = 'example.myshopify.com';
const TOKEN = 'shpat_super_secret_token';

function jsonResponse(body: unknown, init: { readonly ok?: boolean; readonly status?: number; readonly statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? (init.ok === false ? 500 : 200),
    statusText: init.statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchInputToString(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

describe('Shopify Admin GraphQL client', () => {
  it('posts the safe shop metadata query to the Admin GraphQL endpoint with the access token header', async () => {
    const calls: { readonly url: string; readonly init: RequestInit }[] = [];
    const fetch: typeof globalThis.fetch = (url, init) => {
      calls.push({ url: fetchInputToString(url), init: init ?? {} });
      return Promise.resolve(jsonResponse({
        data: {
          shop: {
            name: 'Example Shop',
            myshopifyDomain: SHOP,
            currencyCode: 'USD',
          },
        },
      }));
    };
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).resolves.toEqual({
      name: 'Example Shop',
      myshopifyDomain: SHOP,
      currencyCode: 'USD',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.myshopify.com/admin/api/2026-01/graphql.json');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-shopify-access-token': TOKEN,
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      query: '{ shop { name myshopifyDomain currencyCode } }',
    });
  });

  it('throws redacted errors for GraphQL failures without raw tokens or sensitive headers', async () => {
    const fetch: typeof globalThis.fetch = () => Promise.resolve(jsonResponse({
      errors: [
        {
          message: `Denied with X-Shopify-Access-Token: ${TOKEN}`,
          extensions: { authorization: `Bearer ${TOKEN}` },
        },
      ],
    }));
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.toThrow(ShopifyAdminGraphqlError);
    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.toThrow('[REDACTED]');

    try {
      await client.getShopMetadata({ shop: SHOP, accessToken: TOKEN });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain('Bearer shpat');
      expect(message).not.toContain('X-Shopify-Access-Token');
      expect(message).not.toContain('authorization');
    }
  });

  it('redacts sensitive substrings from thrown network and HTTP error details', async () => {
    expect(redactSensitiveText(`Authorization: Bearer ${TOKEN}`)).toBe('Authorization: [REDACTED]');
    expect(redactSensitiveText(`X-Shopify-Access-Token: ${TOKEN}`)).toBe('X-Shopify-Access-Token: [REDACTED]');
    expect(redactSensitiveText(`token=${TOKEN}`)).toBe('token=[REDACTED]');

    const fetch: typeof globalThis.fetch = () => Promise.reject(new Error(`network failed with token=${TOKEN}`));
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.not.toThrow(TOKEN);
    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.toThrow('token=[REDACTED]');
  });

  it('redacts arbitrary sensitive values from non-OK HTTP JSON bodies', async () => {
    const plainSecret = 'plain_access_secret';
    const bearerSecret = 'plain_bearer_secret';
    const headerSecret = 'plain_header_secret';
    const fetch: typeof globalThis.fetch = () => Promise.resolve(jsonResponse({
      access_token: plainSecret,
      authorization: `Bearer ${bearerSecret}`,
      headers: { 'X-Shopify-Access-Token': headerSecret },
    }, { ok: false, status: 401 }));
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    try {
      await client.getShopMetadata({ shop: SHOP, accessToken: TOKEN });
      expect.unreachable('expected HTTP error');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('[REDACTED]');
      for (const secret of [plainSecret, bearerSecret, headerSecret]) {
        expect(message).not.toContain(secret);
      }
    }
  });

  it('redacts camelCase secret keys from raw JSON-like strings', () => {
    const rawSecret = 'oauth-client-secret-value';
    const redacted = redactSensitiveText(`{"clientSecret":"${rawSecret}","safe":"ok"}`);

    expect(redacted).toBe('{"clientSecret":"[REDACTED]","safe":"ok"}');
    expect(redacted).not.toContain(rawSecret);
  });
});
