import { normalizeTokenStoreShopDomain } from '../tokens/local-token-store.js';

export class MissingRequiredAdminApiScopesError extends Error {
  constructor() {
    super('At least one scope is required');
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

export async function exchangeShopifyOAuthToken(input: ShopifyOAuthExchangeInput): Promise<{ readonly accessToken: string; readonly scopes?: string }> {
  const shop = normalizeTokenStoreShopDomain(input.shop);
  const response = await input.fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });

  if (!response.ok) {
    if (await responseBodyMentionsMissingRequiredAdminApiScopes(response)) {
      throw new MissingRequiredAdminApiScopesError();
    }

    throw new Error(`Shopify OAuth token exchange failed with HTTP ${String(response.status)}.`);
  }

  const payload = await response.json() as { readonly access_token?: unknown; readonly scope?: unknown };

  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new Error('Shopify OAuth token exchange response did not include an access token.');
  }

  return {
    accessToken: payload.access_token,
    ...(typeof payload.scope === 'string' ? { scopes: payload.scope } : {}),
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
