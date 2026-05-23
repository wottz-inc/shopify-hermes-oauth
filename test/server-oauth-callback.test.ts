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
