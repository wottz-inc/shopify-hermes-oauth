import { type AuditEventInput } from '../audit.js';
import { redactSensitiveErrorMessage, type AdminShopMetadata, type ShopifyAdminClient } from '../shopify/admin-client.js';
import { normalizeTokenStoreShopDomain, type TokenStore } from '../tokens/local-token-store.js';

export interface VerifyShopOptions {
  readonly shop: string;
  readonly tokenStore: TokenStore;
  readonly adminClient: ShopifyAdminClient;
  readonly appendAuditEvent: (event: AuditEventInput) => Promise<void> | void;
}

export interface VerifyShopResult {
  readonly shop: string;
  readonly metadata: AdminShopMetadata;
}

export class ShopVerificationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShopVerificationError';
  }
}

export async function verifyShop(options: VerifyShopOptions): Promise<VerifyShopResult> {
  const shop = normalizeTokenStoreShopDomain(options.shop);
  const storedToken = await options.tokenStore.getToken(shop);

  if (storedToken === undefined) {
    await options.appendAuditEvent({
      action: 'shops.verify',
      shop,
      result: 'failure',
      metadata: { reason: 'missing_oauth_record' },
    });
    throw new ShopVerificationError(`No stored OAuth token found for ${shop}.`);
  }

  let metadata: AdminShopMetadata;

  try {
    metadata = await options.adminClient.getShopMetadata({
      shop,
      accessToken: storedToken.accessToken,
    });
  } catch (error) {
    const message = error instanceof Error ? redactSensitiveErrorMessage(error.message) : 'Shop verification failed.';
    await options.appendAuditEvent({
      action: 'shops.verify',
      shop,
      result: 'failure',
      metadata: { reason: 'admin_graphql_error', error: message },
    });
    throw new ShopVerificationError(message);
  }

  await options.tokenStore.storeToken({
    shop,
    accessToken: storedToken.accessToken,
    scopes: storedToken.scopes,
    metadata: {
      ...storedToken.metadata,
      shopName: metadata.name,
      myshopifyDomain: metadata.myshopifyDomain,
      currencyCode: metadata.currencyCode,
    },
  });
  await options.appendAuditEvent({
    action: 'shops.verify',
    shop,
    result: 'success',
    metadata: {
      shopName: metadata.name,
      myshopifyDomain: metadata.myshopifyDomain,
      currencyCode: metadata.currencyCode,
    },
  });

  return { shop, metadata };
}
