import { isJsonPlainRecord as isRecord } from '../util/json.js';

import { csvCell } from './csv.js';

export const INVENTORY_REPORT_QUERY = `
  query InventoryReportProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                inventoryItem {
                  id
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
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

export const INVENTORY_LEVELS_QUERY = `
  query InventoryReportInventoryLevels($inventoryItemId: ID!, $first: Int!, $after: String) {
    inventoryItem(id: $inventoryItemId) {
      inventoryLevels(first: $first, after: $after) {
        edges {
          node {
            location {
              name
            }
            quantities(names: ["available", "on_hand", "committed"]) {
              name
              quantity
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export type InventoryReportFormat = 'markdown' | 'json' | 'csv';

export interface InventoryReportGraphqlClient {
  query(query: string, variables: InventoryReportVariables, options?: InventoryReportGraphqlQueryOptions): Promise<unknown>;
}

export interface InventoryReportGraphqlQueryOptions {
  readonly operationName?: string;
}

export type InventoryReportVariables = InventoryProductsVariables | InventoryLevelsVariables;

export interface InventoryProductsVariables {
  readonly first: number;
  readonly after: string | null;
}

export interface InventoryLevelsVariables {
  readonly inventoryItemId: string;
  readonly first: number;
  readonly after: string | null;
}

export interface InventoryReportOptions {
  readonly client: InventoryReportGraphqlClient;
  readonly lowStockThreshold?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface InventoryReportRow {
  readonly productGid: string;
  readonly productId: string;
  readonly productTitle: string;
  readonly variantGid: string;
  readonly variantId: string;
  readonly variantTitle: string;
  readonly sku: string;
  readonly inventoryItemGid: string;
  readonly inventoryItemId: string;
  readonly locationName: string;
  readonly available: number | null;
  readonly onHand: number | null;
  readonly committed: number | null;
  readonly lowStock: boolean;
}

export interface InventoryReport {
  readonly lowStockThreshold: number;
  readonly rows: readonly InventoryReportRow[];
}

interface InventoryReportGraphqlResponse {
  readonly data?: {
    readonly products?: {
      readonly edges?: readonly ProductEdge[];
      readonly pageInfo?: {
        readonly hasNextPage?: unknown;
        readonly endCursor?: unknown;
      };
    };
  };
}

interface InventoryLevelsGraphqlResponse {
  readonly data?: {
    readonly inventoryItem?: {
      readonly inventoryLevels?: {
        readonly edges?: readonly unknown[];
        readonly pageInfo?: {
          readonly hasNextPage?: unknown;
          readonly endCursor?: unknown;
        };
      };
    } | null;
  };
}

interface ProductEdge {
  readonly cursor?: unknown;
  readonly node?: unknown;
}

export type InventoryReportErrorCode = 'INVENTORY_REPORT_FAILED' | 'MAX_COST_EXCEEDED';

export class InventoryReportError extends Error {
  public readonly code: InventoryReportErrorCode;

  public constructor(message: string, code: InventoryReportErrorCode = 'INVENTORY_REPORT_FAILED') {
    super(message);
    this.name = 'InventoryReportError';
    this.code = code;
  }
}

export const INVENTORY_MAX_COST_REMEDIATION_MESSAGE = 'Shopify rejected the inventory report because query cost exceeded its single-query limit. Retry with safer pagination; if it continues, reduce page size or contact support with issue #56.';

const DEFAULT_INVENTORY_PAGE_SIZE = 10;
const MAX_INVENTORY_PAGE_SIZE = 10;
const INVENTORY_VARIANTS_PAGE_SIZE = 100;
const INVENTORY_LEVELS_PAGE_SIZE = 50;
const DEFAULT_MAX_INVENTORY_PAGES = 1_000;
const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const INVENTORY_LIMIT_REMEDIATION_MESSAGE = 'Narrow the report scope or use Shopify bulk inventory export for stores exceeding this report limit.';

export async function generateInventoryReport(options: InventoryReportOptions): Promise<InventoryReport> {
  const pageSize = options.pageSize ?? DEFAULT_INVENTORY_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_INVENTORY_PAGES;
  const lowStockThreshold = options.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_INVENTORY_PAGE_SIZE) {
    throw new InventoryReportError('Inventory report page size must be an integer between 1 and 10.');
  }

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new InventoryReportError('Inventory report maximum page count must be a positive integer.');
  }

  if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
    throw new InventoryReportError('Inventory report low-stock threshold must be a non-negative integer.');
  }

  const rows: InventoryReportRow[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    let graphqlResponse: InventoryReportGraphqlResponse;
    try {
      graphqlResponse = await options.client.query(INVENTORY_REPORT_QUERY, { first: pageSize, after }, { operationName: 'InventoryReportProducts' }) as InventoryReportGraphqlResponse;
    } catch (error) {
      if (isMaxCostExceededError(error)) {
        throw new InventoryReportError(INVENTORY_MAX_COST_REMEDIATION_MESSAGE, 'MAX_COST_EXCEEDED');
      }
      throw error;
    }
    const connection = graphqlResponse.data?.products;

    if (connection?.edges === undefined || connection.pageInfo === undefined) {
      throw new InventoryReportError('Shopify Admin GraphQL response did not include expected products connection.');
    }

    const nextAfter = readNextProductCursor(connection.pageInfo, after, seenCursors);

    for (const edge of connection.edges) {
      const variants = parseProductVariants(edge.node);
      for (const variant of variants) {
        const levels = await fetchInventoryLevels(options.client, variant.inventoryItemGid);
        rows.push(...buildVariantRows(variant, levels, lowStockThreshold));
      }
    }

    if (nextAfter === null) {
      return { lowStockThreshold, rows };
    }

    after = nextAfter;
  }

  throw new InventoryReportError('Shopify Admin GraphQL products pagination exceeded the maximum page count.');
}

export function formatInventoryReport(report: InventoryReport, format: InventoryReportFormat): string {
  switch (format) {
    case 'markdown':
      return formatMarkdown(report);
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'csv':
      return formatCsv(report);
  }
}

function isMaxCostExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('MAX_COST_EXCEEDED') || /exceeds the single query max cost limit/iu.test(error.message);
}

function readNextProductCursor(pageInfo: { readonly hasNextPage?: unknown; readonly endCursor?: unknown }, after: string | null, seenCursors: Set<string>): string | null {
  if (pageInfo.hasNextPage !== true) {
    return null;
  }

  if (typeof pageInfo.endCursor !== 'string' || pageInfo.endCursor.length === 0) {
    throw new InventoryReportError('Shopify Admin GraphQL products page was missing the next cursor.');
  }

  if (pageInfo.endCursor === after || seenCursors.has(pageInfo.endCursor)) {
    throw new InventoryReportError('Shopify Admin GraphQL products pagination did not advance.');
  }

  seenCursors.add(pageInfo.endCursor);
  return pageInfo.endCursor;
}

interface InventoryVariantContext {
  readonly productGid: string;
  readonly productTitle: string;
  readonly variantGid: string;
  readonly variantTitle: string;
  readonly sku: string;
  readonly inventoryItemGid: string;
}

async function fetchInventoryLevels(client: InventoryReportGraphqlClient, inventoryItemGid: string): Promise<readonly unknown[]> {
  let graphqlResponse: InventoryLevelsGraphqlResponse;
  try {
    graphqlResponse = await client.query(INVENTORY_LEVELS_QUERY, { inventoryItemId: inventoryItemGid, first: INVENTORY_LEVELS_PAGE_SIZE, after: null }, { operationName: 'InventoryReportInventoryLevels' }) as InventoryLevelsGraphqlResponse;
  } catch (error) {
    if (isMaxCostExceededError(error)) {
      throw new InventoryReportError(INVENTORY_MAX_COST_REMEDIATION_MESSAGE, 'MAX_COST_EXCEEDED');
    }
    throw error;
  }
  const connection = graphqlResponse.data?.inventoryItem?.inventoryLevels;

  if (connection?.edges === undefined || connection.pageInfo === undefined) {
    throw new InventoryReportError(`Shopify Admin GraphQL response did not include expected inventory levels connection for inventory item ${inventoryItemGid}.`);
  }

  assertConnectionNotTruncated(
    connection,
    `inventory levels connection was truncated for inventory item ${inventoryItemGid}. v0.1 inventory reports support at most ${INVENTORY_LEVELS_PAGE_SIZE.toString(10)} inventory levels per variant`,
  );

  return connection.edges;
}

function parseProductVariants(value: unknown): InventoryVariantContext[] {
  if (!isRecord(value)) {
    throw new InventoryReportError('Shopify Admin GraphQL response included an invalid product node.');
  }

  const productGid = readString(value.id, 'product id');
  const productTitle = readString(value.title, 'product title');
  assertConnectionNotTruncated(
    value.variants,
    `variants connection was truncated for product ${productGid}. v0.1 inventory reports support at most ${INVENTORY_VARIANTS_PAGE_SIZE.toString(10)} variants per product`,
  );
  const variants = readConnectionEdges(value.variants);
  const contexts: InventoryVariantContext[] = [];

  for (const variantEdge of variants) {
    const variant = readRecord(isRecord(variantEdge) ? variantEdge.node : undefined, 'variant node');
    const variantGid = readString(variant.id, 'variant id');
    const inventoryItem = readRecord(variant.inventoryItem, 'variant inventory item');
    const inventoryItemGid = readString(inventoryItem.id, 'inventory item id');
    contexts.push({
      productGid,
      productTitle,
      variantGid,
      variantTitle: typeof variant.title === 'string' && variant.title.length > 0 ? variant.title : 'Untitled variant',
      sku: typeof variant.sku === 'string' ? variant.sku : '',
      inventoryItemGid,
    });
  }

  return contexts;
}

function buildVariantRows(variant: InventoryVariantContext, levels: readonly unknown[], lowStockThreshold: number): InventoryReportRow[] {
  const rows: InventoryReportRow[] = [];

  for (const levelEdge of levels) {
    const level = readRecord(isRecord(levelEdge) ? levelEdge.node : undefined, 'inventory level node');
    const location = isRecord(level.location) ? level.location : {};
    const available = readQuantity(level, 'available');
    const onHand = readQuantity(level, 'on_hand', 'onHand');
    const committed = readQuantity(level, 'committed');

    rows.push({
      productGid: variant.productGid,
      productId: extractNumericId(variant.productGid),
      productTitle: variant.productTitle,
      variantGid: variant.variantGid,
      variantId: extractNumericId(variant.variantGid),
      variantTitle: variant.variantTitle,
      sku: variant.sku,
      inventoryItemGid: variant.inventoryItemGid,
      inventoryItemId: extractNumericId(variant.inventoryItemGid),
      locationName: typeof location.name === 'string' ? location.name : '',
      available,
      onHand,
      committed,
      lowStock: available !== null && available <= lowStockThreshold,
    });
  }

  return rows;
}

function readConnectionEdges(value: unknown): readonly unknown[] {
  if (!isRecord(value) || !Array.isArray(value.edges)) {
    return [];
  }

  return value.edges;
}

function assertConnectionNotTruncated(value: unknown, detail: string): void {
  if (!isRecord(value)) {
    return;
  }

  const pageInfo = value.pageInfo;
  if (isRecord(pageInfo) && pageInfo.hasNextPage === true) {
    throw new InventoryReportError(`Shopify Admin GraphQL ${detail}. ${INVENTORY_LIMIT_REMEDIATION_MESSAGE}`);
  }
}

function readQuantity(level: Record<string, unknown>, quantityName: string, directField = quantityName): number | null {
  const direct = level[directField];
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return direct;
  }

  const quantities = level.quantities;
  if (Array.isArray(quantities)) {
    for (const quantity of quantities as readonly unknown[]) {
      if (isRecord(quantity) && quantity.name === quantityName && typeof quantity.quantity === 'number' && Number.isFinite(quantity.quantity)) {
        return quantity.quantity;
      }
    }
  }

  return null;
}

function formatMarkdown(report: InventoryReport): string {
  const rows = [
    '| Product ID | Product GID | Product | Variant ID | Variant GID | Variant | SKU | Inventory Item GID | Location | Available | On Hand | Committed | Low Stock |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
  ];

  for (const row of report.rows) {
    rows.push(`| ${[
      markdownCell(row.productId),
      markdownCell(row.productGid),
      markdownCell(row.productTitle),
      markdownCell(row.variantId),
      markdownCell(row.variantGid),
      markdownCell(row.variantTitle),
      markdownCell(row.sku),
      markdownCell(row.inventoryItemGid),
      markdownCell(row.locationName),
      markdownCell(formatNumber(row.available)),
      markdownCell(formatNumber(row.onHand)),
      markdownCell(formatNumber(row.committed)),
      markdownCell(row.lowStock ? 'yes' : 'no'),
    ].join(' | ')} |`);
  }

  return rows.join('\n');
}

function formatCsv(report: InventoryReport): string {
  const rows = ['productId,productGid,productTitle,variantId,variantGid,variantTitle,sku,inventoryItemGid,locationName,available,onHand,committed,lowStock'];

  for (const row of report.rows) {
    rows.push([
      row.productId,
      row.productGid,
      row.productTitle,
      row.variantId,
      row.variantGid,
      row.variantTitle,
      row.sku,
      row.inventoryItemGid,
      row.locationName,
      formatNumber(row.available),
      formatNumber(row.onHand),
      formatNumber(row.committed),
      row.lowStock ? 'true' : 'false',
    ].map(csvCell).join(','));
  }

  return rows.join('\n');
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InventoryReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    if (field.endsWith(' node')) {
      throw new InventoryReportError(`Shopify Admin GraphQL response included an invalid ${field}.`);
    }

    throw new InventoryReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function extractNumericId(gid: string): string {
  const segments = gid.split('/');
  return segments.at(-1) ?? gid;
}

function formatNumber(value: number | null): string {
  return value === null ? '' : value.toString(10);
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
