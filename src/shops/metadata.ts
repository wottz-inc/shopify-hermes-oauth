import { type AdminShopMetadata } from '../shopify/admin-client.js';
import { type TokenMetadata } from '../tokens/local-token-store.js';

export const ALLOWED_SHOP_METADATA = ['shopName', 'currencyCode', 'myshopifyDomain'] as const;

export type AllowedShopMetadataKey = (typeof ALLOWED_SHOP_METADATA)[number];
export type AllowedShopMetadata = Partial<Record<AllowedShopMetadataKey, string>>;

export function summarizeShopMetadata(metadata: TokenMetadata): AllowedShopMetadata {
  const summary: AllowedShopMetadata = {};

  for (const key of ALLOWED_SHOP_METADATA) {
    const value = metadata[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  return summary;
}

const ADMIN_METADATA_READERS = {
  shopName: (metadata: AdminShopMetadata) => metadata.name,
  currencyCode: (metadata: AdminShopMetadata) => metadata.currencyCode,
  myshopifyDomain: (metadata: AdminShopMetadata) => metadata.myshopifyDomain,
} satisfies Record<AllowedShopMetadataKey, (metadata: AdminShopMetadata) => string>;

export function shopMetadataFromAdmin(metadata: AdminShopMetadata): Required<AllowedShopMetadata> {
  const summary = {} as Required<AllowedShopMetadata>;

  for (const key of ALLOWED_SHOP_METADATA) {
    summary[key] = ADMIN_METADATA_READERS[key](metadata);
  }

  return summary;
}
