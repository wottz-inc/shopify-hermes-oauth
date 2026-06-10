import { createHmac } from 'node:crypto';
import { Socket, type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOAuthHttpServer, type OAuthHttpServerDependencies } from '../src/server.js';

const clientSecret = 'shpss_super_secret_value';
const accessToken = 'shpat_mocked_access_token';
const appUrl = 'https://app.example';

const servers: ReturnType<typeof createOAuthHttpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error: Error | undefined) => {
            if (error === undefined) {
              resolve();
              return;
            }

            reject(error);
          });
        }),
    ),
  );
  servers.length = 0;
});

describe('OAuth HTTP server routes', () => {
  it('returns a generic 500 and does not leak unhandled rejections when a route response write fails once', async () => {
    const deps = makeDeps();
    const server = createOAuthHttpServer(deps);
    server.prependListener('request', (_request, response) => {
      const originalWriteHead = response.writeHead.bind(response);
      let failedOnce = false;
      response.writeHead = ((...args: Parameters<typeof response.writeHead>) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error(`route failure containing ${clientSecret}`);
        }

        return originalWriteHead(...args);
      }) as typeof response.writeHead;
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port.toString(10)}`;

    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(response.status).toBe(500);
      expect(body).toBe('Internal server error');
      expect(body).not.toContain(clientSecret);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('returns a generic 500 for a malformed request URL route write failure without unhandled rejections', async () => {
    const deps = makeDeps();
    const server = createOAuthHttpServer(deps);
    server.prependListener('request', (_request, response) => {
      const originalWriteHead = response.writeHead.bind(response);
      let failedOnce = false;
      response.writeHead = ((...args: Parameters<typeof response.writeHead>) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error(`malformed URL route failure containing ${clientSecret}`);
        }

        return originalWriteHead(...args);
      }) as typeof response.writeHead;
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;

    try {
      const rawResponse = await sendRawHttpRequest(
        address.port,
        'GET http://[::1 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(rawResponse).toContain('HTTP/1.1 500 Internal Server Error');
      expect(rawResponse).toContain('Internal server error');
      expect(rawResponse).not.toContain(clientSecret);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('swallows fallback response write failures, destroys the response, and does not leak an unhandled rejection', async () => {
    const deps = makeDeps();
    const server = createOAuthHttpServer(deps);
    let responseDestroyed = false;
    server.prependListener('request', (_request, response) => {
      const originalDestroy = response.destroy.bind(response);
      response.destroy = (...args: Parameters<typeof response.destroy>) => {
        responseDestroyed = true;
        return originalDestroy(...args);
      };
      response.writeHead = () => {
        throw new Error(`response write failed with ${clientSecret}`);
      };
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;

    try {
      await sendRawHttpRequestAndClose(address.port, 'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandledRejections).toEqual([]);
      expect(responseDestroyed).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('returns safe metadata from /health without secrets', async () => {
    const { baseUrl } = await listen(makeDeps());

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(body)).toEqual({ ok: true, service: 'shopify-hermes-oauth' });
    expect(body).not.toContain(clientSecret);
    expect(body).not.toContain(accessToken);
  });

  it('validates shop on /auth/start and redirects to Shopify OAuth URL with state', async () => {
    const deps = makeDeps();
    const { baseUrl } = await listen(deps);

    const response = await fetch(`${baseUrl}/auth/start?shop=Example-Shop.myshopify.com`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(deps.stateStore.create).toHaveBeenCalledWith({
      shop: 'example-shop.myshopify.com',
      redirectUri: `${appUrl}/auth/callback`,
    });

    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    const redirectUrl = new URL(location ?? '');
    expect(redirectUrl.origin).toBe('https://example-shop.myshopify.com');
    expect(redirectUrl.pathname).toBe('/admin/oauth/authorize');
    expect(redirectUrl.searchParams.get('client_id')).toBe('client-id');
    expect(redirectUrl.searchParams.get('scope')).toBe('read_products,write_orders');
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe(`${appUrl}/auth/callback`);
    expect(redirectUrl.searchParams.get('state')).toBe('state-123');
    expect(location).not.toContain(clientSecret);
  });

  it('trims and drops blank programmatic config scopes before building the Shopify OAuth URL', async () => {
    const baseDeps = makeDeps();
    const deps: OAuthHttpServerDependencies = {
      ...baseDeps,
      config: {
        ...baseDeps.config,
        scopes: [' read_products ', '', '  ', 'write_orders'],
      },
    };
    const { baseUrl } = await listen(deps);

    const response = await fetch(`${baseUrl}/auth/start?shop=Example-Shop.myshopify.com`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    const redirectUrl = new URL(location ?? '');
    expect(redirectUrl.searchParams.get('scope')).toBe('read_products,write_orders');
  });

  it('rejects invalid /auth/start shop input without leaking user input', async () => {
    const { baseUrl } = await listen(makeDeps());

    const response = await fetch(`${baseUrl}/auth/start?shop=https://evil.example/path`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid Shopify shop domain');
    expect(body).not.toContain('evil.example');
  });

  it('rejects an invalid callback HMAC before state consume, token exchange, or token store', async () => {
    const deps = makeDeps();
    const { baseUrl } = await listen(deps);
    const params = new URLSearchParams({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-123',
      timestamp: '1700000000',
      hmac: 'invalid-hmac',
    });

    const response = await fetch(`${baseUrl}/auth/callback?${params.toString()}`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(deps.stateStore.consume).not.toHaveBeenCalled();
    expect(deps.tokenExchange).not.toHaveBeenCalled();
    expect(deps.tokenStore.storeToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid callback state before token exchange or token store', async () => {
    const deps = { ...makeDeps(), now: Date.now };
    deps.stateStore.consume.mockImplementation(() => {
      throw new Error('Invalid or expired OAuth state');
    });
    const { baseUrl } = await listen(deps);
    const callbackTimestamp = Math.floor(Date.now() / 1_000).toString(10);
    const callbackUrl = signedCallbackUrl(baseUrl, {
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-123',
      timestamp: callbackTimestamp,
    });

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe('Invalid OAuth callback');
    expect(deps.tokenExchange).not.toHaveBeenCalled();
    expect(deps.tokenStore.storeToken).not.toHaveBeenCalled();
  });

  it('exchanges and stores a token for a valid mocked callback', async () => {
    const deps = { ...makeDeps(), now: Date.now };
    const { baseUrl } = await listen(deps);
    const callbackTimestamp = Math.floor(Date.now() / 1_000).toString(10);
    const callbackUrl = signedCallbackUrl(baseUrl, {
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-123',
      timestamp: callbackTimestamp,
    });

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('OAuth install complete');
    expect(deps.stateStore.consume).toHaveBeenCalledWith('state-123');
    expect(deps.tokenExchange).toHaveBeenCalledWith({
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      redirectUri: `${appUrl}/auth/callback`,
    });
    expect(deps.tokenStore.storeToken).toHaveBeenCalledWith({
      shop: 'example.myshopify.com',
      accessToken,
      scopes: ['read_products', 'write_orders'],
    });
    expect(body).not.toContain(accessToken);
    expect(body).not.toContain(clientSecret);
  });

  it.each([
    { name: 'omitted', exchangeResult: { accessToken } },
    { name: 'empty', exchangeResult: { accessToken, scopes: '' } },
  ] as const)('fails closed and does not store configured scopes when token exchange returns $name scopes', async ({ exchangeResult }) => {
    const deps = { ...makeDeps(), now: Date.now };
    deps.tokenExchange.mockResolvedValue(exchangeResult);
    const { baseUrl } = await listen(deps);
    const callbackTimestamp = Math.floor(Date.now() / 1_000).toString(10);
    const callbackUrl = signedCallbackUrl(baseUrl, {
      shop: 'example.myshopify.com',
      code: 'oauth-code',
      state: 'state-123',
      timestamp: callbackTimestamp,
    });

    const response = await fetch(callbackUrl);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Required Shopify Admin API scopes are missing');
    expect(body).toContain('Reinstall or re-authorize the shop');
    expect(body).not.toContain(accessToken);
    expect(body).not.toContain(clientSecret);
    expect(deps.tokenStore.storeToken).not.toHaveBeenCalled();
  });
});

function makeDeps(): OAuthHttpServerDependencies & {
  stateStore: {
    create: ReturnType<typeof vi.fn>;
    consume: ReturnType<typeof vi.fn>;
  };
  tokenExchange: ReturnType<typeof vi.fn>;
  tokenStore: { storeToken: ReturnType<typeof vi.fn> };
} {
  return {
    config: {
      clientId: 'client-id',
      clientSecret,
      appUrl,
      scopes: ['read_products', 'write_orders'],
    },
    stateStore: {
      create: vi.fn(() => ({
        state: 'state-123',
        shop: 'example-shop.myshopify.com',
        redirectUri: `${appUrl}/auth/callback`,
        expiresAt: 1_700_000_900_000,
      })),
      consume: vi.fn(() => ({
        state: 'state-123',
        shop: 'example.myshopify.com',
        redirectUri: `${appUrl}/auth/callback`,
        expiresAt: 1_700_000_900_000,
      })),
    },
    tokenExchange: vi.fn(() => Promise.resolve({ accessToken, scopes: ['read_products', 'write_orders'] })),
    tokenStore: { storeToken: vi.fn(() => Promise.resolve()) },
    now: () => 1_700_000_000_000,
  };
}

async function listen(deps: OAuthHttpServerDependencies): Promise<{ baseUrl: string }> {
  const server = createOAuthHttpServer(deps);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return { baseUrl: `http://127.0.0.1:${address.port.toString(10)}` };
}

async function sendRawHttpRequest(port: number, request: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new Socket();
    const cleanup = (): void => {
      socket.off('error', reject);
      socket.destroy();
    };
    socket.once('error', reject);
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.once('close', () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.connect(port, '127.0.0.1', () => {
      socket.write(request);
    });
  });
}

async function sendRawHttpRequestAndClose(port: number, request: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    const cleanup = (): void => {
      socket.off('error', reject);
      socket.destroy();
    };
    socket.once('error', reject);
    socket.connect(port, '127.0.0.1', () => {
      socket.write(request, () => {
        setImmediate(() => {
          cleanup();
          resolve();
        });
      });
    });
  });
}

function signedCallbackUrl(
  baseUrl: string,
  params: Record<'shop' | 'code' | 'state' | 'timestamp', string>,
): string {
  const searchParams = new URLSearchParams(params);
  searchParams.set('hmac', signParams(searchParams));

  return `${baseUrl}/auth/callback?${searchParams.toString()}`;
}

function signParams(params: URLSearchParams): string {
  const message = [...params.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return createHmac('sha256', clientSecret).update(message).digest('hex');
}
