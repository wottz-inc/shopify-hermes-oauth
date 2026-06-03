import { describe, expect, it } from 'vitest';

import { ShopVerificationError, verifyShop } from '../src/shops/verify.js';
import type { AdminShopMetadata, ShopifyAdminClient } from '../src/shopify/admin-client.js';
import { normalizeTokenStoreShopDomain, type StoreShopTokenInput, type TokenStore } from '../src/tokens/local-token-store.js';

class MemoryTokenStore implements TokenStore {
  readonly #records = new Map<string, StoreShopTokenInput & { readonly storedAt: string; readonly updatedAt: string }>();

  public constructor(records: readonly StoreShopTokenInput[] = []) {
    for (const record of records) {
      const shop = normalizeTokenStoreShopDomain(record.shop);
      this.#records.set(shop, { ...record, shop, storedAt: '2026-05-22T12:00:00.000Z', updatedAt: '2026-05-22T12:00:00.000Z' });
    }
  }

  public storeToken(token: StoreShopTokenInput): Promise<void> {
    const shop = normalizeTokenStoreShopDomain(token.shop);
    const existing = this.#records.get(shop);
    this.#records.set(shop, {
      ...token,
      shop,
      storedAt: existing?.storedAt ?? '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:05:00.000Z',
    });
    return Promise.resolve();
  }

  public getToken(shop: string) {
    const token = this.#records.get(normalizeTokenStoreShopDomain(shop));
    return Promise.resolve(token === undefined
      ? undefined
      : {
        shop: token.shop,
        accessToken: token.accessToken,
        scopes: typeof token.scopes === 'string' ? token.scopes.split(',') : token.scopes,
        storedAt: token.storedAt,
        updatedAt: token.updatedAt,
        ...(token.metadata === undefined ? {} : { metadata: token.metadata }),
      });
  }

  public async listTokens() {
    const records = [];
    for (const shop of this.#records.keys()) {
      const token = await this.getToken(shop);
      if (token !== undefined) {
        records.push(token);
      }
    }
    return records;
  }

  public deleteToken(shop: string): Promise<boolean> {
    return Promise.resolve(this.#records.delete(normalizeTokenStoreShopDomain(shop)));
  }
}

class FakeAdminClient implements ShopifyAdminClient {
  public calls: { readonly shop: string; readonly accessToken: string }[] = [];

  public constructor(private readonly response: AdminShopMetadata | Error) {}

  public getShopMetadata(input: { readonly shop: string; readonly accessToken: string }): Promise<AdminShopMetadata> {
    this.calls.push(input);

    if (this.response instanceof Error) {
      return Promise.reject(this.response);
    }

    return Promise.resolve(this.response);
  }
}

describe('verifyShop', () => {
  it('fails safely and audits failure when a shop has no stored token', async () => {
    const auditEvents: unknown[] = [];
    const adminClient = new FakeAdminClient({ name: 'Should Not Call', myshopifyDomain: 'missing.myshopify.com', currencyCode: 'USD' });

    await expect(verifyShop({
      shop: 'missing',
      tokenStore: new MemoryTokenStore(),
      adminClient,
      appendAuditEvent: (event) => {
        auditEvents.push(event);
      },
    })).rejects.toThrow('No stored OAuth token found for missing.myshopify.com.');
    try {
      await verifyShop({
        shop: 'missing',
        tokenStore: new MemoryTokenStore(),
        adminClient,
        appendAuditEvent: () => undefined,
      });
      expect.unreachable('expected missing token failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ShopVerificationError);
      expect((error as ShopVerificationError).code).toBe('SHOP_VERIFICATION_MISSING_TOKEN');
    }

    expect(adminClient.calls).toEqual([]);
    expect(JSON.stringify(auditEvents)).not.toContain('shpat_');
    expect(auditEvents).toEqual([{
      action: 'shops.verify',
      shop: 'missing.myshopify.com',
      result: 'failure',
      metadata: { reason: 'missing_oauth_record' },
    }]);
  });

  it('reports stable code for missing required scopes without calling Admin GraphQL', async () => {
    const adminClient = new FakeAdminClient({ name: 'Should Not Call', myshopifyDomain: 'example.myshopify.com', currencyCode: 'USD' });

    let thrown: unknown;
    try {
      await verifyShop({
        shop: 'example',
        tokenStore: new MemoryTokenStore([{ shop: 'example.myshopify.com', accessToken: 'shpat_do_not_leak', scopes: ['read_products'] }]),
        adminClient,
        requiredScopes: ['read_orders'],
        appendAuditEvent: () => undefined,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShopVerificationError);
    expect((thrown as ShopVerificationError).code).toBe('SHOP_VERIFICATION_MISSING_SCOPES');
    expect(adminClient.calls).toEqual([]);
  });

  it('returns safe metadata, updates non-secret token metadata, and audits success without printing tokens', async () => {
    const accessToken = 'shpat_do_not_leak';
    const store = new MemoryTokenStore([{
      shop: 'example.myshopify.com',
      accessToken,
      scopes: ['read_products'],
      metadata: { shopName: 'Old Name' },
    }]);
    const auditEvents: unknown[] = [];
    const adminClient = new FakeAdminClient({
      name: 'Example Shop',
      myshopifyDomain: 'example.myshopify.com',
      currencyCode: 'USD',
    });

    const result = await verifyShop({
      shop: 'EXAMPLE',
      tokenStore: store,
      adminClient,
      appendAuditEvent: (event) => {
        auditEvents.push(event);
      },
    });

    expect(result).toEqual({
      shop: 'example.myshopify.com',
      metadata: {
        name: 'Example Shop',
        myshopifyDomain: 'example.myshopify.com',
        currencyCode: 'USD',
      },
    });
    expect(adminClient.calls).toEqual([{ shop: 'example.myshopify.com', accessToken }]);
    await expect(store.getToken('example')).resolves.toMatchObject({
      metadata: {
        shopName: 'Example Shop',
        myshopifyDomain: 'example.myshopify.com',
        currencyCode: 'USD',
      },
    });
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(auditEvents)).not.toContain(accessToken);
    expect(auditEvents).toEqual([{
      action: 'shops.verify',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: {
        shopName: 'Example Shop',
        myshopifyDomain: 'example.myshopify.com',
        currencyCode: 'USD',
      },
    }]);
  });

  it('drops pre-existing non-allowlisted metadata when refreshing verified shop metadata', async () => {
    const store = new MemoryTokenStore([{
      shop: 'example.myshopify.com',
      accessToken: 'shpat_do_not_leak',
      scopes: ['read_products'],
      metadata: {
        shopName: 'Old Name',
        currencyCode: 'CAD',
        myshopifyDomain: 'old-example.myshopify.com',
        accessToken: 'persisted-secret',
        privateNote: 'do not keep',
      },
    }]);
    const adminClient = new FakeAdminClient({
      name: 'Example Shop',
      myshopifyDomain: 'example.myshopify.com',
      currencyCode: 'USD',
    });

    await verifyShop({
      shop: 'example',
      tokenStore: store,
      adminClient,
      appendAuditEvent: () => undefined,
    });

    await expect(store.getToken('example')).resolves.toMatchObject({
      metadata: {
        shopName: 'Example Shop',
        myshopifyDomain: 'example.myshopify.com',
        currencyCode: 'USD',
      },
    });
    const refreshedToken = await store.getToken('example');
    expect(refreshedToken?.metadata).not.toHaveProperty('accessToken');
    expect(refreshedToken?.metadata).not.toHaveProperty('privateNote');
    expect(refreshedToken?.metadata).toEqual({
      shopName: 'Example Shop',
      myshopifyDomain: 'example.myshopify.com',
      currencyCode: 'USD',
    });
  });

  it('audits redacted Admin GraphQL failures and does not expose the stored token', async () => {
    const accessToken = 'shpat_do_not_leak';
    const auditEvents: unknown[] = [];
    const adminClient = new FakeAdminClient(new Error(`GraphQL failed for token=[REDACTED]`));

    let thrown: unknown;
    try {
      await verifyShop({
        shop: 'example',
        tokenStore: new MemoryTokenStore([{ shop: 'example.myshopify.com', accessToken, scopes: ['read_products'] }]),
        adminClient,
        appendAuditEvent: (event) => {
          auditEvents.push(event);
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ShopVerificationError);
    expect((thrown as ShopVerificationError).message).toContain('[REDACTED]');
    expect((thrown as ShopVerificationError).code).toBe('SHOP_VERIFICATION_ADMIN_ERROR');

    expect(JSON.stringify(auditEvents)).not.toContain(accessToken);
    expect(auditEvents).toEqual([{
      action: 'shops.verify',
      shop: 'example.myshopify.com',
      result: 'failure',
      metadata: { reason: 'admin_graphql_error', error: 'GraphQL failed for token=[REDACTED]' },
    }]);
  });

  it('redacts arbitrary injected admin client secrets before auditing or throwing', async () => {
    const accessToken = 'shpat_do_not_leak';
    const plainSecret = 'plain_access_secret';
    const bearerSecret = 'plain_bearer_secret';
    const headerSecret = 'plain_header_secret';
    const cookieSecret = 'plain_cookie_secret';
    const auditEvents: unknown[] = [];
    const adminClient = new FakeAdminClient(new Error(
      `Admin failed with ${JSON.stringify({
        access_token: plainSecret,
        authorization: `Bearer ${bearerSecret}`,
        headers: { 'X-Shopify-Access-Token': headerSecret, cookie: cookieSecret },
      })}`,
    ));

    let thrownMessage = '';
    try {
      await verifyShop({
        shop: 'example',
        tokenStore: new MemoryTokenStore([{ shop: 'example.myshopify.com', accessToken, scopes: ['read_products'] }]),
        adminClient,
        appendAuditEvent: (event) => {
          auditEvents.push(event);
        },
      });
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }

    expect(thrownMessage).toContain('[REDACTED]');
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).toContain('[REDACTED]');
    for (const secret of [accessToken, plainSecret, bearerSecret, headerSecret, cookieSecret]) {
      expect(serializedAudit).not.toContain(secret);
      expect(thrownMessage).not.toContain(secret);
    }
  });

  it('redacts sensitive injected admin client header names before auditing or throwing', async () => {
    const auditEvents: unknown[] = [];
    const adminClient = new FakeAdminClient(new Error('upstream echoed X-Shopify-Access-Token and authorization headers'));

    let thrownMessage = '';
    try {
      await verifyShop({
        shop: 'example',
        tokenStore: new MemoryTokenStore([{ shop: 'example.myshopify.com', accessToken: 'shpat_do_not_leak', scopes: ['read_products'] }]),
        adminClient,
        appendAuditEvent: (event) => {
          auditEvents.push(event);
        },
      });
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }

    const serializedAudit = JSON.stringify(auditEvents);
    expect(thrownMessage).toBe('[REDACTED]');
    expect(serializedAudit).toContain('[REDACTED]');
    expect(thrownMessage).not.toMatch(/x-shopify-access-token|authorization|shpat/iu);
    expect(serializedAudit).not.toMatch(/x-shopify-access-token|authorization|shpat/iu);
  });
});
