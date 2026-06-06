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

export {
  BULK_OPERATION_TEMPLATES,
  BulkOperationError,
  cancelBulkOperation,
  fetchBulkOperationResult,
  getBulkOperationTemplate,
  getCurrentBulkOperation,
  startBulkOperation,
  waitForBulkOperation,
} from './bulk/operations.js';
export type {
  BulkOperationClient,
  BulkOperationErrorCode,
  BulkOperationRecord,
  BulkOperationStatus,
  BulkOperationTemplate,
  BulkOperationTemplateId,
  BulkOperationWaitResult,
} from './bulk/operations.js';

export { InMemoryOAuthStateStore, OAuthStateError } from './oauth/state-store.js';
export type {
  CreateOAuthStateInput,
  OAuthStateRecord,
  OAuthStateStoreOptions,
} from './oauth/state-store.js';

export { LocalJsonTokenStore, TokenStoreError, createLocalJsonTokenStore, normalizeTokenStoreShopDomain } from './tokens/local-token-store.js';
export type {
  AssociatedUserMetadata,
  LocalJsonTokenStoreOptions,
  StoredShopToken,
  StoreShopTokenInput,
  TokenAccessMode,
  TokenMetadata,
  TokenSource,
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

export {
  INVENTORY_ITEM_DETAIL_QUERY,
  INVENTORY_LEVELS_BY_ITEM_QUERY,
  INVENTORY_LEVELS_BY_LOCATION_QUERY,
  LOCATION_DETAIL_QUERY,
  LOCATIONS_QUERY,
  InventoryDetailsError,
  getInventoryItem,
  getLocation,
  listInventoryLevels,
  listLocations,
} from './inventory/details.js';
export type {
  InventoryDetailsGraphqlClient,
  InventoryItemDetail,
  InventoryItemGetOptions,
  InventoryLevelSummary,
  InventoryLevelsListOptions,
  InventoryLevelsListResult,
  LocationGetOptions,
  LocationListOptions,
  LocationSummary,
  LocationsListResult,
} from './inventory/details.js';

export {
  STORE_APP_DIAGNOSTICS_QUERY,
  STORE_PRIVACY_DIAGNOSTICS_QUERY,
  StoreDiagnosticsError,
  generateStoreDiagnostics,
} from './shops/diagnostics.js';
export type {
  StoreDiagnosticsAccess,
  StoreDiagnosticsApp,
  StoreDiagnosticsGraphqlClient,
  StoreDiagnosticsOptions,
  StoreDiagnosticsPolicy,
  StoreDiagnosticsPrivacy,
  StoreDiagnosticsResult,
  StoreDiagnosticsStore,
} from './shops/diagnostics.js';

export { OrdersReportError } from './reports/orders.js';

export {
  DISCOUNT_NODE_QUERY,
  DISCOUNTS_QUERY,
  MARKETING_EVENTS_QUERY,
  MARKETING_EVENT_PII_POLICY,
  DiscountsMarketingSurfaceError,
  getDiscount,
  listDiscounts,
  listMarketingEvents,
} from './discounts-marketing/index.js';
export type {
  DiscountSummary,
  DiscountsAggregateSummary,
  DiscountsListResult,
  DiscountsMarketingGraphqlClient,
  GetDiscountOptions,
  ListDiscountsOptions,
  ListMarketingEventsOptions,
  MarketingEventSummary,
  MarketingEventsListResult,
} from './discounts-marketing/index.js';

export {
  METAFIELD_DEFINITION_QUERY,
  METAFIELD_DEFINITIONS_QUERY,
  METAOBJECT_DEFINITION_QUERY,
  METAOBJECT_DEFINITIONS_QUERY,
  METAOBJECT_QUERY,
  METAOBJECTS_QUERY,
  RESOURCE_METAFIELDS_QUERY,
  CustomDataSurfaceError,
  getMetafieldDefinition,
  getMetaobject,
  getMetaobjectDefinition,
  listMetafieldDefinitions,
  listMetaobjectDefinitions,
  listMetaobjects,
  listResourceMetafields,
} from './custom-data/index.js';
export type {
  CustomDataGraphqlClient,
  GetMetafieldDefinitionOptions,
  GetMetaobjectDefinitionOptions,
  GetMetaobjectOptions,
  ListMetafieldDefinitionsOptions,
  ListMetaobjectDefinitionsOptions,
  ListMetaobjectsOptions,
  ListResourceMetafieldsOptions,
  MetafieldSchema,
  MetaobjectSchema,
  PageInfo,
} from './custom-data/index.js';

export {
  ONLINE_STORE_CONTENT_FIRST,
  ONLINE_STORE_SUMMARY_QUERY,
  ONLINE_STORE_THEMES_FIRST,
  OnlineStoreSummaryError,
  summarizeOnlineStore,
} from './online-store/summary.js';
export type {
  BlogSummary,
  OnlineStoreLimitation,
  OnlineStoreSection,
  OnlineStoreSummaryGraphqlClient,
  OnlineStoreSummaryOptions,
  OnlineStoreSummaryResult,
  PageSummary,
  ThemeSummary,
} from './online-store/summary.js';

export {
  LOCALES_API_LIMITATION,
  MARKETS_API_LIMITATION,
  MARKETS_QUERY,
  SHOP_LOCALES_QUERY,
  MarketsLocalizationSurfaceError,
  listMarkets,
  listShopLocales,
} from './markets-localization/index.js';
export type {
  ListMarketsOptions,
  ListMarketsResult,
  ListShopLocalesOptions,
  ListShopLocalesResult,
  MarketCurrencySummary,
  MarketRegionSummary,
  MarketSummary,
  MarketsLocalizationGraphqlClient,
  ShopLocaleSummary,
} from './markets-localization/index.js';

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
