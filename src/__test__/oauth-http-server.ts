import type { Server } from 'node:http';

import {
  createOAuthHttpServerWithDependencies,
  type OAuthHttpServerInternalDependencies,
} from '../internal/oauth-http-server.js';

export type OAuthHttpServerTestingDependencies = OAuthHttpServerInternalDependencies;

export function createOAuthHttpServerForTesting(
  dependencies: OAuthHttpServerTestingDependencies,
): Server {
  return createOAuthHttpServerWithDependencies(dependencies);
}
