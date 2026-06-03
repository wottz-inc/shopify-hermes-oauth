export { resolveHermesHome, resolveShopifyHermesPaths } from './hermes-home.js';
export type { HermesHomeResolverOptions, ShopifyHermesPaths } from './hermes-home.js';

export {
  ConfigError,
  loadShopifyHermesConfig,
  redactConfig,
  redactValue,
} from './config.js';
export type { LoadShopifyHermesConfigOptions, ShopifyHermesConfig } from './config.js';

export { runShopifyHermesOauthCli } from './cli.js';
export type { CliDependencies } from './cli.js';

export {
  AuditSecretError,
  appendAuditEvent,
  findSecretLikePath,
} from './audit.js';
export type { AuditEvent, AuditEventInput, AuditResult } from './audit.js';

export {
  ensureDataDirectory,
  readJsonFile,
  writeJsonAtomic,
} from './storage/local-files.js';
export type { LocalFileDependencies } from './storage/local-files.js';

export { ShopDomainValidationError, normalizeShopDomain } from './shop-domain.js';

export { SAFE_ERROR_CODES, SafeError, isSafeOperationError, safeErrorCode } from './safe-errors.js';
export type { SafeErrorCode, SafeOperationError } from './safe-errors.js';

export { InMemoryOAuthStateStore, OAuthStateError } from './oauth/state-store.js';
export type {
  CreateOAuthStateInput,
  OAuthStateRecord,
  OAuthStateStoreOptions,
} from './oauth/state-store.js';

export { LocalJsonTokenStore, TokenStoreError, createLocalJsonTokenStore, normalizeTokenStoreShopDomain } from './tokens/local-token-store.js';
export type {
  LocalJsonTokenStoreOptions,
  StoredShopToken,
  StoreShopTokenInput,
  TokenMetadata,
  TokenStore,
} from './tokens/local-token-store.js';

export {
  SHOP_METADATA_QUERY,
  ShopifyAdminGraphqlError,
  createShopifyAdminGraphqlClient,
  redactSensitiveErrorMessage,
  redactSensitiveText,
} from './shopify/admin-client.js';
export type {
  AdminGraphqlCostTelemetry,
  AdminGraphqlQueryInput,
  AdminShopMetadata,
  AdminShopMetadataInput,
  ShopifyAdminClient,
  ShopifyAdminGraphqlErrorCode,
  ShopifyAdminGraphqlClientOptions,
  ShopifyAdminQueryClient,
} from './shopify/admin-client.js';

export {
  PRODUCTS_REPORT_QUERY,
  ProductsReportError,
  formatProductsReport,
  generateProductsReport,
} from './reports/products.js';
export type {
  ProductReportItem,
  ProductsReport,
  ProductsReportFormat,
  ProductsReportGraphqlClient,
  ProductsReportOptions,
  ProductsReportVariables,
} from './reports/products.js';

export {
  INVENTORY_REPORT_QUERY,
  InventoryReportError,
  formatInventoryReport,
  generateInventoryReport,
} from './reports/inventory.js';
export type {
  InventoryReport,
  InventoryReportFormat,
  InventoryReportGraphqlClient,
  InventoryReportOptions,
  InventoryReportRow,
  InventoryReportVariables,
} from './reports/inventory.js';

export { OrdersReportError } from './reports/orders.js';

export { ShopVerificationError, verifyShop } from './shops/verify.js';
export type { VerifyShopOptions, VerifyShopResult } from './shops/verify.js';

export { createOAuthHttpServer } from './server.js';
export type {
  OAuthHttpServerConfig,
  OAuthHttpServerDependencies,
  OAuthStateStore,
  OAuthStoredToken,
  OAuthTokenExchange,
  OAuthTokenExchangeInput,
  OAuthTokenExchangeResult,
  OAuthTokenStore,
} from './server.js';

export const version = '0.1.0';

export function hello(): string {
  return 'shopify-hermes-oauth ready';
}
