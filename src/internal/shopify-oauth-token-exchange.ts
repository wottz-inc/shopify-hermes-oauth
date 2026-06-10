import { SafeError, type SafeErrorCode } from '../safe-errors.js';
import { normalizeTokenStoreShopDomain } from '../tokens/local-token-store.js';

export class MissingRequiredAdminApiScopesError extends Error {
  public readonly code: SafeErrorCode = 'OAUTH_MISSING_REQUIRED_SCOPES';

  constructor() {
    super('At least one scope is required');
    this.name = 'MissingRequiredAdminApiScopesError';
  }
}

export interface ShopifyOAuthExchangeInput {
  readonly fetch: typeof globalThis.fetch;
  readonly shop: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export async function exchangeShopifyOAuthToken(input: ShopifyOAuthExchangeInput): Promise<{ readonly accessToken: string; readonly scopes: string }> {
  const shop = normalizeTokenStoreShopDomain(input.shop);
  let response: Response;

  try {
    response = await input.fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    });
  } catch {
    throw new SafeError('Shopify OAuth token exchange request failed.', 'OAUTH_TOKEN_EXCHANGE_HTTP_ERROR');
  }

  if (!response.ok) {
    if (await responseBodyMentionsMissingRequiredAdminApiScopes(response)) {
      throw new MissingRequiredAdminApiScopesError();
    }

    throw new SafeError(`Shopify OAuth token exchange failed with HTTP ${String(response.status)}.`, 'OAUTH_TOKEN_EXCHANGE_HTTP_ERROR');
  }

  let payload: { readonly access_token?: unknown; readonly scope?: unknown };
  try {
    payload = await response.json() as { readonly access_token?: unknown; readonly scope?: unknown };
  } catch {
    throw new SafeError('Shopify OAuth token exchange response was not valid JSON.', 'OAUTH_TOKEN_EXCHANGE_INVALID_RESPONSE');
  }

  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new SafeError('Shopify OAuth token exchange response did not include an access token.', 'OAUTH_TOKEN_EXCHANGE_INVALID_RESPONSE');
  }

  if (typeof payload.scope !== 'string' || payload.scope.trim().length === 0) {
    throw new MissingRequiredAdminApiScopesError();
  }

  return {
    accessToken: payload.access_token,
    scopes: payload.scope,
  };
}

async function responseBodyMentionsMissingRequiredAdminApiScopes(response: Response): Promise<boolean> {
  let body: string;

  try {
    body = await response.text();
  } catch {
    return false;
  }

  return body.toLowerCase().includes('at least one scope is required');
}
