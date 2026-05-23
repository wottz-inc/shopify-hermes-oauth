import { csvCell } from './csv.js';

export const ORDERS_REPORT_QUERY = `
  query OrdersReport($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export type OrdersReportFormat = 'markdown' | 'json' | 'csv';

export interface OrdersReportGraphqlClient {
  query(query: string, variables: OrdersReportVariables): Promise<unknown>;
}

export interface OrdersReportVariables {
  readonly first: number;
  readonly after: string | null;
  readonly query: string;
}

export interface OrdersReportWindowInput {
  readonly since?: string;
  readonly from?: string;
  readonly to?: string;
  readonly now?: Date;
}

export interface OrdersReportWindow {
  readonly from: string;
  readonly to: string;
  readonly query: string;
}

export interface OrdersReportOptions {
  readonly client: OrdersReportGraphqlClient;
  readonly window: OrdersReportWindowInput;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface OrderReportItem {
  readonly id: string;
  readonly gid: string;
  readonly name: string;
  readonly createdAt: string;
  readonly financialStatus: string;
  readonly fulfillmentStatus: string;
  readonly totalAmount: string;
  readonly currencyCode: string;
  readonly lineItemsSummary: string;
}

export interface OrdersReport {
  readonly window: OrdersReportWindow;
  readonly orders: readonly OrderReportItem[];
}

interface OrdersReportGraphqlResponse {
  readonly data?: {
    readonly orders?: {
      readonly edges?: readonly OrderEdge[];
      readonly pageInfo?: {
        readonly hasNextPage?: unknown;
        readonly endCursor?: unknown;
      };
    };
  };
}

interface OrderEdge {
  readonly cursor?: unknown;
  readonly node?: unknown;
}

export class OrdersReportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OrdersReportError';
  }
}

const DEFAULT_ORDERS_PAGE_SIZE = 50;
const MAX_ORDERS_PAGE_SIZE = 250;
const DEFAULT_MAX_ORDERS_PAGES = 1_000;

export async function generateOrdersReport(options: OrdersReportOptions): Promise<OrdersReport> {
  const pageSize = options.pageSize ?? DEFAULT_ORDERS_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_ORDERS_PAGES;
  const window = parseOrdersReportWindow(options.window);

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_ORDERS_PAGE_SIZE) {
    throw new OrdersReportError('Orders report page size must be an integer between 1 and 250.');
  }

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new OrdersReportError('Orders report maximum page count must be a positive integer.');
  }

  const orders: OrderReportItem[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const graphqlResponse = await options.client.query(ORDERS_REPORT_QUERY, { first: pageSize, after, query: window.query }) as OrdersReportGraphqlResponse;
    const connection = graphqlResponse.data?.orders;

    if (connection?.edges === undefined || connection.pageInfo === undefined) {
      throw new OrdersReportError('Shopify Admin GraphQL response did not include expected orders connection.');
    }

    for (const edge of connection.edges) {
      orders.push(parseOrder(edge.node));
    }

    if (connection.pageInfo.hasNextPage !== true) {
      return { window, orders };
    }

    if (typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor.length === 0) {
      throw new OrdersReportError('Shopify Admin GraphQL orders page was missing the next cursor.');
    }

    if (connection.pageInfo.endCursor === after || seenCursors.has(connection.pageInfo.endCursor)) {
      throw new OrdersReportError('Shopify Admin GraphQL orders pagination did not advance.');
    }

    seenCursors.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
  }

  throw new OrdersReportError('Shopify Admin GraphQL orders pagination exceeded the maximum page count.');
}

export function parseOrdersReportWindow(input: OrdersReportWindowInput): OrdersReportWindow {
  const hasSince = input.since !== undefined;
  const hasRange = input.from !== undefined || input.to !== undefined;

  if (hasSince && hasRange) {
    throw new OrdersReportError('Use either --since or --from/--to for orders report, not both.');
  }

  if (hasSince) {
    const match = /^(?<days>[1-9]\d*)d$/u.exec(input.since ?? '');

    if (match?.groups === undefined) {
      throw new OrdersReportError('Orders report --since must be a positive day window like 30d.');
    }

    const days = Number(match.groups.days);
    if (!Number.isSafeInteger(days) || days < 1) {
      throw new OrdersReportError('Orders report --since must be a positive day window like 30d.');
    }

    const now = input.now ?? new Date();
    const to = dateOnlyUtc(now);
    const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
    const from = dateOnlyUtc(fromDate);

    return buildWindow(from, to);
  }

  if (!hasRange) {
    throw new OrdersReportError('Orders report requires either --since or --from/--to.');
  }

  if (input.from === undefined || input.to === undefined) {
    throw new OrdersReportError('Orders report explicit date range requires both --from and --to.');
  }

  const from = parseDateOnly(input.from);
  const to = parseDateOnly(input.to);

  if (from > to) {
    throw new OrdersReportError('Orders report --from date must be on or before --to date.');
  }

  return buildWindow(input.from, input.to);
}

export function formatOrdersReport(report: OrdersReport, format: OrdersReportFormat): string {
  switch (format) {
    case 'markdown':
      return formatMarkdown(report);
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'csv':
      return formatCsv(report);
  }
}

function parseOrder(value: unknown): OrderReportItem {
  if (!isRecord(value)) {
    throw new OrdersReportError('Shopify Admin GraphQL response included an invalid order node.');
  }

  const totalPriceSet = readRecord(value.totalPriceSet, 'order total price set');
  const shopMoney = readRecord(totalPriceSet.shopMoney, 'order shop money');
  return {
    gid: readString(value.id, 'order id'),
    id: extractNumericId(readString(value.id, 'order id')),
    name: readString(value.name, 'order name'),
    createdAt: readString(value.createdAt, 'order created date'),
    financialStatus: readString(value.displayFinancialStatus, 'order financial status'),
    fulfillmentStatus: readString(value.displayFulfillmentStatus, 'order fulfillment status'),
    totalAmount: readString(shopMoney.amount, 'order total amount'),
    currencyCode: readString(shopMoney.currencyCode, 'order currency code'),
    lineItemsSummary: summarizeLineItems(value.lineItems),
  };
}

function summarizeLineItems(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.edges)) {
    return 'Unavailable';
  }

  const items = value.edges.map((edge) => {
    const node = isRecord(edge) ? edge.node : undefined;

    if (!isRecord(node)) {
      return undefined;
    }

    const title = typeof node.title === 'string' && node.title.length > 0 ? node.title : 'Untitled item';
    const quantity = typeof node.quantity === 'number' && Number.isFinite(node.quantity) ? node.quantity.toString(10) : 'n/a';
    return `${title} x${quantity}`;
  }).filter((item): item is string => item !== undefined);

  if (items.length === 0) {
    return hasMoreLineItems(value) ? 'No line items shown; additional line items omitted: …' : '0 items';
  }

  if (hasMoreLineItems(value)) {
    return `Showing first ${items.length.toString(10)} line items; additional line items omitted: ${items.join('; ')}; …`;
  }

  return `${items.length.toString(10)} ${items.length === 1 ? 'item' : 'items'}: ${items.join('; ')}`;
}

function hasMoreLineItems(value: Record<string, unknown>): boolean {
  const pageInfo = value.pageInfo;
  return isRecord(pageInfo) && pageInfo.hasNextPage === true;
}

function formatMarkdown(report: OrdersReport): string {
  const rows = [
    '| ID | GID | Name | Created At | Financial Status | Fulfillment Status | Total | Currency | Line Items |',
    '| --- | --- | --- | --- | --- | --- | ---: | --- | --- |',
  ];

  for (const order of report.orders) {
    rows.push(`| ${[
      markdownCell(order.id),
      markdownCell(order.gid),
      markdownCell(order.name),
      markdownCell(order.createdAt),
      markdownCell(order.financialStatus),
      markdownCell(order.fulfillmentStatus),
      markdownCell(order.totalAmount),
      markdownCell(order.currencyCode),
      markdownCell(order.lineItemsSummary),
    ].join(' | ')} |`);
  }

  return rows.join('\n');
}

function formatCsv(report: OrdersReport): string {
  const rows = ['id,gid,name,createdAt,financialStatus,fulfillmentStatus,totalAmount,currencyCode,lineItemsSummary'];

  for (const order of report.orders) {
    rows.push([
      order.id,
      order.gid,
      order.name,
      order.createdAt,
      order.financialStatus,
      order.fulfillmentStatus,
      order.totalAmount,
      order.currencyCode,
      order.lineItemsSummary,
    ].map(csvCell).join(','));
  }

  return rows.join('\n');
}

function parseDateOnly(value: string): Date {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);

  if (match?.groups === undefined) {
    throw new OrdersReportError(`Invalid orders report date: ${value}. Use YYYY-MM-DD.`);
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new OrdersReportError(`Invalid orders report date: ${value}. Use YYYY-MM-DD.`);
  }

  return date;
}

function buildWindow(from: string, to: string): OrdersReportWindow {
  return { from, to, query: `created_at:>=${from} created_at:<=${to}` };
}

function dateOnlyUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new OrdersReportError('Orders report current time is invalid.');
  }

  return `${date.getUTCFullYear().toString(10).padStart(4, '0')}-${(date.getUTCMonth() + 1).toString(10).padStart(2, '0')}-${date.getUTCDate().toString(10).padStart(2, '0')}`;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new OrdersReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new OrdersReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function extractNumericId(gid: string): string {
  const segments = gid.split('/');
  return segments.at(-1) ?? gid;
}

function markdownCell(value: string): string {
  return sanitizeOutput(value).replace(/\|/gu, '\\|');
}

function sanitizeOutput(value: string): string {
  let sanitized = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint === 0x0A) {
      sanitized += '\\n';
    } else if (codePoint === 0x0D) {
      sanitized += '\\r';
    } else if (codePoint === 0x09) {
      sanitized += '\\t';
    } else if ((codePoint >= 0x00 && codePoint <= 0x1F) || (codePoint >= 0x7F && codePoint <= 0x9F)) {
      sanitized += `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      sanitized += character;
    }
  }

  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
