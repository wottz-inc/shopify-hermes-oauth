import type { Server } from 'node:http';

import {
  createOAuthHttpServerWithDependencies,
  createShopifyHmacValidator,
  type OAuthHttpServerDependencies,
  type OAuthHttpServerInternalDependencies,
} from './internal/oauth-http-server.js';

export type {
  OAuthAuthStartRateLimitConfig,
  OAuthHttpServerConfig,
  OAuthHttpServerDependencies,
  OAuthStateStore,
  OAuthStoredToken,
  OAuthTokenExchange,
  OAuthTokenExchangeInput,
  OAuthTokenExchangeResult,
  OAuthTokenStore,
} from './internal/oauth-http-server.js';

// Shopify callback timestamps are seconds since epoch; see the internal validator.
export function createOAuthHttpServer(dependencies: OAuthHttpServerDependencies): Server {
  const resolvedDependencies: OAuthHttpServerInternalDependencies = {
    ...dependencies,
    hmacValidator: createShopifyHmacValidator(dependencies.config),
  };

  return createOAuthHttpServerWithDependencies(resolvedDependencies);
}
