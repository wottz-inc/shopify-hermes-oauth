const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

export const MARKETS_API_LIMITATION = {
  unsupportedReason: 'Shopify Admin GraphQL markets API is unavailable for this shop/API version, app scopes, or shop plan.',
  requiredScopes: ['read_markets'] as const,
  shopPlanConstraints: 'Markets Admin APIs can be gated by Shopify plan, feature availability, API version, and app scope approval. Unsupported or empty stores return a safe structured status instead of raw GraphQL errors.',
} as const;

export const LOCALES_API_LIMITATION = {
  unsupportedReason: 'Shopify Admin GraphQL localization API is unavailable for this shop/API version, app scopes, or shop plan.',
  requiredScopes: ['read_locales'] as const,
  shopPlanConstraints: 'Markets and localization Admin APIs can be gated by Shopify plan, feature availability, API version, and app scope approval. Unsupported or empty stores return a safe structured status instead of raw GraphQL errors.',
} as const;

export const MARKETS_QUERY = `#graphql
query Markets($first: Int!, $after: String) {
  markets(first: $first, after: $after) {
    edges {
      node {
        id
        name
        handle
        status
        currencySettings {
          baseCurrency { currencyCode currencyName enabled }
        }
        regions(first: 10) {
          edges {
            node {
              id
              name
              ... on MarketRegionCountry { code }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const SHOP_LOCALES_QUERY = `#graphql
query ShopLocales {
  shopLocales {
    locale
    name
    primary
    published
  }
}
`;

export interface MarketsLocalizationGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface PageInfo { readonly hasNextPage: boolean; readonly endCursor?: string }
export interface MarketCurrencySummary { readonly currencyCode?: string; readonly currencyName?: string; readonly enabled?: boolean }
export interface MarketRegionSummary { readonly id?: string; readonly name?: string; readonly code?: string }
export interface MarketSummary { readonly id: string; readonly name?: string; readonly handle?: string; readonly status?: string; readonly baseCurrency?: MarketCurrencySummary; readonly regions: readonly MarketRegionSummary[]; readonly regionsTruncated: boolean }
export interface ShopLocaleSummary { readonly locale: string; readonly name?: string; readonly primary: boolean; readonly published: boolean }
export interface ListMarketsOptions { readonly client: MarketsLocalizationGraphqlClient; readonly first?: number; readonly after?: string }
export interface ListMarketsResult { readonly supported: boolean; readonly markets: readonly MarketSummary[]; readonly summary: { readonly marketCount: number; readonly activeCount: number; readonly regionCount: number; readonly regionsTruncatedCount: number }; readonly pageInfo: PageInfo; readonly limitation?: typeof MARKETS_API_LIMITATION }
export interface ListShopLocalesOptions { readonly client: MarketsLocalizationGraphqlClient }
export interface ListShopLocalesResult { readonly supported: boolean; readonly locales: readonly ShopLocaleSummary[]; readonly summary: { readonly localeCount: number; readonly publishedCount: number; readonly primaryLocale?: string }; readonly limitation?: typeof LOCALES_API_LIMITATION }

export class MarketsLocalizationSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MarketsLocalizationSurfaceError';
  }
}

export async function listMarkets(options: ListMarketsOptions): Promise<ListMarketsResult> {
  const variables = { first: normalizePageSize(options.first), ...optionalCursor(options.after) };
  let response: Record<string, unknown>;
  try {
    response = await options.client.query(MARKETS_QUERY, variables, { operationName: 'Markets' }) as Record<string, unknown>;
  } catch (error) {
    if (isUnsupportedShopifyApiError(error)) return unsupportedMarketsResult();
    throw error;
  }
  const rawConnection = readPath(response, ['data', 'markets']);
  if (rawConnection === null) return unsupportedMarketsResult();
  const connection = requireConnection(rawConnection, 'markets');
  const markets = connection.edges.map((edge) => normalizeMarket(readNode(edge, 'market')));
  return { supported: true, markets, summary: summarizeMarkets(markets), pageInfo: normalizePageInfo(connection.pageInfo) };
}

export async function listShopLocales(options: ListShopLocalesOptions): Promise<ListShopLocalesResult> {
  let response: Record<string, unknown>;
  try {
    response = await options.client.query(SHOP_LOCALES_QUERY, {}, { operationName: 'ShopLocales' }) as Record<string, unknown>;
  } catch (error) {
    if (isUnsupportedShopifyApiError(error)) return unsupportedLocalesResult();
    throw error;
  }
  const rawLocales = readPath(response, ['data', 'shopLocales']);
  if (rawLocales === null) return unsupportedLocalesResult();
  if (!Array.isArray(rawLocales)) throw new MarketsLocalizationSurfaceError('Shopify Admin GraphQL response did not include expected shopLocales array.');
  const locales = rawLocales.map(normalizeShopLocale);
  return { supported: true, locales, summary: summarizeLocales(locales) };
}

function unsupportedMarketsResult(): ListMarketsResult {
  return { supported: false, markets: [], summary: { marketCount: 0, activeCount: 0, regionCount: 0, regionsTruncatedCount: 0 }, pageInfo: { hasNextPage: false }, limitation: MARKETS_API_LIMITATION };
}
function unsupportedLocalesResult(): ListShopLocalesResult {
  return { supported: false, locales: [], summary: { localeCount: 0, publishedCount: 0 }, limitation: LOCALES_API_LIMITATION };
}

function isUnsupportedShopifyApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:access denied|permission|scope).*(?:markets|shopLocales|read_markets|read_locales)|(?:markets|shopLocales|read_markets|read_locales).*(?:access denied|permission|scope)|(?:doesn't exist|does not exist|undefined field|cannot query field|not supported|unavailable).*(?:markets|shopLocales)|(?:markets|shopLocales).*(?:doesn't exist|does not exist|undefined field|cannot query field|not supported|unavailable)/i.test(message);
}
function normalizePageSize(value: number | undefined): number { const pageSize = value ?? DEFAULT_PAGE_SIZE; if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new MarketsLocalizationSurfaceError('Page size must be an integer between 1 and 50.'); return pageSize; }
function optionalCursor(value: string | undefined): Record<string, string> { if (value === undefined) return {}; if (value.trim().length === 0 || /[{}]|\b(?:mutation|query)\b/iu.test(value)) throw new MarketsLocalizationSurfaceError('Cursor is invalid.'); return { after: value }; }
function normalizeMarket(node: Record<string, unknown>): MarketSummary {
  const regionsConnection = isRecord(node.regions) ? normalizeOptionalRegionsConnection(node.regions) : { regions: [], regionsTruncated: false };
  return { id: readString(node.id, 'market id'), ...optionalString(node, 'name'), ...optionalString(node, 'handle'), ...optionalString(node, 'status'), ...optionalBaseCurrency(node.currencySettings), regions: regionsConnection.regions, regionsTruncated: regionsConnection.regionsTruncated };
}
function optionalBaseCurrency(value: unknown): { readonly baseCurrency?: MarketCurrencySummary } { if (!isRecord(value) || !isRecord(value.baseCurrency)) return {}; const currency = value.baseCurrency; const baseCurrency = { ...optionalString(currency, 'currencyCode'), ...optionalString(currency, 'currencyName'), ...(typeof currency.enabled === 'boolean' ? { enabled: currency.enabled } : {}) }; return Object.keys(baseCurrency).length > 0 ? { baseCurrency } : {}; }
function normalizeOptionalRegionsConnection(value: Record<string, unknown>): { readonly regions: readonly MarketRegionSummary[]; readonly regionsTruncated: boolean } { if (!Array.isArray(value.edges)) return { regions: [], regionsTruncated: false }; const pageInfo = isRecord(value.pageInfo) ? normalizePageInfo(value.pageInfo) : { hasNextPage: false }; return { regions: value.edges.map((edge) => normalizeRegion(readNode(edge, 'market region'))), regionsTruncated: pageInfo.hasNextPage }; }
function normalizeRegion(node: Record<string, unknown>): MarketRegionSummary { return { ...optionalString(node, 'id'), ...optionalString(node, 'name'), ...optionalString(node, 'code') }; }
function normalizeShopLocale(value: unknown): ShopLocaleSummary { const node = requireRecord(value, 'shop locale'); return { locale: readString(node.locale, 'locale'), ...optionalString(node, 'name'), primary: node.primary === true, published: node.published === true }; }
function summarizeMarkets(markets: readonly MarketSummary[]): ListMarketsResult['summary'] { return { marketCount: markets.length, activeCount: markets.filter((market) => market.status === 'ACTIVE').length, regionCount: markets.reduce((total, market) => total + market.regions.length, 0), regionsTruncatedCount: markets.filter((market) => market.regionsTruncated).length }; }
function summarizeLocales(locales: readonly ShopLocaleSummary[]): ListShopLocalesResult['summary'] { const primary = locales.find((locale) => locale.primary)?.locale; return { localeCount: locales.length, publishedCount: locales.filter((locale) => locale.published).length, ...(primary === undefined ? {} : { primaryLocale: primary }) }; }
function requireConnection(value: unknown, label: string): { readonly edges: readonly unknown[]; readonly pageInfo: Record<string, unknown> } { if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.pageInfo)) throw new MarketsLocalizationSurfaceError(`Shopify Admin GraphQL response did not include expected ${label} connection.`); return { edges: value.edges, pageInfo: value.pageInfo }; }
function readNode(edge: unknown, label: string): Record<string, unknown> { if (!isRecord(edge) || !isRecord(edge.node)) throw new MarketsLocalizationSurfaceError(`Shopify Admin GraphQL response included an invalid ${label} edge.`); return edge.node; }
function normalizePageInfo(pageInfo: Record<string, unknown>): PageInfo { if (typeof pageInfo.hasNextPage !== 'boolean') throw new MarketsLocalizationSurfaceError('Shopify Admin GraphQL pageInfo was invalid.'); return { hasNextPage: pageInfo.hasNextPage, ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}) }; }
function optionalString(node: Record<string, unknown>, key: string): Record<string, string> { return typeof node[key] === 'string' ? { [key]: node[key] } : {}; }
function readString(value: unknown, label: string): string { if (typeof value !== 'string') throw new MarketsLocalizationSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`); return value; }
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new MarketsLocalizationSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`); return value; }
function readPath(value: unknown, path: readonly string[]): unknown { let current = value; for (const key of path) { if (!isRecord(current)) return undefined; current = current[key]; } return current; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
