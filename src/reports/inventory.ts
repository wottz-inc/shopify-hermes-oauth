import { isJsonPlainRecord as isRecord } from '../util/json.js';

import { csvCell } from './csv.js';

export const INVENTORY_REPORT_QUERY = `
  query InventoryReport($first: Int!, $after: String) {
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
                  inventoryLevels(first: 50) {
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

export type InventoryReportFormat = 'markdown' | 'json' | 'csv';

export interface InventoryReportGraphqlClient {
  query(query: string, variables: InventoryReportVariables): Promise<unknown>;
}

export interface InventoryReportVariables {
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

interface ProductEdge {
  readonly cursor?: unknown;
  readonly node?: unknown;
}

export class InventoryReportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InventoryReportError';
  }
}

const DEFAULT_INVENTORY_PAGE_SIZE = 50;
const MAX_INVENTORY_PAGE_SIZE = 250;
const DEFAULT_MAX_INVENTORY_PAGES = 1_000;
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export async function generateInventoryReport(options: InventoryReportOptions): Promise<InventoryReport> {
  const pageSize = options.pageSize ?? DEFAULT_INVENTORY_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_INVENTORY_PAGES;
  const lowStockThreshold = options.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_INVENTORY_PAGE_SIZE) {
    throw new InventoryReportError('Inventory report page size must be an integer between 1 and 250.');
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
    const graphqlResponse = await options.client.query(INVENTORY_REPORT_QUERY, { first: pageSize, after }) as InventoryReportGraphqlResponse;
    const connection = graphqlResponse.data?.products;

    if (connection?.edges === undefined || connection.pageInfo === undefined) {
      throw new InventoryReportError('Shopify Admin GraphQL response did not include expected products connection.');
    }

    for (const edge of connection.edges) {
      rows.push(...parseProductRows(edge.node, lowStockThreshold));
    }

    if (connection.pageInfo.hasNextPage !== true) {
      return { lowStockThreshold, rows };
    }

    if (typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor.length === 0) {
      throw new InventoryReportError('Shopify Admin GraphQL products page was missing the next cursor.');
    }

    if (connection.pageInfo.endCursor === after || seenCursors.has(connection.pageInfo.endCursor)) {
      throw new InventoryReportError('Shopify Admin GraphQL products pagination did not advance.');
    }

    seenCursors.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
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

function parseProductRows(value: unknown, lowStockThreshold: number): InventoryReportRow[] {
  if (!isRecord(value)) {
    throw new InventoryReportError('Shopify Admin GraphQL response included an invalid product node.');
  }

  const productGid = readString(value.id, 'product id');
  const productTitle = readString(value.title, 'product title');
  assertConnectionNotTruncated(
    value.variants,
    `variants connection was truncated for product ${productGid}. v0.1 inventory reports support at most 100 variants per product`,
  );
  const variants = readConnectionEdges(value.variants);
  const rows: InventoryReportRow[] = [];

  for (const variantEdge of variants) {
    const variant = readRecord(isRecord(variantEdge) ? variantEdge.node : undefined, 'variant node');
    const variantGid = readString(variant.id, 'variant id');
    const inventoryItem = readRecord(variant.inventoryItem, 'variant inventory item');
    const inventoryItemGid = readString(inventoryItem.id, 'inventory item id');
    assertConnectionNotTruncated(
      inventoryItem.inventoryLevels,
      `inventory levels connection was truncated for product ${productGid}, variant ${variantGid}, inventory item ${inventoryItemGid}. v0.1 inventory reports support at most 50 inventory levels per variant`,
    );
    const levels = readConnectionEdges(inventoryItem.inventoryLevels);

    for (const levelEdge of levels) {
      const level = readRecord(isRecord(levelEdge) ? levelEdge.node : undefined, 'inventory level node');
      const location = isRecord(level.location) ? level.location : {};
      const available = readQuantity(level, 'available');
      const onHand = readQuantity(level, 'on_hand', 'onHand');
      const committed = readQuantity(level, 'committed');

      rows.push({
        productGid,
        productId: extractNumericId(productGid),
        productTitle,
        variantGid,
        variantId: extractNumericId(variantGid),
        variantTitle: typeof variant.title === 'string' && variant.title.length > 0 ? variant.title : 'Untitled variant',
        sku: typeof variant.sku === 'string' ? variant.sku : '',
        inventoryItemGid,
        inventoryItemId: extractNumericId(inventoryItemGid),
        locationName: typeof location.name === 'string' ? location.name : '',
        available,
        onHand,
        committed,
        lowStock: available !== null && available <= lowStockThreshold,
      });
    }
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
    throw new InventoryReportError(`Shopify Admin GraphQL ${detail}.`);
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
