import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';

import { createOAuthHttpServer, type OAuthHttpServerDependencies } from '../src/server.js';
import { createOAuthHttpServerForTesting } from '../src/__test__/oauth-http-server.js';

const openServers: Server[] = [];

const baseDependencies = (): OAuthHttpServerDependencies => ({
  config: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    appUrl: 'http://127.0.0.1:3000',
    scopes: ['read_products'],
  },
  stateStore: {
    create: () => ({
      state: 'state-value',
      shop: 'example.myshopify.com',
      expiresAt: Date.now() + 60_000,
    }),
    consume: () => ({
      state: 'state-value',
      shop: 'example.myshopify.com',
      expiresAt: Date.now() + 60_000,
    }),
  },
  tokenExchange: () => ({ accessToken: 'offline-token' }),
  tokenStore: { storeToken: () => undefined },
  now: () => 1_700_000_000_000,
});

describe('OAuth callback HMAC validation', () => {
  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
  });

  it('rate-limits auth-start requests per IP and shop with a safe generic 429', async () => {
    let now = 1_000;
    const createdShops: string[] = [];
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      authStartRateLimit: { maxRequests: 2, windowMs: 60_000 },
      now: () => now,
      stateStore: {
        ...baseDependencies().stateStore,
        create: ({ shop }) => {
          createdShops.push(shop);
          return {
            state: `state-secret-${createdShops.length.toString(10)}`,
            shop,
            expiresAt: now + 60_000,
          };
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);

    const first = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
    const second = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
    const limited = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
    const limitedBody = await limited.text();

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('location')).toBeNull();
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(limitedBody).toBe('Too many requests');
    expect(limitedBody).not.toContain('state-secret');
    expect(limitedBody).not.toContain('test-client-secret');
    expect(createdShops).toEqual(['example.myshopify.com', 'example.myshopify.com']);

    now = 61_001;
    const afterWindow = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });

    expect(afterWindow.status).toBe(302);
    expect(createdShops).toEqual(['example.myshopify.com', 'example.myshopify.com', 'example.myshopify.com']);
  });

  it('tracks auth-start rate limits independently for different shops from the same IP', async () => {
    const createdShops: string[] = [];
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      authStartRateLimit: { maxRequests: 1, windowMs: 60_000 },
      stateStore: {
        ...baseDependencies().stateStore,
        create: ({ shop }) => {
          createdShops.push(shop);
          return {
            state: `state-${shop}`,
            shop,
            expiresAt: Date.now() + 60_000,
          };
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);

    const example = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
    const other = await fetch(`${baseUrl}/auth/start?shop=other.myshopify.com`, { redirect: 'manual' });
    const limitedExample = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });

    expect(example.status).toBe(302);
    expect(other.status).toBe(302);
    expect(limitedExample.status).toBe(429);
    expect(createdShops).toEqual(['example.myshopify.com', 'other.myshopify.com']);
  });

  it('does not trust arbitrary x-forwarded-for values for auth-start rate limiting', async () => {
    const createdShops: string[] = [];
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      authStartRateLimit: { maxRequests: 1, windowMs: 60_000 },
      stateStore: {
        ...baseDependencies().stateStore,
        create: ({ shop }) => {
          createdShops.push(shop);
          return {
            state: `state-${createdShops.length.toString(10)}`,
            shop,
            expiresAt: Date.now() + 60_000,
          };
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);

    const first = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, {
      headers: { 'x-forwarded-for': '198.51.100.10' },
      redirect: 'manual',
    });
    const second = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, {
      headers: { 'x-forwarded-for': '203.0.113.20' },
      redirect: 'manual',
    });

    expect(first.status).toBe(302);
    expect(second.status).toBe(429);
    expect(createdShops).toEqual(['example.myshopify.com']);
  });

  it('bounds auth-start rate-limit buckets and prunes expired buckets deterministically', async () => {
    let now = 1_000;
    const createdShops: string[] = [];
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      authStartRateLimit: { maxRequests: 10, windowMs: 60_000, maxBuckets: 2 },
      now: () => now,
      stateStore: {
        ...baseDependencies().stateStore,
        create: ({ shop }) => {
          createdShops.push(shop);
          return {
            state: `state-${createdShops.length.toString(10)}`,
            shop,
            expiresAt: now + 60_000,
          };
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);

    const first = await fetch(`${baseUrl}/auth/start?shop=first.myshopify.com`, { redirect: 'manual' });
    const second = await fetch(`${baseUrl}/auth/start?shop=second.myshopify.com`, { redirect: 'manual' });
    const capped = await fetch(`${baseUrl}/auth/start?shop=third.myshopify.com`, { redirect: 'manual' });

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(capped.status).toBe(429);
    expect(await capped.text()).toBe('Too many requests');
    expect(createdShops).toEqual(['first.myshopify.com', 'second.myshopify.com']);

    now = 61_001;
    const afterPrune = await fetch(`${baseUrl}/auth/start?shop=third.myshopify.com`, { redirect: 'manual' });

    expect(afterPrune.status).toBe(302);
    expect(createdShops).toEqual(['first.myshopify.com', 'second.myshopify.com', 'third.myshopify.com']);
  });

  it('returns a generic 503 when auth-start cannot create OAuth state', async () => {
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      stateStore: {
        ...baseDependencies().stateStore,
        create: () => {
          throw new Error('OAuth state store is at capacity: secret internals');
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);

    const response = await fetch(`${baseUrl}/auth/start?shop=example.myshopify.com`, { redirect: 'manual' });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('OAuth install is temporarily unavailable');
    expect(body).not.toContain('capacity');
    expect(body).not.toContain('secret internals');
  });

  it('rejects an invalid HMAC through the default official Shopify helper path before consuming state', async () => {
    let consumedState: string | undefined;
    let tokenExchangeCalls = 0;
    let storedTokenCalls = 0;
    const dependencies: OAuthHttpServerDependencies = {
      ...baseDependencies(),
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state) => {
          consumedState = state;
          throw new Error('state must not be consumed after invalid HMAC');
        },
      },
      tokenExchange: () => {
        tokenExchangeCalls += 1;
        return { accessToken: 'offline-token' };
      },
      tokenStore: {
        storeToken: () => {
          storedTokenCalls += 1;
        },
      },
    };
    const server = await listen(createOAuthHttpServer(dependencies));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp: '1700000000',
      hmac: '0'.repeat(64),
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(consumedState).toBeUndefined();
    expect(tokenExchangeCalls).toBe(0);
    expect(storedTokenCalls).toBe(0);
  });

  it.each(['state', 'shop', 'code', 'timestamp', 'hmac', 'signature'] as const)(
    'rejects duplicate callback parameter %s before HMAC validation, state consumption, or token exchange',
    async (duplicateKey) => {
      let hmacValidatorCalls = 0;
      let consumedState: string | undefined;
      let tokenExchangeCalls = 0;
      let storedTokenCalls = 0;
      const dependencies = {
        ...baseDependencies(),
        stateStore: {
          ...baseDependencies().stateStore,
          consume: (state: string) => {
            consumedState = state;
            throw new Error('state must not be consumed when duplicate callback params are present');
          },
        },
        tokenExchange: () => {
          tokenExchangeCalls += 1;
          return { accessToken: 'offline-token' };
        },
        tokenStore: {
          storeToken: () => {
            storedTokenCalls += 1;
          },
        },
      } satisfies OAuthHttpServerDependencies;
      const server = await listen(createOAuthHttpServerForTesting({
        ...dependencies,
        hmacValidator: () => {
          hmacValidatorCalls += 1;
          return true;
        },
      }));
      const baseUrl = serverBaseUrl(server);
      const callbackUrl = new URL('/auth/callback', baseUrl);
      const params = new URLSearchParams({
        shop: 'example.myshopify.com',
        code: 'oauth-code',
        state: 'state-value',
        timestamp: '1700000000',
        hmac: '0'.repeat(64),
        signature: 'legacy-signature',
      });
      params.append(duplicateKey, `duplicate-${duplicateKey}`);
      callbackUrl.search = params.toString();

      const response = await fetch(callbackUrl);
      const body = await response.text();

      expect(response.status).toBe(400);
      expect(body).toBe('Invalid OAuth callback');
      expect(hmacValidatorCalls).toBe(0);
      expect(consumedState).toBeUndefined();
      expect(tokenExchangeCalls).toBe(0);
      expect(storedTokenCalls).toBe(0);
    },
  );

  it('keeps the HMAC validator seam out of public OAuth HTTP server dependencies', () => {
    const dependencies = {
      ...baseDependencies(),
      // @ts-expect-error hmacValidator is internal-only and must not be part of the public dependency type.
      hmacValidator: () => true,
    } satisfies OAuthHttpServerDependencies;

    expect(dependencies.config.clientId).toBe('test-client-id');
  });

  it('rejects very large safe-integer callback timestamps without trusting unsafe millisecond arithmetic', async () => {
    let hmacValidatorCalls = 0;
    let consumedState: string | undefined;
    let tokenExchangeCalls = 0;
    let storedTokenCalls = 0;
    const giantTimestamp = Number.MAX_SAFE_INTEGER.toString(10);
    const unsafeMatchingMilliseconds = Number.MAX_SAFE_INTEGER * 1_000;
    const dependencies = {
      ...baseDependencies(),
      now: () => unsafeMatchingMilliseconds,
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state: string) => {
          consumedState = state;
          return {
            state,
            shop: 'example.myshopify.com',
            expiresAt: Date.now() + 60_000,
          };
        },
      },
      tokenExchange: () => {
        tokenExchangeCalls += 1;
        return { accessToken: 'offline-token' };
      },
      tokenStore: {
        storeToken: () => {
          storedTokenCalls += 1;
        },
      },
    } satisfies OAuthHttpServerDependencies;
    const server = await listen(createOAuthHttpServerForTesting({
      ...dependencies,
      hmacValidator: () => {
        hmacValidatorCalls += 1;
        return true;
      },
    }));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp: giantTimestamp,
      hmac: '0'.repeat(64),
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(hmacValidatorCalls).toBe(0);
    expect(consumedState).toBeUndefined();
    expect(tokenExchangeCalls).toBe(0);
    expect(storedTokenCalls).toBe(0);
  });

  it('rejects stale callback timestamps with the generic callback error response', async () => {
    let hmacValidatorCalls = 0;
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      hmacValidator: () => {
        hmacValidatorCalls += 1;
        return true;
      },
    }));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp: '1699999000',
      hmac: '0'.repeat(64),
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(hmacValidatorCalls).toBe(0);
  });

  it('returns a safe actionable diagnostic when callback storage sees no Admin API scopes', async () => {
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      config: {
        ...baseDependencies().config,
        scopes: [],
      },
      tokenExchange: () => ({ accessToken: 'offline-token-secret', scopes: '' }),
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code-secret',
      state: 'state-value-secret',
      timestamp: '1700000000',
      hmac: 'hmac-secret-value',
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Required Shopify Admin API scopes are missing');
    expect(body).toContain('optional scopes alone are insufficient');
    expect(body).toContain('read_products');
    expect(body).toContain('read_orders');
    expect(body).toContain('read_inventory');
    expect(body).toContain('read_locations');
    expect(body).not.toContain('oauth-code-secret');
    expect(body).not.toContain('state-value-secret');
    expect(body).not.toContain('hmac-secret-value');
    expect(body).not.toContain('test-client-secret');
    expect(body).not.toContain('offline-token-secret');
  });

  it('returns a safe canonical-shop retry diagnostic for callback/state shop mismatch', async () => {
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state: string) => ({
          state,
          shop: 'original-shop.myshopify.com',
          expiresAt: Date.now() + 60_000,
        }),
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'canonical-shop.myshopify.com',
      code: 'oauth-code-secret',
      state: 'state-value-secret',
      timestamp: '1700000000',
      hmac: 'hmac-secret-value',
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Shopify returned a different canonical shop domain');
    expect(body).toContain('Retry the install using canonical-shop.myshopify.com');
    expect(body).not.toContain('original-shop.myshopify.com');
    expect(body).not.toContain('oauth-code-secret');
    expect(body).not.toContain('state-value-secret');
    expect(body).not.toContain('hmac-secret-value');
  });

  it('accepts current callback timestamps when validation succeeds', async () => {
    const consumedStates: string[] = [];
    const exchangedCodes: string[] = [];
    const storedShops: string[] = [];
    const server = await listen(createOAuthHttpServerForTesting({
      ...baseDependencies(),
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state: string) => {
          consumedStates.push(state);
          return {
            state,
            shop: 'example.myshopify.com',
            expiresAt: Date.now() + 60_000,
          };
        },
      },
      tokenExchange: ({ code }) => {
        exchangedCodes.push(code);
        return { accessToken: 'offline-token' };
      },
      tokenStore: {
        storeToken: ({ shop }) => {
          storedShops.push(shop);
        },
      },
      hmacValidator: () => true,
    }));
    const baseUrl = serverBaseUrl(server);
    const callbackUrl = new URL('/auth/callback', baseUrl);
    callbackUrl.search = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp: '1700000000',
      hmac: '0'.repeat(64),
    }).toString();

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('OAuth install complete');
    expect(consumedStates).toEqual(['state-value']);
    expect(exchangedCodes).toEqual(['oauth-code']);
    expect(storedShops).toEqual(['example.myshopify.com']);
  });

  it('accepts a valid callback through the default official Shopify HMAC helper path', async () => {
    const consumedStates: string[] = [];
    const exchangedCodes: string[] = [];
    const storedShops: string[] = [];
    const timestamp = Math.floor(Date.now() / 1_000).toString(10);
    const dependencies: OAuthHttpServerDependencies = {
      ...baseDependencies(),
      now: Date.now,
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state) => {
          consumedStates.push(state);
          return {
            state,
            shop: 'example.myshopify.com',
            redirectUri: 'http://127.0.0.1:3000/auth/callback',
            expiresAt: Date.now() + 60_000,
          };
        },
      },
      tokenExchange: ({ code }) => {
        exchangedCodes.push(code);
        return { accessToken: 'offline-token' };
      },
      tokenStore: {
        storeToken: ({ shop }) => {
          storedShops.push(shop);
        },
      },
    };
    const server = await listen(createOAuthHttpServer(dependencies));
    const baseUrl = serverBaseUrl(server);
    const params = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp,
    });
    params.set('hmac', signCallbackParams(params, 'test-client-secret'));

    const response = await fetch(`${baseUrl}/auth/callback?${params.toString()}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('OAuth install complete');
    expect(consumedStates).toEqual(['state-value']);
    expect(exchangedCodes).toEqual(['oauth-code']);
    expect(storedShops).toEqual(['example.myshopify.com']);
  });

  it('accepts callback HMACs signed with the current secret when an old secret is configured', async () => {
    const storedShops: string[] = [];
    const timestamp = Math.floor(Date.now() / 1_000).toString(10);
    const dependencies: OAuthHttpServerDependencies = {
      ...baseDependencies(),
      now: Date.now,
      config: {
        ...baseDependencies().config,
        clientSecret: 'current-client-secret',
        oldClientSecret: 'old-client-secret',
      },
      tokenStore: {
        storeToken: ({ shop }) => {
          storedShops.push(shop);
        },
      },
    };
    const server = await listen(createOAuthHttpServer(dependencies));
    const baseUrl = serverBaseUrl(server);
    const params = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp,
    });
    params.set('hmac', signCallbackParams(params, 'current-client-secret'));

    const response = await fetch(`${baseUrl}/auth/callback?${params.toString()}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('OAuth install complete');
    expect(storedShops).toEqual(['example.myshopify.com']);
  });

  it('accepts callback HMACs signed with the old secret during rotation without exposing which secret matched', async () => {
    const storedShops: string[] = [];
    const timestamp = Math.floor(Date.now() / 1_000).toString(10);
    const dependencies: OAuthHttpServerDependencies = {
      ...baseDependencies(),
      now: Date.now,
      config: {
        ...baseDependencies().config,
        clientSecret: 'current-client-secret',
        oldClientSecret: 'old-client-secret',
      },
      tokenStore: {
        storeToken: ({ shop }) => {
          storedShops.push(shop);
        },
      },
    };
    const server = await listen(createOAuthHttpServer(dependencies));
    const baseUrl = serverBaseUrl(server);
    const params = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp,
    });
    params.set('hmac', signCallbackParams(params, 'old-client-secret'));

    const response = await fetch(`${baseUrl}/auth/callback?${params.toString()}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('OAuth install complete');
    expect(body).not.toContain('old');
    expect(body).not.toContain('current');
    expect(storedShops).toEqual(['example.myshopify.com']);
  });

  it('rejects callback HMACs that match neither the current nor old secret without leaking rotation details', async () => {
    let consumedState: string | undefined;
    const timestamp = Math.floor(Date.now() / 1_000).toString(10);
    const dependencies: OAuthHttpServerDependencies = {
      ...baseDependencies(),
      now: Date.now,
      config: {
        ...baseDependencies().config,
        clientSecret: 'current-client-secret',
        oldClientSecret: 'old-client-secret',
      },
      stateStore: {
        ...baseDependencies().stateStore,
        consume: (state) => {
          consumedState = state;
          throw new Error('state must not be consumed after invalid HMAC');
        },
      },
    };
    const server = await listen(createOAuthHttpServer(dependencies));
    const baseUrl = serverBaseUrl(server);
    const params = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-value',
      timestamp,
    });
    params.set('hmac', signCallbackParams(params, 'neither-client-secret'));

    const response = await fetch(`${baseUrl}/auth/callback?${params.toString()}`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(body).not.toContain('old');
    expect(body).not.toContain('current');
    expect(consumedState).toBeUndefined();
  });
});

async function listen(server: Server): Promise<Server> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not bind to a TCP port');
  }
  return `http://127.0.0.1:${address.port.toString(10)}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function signCallbackParams(params: URLSearchParams, clientSecret: string): string {
  const message = [...params.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return createHmac('sha256', clientSecret).update(message).digest('hex');
}
