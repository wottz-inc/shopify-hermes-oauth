import { missingShopifyScopes, normalizeShopifyScopes } from '../shopify/scopes.js';
import { normalizeTokenStoreShopDomain, type TokenStore } from '../tokens/local-token-store.js';

export const B2B_COMPANIES_FIRST = 25;
export const B2B_COMPANY_LOCATIONS_FIRST = 10;
export const B2B_CATALOGS_FIRST = 25;
export const B2B_PRICE_LISTS_FIRST = 25;

const READ_COMPANIES_SCOPE = 'read_companies';
const READ_PRODUCTS_SCOPE = 'read_products';

export const B2B_COMPANIES_SUMMARY_QUERY = `#graphql
query B2bCompaniesSummary($companiesFirst: Int!, $locationsFirst: Int!) {
  companies(first: $companiesFirst) {
    nodes {
      id
      name
      locationsCount { count }
      locations(first: $locationsFirst) {
        nodes {
          id
          name
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const B2B_CATALOGS_SUMMARY_QUERY = `#graphql
query B2bCatalogsSummary($catalogsFirst: Int!, $priceListsFirst: Int!) {
  catalogs(first: $catalogsFirst) {
    nodes {
      id
      title
      status
      catalogType
      companyLocationsCount { count }
      priceList {
        id
        name
        currency
        fixedPricesCount { count }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
  priceLists(first: $priceListsFirst) {
    nodes {
      id
      name
      currency
      fixedPricesCount { count }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export interface B2bSummaryGraphqlClient {
  query(query: string, variables: Record<string, number>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface B2bSummaryOptions {
  readonly shop: string;
  readonly tokenStore: Pick<TokenStore, 'getToken'>;
  readonly client: B2bSummaryGraphqlClient;
}

export interface B2bLimits {
  readonly companiesFirst: number;
  readonly locationsFirst: number;
  readonly catalogsFirst: number;
  readonly priceListsFirst: number;
}

export interface B2bPiiPolicy {
  readonly redactedFields: readonly string[];
}

export interface B2bCompaniesSummaryResult {
  readonly shop: string;
  readonly limits: B2bLimits;
  readonly companies: B2bCompaniesSection;
  readonly pii: B2bPiiPolicy;
}

export interface B2bCatalogsSummaryResult {
  readonly shop: string;
  readonly limits: B2bLimits;
  readonly catalogs: B2bCatalogsSection;
  readonly priceLists: B2bPriceListsSection;
  readonly pii: B2bPiiPolicy;
}

export type B2bCompaniesSection =
  | { readonly status: 'missing_scope'; readonly requiredScope: typeof READ_COMPANIES_SCOPE }
  | { readonly status: 'b2b_unavailable'; readonly reason: 'b2b_fields_unavailable' }
  | { readonly status: 'ok'; readonly nodes: readonly B2bCompanySummary[]; readonly pageInfo: PageInfo; readonly truncated: boolean };

export type B2bCatalogsSection =
  | { readonly status: 'catalog_permission_required'; readonly requiredScope: typeof READ_PRODUCTS_SCOPE }
  | { readonly status: 'catalog_permission_required'; readonly reason: 'catalog_fields_unavailable_or_permission_required' }
  | { readonly status: 'ok'; readonly nodes: readonly B2bCatalogSummary[]; readonly pageInfo: PageInfo; readonly truncated: boolean };

export type B2bPriceListsSection =
  | { readonly status: 'catalog_permission_required'; readonly requiredScope: typeof READ_PRODUCTS_SCOPE }
  | { readonly status: 'catalog_permission_required'; readonly reason: 'catalog_fields_unavailable_or_permission_required' }
  | { readonly status: 'ok'; readonly nodes: readonly B2bPriceListSummary[]; readonly pageInfo: PageInfo; readonly truncated: boolean };

export interface B2bCompanySummary {
  readonly id: string;
  readonly name: string;
  readonly locationCount: number;
  readonly locations: readonly B2bCompanyLocationSummary[];
  readonly locationsTruncated: boolean;
}

export interface B2bCompanyLocationSummary {
  readonly id: string;
  readonly name: string;
}

export interface B2bCatalogSummary {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly type?: string;
  readonly companyLocationAssignmentCount: number;
  readonly priceList?: B2bPriceListSummary;
}

export interface B2bPriceListSummary {
  readonly id: string;
  readonly name: string;
  readonly currency?: string;
  readonly fixedPriceCount: number;
}

export interface PageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export class B2bSummaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'B2bSummaryError';
  }
}

export async function summarizeB2bCompanies(options: B2bSummaryOptions): Promise<B2bCompaniesSummaryResult> {
  const shop = normalizeTokenStoreShopDomain(options.shop);
  const token = await options.tokenStore.getToken(shop);
  if (token === undefined) throw new B2bSummaryError(`No stored OAuth token found for ${shop}.`);

  const base = baseCompaniesResult(shop);
  const scopes = normalizeShopifyScopes(token.scopes);
  if (missingShopifyScopes(scopes, [READ_COMPANIES_SCOPE]).length > 0) {
    return { ...base, companies: { status: 'missing_scope', requiredScope: READ_COMPANIES_SCOPE } };
  }

  try {
    const response = await options.client.query(B2B_COMPANIES_SUMMARY_QUERY, { companiesFirst: B2B_COMPANIES_FIRST, locationsFirst: B2B_COMPANY_LOCATIONS_FIRST }, { operationName: 'B2bCompaniesSummary' });
    const data = readRecord(readPath(response, ['data']), 'data');
    return { ...base, companies: normalizeCompaniesConnection(data.companies) };
  } catch (error) {
    if (!isB2bUnavailableError(error)) throw error;
    return { ...base, companies: { status: 'b2b_unavailable', reason: 'b2b_fields_unavailable' } };
  }
}

export async function summarizeB2bCatalogs(options: B2bSummaryOptions): Promise<B2bCatalogsSummaryResult> {
  const shop = normalizeTokenStoreShopDomain(options.shop);
  const token = await options.tokenStore.getToken(shop);
  if (token === undefined) throw new B2bSummaryError(`No stored OAuth token found for ${shop}.`);

  const base = baseCatalogsResult(shop);
  const scopes = normalizeShopifyScopes(token.scopes);
  if (missingShopifyScopes(scopes, [READ_PRODUCTS_SCOPE]).length > 0) {
    return { ...base, catalogs: { status: 'catalog_permission_required', requiredScope: READ_PRODUCTS_SCOPE }, priceLists: { status: 'catalog_permission_required', requiredScope: READ_PRODUCTS_SCOPE } };
  }

  try {
    const response = await options.client.query(B2B_CATALOGS_SUMMARY_QUERY, { catalogsFirst: B2B_CATALOGS_FIRST, priceListsFirst: B2B_PRICE_LISTS_FIRST }, { operationName: 'B2bCatalogsSummary' });
    const data = readRecord(readPath(response, ['data']), 'data');
    return {
      ...base,
      catalogs: normalizeCatalogsConnection(data.catalogs),
      priceLists: normalizePriceListsConnection(data.priceLists),
    };
  } catch (error) {
    if (!isCatalogPermissionError(error)) throw error;
    const status = { status: 'catalog_permission_required' as const, reason: 'catalog_fields_unavailable_or_permission_required' as const };
    return { ...base, catalogs: status, priceLists: status };
  }
}

function baseCompaniesResult(shop: string): Omit<B2bCompaniesSummaryResult, 'companies'> {
  return { shop, limits: limits(), pii: piiPolicy() };
}

function baseCatalogsResult(shop: string): Omit<B2bCatalogsSummaryResult, 'catalogs' | 'priceLists'> {
  return { shop, limits: limits(), pii: piiPolicy() };
}

function limits(): B2bLimits {
  return { companiesFirst: B2B_COMPANIES_FIRST, locationsFirst: B2B_COMPANY_LOCATIONS_FIRST, catalogsFirst: B2B_CATALOGS_FIRST, priceListsFirst: B2B_PRICE_LISTS_FIRST };
}

function piiPolicy(): B2bPiiPolicy {
  return { redactedFields: ['contacts', 'customers', 'emails', 'phones', 'addresses', 'notes', 'tags', 'paymentTerms'] };
}

function normalizeCompaniesConnection(value: unknown): Extract<B2bCompaniesSection, { readonly status: 'ok' }> {
  const connection = readRecord(value, 'companies');
  const nodes = Array.isArray(connection.nodes) ? connection.nodes.slice(0, B2B_COMPANIES_FIRST).map(normalizeCompany) : [];
  const pageInfo = normalizePageInfo(connection.pageInfo);
  return { status: 'ok', nodes, pageInfo, truncated: pageInfo.hasNextPage };
}

function normalizeCompany(value: unknown): B2bCompanySummary {
  const record = readRecord(value, 'company');
  const locations = readRecord(record.locations, 'company locations');
  const locationPageInfo = normalizePageInfo(locations.pageInfo);
  const locationNodes = Array.isArray(locations.nodes) ? locations.nodes.slice(0, B2B_COMPANY_LOCATIONS_FIRST).map(normalizeCompanyLocation) : [];
  return {
    id: readString(record.id, 'company id'),
    name: readString(record.name, 'company name'),
    locationCount: readCount(record.locationsCount),
    locations: locationNodes,
    locationsTruncated: locationPageInfo.hasNextPage,
  };
}

function normalizeCompanyLocation(value: unknown): B2bCompanyLocationSummary {
  const record = readRecord(value, 'company location');
  return {
    id: readString(record.id, 'company location id'),
    name: readString(record.name, 'company location name'),
  };
}

function normalizeCatalogsConnection(value: unknown): Extract<B2bCatalogsSection, { readonly status: 'ok' }> {
  const connection = readRecord(value, 'catalogs');
  const nodes = Array.isArray(connection.nodes) ? connection.nodes.slice(0, B2B_CATALOGS_FIRST).map(normalizeCatalog) : [];
  const pageInfo = normalizePageInfo(connection.pageInfo);
  return { status: 'ok', nodes, pageInfo, truncated: pageInfo.hasNextPage };
}

function normalizeCatalog(value: unknown): B2bCatalogSummary {
  const record = readRecord(value, 'catalog');
  return {
    id: readString(record.id, 'catalog id'),
    title: readString(record.title, 'catalog title'),
    ...optionalString(record.status, 'status'),
    ...optionalString(record.catalogType ?? record.type, 'type'),
    companyLocationAssignmentCount: readCount(record.companyLocationsCount ?? record.companyLocationAssignmentsCount),
    ...(isRecord(record.priceList) ? { priceList: normalizePriceList(record.priceList) } : {}),
  };
}

function normalizePriceListsConnection(value: unknown): Extract<B2bPriceListsSection, { readonly status: 'ok' }> {
  const connection = readRecord(value, 'priceLists');
  const nodes = Array.isArray(connection.nodes) ? connection.nodes.slice(0, B2B_PRICE_LISTS_FIRST).map(normalizePriceList) : [];
  const pageInfo = normalizePageInfo(connection.pageInfo);
  return { status: 'ok', nodes, pageInfo, truncated: pageInfo.hasNextPage };
}

function normalizePriceList(value: unknown): B2bPriceListSummary {
  const record = readRecord(value, 'price list');
  return {
    id: readString(record.id, 'price list id'),
    name: readString(record.name, 'price list name'),
    ...optionalString(record.currency, 'currency'),
    fixedPriceCount: readCount(record.fixedPricesCount),
  };
}

function readCount(value: unknown): number {
  if (isRecord(value) && Number.isInteger(value.count)) return value.count as number;
  if (Number.isInteger(value)) return value as number;
  return 0;
}

function normalizePageInfo(value: unknown): PageInfo {
  const record = isRecord(value) ? value : {};
  return { hasNextPage: record.hasNextPage === true, ...(typeof record.endCursor === 'string' ? { endCursor: record.endCursor } : {}) };
}

function optionalString(value: unknown, key: string): Record<string, string> {
  return typeof value === 'string' ? { [key]: value } : {};
}

function isB2bUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:cannot query field|undefined field|does(?: not|n't) exist|not supported|unavailable).*(?:companies|companylocation|b2b)|(?:companies|companylocation|b2b).*(?:cannot query field|undefined field|does(?: not|n't) exist|not supported|unavailable)/iu.test(message);
}

function isCatalogPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:access denied|permission|required scope|cannot query field|undefined field|does(?: not|n't) exist|not supported|unavailable).*(?:catalogs?|pricelists?|price lists?)|(?:catalogs?|pricelists?|price lists?).*(?:access denied|permission|required scope|cannot query field|undefined field|does(?: not|n't) exist|not supported|unavailable)/iu.test(message);
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
  if (!isRecord(value)) throw new B2bSummaryError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new B2bSummaryError(`Shopify Admin GraphQL response included invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
