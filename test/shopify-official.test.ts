import { describe, expect, it } from 'vitest';

import { nodeAdapterInitialized } from '@shopify/shopify-api/adapters/node';
import { ApiVersion, LogSeverity, shopifyApi } from '@shopify/shopify-api';

describe('official Shopify API package', () => {
  it('initializes local OAuth, HMAC, session, and GraphQL surfaces without live calls', () => {
    const shopify = shopifyApi({
      apiKey: 'test-client-id',
      apiSecretKey: 'test-client-secret',
      apiVersion: ApiVersion.January26,
      hostName: 'app.example.test',
      isEmbeddedApp: false,
      logger: { level: LogSeverity.Error },
      scopes: ['read_products'],
      _logDisabledFutureFlags: false,
    });

    expect(nodeAdapterInitialized).toBe(true);
    expect(shopify.config.apiVersion).toBe(ApiVersion.January26);
    expect(shopify.auth.begin).toEqual(expect.any(Function));
    expect(shopify.auth.callback).toEqual(expect.any(Function));
    expect(shopify.utils.validateHmac).toEqual(expect.any(Function));
    expect(shopify.session.getOfflineId).toEqual(expect.any(Function));
    expect(shopify.clients.Graphql).toEqual(expect.any(Function));
  });
});
