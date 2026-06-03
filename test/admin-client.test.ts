import { describe, expect, it } from 'vitest';

import {
  ShopifyAdminGraphqlError,
  buildShopifyAdminGraphqlEndpoint,
  createShopifyAdminGraphqlClient,
  normalizeShopifyAdminApiVersion,
  redactHttpBody,
  redactSensitiveText,
} from '../src/shopify/admin-client.js';

const SHOP = 'example.myshopify.com';
const TOKEN = 'shpat_super_secret_token';

function jsonResponse(
  body: unknown,
  init: { readonly ok?: boolean; readonly status?: number; readonly statusText?: string; readonly headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), {
    status: init.status ?? (init.ok === false ? 500 : 200),
    statusText: init.statusText,
    headers,
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
  class CustomBody {
    public readonly accessToken = 'class-token-must-use-raw-redaction';
  }

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
      query: 'query ShopMetadata { shop { name myshopifyDomain currencyCode } }',
      operationName: 'ShopMetadata',
    });
  });

  it('normalizes Shopify Admin API versions and centrally builds GraphQL endpoints', () => {
    expect(normalizeShopifyAdminApiVersion(' 2026-01 ')).toBe('2026-01');
    expect(normalizeShopifyAdminApiVersion('unstable')).toBe('unstable');
    expect(buildShopifyAdminGraphqlEndpoint('Example.MyShopify.com', '2026-12')).toBe(
      'https://example.myshopify.com/admin/api/2026-12/graphql.json',
    );
  });

  it.each(['', ' ', '2026-00', '2026-13', '2026-1', '2026-01/../unstable', '2026-01?x=1', '2026 01'])(
    'rejects invalid Shopify Admin API version %j before fetching without echoing the raw input', async (apiVersion) => {
      const fetch: typeof globalThis.fetch = () => {
        expect.unreachable('invalid API versions must fail before network I/O');
      };
      const client = createShopifyAdminGraphqlClient({ apiVersion, fetch });

      await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).rejects.toThrow(ShopifyAdminGraphqlError);
      await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).rejects.toThrow('Invalid Shopify Admin API version.');
      try {
        await client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toBe('Invalid Shopify Admin API version.');
        if (apiVersion.trim().length > 0) {
          expect(message).not.toContain(apiVersion);
        }
        expect((error as ShopifyAdminGraphqlError).code).toBe('INVALID_API_VERSION');
      }
    },
  );

  it('serializes safe GraphQL operation names and includes them in safe diagnostics and telemetry', async () => {
    const calls: { readonly url: string; readonly init: RequestInit }[] = [];
    const telemetry: unknown[] = [];
    const fetch: typeof globalThis.fetch = (url, init) => {
      calls.push({ url: fetchInputToString(url), init: init ?? {} });
      return Promise.resolve(jsonResponse({
        errors: [{ message: 'safe failure' }],
        extensions: { cost: { requestedQueryCost: 1 } },
      }));
    };
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch, onTelemetry: (event) => telemetry.push(event) });

    await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: 'query ProductsReport { products { edges { node { id } } } }', operationName: 'ProductsReport' })).rejects.toThrow(
      'operationName=ProductsReport',
    );

    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      query: 'query ProductsReport { products { edges { node { id } } } }',
      operationName: 'ProductsReport',
    });
    expect(telemetry).toEqual([{ shop: SHOP, operationName: 'ProductsReport', requestedQueryCost: 1 }]);
  });

  it.each([
    ['PII-like operation name', 'Customers Report alice@example.test', 'alice'],
    ['secret-like GraphQL identifier', 'shpat_abc123TOKEN', 'shpat_abc123TOKEN'],
    ['access-token identifier', 'accessToken', 'accessToken'],
    ['callback identifier', 'callbackUrl', 'callbackUrl'],
    ['API-key identifier', 'ApiKeyLookup', 'ApiKeyLookup'],
    ['auth identifier', 'AuthLookup', 'AuthLookup'],
    ['OAuth identifier', 'OAuthLookup', 'OAuthLookup'],
    ['session-cookie identifier', 'sessionCookie', 'sessionCookie'],
  ] as const)('rejects unsafe GraphQL operation names before fetching without echoing raw input: %s', async (_name, unsafeOperationName, leakedValue) => {
    const fetch: typeof globalThis.fetch = () => {
      expect.unreachable('invalid operation names must fail before network I/O');
    };
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }', operationName: unsafeOperationName })).rejects.toThrow(
      'Invalid Shopify Admin GraphQL operation name.',
    );
    try {
      await client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }', operationName: unsafeOperationName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(leakedValue);
      expect(message).not.toContain(unsafeOperationName);
      expect((error as ShopifyAdminGraphqlError).code).toBe('INVALID_OPERATION_NAME');
    }
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

  it.each([
    ['null', null],
    ['array', []],
  ] as const)('throws a controlled error when shop metadata response JSON is %s', async (_name, body) => {
    const fetch: typeof globalThis.fetch = () => Promise.resolve(jsonResponse(body));
    const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch });

    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.toThrow(ShopifyAdminGraphqlError);
    await expect(client.getShopMetadata({ shop: SHOP, accessToken: TOKEN })).rejects.toThrow(
      'Shopify Admin GraphQL response did not include expected shop metadata.',
    );
  });

  it('redacts sensitive substrings from thrown network and HTTP error details', async () => {
    expect(redactSensitiveText(`Authorization: Bearer ${TOKEN}`)).toBe('Authorization: [REDACTED]');
    expect(redactSensitiveText(`X-Shopify-Access-Token: ${TOKEN}`)).toBe('X-Shopify-Access-Token: [REDACTED]');
    expect(redactSensitiveText(`token=${TOKEN}`)).toBe('token=[REDACTED]');

    const fetch: typeof globalThis.fetch = () => Promise.reject(new Error(`network failed with token=${TOKEN}`));
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      retryJitterMs: 0,
      sleep: () => Promise.resolve(),
    });

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
      expect((error as ShopifyAdminGraphqlError).code).toBe('HTTP_ERROR');
      for (const secret of [plainSecret, bearerSecret, headerSecret]) {
        expect(message).not.toContain(secret);
      }
    }
  });

  it.each([
    ['Date', new Date('2026-01-02T03:04:05.000Z')],
    ['Map', new Map([['accessToken', 'map-token-must-use-raw-redaction']])],
    ['class instance', new CustomBody()],
    ['null', null],
  ] as const)('redacts %s HTTP bodies from raw text rather than treating them as plain records', (_name, parsedBody) => {
    const raw = '{"accessToken":"raw-secret-must-not-leak","safe":"ok"}';
    const redacted = redactHttpBody(parsedBody, raw);

    expect(redacted).toBe('{"accessToken":"[REDACTED]","safe":"ok"}');
    expect(redacted).not.toContain('raw-secret-must-not-leak');
  });

  it('continues to redact arrays and plain objects structurally', () => {
    expect(redactHttpBody([{ accessToken: 'array-token-must-not-leak' }], '')).toBe('[{"[REDACTED]":"[REDACTED]"}]');
    expect(redactHttpBody({ accessToken: 'object-token-must-not-leak' }, '')).toBe('{"[REDACTED]":"[REDACTED]"}');
  });

  it('redacts camelCase secret keys from raw JSON-like strings', () => {
    const rawSecret = 'oauth-client-secret-value';
    const redacted = redactSensitiveText(`{"clientSecret":"${rawSecret}","safe":"ok"}`);

    expect(redacted).toBe('{"clientSecret":"[REDACTED]","safe":"ok"}');
    expect(redacted).not.toContain(rawSecret);
  });

  it('redacts generic OAuth, Slack, OpenAI, and Basic authorization token patterns', () => {
    const oauthToken = ['ya', '29.fakeOpaqueOAuthTokenValue1234567890'].join('');
    const slackBotToken = ['xo', 'xb-fakeOpaqueTokenValue'].join('');
    const openAiToken = ['s', 'k-fakeOpaqueTokenValue7890'].join('');
    const basicCredential = ['Basic', ' ZmFrZVVzZXI6ZmFrZVBhc3N3b3Jk'].join('');

    const redacted = redactSensitiveText([
      `oauth response ${oauthToken}`,
      `slack response ${slackBotToken}`,
      `openai response ${openAiToken}`,
      `Authorization: ${basicCredential}`,
    ].join('\n'));

    for (const secret of [oauthToken, slackBotToken, openAiToken, basicCredential]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('oauth response [REDACTED]');
    expect(redacted).toContain('slack response [REDACTED]');
    expect(redacted).toContain('openai response [REDACTED]');
    expect(redacted).toContain('Authorization: [REDACTED]');
  });

  it('redacts long values adjacent to sensitive keys without known token prefixes', () => {
    const opaqueSecret = 'opaqueSecretValueWithoutKnownPrefix1234567890';

    expect(redactSensitiveText(`refresh_token=${opaqueSecret}`)).toBe('refresh_token=[REDACTED]');
    expect(redactSensitiveText(`apiKey: ${opaqueSecret}`)).toBe('apiKey: [REDACTED]');
    expect(redactSensitiveText('note=ordinary short business text')).toBe('note=ordinary short business text');
  });

  it('redacts full comma-delimited sensitive key values', () => {
    const value = 'foo,bar';
    const redacted = redactSensitiveText(`error token=${value} status=401`);

    expect(redacted).toBe('error token=[REDACTED] status=401');
    expect(redacted).not.toContain(value);
  });

  it('redacts single-quoted JSON-like secret keys', () => {
    const rawSecret = 'single-quoted-secret-value';
    const redacted = redactSensitiveText(`{'clientSecret':'${rawSecret}','safe':'ok'}`);

    expect(redacted).toBe("{'clientSecret':'[REDACTED]','safe':'ok'}");
    expect(redacted).not.toContain(rawSecret);
  });

  it('preserves non-secret diagnostic code and state fields while redacting OAuth-specific fields', () => {
    expect(redactSensitiveText('GraphQL extension code=ACCESS_DENIED state=published')).toBe('GraphQL extension code=ACCESS_DENIED state=published');
    expect(redactSensitiveText('OAuth callback oauthCode=secret-code oauthState=secret-state')).toBe('OAuth callback oauthCode=[REDACTED] oauthState=[REDACTED]');
    expect(redactHttpBody({
      errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED', state: 'published', oauthCode: 'oauth-code-secret', oauthState: 'oauth-state-secret' } }],
    }, '')).toBe('{"errors":[{"message":"denied","extensions":{"code":"ACCESS_DENIED","state":"published","[REDACTED]":"[REDACTED]"}}]}');
  });

  it('assigns stable safe error codes to major Admin GraphQL failure paths', async () => {
    const cases: readonly [typeof globalThis.fetch, string][] = [
      [() => Promise.reject(new Error('network token=secret')), 'NETWORK_ERROR'],
      [() => Promise.resolve(new Response('<html>bad json</html>', { status: 200 })), 'INVALID_JSON'],
      [() => Promise.resolve(jsonResponse({ error: 'denied' }, { status: 403 })), 'HTTP_ERROR'],
      [() => Promise.resolve(jsonResponse({ errors: [{ message: 'denied' }] })), 'GRAPHQL_ERRORS'],
      [() => Promise.resolve(jsonResponse({ data: { shop: {} } })), 'INVALID_SHOP_METADATA'],
    ];

    for (const [fetch, expectedCode] of cases) {
      const client = createShopifyAdminGraphqlClient({ apiVersion: '2026-01', fetch, maxRetries: 0 });
      try {
        await client.getShopMetadata({ shop: SHOP, accessToken: TOKEN });
        expect.unreachable('expected Admin GraphQL failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ShopifyAdminGraphqlError);
        expect((error as ShopifyAdminGraphqlError).code).toBe(expectedCode);
      }
    }
  });

  it('redacts OAuth, webhook, and embedded app secrets across query strings, JSON, arrays, and thrown messages', () => {
    const secrets = [
      'oauth-code-secret',
      'oauth-state-secret',
      'hmac-secret-value',
      'signature-secret-value',
      'id-token-secret-value',
      'client-secret-value',
      'old-client-secret-value',
      'refresh-token-value',
      'access-token-value',
    ];
    const redacted = redactSensitiveText([
      'https://app.example.test/auth/callback?code=oauth-code-secret&state=oauth-state-secret&hmac=hmac-secret-value&signature=signature-secret-value',
      JSON.stringify({ id_token: 'id-token-secret-value', client_secret: 'client-secret-value', old_client_secret: 'old-client-secret-value', nested: [{ refresh_token: 'refresh-token-value' }] }),
      'Authorization: Bearer access-token-value',
      'X-Shopify-Access-Token: access-token-value',
      'thrown callback error oauthCode=oauth-code-secret oauthState=oauth-state-secret hmac=hmac-secret-value signature=signature-secret-value',
    ].join('\n'));

    for (const secret of secrets) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('[REDACTED]');
  });

  it('retries HTTP 429 using bounded Retry-After delays before succeeding', async () => {
    const delays: number[] = [];
    const fetchCalls: number[] = [];
    const fetch: typeof globalThis.fetch = () => {
      fetchCalls.push(1);
      if (fetchCalls.length === 1) {
        return Promise.resolve(jsonResponse({ errors: [{ message: 'throttled' }] }, {
          status: 429,
          headers: { 'retry-after': '999' },
        }));
      }

      return Promise.resolve(jsonResponse({ data: { ok: true } }));
    };
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      maxRetries: 2,
      maxRetryDelayMs: 1_000,
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).resolves.toEqual({ data: { ok: true } });
    expect(fetchCalls).toHaveLength(2);
    expect(delays).toEqual([1_000]);
  });

  it('retries retryable HTTP responses even when the transient body is not JSON', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fetch: typeof globalThis.fetch = () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve(new Response('<html>temporary throttle</html>', {
          status: 429,
          headers: { 'retry-after': '2' },
        }));
      }

      return Promise.resolve(jsonResponse({ data: { ok: true } }));
    };
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      maxRetries: 1,
      maxRetryDelayMs: 500,
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).resolves.toEqual({ data: { ok: true } });
    expect(attempts).toBe(2);
    expect(delays).toEqual([500]);
  });

  it('retries transient 5xx and network failures with bounded exponential backoff and jitter', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fetch: typeof globalThis.fetch = () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error('ECONNRESET token=network-secret'));
      }
      if (attempts === 2) {
        return Promise.resolve(jsonResponse({ error: 'temporarily unavailable' }, { status: 503 }));
      }

      return Promise.resolve(jsonResponse({ data: { ok: true } }));
    };
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      maxRetries: 3,
      retryDelayMs: 100,
      retryJitterMs: () => 7,
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    });

    await expect(client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).resolves.toEqual({ data: { ok: true } });
    expect(attempts).toBe(3);
    expect(delays).toEqual([107, 207]);
  });

  it('does not retry non-retryable HTTP errors or GraphQL errors', async () => {
    let httpAttempts = 0;
    const httpClient = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch: () => {
        httpAttempts += 1;
        return Promise.resolve(jsonResponse({ errors: [{ message: 'bad request' }] }, { status: 400 }));
      },
      maxRetries: 3,
      sleep: () => {
        expect.unreachable('non-retryable HTTP errors must not sleep');
      },
    });

    await expect(httpClient.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).rejects.toThrow('HTTP 400');
    expect(httpAttempts).toBe(1);

    let graphqlAttempts = 0;
    const graphqlClient = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch: () => {
        graphqlAttempts += 1;
        return Promise.resolve(jsonResponse({ errors: [{ message: 'user error with customer email alice@example.com' }] }));
      },
      maxRetries: 3,
      sleep: () => {
        expect.unreachable('GraphQL errors must not sleep');
      },
    });

    await expect(graphqlClient.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }' })).rejects.toThrow('Shopify Admin GraphQL returned errors');
    expect(graphqlAttempts).toBe(1);
  });

  it('bounds retry loops and redacts retry exhaustion errors', async () => {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = () => {
      attempts += 1;
      return Promise.reject(new Error(`failed with X-Shopify-Access-Token: ${TOKEN} callback=https://example.test/callback?code=secret`));
    };
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      maxRetries: 2,
      retryDelayMs: 10,
      retryJitterMs: 0,
      sleep: () => Promise.resolve(),
    });

    try {
      await client.query({ shop: SHOP, accessToken: TOKEN, query: '{ ok }', operationName: 'SafeOperation' });
      expect.unreachable('expected retry exhaustion');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(attempts).toBe(3);
      expect(message).toContain('admin_graphql');
      expect(message).toContain('[REDACTED]');
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain('callback=https://example.test/callback?code=secret');
    }
  });

  it('emits safe Admin GraphQL cost telemetry parsed from throttleStatus extensions', async () => {
    const telemetry: unknown[] = [];
    const fetch: typeof globalThis.fetch = () => Promise.resolve(jsonResponse({
      data: { ok: true },
      extensions: {
        cost: {
          requestedQueryCost: 12,
          actualQueryCost: 8,
          throttleStatus: {
            maximumAvailable: 1000,
            currentlyAvailable: 992,
            restoreRate: 50,
          },
        },
      },
    }));
    const client = createShopifyAdminGraphqlClient({
      apiVersion: '2026-01',
      fetch,
      onTelemetry: (event) => telemetry.push(event),
    });

    await client.query({ shop: SHOP, accessToken: TOKEN, query: '{ customers { edges { node { email } } } }', operationName: 'CustomersReport' });

    expect(telemetry).toEqual([{
      shop: SHOP,
      operationName: 'CustomersReport',
      requestedQueryCost: 12,
      actualQueryCost: 8,
      throttleStatus: {
        maximumAvailable: 1000,
        currentlyAvailable: 992,
        restoreRate: 50,
      },
    }]);
    expect(JSON.stringify(telemetry)).not.toContain(TOKEN);
    expect(JSON.stringify(telemetry)).not.toContain('customers');
    expect(JSON.stringify(telemetry)).not.toContain('email');
    expect(JSON.stringify(telemetry)).not.toContain('alice');
  });
});
