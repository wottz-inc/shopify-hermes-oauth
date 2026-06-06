import { normalizeShopifyScopes } from '../shopify/scopes.js';
import { normalizeTokenStoreShopDomain, type StoredShopToken, type TokenStore } from '../tokens/local-token-store.js';

export const STORE_APP_DIAGNOSTICS_QUERY = `#graphql
query StoreAppDiagnostics {
  shop {
    name
    myshopifyDomain
    currencyCode
    plan { displayName }
    primaryDomain { host url }
    ianaTimezone
    enabledPresentmentCurrencies
  }
  currentAppInstallation {
    app { title handle }
    accessScopes { handle }
  }
}
`;

export const STORE_PRIVACY_DIAGNOSTICS_QUERY = `#graphql
query StorePrivacyDiagnostics {
  shop {
    privacyPolicy { title url }
    refundPolicy { title url }
    termsOfService { title url }
  }
}
`;

const PRIVACY_POLICY_TYPES = ['privacyPolicy', 'refundPolicy', 'termsOfService'] as const;
const PRIVACY_REQUIRED_SCOPE = 'read_content';

export interface StoreDiagnosticsGraphqlClient {
  query(query: string, variables: Record<string, never>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface StoreDiagnosticsOptions {
  readonly shop: string;
  readonly tokenStore: Pick<TokenStore, 'getToken'>;
  readonly client: StoreDiagnosticsGraphqlClient;
  readonly configuredScopes?: readonly string[] | string;
}

export interface StoreDiagnosticsResult {
  readonly shop: string;
  readonly store: StoreDiagnosticsStore;
  readonly app: StoreDiagnosticsApp;
  readonly access: StoreDiagnosticsAccess;
  readonly privacy: StoreDiagnosticsPrivacy;
}

export interface StoreDiagnosticsStore {
  readonly name: string;
  readonly myshopifyDomain: string;
  readonly currencyCode: string;
  readonly planName?: string;
  readonly primaryDomain?: { readonly host?: string; readonly url?: string };
  readonly ianaTimezone?: string;
  readonly presentmentCurrencies?: readonly string[];
}

export interface StoreDiagnosticsApp {
  readonly installationStatus: 'installed' | 'not_installed_or_unavailable';
  readonly title?: string;
  readonly handle?: string;
  readonly accessScopes: readonly string[];
}

export interface StoreDiagnosticsAccess {
  readonly storedScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly configuredScopes: readonly string[];
  readonly missingConfiguredScopes: readonly string[];
  readonly extraGrantedScopes: readonly string[];
}

export type StoreDiagnosticsPrivacy =
  | { readonly status: 'missing_scope'; readonly requiredScope: typeof PRIVACY_REQUIRED_SCOPE }
  | { readonly status: 'ok'; readonly policies: readonly StoreDiagnosticsPolicy[] }
  | { readonly status: 'unsupported'; readonly reason: 'policy_fields_unavailable' };

export interface StoreDiagnosticsPolicy {
  readonly type: (typeof PRIVACY_POLICY_TYPES)[number];
  readonly present: boolean;
  readonly title?: string;
  readonly url?: string;
}

export class StoreDiagnosticsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StoreDiagnosticsError';
  }
}

export async function generateStoreDiagnostics(options: StoreDiagnosticsOptions): Promise<StoreDiagnosticsResult> {
  const shop = normalizeTokenStoreShopDomain(options.shop);
  const storedToken = await options.tokenStore.getToken(shop);
  if (storedToken === undefined) {
    throw new StoreDiagnosticsError(`No stored OAuth token found for ${shop}.`);
  }

  const baseResponse = await options.client.query(STORE_APP_DIAGNOSTICS_QUERY, {}, { operationName: 'StoreAppDiagnostics' });
  const { store, app } = normalizeStoreAppResponse(baseResponse);
  const access = buildAccessDiagnostics(storedToken, options.configuredScopes ?? [], app.accessScopes);

  return {
    shop,
    store,
    app,
    access,
    privacy: await readPrivacyDiagnostics(options.client, access.grantedScopes),
  };
}

function buildAccessDiagnostics(token: StoredShopToken, configuredScopesInput: readonly string[] | string, currentGrantedScopes: readonly string[]): StoreDiagnosticsAccess {
  const storedScopes = normalizeShopifyScopes(token.scopes);
  const grantedScopes = normalizeShopifyScopes(currentGrantedScopes);
  const configuredScopes = normalizeShopifyScopes(configuredScopesInput);
  const grantedSet = new Set(grantedScopes);
  const configuredSet = new Set(configuredScopes);

  return {
    storedScopes,
    grantedScopes,
    configuredScopes,
    missingConfiguredScopes: configuredScopes.filter((scope) => !grantedSet.has(scope)),
    extraGrantedScopes: grantedScopes.filter((scope) => !configuredSet.has(scope)),
  };
}

async function readPrivacyDiagnostics(client: StoreDiagnosticsGraphqlClient, grantedScopes: readonly string[]): Promise<StoreDiagnosticsPrivacy> {
  if (!grantedScopes.includes(PRIVACY_REQUIRED_SCOPE)) {
    return { status: 'missing_scope', requiredScope: PRIVACY_REQUIRED_SCOPE };
  }

  let response: unknown;
  try {
    response = await client.query(STORE_PRIVACY_DIAGNOSTICS_QUERY, {}, { operationName: 'StorePrivacyDiagnostics' });
  } catch (error) {
    if (isUnsupportedPolicyFieldsError(error)) {
      return { status: 'unsupported', reason: 'policy_fields_unavailable' };
    }
    throw error;
  }

  const shop = readRecord(readPath(response, ['data', 'shop']), 'shop');
  return {
    status: 'ok',
    policies: PRIVACY_POLICY_TYPES.map((type) => normalizePolicy(type, shop[type])),
  };
}

function normalizeStoreAppResponse(response: unknown): { readonly store: StoreDiagnosticsStore; readonly app: StoreDiagnosticsApp } {
  const dataShop = readRecord(readPath(response, ['data', 'shop']), 'shop');
  const installation = optionalRecord(readPath(response, ['data', 'currentAppInstallation']));
  const appRecord = optionalRecord(installation?.app);

  return {
    store: {
      name: readString(dataShop.name, 'shop name'),
      myshopifyDomain: readString(dataShop.myshopifyDomain, 'myshopifyDomain'),
      currencyCode: readString(dataShop.currencyCode, 'currencyCode'),
      ...optionalPlanName(dataShop.plan),
      ...optionalPrimaryDomain(dataShop.primaryDomain),
      ...(typeof dataShop.ianaTimezone === 'string' ? { ianaTimezone: dataShop.ianaTimezone } : {}),
      ...optionalPresentmentCurrencies(dataShop.enabledPresentmentCurrencies),
    },
    app: {
      installationStatus: installation === undefined ? 'not_installed_or_unavailable' : 'installed',
      ...(typeof appRecord?.title === 'string' ? { title: appRecord.title } : {}),
      ...(typeof appRecord?.handle === 'string' ? { handle: appRecord.handle } : {}),
      accessScopes: normalizeAccessScopeHandles(installation?.accessScopes),
    },
  };
}

function normalizePolicy(type: StoreDiagnosticsPolicy['type'], value: unknown): StoreDiagnosticsPolicy {
  if (value === null || value === undefined) return { type, present: false };
  const policy = readRecord(value, `${type} policy`);
  return {
    type,
    present: true,
    ...(typeof policy.title === 'string' ? { title: policy.title } : {}),
    ...(typeof policy.url === 'string' ? { url: policy.url } : {}),
  };
}

function optionalPlanName(value: unknown): { readonly planName?: string } {
  const plan = optionalRecord(value);
  return typeof plan?.displayName === 'string' ? { planName: plan.displayName } : {};
}

function optionalPrimaryDomain(value: unknown): { readonly primaryDomain?: { readonly host?: string; readonly url?: string } } {
  const domain = optionalRecord(value);
  if (domain === undefined) return {};
  const summary = {
    ...(typeof domain.host === 'string' ? { host: domain.host } : {}),
    ...(typeof domain.url === 'string' ? { url: domain.url } : {}),
  };
  return Object.keys(summary).length === 0 ? {} : { primaryDomain: summary };
}

function optionalPresentmentCurrencies(value: unknown): { readonly presentmentCurrencies?: readonly string[] } {
  if (!Array.isArray(value)) return {};
  return { presentmentCurrencies: value.filter((entry): entry is string => typeof entry === 'string') };
}

function normalizeAccessScopeHandles(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return normalizeShopifyScopes(value.map((entry) => optionalRecord(entry)?.handle).filter((entry): entry is string => typeof entry === 'string'));
}

function isUnsupportedPolicyFieldsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:cannot query field|undefined field|doesn't exist|does not exist|not supported|unavailable).*(?:privacyPolicy|refundPolicy|termsOfService|policy)|(?:privacyPolicy|refundPolicy|termsOfService|policy).*(?:cannot query field|undefined field|doesn't exist|does not exist|not supported|unavailable)/iu.test(message);
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new StoreDiagnosticsError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new StoreDiagnosticsError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
