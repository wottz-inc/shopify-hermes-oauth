import { hasGraphqlLikeSearchSyntax, isValidOpaqueCursor } from '../input-validation.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DISCOUNT_NODE_GID_PATTERN = /^gid:\/\/shopify\/DiscountNode\/\d+$/u;

export const MARKETING_EVENT_PII_POLICY = {
  redactedFields: ['customer', 'orders', 'conversions', 'utm/query parameters'] as const,
  urls: 'query_redacted',
} as const;

const DISCOUNT_FIELDS = `#graphql
fragment SafeDiscountFields on Discount {
  __typename
  ... on DiscountCodeBasic {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
    codesCount { count }
  }
  ... on DiscountCodeBxgy {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
    codesCount { count }
  }
  ... on DiscountCodeFreeShipping {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
    codesCount { count }
  }
  ... on DiscountAutomaticBasic {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
  }
  ... on DiscountAutomaticBxgy {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
  }
  ... on DiscountAutomaticFreeShipping {
    title
    status
    startsAt
    endsAt
    usageCount
    summary
  }
}
`;

export const DISCOUNTS_QUERY = `#graphql
${DISCOUNT_FIELDS}
query Discounts($first: Int!, $after: String, $query: String) {
  discountNodes(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        discount { ...SafeDiscountFields }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export const DISCOUNT_NODE_QUERY = `#graphql
${DISCOUNT_FIELDS}
query Discount($id: ID!) {
  discountNode(id: $id) {
    id
    discount { ...SafeDiscountFields }
  }
}
`;

export const MARKETING_EVENTS_QUERY = `#graphql
query MarketingEvents($first: Int!, $after: String, $query: String) {
  marketingEvents(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        eventType
        marketingChannelType
        sourceAndMedium
        sourceType
        startedAt
        endedAt
        scheduledToEndAt
        budget {
          amount
          currencyCode
        }
        manageUrl
        previewUrl
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export interface DiscountsMarketingGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface DiscountSummary {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly status?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly usageCount?: number;
  readonly codesCount?: { readonly count: number };
  readonly summary?: string;
}

export interface DiscountsAggregateSummary {
  readonly discountCount: number;
  readonly activeCount: number;
  readonly expiredCount: number;
  readonly scheduledCount: number;
  readonly withCodesCount: number;
  readonly usageCount: number;
}

export interface PageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export interface DiscountsListResult {
  readonly discounts: readonly DiscountSummary[];
  readonly summary: DiscountsAggregateSummary;
  readonly pageInfo: PageInfo;
}

export interface MarketingMoneySummary {
  readonly amount: string;
  readonly currencyCode: string;
}

export interface MarketingEventSummary {
  readonly id: string;
  readonly eventType?: string;
  readonly marketingChannelType?: string;
  readonly sourceAndMedium?: string;
  readonly sourceType?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly scheduledToEndAt?: string;
  readonly budget?: MarketingMoneySummary;
  readonly manageUrl?: string;
  readonly previewUrl?: string;
}

export interface MarketingEventsListResult {
  readonly marketingEvents: readonly MarketingEventSummary[];
  readonly summary: {
    readonly marketingEventCount: number;
    readonly byChannel: Readonly<Record<string, number>>;
    readonly withBudgetCount: number;
  };
  readonly pageInfo: PageInfo;
  readonly pii: typeof MARKETING_EVENT_PII_POLICY;
}

export interface ListDiscountsOptions {
  readonly client: DiscountsMarketingGraphqlClient;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface GetDiscountOptions {
  readonly client: DiscountsMarketingGraphqlClient;
  readonly id: string;
}

export interface ListMarketingEventsOptions {
  readonly client: DiscountsMarketingGraphqlClient;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export class DiscountsMarketingSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DiscountsMarketingSurfaceError';
  }
}

export async function listDiscounts(options: ListDiscountsOptions): Promise<DiscountsListResult> {
  const variables = readListVariables(options.first, options.after, options.query, 'Discount query is invalid.');
  const response = await options.client.query(DISCOUNTS_QUERY, variables, { operationName: 'Discounts' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'discountNodes']), 'discountNodes');
  const discounts = connection.edges.map((edge) => normalizeDiscountNode(readNode(edge, 'discount node')));
  return { discounts, summary: summarizeDiscounts(discounts), pageInfo: normalizePageInfo(connection.pageInfo) };
}

export async function getDiscount(options: GetDiscountOptions): Promise<{ readonly discount: DiscountSummary }> {
  const id = normalizeDiscountId(options.id);
  const response = await options.client.query(DISCOUNT_NODE_QUERY, { id }, { operationName: 'Discount' }) as Record<string, unknown>;
  const node = readPath(response, ['data', 'discountNode']);
  if (!isRecord(node)) {
    throw new DiscountsMarketingSurfaceError('Discount was not found.');
  }
  return { discount: normalizeDiscountNode(node) };
}

export async function listMarketingEvents(options: ListMarketingEventsOptions): Promise<MarketingEventsListResult> {
  const variables = readListVariables(options.first, options.after, options.query, 'Marketing event query is invalid.');
  const response = await options.client.query(MARKETING_EVENTS_QUERY, variables, { operationName: 'MarketingEvents' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'marketingEvents']), 'marketingEvents');
  const marketingEvents = connection.edges.map((edge) => normalizeMarketingEvent(readNode(edge, 'marketing event')));
  return { marketingEvents, summary: summarizeMarketingEvents(marketingEvents), pageInfo: normalizePageInfo(connection.pageInfo), pii: MARKETING_EVENT_PII_POLICY };
}

function readListVariables(first: number | undefined, after: string | undefined, query: string | undefined, queryError: string): Record<string, unknown> {
  return {
    first: normalizePageSize(first),
    ...(after === undefined ? {} : { after: normalizeCursor(after, 'Cursor is invalid.') }),
    ...(query === undefined ? {} : { query: normalizeSearchQuery(query, queryError) }),
  };
}

function normalizePageSize(first: number | undefined): number {
  const pageSize = first ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new DiscountsMarketingSurfaceError('Page size must be an integer between 1 and 50.');
  }
  return pageSize;
}

function normalizeCursor(value: string, message: string): string {
  if (!isValidOpaqueCursor(value)) {
    throw new DiscountsMarketingSurfaceError(message);
  }
  return value;
}

function normalizeSearchQuery(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || hasGraphqlLikeSearchSyntax(trimmed)) {
    throw new DiscountsMarketingSurfaceError(message);
  }
  return value;
}

function normalizeDiscountId(value: string): string {
  const trimmed = value.trim();
  if (!DISCOUNT_NODE_GID_PATTERN.test(trimmed)) {
    throw new DiscountsMarketingSurfaceError('Discount id must be a Shopify DiscountNode GID.');
  }
  return trimmed;
}

function normalizeDiscountNode(node: Record<string, unknown>): DiscountSummary {
  const id = readString(node.id, 'discount id');
  const discount = requireRecord(node.discount, 'discount');
  const type = readString(discount.__typename, 'discount type');
  return {
    id,
    type,
    ...optionalString(discount, 'title'),
    ...optionalString(discount, 'status'),
    ...optionalString(discount, 'startsAt'),
    ...optionalString(discount, 'endsAt'),
    ...optionalNumber(discount, 'usageCount'),
    ...optionalCodesCount(discount.codesCount),
    ...optionalString(discount, 'summary'),
  };
}

function optionalCodesCount(value: unknown): { readonly codesCount?: { readonly count: number } } {
  if (!isRecord(value)) return {};
  return typeof value.count === 'number' && Number.isFinite(value.count) ? { codesCount: { count: value.count } } : {};
}

function summarizeDiscounts(discounts: readonly DiscountSummary[]): DiscountsAggregateSummary {
  return {
    discountCount: discounts.length,
    activeCount: discounts.filter((discount) => discount.status === 'ACTIVE').length,
    expiredCount: discounts.filter((discount) => discount.status === 'EXPIRED').length,
    scheduledCount: discounts.filter((discount) => discount.status === 'SCHEDULED').length,
    withCodesCount: discounts.filter((discount) => discount.codesCount !== undefined).length,
    usageCount: discounts.reduce((total, discount) => total + (discount.usageCount ?? 0), 0),
  };
}

function normalizeMarketingEvent(node: Record<string, unknown>): MarketingEventSummary {
  return {
    id: readString(node.id, 'marketing event id'),
    ...optionalString(node, 'eventType'),
    ...optionalString(node, 'marketingChannelType'),
    ...optionalString(node, 'sourceAndMedium'),
    ...optionalString(node, 'sourceType'),
    ...optionalString(node, 'startedAt'),
    ...optionalString(node, 'endedAt'),
    ...optionalString(node, 'scheduledToEndAt'),
    ...optionalBudget(node.budget),
    ...optionalUrl(node, 'manageUrl'),
    ...optionalUrl(node, 'previewUrl'),
  };
}

function optionalBudget(value: unknown): { readonly budget?: MarketingMoneySummary } {
  if (!isRecord(value) || typeof value.amount !== 'string' || typeof value.currencyCode !== 'string') return {};
  return { budget: { amount: value.amount, currencyCode: value.currencyCode } };
}

function optionalUrl(node: Record<string, unknown>, key: 'manageUrl' | 'previewUrl'): Record<string, string> {
  const value = node[key];
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return { [key]: url.toString().replace(/\/$/u, '') };
  } catch {
    return {};
  }
}

function summarizeMarketingEvents(events: readonly MarketingEventSummary[]): MarketingEventsListResult['summary'] {
  const byChannel: Record<string, number> = {};
  for (const event of events) {
    if (event.marketingChannelType !== undefined) byChannel[event.marketingChannelType] = (byChannel[event.marketingChannelType] ?? 0) + 1;
  }
  return { marketingEventCount: events.length, byChannel, withBudgetCount: events.filter((event) => event.budget !== undefined).length };
}

function requireConnection(value: unknown, label: string): { readonly edges: readonly unknown[]; readonly pageInfo: Record<string, unknown> } {
  if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.pageInfo)) {
    throw new DiscountsMarketingSurfaceError(`Shopify Admin GraphQL response did not include expected ${label} connection.`);
  }
  return { edges: value.edges, pageInfo: value.pageInfo };
}

function readNode(edge: unknown, label: string): Record<string, unknown> {
  if (!isRecord(edge) || !isRecord(edge.node)) {
    throw new DiscountsMarketingSurfaceError(`Shopify Admin GraphQL response included an invalid ${label} edge.`);
  }
  return edge.node;
}

function normalizePageInfo(pageInfo: Record<string, unknown>): PageInfo {
  if (typeof pageInfo.hasNextPage !== 'boolean') {
    throw new DiscountsMarketingSurfaceError('Shopify Admin GraphQL pageInfo was invalid.');
  }
  return { hasNextPage: pageInfo.hasNextPage, ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}) };
}

function optionalString(node: Record<string, unknown>, key: string): Record<string, string> {
  return typeof node[key] === 'string' ? { [key]: node[key] } : {};
}

function optionalNumber(node: Record<string, unknown>, key: string): Record<string, number> {
  return typeof node[key] === 'number' && Number.isFinite(node[key]) ? { [key]: node[key] } : {};
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new DiscountsMarketingSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DiscountsMarketingSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
