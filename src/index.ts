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

export { InMemoryOAuthStateStore, OAuthStateError } from './oauth/state-store.js';
export type {
  CreateOAuthStateInput,
  OAuthStateRecord,
  OAuthStateStoreOptions,
} from './oauth/state-store.js';

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
