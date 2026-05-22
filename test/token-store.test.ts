import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalJsonTokenStore } from '../src/tokens/local-token-store.js';

const tempRoots: string[] = [];

async function makeStore(): Promise<{ readonly file: string; readonly store: LocalJsonTokenStore }> {
  const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-tokens-'));
  tempRoots.push(root);
  const file = join(root, 'tokens.json');
  return { file, store: new LocalJsonTokenStore({ path: file, now: () => '2026-05-22T12:00:00.000Z' }) };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalJsonTokenStore', () => {
  it('stores, gets, lists, and deletes per-shop tokens with normalized domains and restrictive file mode', async () => {
    const { file, store } = await makeStore();

    await store.storeToken({
      shop: 'Example.MyShopify.Com',
      accessToken: 'shpat_test_secret',
      scopes: ['read_products', 'read_orders'],
      metadata: { shopName: 'Example Shop', currencyCode: 'USD', myshopifyDomain: 'example.myshopify.com' },
    });

    await expect(readFile(file, 'utf8')).resolves.toContain('shpat_test_secret');
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const token = await store.getToken('example');
    expect(token).toEqual({
      shop: 'example.myshopify.com',
      accessToken: 'shpat_test_secret',
      scopes: ['read_products', 'read_orders'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:00:00.000Z',
      metadata: { shopName: 'Example Shop', currencyCode: 'USD', myshopifyDomain: 'example.myshopify.com' },
    });

    const listed = await store.listTokens();
    expect(listed).toEqual([token]);

    expect(await store.deleteToken('EXAMPLE.myshopify.com')).toBe(true);
    expect(await store.getToken('example.myshopify.com')).toBeUndefined();
    expect(await store.listTokens()).toEqual([]);
    expect(await store.deleteToken('example.myshopify.com')).toBe(false);
  });

  it('updates existing shops while preserving storedAt', async () => {
    let now = '2026-05-22T12:00:00.000Z';
    const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-tokens-'));
    tempRoots.push(root);
    const store = new LocalJsonTokenStore({ path: join(root, 'tokens.json'), now: () => now });

    await store.storeToken({ shop: 'example', accessToken: 'first-token', scopes: ['read_products'] });
    now = '2026-05-22T12:05:00.000Z';
    await store.storeToken({ shop: 'example.myshopify.com', accessToken: 'second-token', scopes: 'read_orders, read_customers' });

    await expect(store.getToken('example')).resolves.toMatchObject({
      shop: 'example.myshopify.com',
      accessToken: 'second-token',
      scopes: ['read_orders', 'read_customers'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:05:00.000Z',
    });
  });

  it('returns defensive copies from get and list', async () => {
    const { store } = await makeStore();
    await store.storeToken({
      shop: 'example',
      accessToken: 'secret-token',
      scopes: ['read_products'],
      metadata: { shopName: 'Original' },
    });

    const fromGet = await store.getToken('example');
    const fromList = (await store.listTokens())[0];
    expect(fromGet).toBeDefined();
    expect(fromList).toBeDefined();

    (fromGet as unknown as { scopes: string[] }).scopes.push('write_products');
    (fromGet as unknown as { metadata: { shopName: string } }).metadata.shopName = 'Mutated';
    (fromList as unknown as { accessToken: string }).accessToken = 'mutated-token';

    await expect(store.getToken('example')).resolves.toEqual({
      shop: 'example.myshopify.com',
      accessToken: 'secret-token',
      scopes: ['read_products'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:00:00.000Z',
      metadata: { shopName: 'Original' },
    });
  });

  it('rejects blank tokens and invalid scopes or metadata', async () => {
    const { store } = await makeStore();

    await expect(store.storeToken({ shop: 'example', accessToken: '   ', scopes: ['read_products'] })).rejects.toThrow('Access token cannot be blank');
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: ['read_products', '  '] })).rejects.toThrow('Scopes must be non-blank strings');
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: [] })).rejects.toThrow('At least one scope is required');
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: ['read_products'], metadata: { shopName: '  ' } })).rejects.toThrow('Metadata values must be non-blank strings');
  });
});
