import { csvCell } from './csv.js';

export const SHOPIFYQL_ANALYTICS_QUERY = `
  query CuratedShopifyqlAnalytics($query: String!) {
    shopifyqlQuery(query: $query) {
      __typename
      ... on TableResponse {
        tableData {
          columns {
            name
          }
          rowData
        }
      }
      parseErrors {
        message
      }
    }
  }
`;

export const SHOPIFYQL_ANALYTICS_REQUIRED_SCOPE = 'read_reports';
export const SHOPIFYQL_ANALYTICS_GATE_ENV = 'SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS';

export type ShopifyqlAnalyticsReportId = 'sales_summary_by_period' | 'top_products_by_sales';
export type ShopifyqlAnalyticsGranularity = 'day' | 'week' | 'month';
export type ShopifyqlAnalyticsFormat = 'markdown' | 'json' | 'csv';
export type ShopifyqlAnalyticsStatus = 'ok' | 'unsupported';

export interface ShopifyqlAnalyticsGraphqlClient {
  query(query: string, variables: ShopifyqlAnalyticsVariables, options?: ShopifyqlAnalyticsQueryOptions): Promise<unknown>;
}

export interface ShopifyqlAnalyticsVariables {
  readonly query: string;
}

export interface ShopifyqlAnalyticsQueryOptions {
  readonly operationName?: string;
}

export interface ShopifyqlAnalyticsOptions {
  readonly client: ShopifyqlAnalyticsGraphqlClient;
  readonly report: string;
  readonly from: string;
  readonly to: string;
  readonly granularity?: string;
  readonly limit?: number;
}

export interface ShopifyqlAnalyticsReport {
  readonly report: ShopifyqlAnalyticsReportId;
  readonly status: ShopifyqlAnalyticsStatus;
  readonly from: string;
  readonly to: string;
  readonly granularity?: ShopifyqlAnalyticsGranularity;
  readonly limit: number;
  readonly rows: readonly Record<string, string>[];
  readonly guidance?: string;
}

export class ShopifyqlAnalyticsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShopifyqlAnalyticsError';
  }
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_CELL_LENGTH = 1_000;
const DEFAULT_GRANULARITY: ShopifyqlAnalyticsGranularity = 'day';
const SAFE_UNSUPPORTED_GUIDANCE = 'ShopifyQL analytics reports require Shopify read_reports scope plus protected customer data/analytics approval and SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true. Reinstall or re-authorize the shop after opting in; do not paste tokens, secrets, raw ShopifyQL, or customer data into chat.';
const EXPECTED_COLUMNS: Record<ShopifyqlAnalyticsReportId, readonly string[]> = {
  sales_summary_by_period: ['day', 'week', 'month', 'total_sales', 'net_sales', 'gross_sales', 'discounts', 'returns', 'orders'],
  top_products_by_sales: ['product_title', 'total_sales', 'net_sales', 'quantity_ordered'],
};

export function analyticsReportsDisabledMessage(): string {
  return `Curated ShopifyQL analytics reports are disabled. Set ${SHOPIFYQL_ANALYTICS_GATE_ENV}=true only after accepting the read_reports scope and protected customer data/analytics privacy implications, then reinstall or re-authorize affected shops; do not paste tokens or secrets into chat.`;
}

export async function generateShopifyqlAnalyticsReport(options: ShopifyqlAnalyticsOptions): Promise<ShopifyqlAnalyticsReport> {
  const reportId = parseReportId(options.report);
  const from = parseDateOnly(options.from, 'from');
  const to = parseDateOnly(options.to, 'to');
  if (from.valueOf() > to.valueOf()) {
    throw new ShopifyqlAnalyticsError('ShopifyQL analytics report from date must be on or before to date.');
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ShopifyqlAnalyticsError('ShopifyQL analytics report limit must be an integer between 1 and 100.');
  }

  const granularity = parseGranularity(options.granularity ?? DEFAULT_GRANULARITY);

  const shopifyql = buildCuratedShopifyql({ report: reportId, from: options.from, to: options.to, granularity, limit });
  const response = await options.client.query(SHOPIFYQL_ANALYTICS_QUERY, { query: shopifyql }, { operationName: 'CuratedShopifyqlAnalytics' });
  const parsed = parseShopifyqlResponse(response, reportId, limit);

  return {
    report: reportId,
    status: parsed.status,
    from: options.from,
    to: options.to,
    ...(reportId === 'sales_summary_by_period' ? { granularity } : {}),
    limit,
    rows: parsed.rows,
    ...(parsed.status === 'unsupported' ? { guidance: SAFE_UNSUPPORTED_GUIDANCE } : {}),
  };
}

export function formatShopifyqlAnalyticsReport(report: ShopifyqlAnalyticsReport, format: ShopifyqlAnalyticsFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'csv':
      return formatCsv(report.rows);
    case 'markdown':
      return formatMarkdown(report);
  }
}

function buildCuratedShopifyql(options: Required<Pick<ShopifyqlAnalyticsOptions, 'report' | 'from' | 'to' | 'granularity' | 'limit'>>): string {
  switch (options.report) {
    case 'sales_summary_by_period':
      return `FROM sales SHOW total_sales, net_sales, gross_sales, discounts, returns, orders GROUP BY ${options.granularity} SINCE ${options.from} UNTIL ${options.to} LIMIT ${options.limit.toString(10)}`;
    case 'top_products_by_sales':
      return `FROM sales SHOW product_title, total_sales, net_sales, quantity_ordered GROUP BY product_title SINCE ${options.from} UNTIL ${options.to} ORDER BY total_sales DESC LIMIT ${options.limit.toString(10)}`;
  }
  throw new ShopifyqlAnalyticsError('ShopifyQL analytics report must be one of sales_summary_by_period or top_products_by_sales. Raw ShopifyQL is not accepted.');
}

function parseReportId(report: string): ShopifyqlAnalyticsReportId {
  if (report !== 'sales_summary_by_period' && report !== 'top_products_by_sales') {
    throw new ShopifyqlAnalyticsError('ShopifyQL analytics report must be one of sales_summary_by_period or top_products_by_sales. Raw ShopifyQL is not accepted.');
  }
  return report;
}

function parseGranularity(granularity: string): ShopifyqlAnalyticsGranularity {
  if (granularity !== 'day' && granularity !== 'week' && granularity !== 'month') {
    throw new ShopifyqlAnalyticsError('ShopifyQL analytics report granularity must be one of day, week, or month.');
  }
  return granularity;
}

function parseShopifyqlResponse(response: unknown, report: ShopifyqlAnalyticsReportId, limit: number): { readonly status: ShopifyqlAnalyticsStatus; readonly rows: readonly Record<string, string>[] } {
  const root = readObject(response);
  const data = readObject(root.data);
  const result = readObject(data.shopifyqlQuery);
  if (hasParseErrors(result)) {
    return { status: 'unsupported', rows: [] };
  }

  const tableData = readObject(result.tableData);
  const columns = Array.isArray(tableData.columns) ? tableData.columns : [];
  const expectedColumns = new Set(EXPECTED_COLUMNS[report]);
  const columnMappings = columns
    .map((column, index) => ({ index, name: readColumnName(column) }))
    .filter((column): column is { readonly index: number; readonly name: string } => column.name !== undefined && expectedColumns.has(column.name));
  const rowData = Array.isArray(tableData.rowData) ? tableData.rowData : [];
  if (columnMappings.length === 0) {
    return { status: 'unsupported', rows: [] };
  }

  return {
    status: 'ok',
    rows: rowData.slice(0, limit).map((row) => normalizeRow(row, columnMappings)),
  };
}

function hasParseErrors(result: Record<string, unknown>): boolean {
  return Array.isArray(result.parseErrors) && result.parseErrors.length > 0;
}

function normalizeRow(row: unknown, columns: readonly { readonly index: number; readonly name: string }[]): Record<string, string> {
  const values = Array.isArray(row) ? row : isRecord(row) && Array.isArray(row.data) ? row.data : [];
  const normalized: Record<string, string> = {};
  for (const column of columns) {
    normalized[column.name] = stringifyCell(values[column.index]);
  }
  return normalized;
}

function readColumnName(column: unknown): string | undefined {
  if (typeof column === 'string') return sanitizeHeader(column);
  if (!isRecord(column)) return undefined;
  if (typeof column.name === 'string') return sanitizeHeader(column.name);
  if (typeof column.displayName === 'string') return sanitizeHeader(column.displayName);
  return undefined;
}

function sanitizeHeader(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_ -]/gu, '').replace(/[ -]+/gu, '_').toLowerCase();
  return sanitized.length === 0 ? 'column' : sanitized.slice(0, 80);
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return sanitizeCell(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return sanitizeCell(JSON.stringify(value));
}

function formatMarkdown(report: ShopifyqlAnalyticsReport): string {
  if (report.status === 'unsupported') {
    return `ShopifyQL analytics report unavailable: ${report.guidance ?? SAFE_UNSUPPORTED_GUIDANCE}`;
  }
  const headers = collectHeaders(report.rows);
  if (headers.length === 0) return 'No rows returned.';
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...report.rows.map((row) => `| ${headers.map((header) => markdownCell(row[header] ?? '')).join(' | ')} |`),
  ].join('\n');
}

function formatCsv(rows: readonly Record<string, string>[]): string {
  const headers = collectHeaders(rows);
  if (headers.length === 0) return '';
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? '')).join(',')),
  ].join('\n');
}

function collectHeaders(rows: readonly Record<string, string>[]): readonly string[] {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  return headers;
}

function parseDateOnly(value: string, label: string): Date {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);
  if (match?.groups === undefined) {
    throw new ShopifyqlAnalyticsError(`Invalid ShopifyQL analytics ${label} date. Use YYYY-MM-DD.`);
  }
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ShopifyqlAnalyticsError(`Invalid ShopifyQL analytics ${label} date. Use YYYY-MM-DD.`);
  }
  return date;
}

function markdownCell(value: string): string {
  return sanitizeCell(value).replace(/\|/gu, '\\|');
}

function sanitizeCell(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x0A) sanitized += '\\n';
    else if (codePoint === 0x0D) sanitized += '\\r';
    else if (codePoint === 0x09) sanitized += '\\t';
    else if ((codePoint >= 0x00 && codePoint <= 0x1F) || (codePoint >= 0x7F && codePoint <= 0x9F)) sanitized += `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    else sanitized += character;
  }
  return sanitized.length > MAX_CELL_LENGTH ? `${sanitized.slice(0, MAX_CELL_LENGTH)}…` : sanitized;
}

function readObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
