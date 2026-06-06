import { missingShopifyScopes, normalizeShopifyScopes } from '../shopify/scopes.js';
import { normalizeTokenStoreShopDomain, type TokenStore } from '../tokens/local-token-store.js';

export const ONLINE_STORE_THEMES_FIRST = 5;
export const ONLINE_STORE_CONTENT_FIRST = 10;

export const ONLINE_STORE_SUMMARY_QUERY = `#graphql
query OnlineStoreSummary($themesFirst: Int!, $contentFirst: Int!) {
  themes(first: $themesFirst) {
    nodes { id name role createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
  pages(first: $contentFirst) {
    nodes { id title handle isVisible createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
  blogs(first: $contentFirst) {
    nodes { id title handle }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const ONLINE_STORE_THEMES_QUERY = `#graphql
query OnlineStoreThemesSummary($themesFirst: Int!) {
  themes(first: $themesFirst) {
    nodes { id name role createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const ONLINE_STORE_CONTENT_QUERY = `#graphql
query OnlineStoreContentSummary($contentFirst: Int!) {
  pages(first: $contentFirst) {
    nodes { id title handle isVisible createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
  blogs(first: $contentFirst) {
    nodes { id title handle }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const READ_THEMES_SCOPE = 'read_themes';
const READ_CONTENT_SCOPE = 'read_content';

export interface OnlineStoreSummaryGraphqlClient {
  query(query: string, variables: Record<string, number>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface OnlineStoreSummaryOptions {
  readonly shop: string;
  readonly tokenStore: Pick<TokenStore, 'getToken'>;
  readonly client: OnlineStoreSummaryGraphqlClient;
}

export interface OnlineStoreSummaryResult {
  readonly shop: string;
  readonly limits: { readonly themesFirst: number; readonly contentFirst: number };
  readonly onlineStore: {
    readonly themes: OnlineStoreSection<ThemeSummary, typeof READ_THEMES_SCOPE>;
    readonly pages: OnlineStoreSection<PageSummary, typeof READ_CONTENT_SCOPE>;
    readonly blogs: OnlineStoreSection<BlogSummary, typeof READ_CONTENT_SCOPE>;
  };
  readonly checkout: OnlineStoreLimitation;
  readonly customerAccounts: OnlineStoreLimitation;
  readonly branding: OnlineStoreLimitation;
}

export type OnlineStoreSection<T, Scope extends string> =
  | { readonly status: 'missing_scope'; readonly requiredScope: Scope }
  | { readonly status: 'unsupported'; readonly reason: 'online_store_fields_unavailable' }
  | { readonly status: 'ok'; readonly nodes: readonly T[]; readonly pageInfo: PageInfo; readonly truncated: boolean };

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface PageSummary {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
  readonly isVisible?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface BlogSummary {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
}

export interface PageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export interface OnlineStoreLimitation {
  readonly status: 'documented_limitation';
  readonly reason:
    | 'checkout_configuration_not_exposed_read_only_by_curated_admin_graphql'
    | 'customer_account_configuration_not_exposed_read_only_by_curated_admin_graphql'
    | 'branding_configuration_not_exposed_read_only_without_checkout_branding_write_surface';
}

export class OnlineStoreSummaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OnlineStoreSummaryError';
  }
}

export async function summarizeOnlineStore(options: OnlineStoreSummaryOptions): Promise<OnlineStoreSummaryResult> {
  const shop = normalizeTokenStoreShopDomain(options.shop);
  const token = await options.tokenStore.getToken(shop);
  if (token === undefined) {
    throw new OnlineStoreSummaryError(`No stored OAuth token found for ${shop}.`);
  }

  const scopes = normalizeShopifyScopes(token.scopes);
  const canReadThemes = missingShopifyScopes(scopes, [READ_THEMES_SCOPE]).length === 0;
  const canReadContent = missingShopifyScopes(scopes, [READ_CONTENT_SCOPE]).length === 0;
  const base = baseResult(shop);

  if (!canReadThemes && !canReadContent) {
    return {
      ...base,
      onlineStore: {
        themes: { status: 'missing_scope', requiredScope: READ_THEMES_SCOPE },
        pages: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE },
        blogs: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE },
      },
    };
  }

  if (canReadThemes && canReadContent) return readOnlineStoreSummary(options.client, base);
  if (canReadThemes) return readThemeOnlySummary(options.client, base);
  return readContentOnlySummary(options.client, base);
}

function baseResult(shop: string): Omit<OnlineStoreSummaryResult, 'onlineStore'> {
  return {
    shop,
    limits: { themesFirst: ONLINE_STORE_THEMES_FIRST, contentFirst: ONLINE_STORE_CONTENT_FIRST },
    checkout: { status: 'documented_limitation', reason: 'checkout_configuration_not_exposed_read_only_by_curated_admin_graphql' },
    customerAccounts: { status: 'documented_limitation', reason: 'customer_account_configuration_not_exposed_read_only_by_curated_admin_graphql' },
    branding: { status: 'documented_limitation', reason: 'branding_configuration_not_exposed_read_only_without_checkout_branding_write_surface' },
  };
}

async function readOnlineStoreSummary(client: OnlineStoreSummaryGraphqlClient, base: Omit<OnlineStoreSummaryResult, 'onlineStore'>): Promise<OnlineStoreSummaryResult> {
  try {
    const response = await client.query(ONLINE_STORE_SUMMARY_QUERY, { themesFirst: ONLINE_STORE_THEMES_FIRST, contentFirst: ONLINE_STORE_CONTENT_FIRST }, { operationName: 'OnlineStoreSummary' });
    const data = readRecord(readPath(response, ['data']), 'data');
    return {
      ...base,
      onlineStore: {
        themes: normalizeConnection(data.themes, normalizeTheme, 'themes', ONLINE_STORE_THEMES_FIRST),
        pages: normalizeConnection(data.pages, normalizePage, 'pages', ONLINE_STORE_CONTENT_FIRST),
        blogs: normalizeConnection(data.blogs, normalizeBlog, 'blogs', ONLINE_STORE_CONTENT_FIRST),
      },
    };
  } catch (error) {
    if (!isUnsupportedOnlineStoreFieldsError(error)) throw error;
    return { ...base, onlineStore: { themes: unsupported(), pages: unsupported(), blogs: unsupported() } };
  }
}

async function readThemeOnlySummary(client: OnlineStoreSummaryGraphqlClient, base: Omit<OnlineStoreSummaryResult, 'onlineStore'>): Promise<OnlineStoreSummaryResult> {
  try {
    const response = await client.query(ONLINE_STORE_THEMES_QUERY, { themesFirst: ONLINE_STORE_THEMES_FIRST }, { operationName: 'OnlineStoreThemesSummary' });
    const data = readRecord(readPath(response, ['data']), 'data');
    return {
      ...base,
      onlineStore: {
        themes: normalizeConnection(data.themes, normalizeTheme, 'themes', ONLINE_STORE_THEMES_FIRST),
        pages: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE },
        blogs: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE },
      },
    };
  } catch (error) {
    if (!isUnsupportedOnlineStoreFieldsError(error)) throw error;
    return { ...base, onlineStore: { themes: unsupported(), pages: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE }, blogs: { status: 'missing_scope', requiredScope: READ_CONTENT_SCOPE } } };
  }
}

async function readContentOnlySummary(client: OnlineStoreSummaryGraphqlClient, base: Omit<OnlineStoreSummaryResult, 'onlineStore'>): Promise<OnlineStoreSummaryResult> {
  try {
    const response = await client.query(ONLINE_STORE_CONTENT_QUERY, { contentFirst: ONLINE_STORE_CONTENT_FIRST }, { operationName: 'OnlineStoreContentSummary' });
    const data = readRecord(readPath(response, ['data']), 'data');
    return {
      ...base,
      onlineStore: {
        themes: { status: 'missing_scope', requiredScope: READ_THEMES_SCOPE },
        pages: normalizeConnection(data.pages, normalizePage, 'pages', ONLINE_STORE_CONTENT_FIRST),
        blogs: normalizeConnection(data.blogs, normalizeBlog, 'blogs', ONLINE_STORE_CONTENT_FIRST),
      },
    };
  } catch (error) {
    if (!isUnsupportedOnlineStoreFieldsError(error)) throw error;
    return { ...base, onlineStore: { themes: { status: 'missing_scope', requiredScope: READ_THEMES_SCOPE }, pages: unsupported(), blogs: unsupported() } };
  }
}

function unsupported(): { readonly status: 'unsupported'; readonly reason: 'online_store_fields_unavailable' } {
  return { status: 'unsupported', reason: 'online_store_fields_unavailable' };
}

function normalizeConnection<T>(value: unknown, normalizeNode: (value: unknown) => T, label: string, maxNodes: number): { readonly status: 'ok'; readonly nodes: readonly T[]; readonly pageInfo: PageInfo; readonly truncated: boolean } {
  const connection = readRecord(value, label);
  const nodesValue = Array.isArray(connection.nodes) ? connection.nodes.slice(0, maxNodes) : [];
  const pageInfo = normalizePageInfo(connection.pageInfo);
  return { status: 'ok', nodes: nodesValue.map(normalizeNode), pageInfo, truncated: pageInfo.hasNextPage };
}

function normalizeTheme(value: unknown): ThemeSummary {
  const record = readRecord(value, 'theme');
  return { id: readString(record.id, 'theme id'), name: readString(record.name, 'theme name'), ...optionalString(record.role, 'role'), ...optionalString(record.createdAt, 'createdAt'), ...optionalString(record.updatedAt, 'updatedAt') };
}

function normalizePage(value: unknown): PageSummary {
  const record = readRecord(value, 'page');
  return { id: readString(record.id, 'page id'), title: readString(record.title, 'page title'), ...optionalString(record.handle, 'handle'), ...(typeof record.isVisible === 'boolean' ? { isVisible: record.isVisible } : {}), ...optionalString(record.createdAt, 'createdAt'), ...optionalString(record.updatedAt, 'updatedAt') };
}

function normalizeBlog(value: unknown): BlogSummary {
  const record = readRecord(value, 'blog');
  return { id: readString(record.id, 'blog id'), title: readString(record.title, 'blog title'), ...optionalString(record.handle, 'handle') };
}

function normalizePageInfo(value: unknown): PageInfo {
  const record = isRecord(value) ? value : {};
  return { hasNextPage: record.hasNextPage === true, ...(typeof record.endCursor === 'string' ? { endCursor: record.endCursor } : {}) };
}

function optionalString(value: unknown, key: string): Record<string, string> {
  return typeof value === 'string' ? { [key]: value } : {};
}

function isUnsupportedOnlineStoreFieldsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:cannot query field|undefined field|doesn't exist|does not exist|not supported|unavailable).*(?:themes|pages|blogs|online store|onlinestore)|(?:themes|pages|blogs|online store|onlinestore).*(?:cannot query field|undefined field|doesn't exist|does not exist|not supported|unavailable)/iu.test(message);
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
  if (!isRecord(value)) throw new OnlineStoreSummaryError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new OnlineStoreSummaryError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
