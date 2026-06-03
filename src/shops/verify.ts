import { shopMetadataFromAdmin, summarizeShopMetadata } from './metadata.js';
import { type AuditEventInput } from '../audit.js';
import { type SafeErrorCode, safeErrorCode } from '../safe-errors.js';
import { redactSensitiveErrorMessage, type AdminShopMetadata, type ShopifyAdminClient } from '../shopify/admin-client.js';
import { MissingShopifyScopesError, missingShopifyScopes } from '../shopify/scopes.js';
import { normalizeTokenStoreShopDomain, type TokenStore } from '../tokens/local-token-store.js';

export interface VerifyShopOptions {
  readonly shop: string;
  readonly tokenStore: TokenStore;
  readonly adminClient: ShopifyAdminClient;
  readonly appendAuditEvent: (event: AuditEventInput) => Promise<void> | void;
  readonly requiredScopes?: readonly string[];
}

export interface VerifyShopResult {
  readonly shop: string;
  readonly metadata: AdminShopMetadata;
}

export class ShopVerificationError extends Error {
  public readonly code: SafeErrorCode;

  public constructor(message: string, code: SafeErrorCode = 'SHOP_VERIFICATION_ADMIN_ERROR') {
    super(message);
    this.name = 'ShopVerificationError';
    this.code = code;
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
    throw new ShopVerificationError(`No stored OAuth token found for ${shop}.`, 'SHOP_VERIFICATION_MISSING_TOKEN');
  }

  const missingScopes = missingShopifyScopes(storedToken.scopes, options.requiredScopes ?? []);
  if (missingScopes.length > 0) {
    await options.appendAuditEvent({
      action: 'shops.verify',
      shop,
      result: 'failure',
      metadata: { reason: 'missing_required_scope' },
    });
    throw new ShopVerificationError(new MissingShopifyScopesError(shop, missingScopes).message, 'SHOP_VERIFICATION_MISSING_SCOPES');
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
    throw new ShopVerificationError(message, safeErrorCode(error, 'SHOP_VERIFICATION_ADMIN_ERROR'));
  }

  const safeMetadata = shopMetadataFromAdmin(metadata);

  await options.tokenStore.storeToken({
    shop,
    accessToken: storedToken.accessToken,
    scopes: storedToken.scopes,
    metadata: {
      ...(storedToken.metadata === undefined ? {} : summarizeShopMetadata(storedToken.metadata)),
      ...safeMetadata,
    },
  });
  await options.appendAuditEvent({
    action: 'shops.verify',
    shop,
    result: 'success',
    metadata: safeMetadata,
  });

  return { shop, metadata };
}
