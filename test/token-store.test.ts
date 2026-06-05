import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalJsonTokenStore, TokenStoreError, type AssociatedUserMetadata } from '../src/tokens/local-token-store.js';

const tempRoots: string[] = [];

function tokenLength(token: { readonly accessToken: string } | undefined): number | undefined {
  return token?.accessToken.length;
}

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

    const serialized = JSON.parse(await readFile(file, 'utf8')) as { readonly shops: Record<string, { readonly accessToken: string }> };
    expect(serialized.shops['example.myshopify.com']?.accessToken).toHaveLength('shpat_test_secret'.length);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const token = await store.getToken('example');
    expect(token).toMatchObject({
      shop: 'example.myshopify.com',
      scopes: ['read_products', 'read_orders'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:00:00.000Z',
      metadata: { shopName: 'Example Shop', currencyCode: 'USD', myshopifyDomain: 'example.myshopify.com' },
    });
    expect(tokenLength(token)).toBe('shpat_test_secret'.length);

    const listed = await store.listTokens();
    expect(listed).toHaveLength(1);
    expect(listed.map(({ shop, scopes, storedAt, updatedAt, metadata }) => ({ shop, scopes, storedAt, updatedAt, metadata }))).toEqual([
      {
        shop: 'example.myshopify.com',
        scopes: ['read_products', 'read_orders'],
        storedAt: '2026-05-22T12:00:00.000Z',
        updatedAt: '2026-05-22T12:00:00.000Z',
        metadata: { shopName: 'Example Shop', currencyCode: 'USD', myshopifyDomain: 'example.myshopify.com' },
      },
    ]);

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
      scopes: ['read_orders', 'read_customers'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:05:00.000Z',
    });
    const updated = await store.getToken('example');
    expect(tokenLength(updated)).toBe('second-token'.length);
  });

  it('migrates legacy token records to schemaVersion 1 richer metadata without losing tokens', async () => {
    const { file, store } = await makeStore();
    await writeFile(file, JSON.stringify({
      version: 1,
      shops: {
        'legacy.myshopify.com': {
          shop: 'legacy.myshopify.com',
          accessToken: 'legacy-secret-token',
          scopes: 'read_orders,read_products',
          storedAt: '2026-05-21T12:00:00.000Z',
          updatedAt: '2026-05-21T12:00:00.000Z',
          metadata: { shopName: 'Legacy Shop' },
        },
      },
    }), { mode: 0o600 });

    const token = await store.getToken('legacy');
    expect(token).toMatchObject({
      shop: 'legacy.myshopify.com',
      schemaVersion: 1,
      accessMode: 'offline',
      scopes: ['read_orders', 'read_products'],
      grantedScopes: ['read_orders', 'read_products'],
      requestedScopes: ['read_orders', 'read_products'],
      tokenSource: 'authorization_code',
      storedAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
      metadata: { shopName: 'Legacy Shop' },
    });
    expect(tokenLength(token)).toBe('legacy-secret-token'.length);

    await store.storeToken({ shop: 'legacy', accessToken: 'new-secret-token', scopes: ['read_orders'] });
    const serialized = JSON.parse(await readFile(file, 'utf8')) as { readonly shops: Record<string, { readonly accessToken: string; readonly schemaVersion?: number }> };
    expect(serialized.shops['legacy.myshopify.com']).toMatchObject({ schemaVersion: 1, accessToken: 'new-secret-token' });
  });

  it('stores and reads richer token metadata while preserving CLI/report compatibility fields', async () => {
    const { store } = await makeStore();

    await store.storeToken({
      shop: 'online',
      accessToken: 'online-access-token',
      scopes: ['read_products'],
      accessMode: 'online',
      expiresAt: '2026-05-22T13:00:00.000Z',
      refreshToken: 'refresh-secret-token',
      refreshTokenExpiresAt: '2026-05-29T12:00:00.000Z',
      grantedScopes: ['read_products'],
      requestedScopes: ['read_products', 'read_orders'],
      tokenSource: 'token_exchange',
      associatedUser: {
        id: 'gid://shopify/StaffMember/1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.test',
        accountOwner: true,
        locale: 'en',
        collaborator: false,
        token: 'must-not-be-stored',
      } as AssociatedUserMetadata,
    });

    const token = await store.getToken('online');
    expect(token).toMatchObject({
      shop: 'online.myshopify.com',
      accessToken: 'online-access-token',
      scopes: ['read_products'],
      schemaVersion: 1,
      accessMode: 'online',
      expiresAt: '2026-05-22T13:00:00.000Z',
      refreshToken: 'refresh-secret-token',
      refreshTokenExpiresAt: '2026-05-29T12:00:00.000Z',
      grantedScopes: ['read_products'],
      requestedScopes: ['read_products', 'read_orders'],
      tokenSource: 'token_exchange',
      associatedUser: {
        id: 'gid://shopify/StaffMember/1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.test',
        accountOwner: true,
        locale: 'en',
        collaborator: false,
      },
    });
    expect(token?.associatedUser).not.toHaveProperty('token');
  });

  it('accepts future per-record schema versions and ignores unknown stored fields', async () => {
    const { file, store } = await makeStore();
    await writeFile(file, JSON.stringify({
      version: 1,
      shops: {
        'future.myshopify.com': {
          shop: 'future.myshopify.com',
          schemaVersion: 99,
          accessToken: 'future-secret-token',
          refreshToken: 'future-refresh-token',
          scopes: ['read_products'],
          grantedScopes: ['read_products'],
          requestedScopes: ['read_products', 'read_orders'],
          accessMode: 'offline',
          tokenSource: 'manual_import',
          storedAt: '2026-05-21T12:00:00.000Z',
          updatedAt: '2026-05-21T12:00:00.000Z',
          unknownSecretField: 'must-not-leak',
          associatedUser: { id: '1', email: 'safe@example.test', ssn: 'must-not-leak' },
        },
      },
    }), { mode: 0o600 });

    const token = await store.getToken('future');
    expect(token).toMatchObject({
      schemaVersion: 99,
      shop: 'future.myshopify.com',
      accessToken: 'future-secret-token',
      refreshToken: 'future-refresh-token',
      scopes: ['read_products'],
      grantedScopes: ['read_products'],
      requestedScopes: ['read_products', 'read_orders'],
      accessMode: 'offline',
      tokenSource: 'manual_import',
      associatedUser: { id: '1', email: 'safe@example.test' },
    });
    expect(token).not.toHaveProperty('unknownSecretField');
    expect(token?.associatedUser).not.toHaveProperty('ssn');
  });

  it('preserves both shops when two store instances write concurrently to the same file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-tokens-'));
    tempRoots.push(root);
    const file = join(root, 'tokens.json');
    await writeFile(file, '{"version":1,"shops":{}}\n', { mode: 0o600 });

    let releaseFirstWrite: (() => void) | undefined;
    const firstMayWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let resolveSecondStoreScheduled: (() => void) | undefined;
    const secondStoreScheduled = new Promise<void>((resolve) => {
      resolveSecondStoreScheduled = resolve;
    });
    let secondStore: Promise<void> | undefined;

    const firstStore = new LocalJsonTokenStore({
      path: file,
      now: () => '2026-05-22T12:00:00.000Z',
      fileDependencies: {
        async writeFile(path, content, options) {
          if (path !== `${file}.lock`) {
            secondStore ??= new LocalJsonTokenStore({
              path: file,
              now: () => '2026-05-22T12:01:00.000Z',
            }).storeToken({ shop: 'bravo', accessToken: 'second-token', scopes: ['read_orders'] });
            resolveSecondStoreScheduled?.();
            await firstMayWrite;
          }

          await writeFile(path, content, options);
        },
      },
    });

    const firstStorePromise = firstStore.storeToken({
      shop: 'alpha',
      accessToken: 'first-token',
      scopes: ['read_products'],
    });
    await secondStoreScheduled;
    releaseFirstWrite?.();

    await firstStorePromise;
    await secondStore;

    const listed = await new LocalJsonTokenStore({ path: file }).listTokens();
    expect(listed).toHaveLength(2);
    expect(listed.map(({ shop, scopes }) => ({ shop, scopes }))).toEqual([
      { shop: 'alpha.myshopify.com', scopes: ['read_products'] },
      { shop: 'bravo.myshopify.com', scopes: ['read_orders'] },
    ]);
    expect(listed.map((token) => token.accessToken.length)).toEqual([11, 12]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('serializes concurrent delete and store operations so deleting one shop does not discard another store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-tokens-'));
    tempRoots.push(root);
    const file = join(root, 'tokens.json');
    const initialStore = new LocalJsonTokenStore({ path: file, now: () => '2026-05-22T12:00:00.000Z' });
    await initialStore.storeToken({ shop: 'alpha', accessToken: 'initial-token', scopes: ['read_products'] });

    let releaseDeleteWrite: (() => void) | undefined;
    const deleteMayWrite = new Promise<void>((resolve) => {
      releaseDeleteWrite = resolve;
    });
    let resolveConcurrentStoreScheduled: (() => void) | undefined;
    const concurrentStoreScheduled = new Promise<void>((resolve) => {
      resolveConcurrentStoreScheduled = resolve;
    });
    let concurrentStore: Promise<void> | undefined;

    const deletingStore = new LocalJsonTokenStore({
      path: file,
      fileDependencies: {
        async writeFile(path, content, options) {
          if (path !== `${file}.lock`) {
            concurrentStore ??= new LocalJsonTokenStore({
              path: file,
              now: () => '2026-05-22T12:01:00.000Z',
            }).storeToken({ shop: 'bravo', accessToken: 'created-token', scopes: ['read_orders'] });
            resolveConcurrentStoreScheduled?.();
            await deleteMayWrite;
          }

          await writeFile(path, content, options);
        },
      },
    });

    const deletePromise = deletingStore.deleteToken('alpha');
    await concurrentStoreScheduled;
    releaseDeleteWrite?.();

    await expect(deletePromise).resolves.toBe(true);
    await concurrentStore;

    const listed = await new LocalJsonTokenStore({ path: file }).listTokens();
    expect(listed).toHaveLength(1);
    expect(listed.map(({ shop, scopes }) => ({ shop, scopes }))).toEqual([
      { shop: 'bravo.myshopify.com', scopes: ['read_orders'] },
    ]);
    expect(listed.map((token) => token.accessToken.length)).toEqual([13]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
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

    const stored = await store.getToken('example');
    expect(stored).toMatchObject({
      shop: 'example.myshopify.com',
      scopes: ['read_products'],
      storedAt: '2026-05-22T12:00:00.000Z',
      updatedAt: '2026-05-22T12:00:00.000Z',
      metadata: { shopName: 'Original' },
    });
    expect(tokenLength(stored)).toBe('secret-token'.length);
  });

  it('rejects blank tokens and invalid scopes or metadata', async () => {
    const { store } = await makeStore();

    await expect(store.storeToken({ shop: 'example', accessToken: '   ', scopes: ['read_products'] })).rejects.toThrow('Access token cannot be blank');
    try {
      await store.storeToken({ shop: 'example', accessToken: '   ', scopes: ['read_products'] });
      expect.unreachable('expected blank token failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TokenStoreError);
      expect((error as TokenStoreError).code).toBe('TOKEN_STORE_ERROR');
    }
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: ['read_products', '  '] })).rejects.toThrow('Scopes must be non-blank strings');
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: [] })).rejects.toThrow('At least one scope is required');
    await expect(store.storeToken({ shop: 'example', accessToken: 'token', scopes: ['read_products'], metadata: { shopName: '  ' } })).rejects.toThrow('Metadata values must be non-blank strings');
  });
});
