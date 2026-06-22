import { isJsonPlainRecord as isRecord } from '../util/json.js';

import { csvCell } from './csv.js';
import { markdownCell } from './sanitize.js';

export const PRODUCTS_REPORT_QUERY = `
  query ProductsReport($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          handle
          status
          vendor
          productType
          totalInventory
          variants(first: 100) {
            edges {
              node {
                title
                sku
                inventoryQuantity
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

export type ProductsReportFormat = 'markdown' | 'json' | 'csv';

export interface ProductsReportGraphqlClient {
  query(query: string, variables: ProductsReportVariables, options?: ProductsReportGraphqlQueryOptions): Promise<unknown>;
}

export interface ProductsReportGraphqlQueryOptions {
  readonly operationName?: string;
}

export interface ProductsReportVariables {
  readonly first: number;
  readonly after: string | null;
}

export interface ProductsReportOptions {
  readonly client: ProductsReportGraphqlClient;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface ProductReportItem {
  readonly id: string;
  readonly gid: string;
  readonly title: string;
  readonly handle: string;
  readonly status: string;
  readonly vendor: string;
  readonly productType: string;
  readonly totalInventory: number | null;
  readonly variantsSummary: string;
}

export interface ProductsReport {
  readonly products: readonly ProductReportItem[];
}

interface ProductsReportGraphqlResponse {
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

export class ProductsReportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProductsReportError';
  }
}

const DEFAULT_PRODUCTS_PAGE_SIZE = 50;
const MAX_PRODUCTS_PAGE_SIZE = 250;
const DEFAULT_MAX_PRODUCTS_PAGES = 1_000;

export async function generateProductsReport(options: ProductsReportOptions): Promise<ProductsReport> {
  const pageSize = options.pageSize ?? DEFAULT_PRODUCTS_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PRODUCTS_PAGES;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PRODUCTS_PAGE_SIZE) {
    throw new ProductsReportError('Products report page size must be an integer between 1 and 250.');
  }

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new ProductsReportError('Products report maximum page count must be a positive integer.');
  }

  const products: ProductReportItem[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const graphqlResponse = await options.client.query(PRODUCTS_REPORT_QUERY, { first: pageSize, after }, { operationName: 'ProductsReport' }) as ProductsReportGraphqlResponse;
    const connection = graphqlResponse.data?.products;

    if (connection?.edges === undefined || connection.pageInfo === undefined) {
      throw new ProductsReportError('Shopify Admin GraphQL response did not include expected products connection.');
    }

    for (const edge of connection.edges) {
      products.push(parseProduct(edge.node));
    }

    if (connection.pageInfo.hasNextPage !== true) {
      return { products };
    }

    if (typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor.length === 0) {
      throw new ProductsReportError('Shopify Admin GraphQL products page was missing the next cursor.');
    }

    if (connection.pageInfo.endCursor === after || seenCursors.has(connection.pageInfo.endCursor)) {
      throw new ProductsReportError('Shopify Admin GraphQL products pagination did not advance.');
    }

    seenCursors.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
  }

  throw new ProductsReportError('Shopify Admin GraphQL products pagination exceeded the maximum page count.');
}

export function formatProductsReport(report: ProductsReport, format: ProductsReportFormat): string {
  switch (format) {
    case 'markdown':
      return formatMarkdown(report);
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'csv':
      return formatCsv(report);
  }
}

function parseProduct(value: unknown): ProductReportItem {
  if (!isRecord(value)) {
    throw new ProductsReportError('Shopify Admin GraphQL response included an invalid product node.');
  }

  return {
    gid: readString(value.id, 'product id'),
    id: extractNumericId(readString(value.id, 'product id')),
    title: readString(value.title, 'product title'),
    handle: readString(value.handle, 'product handle'),
    status: readString(value.status, 'product status'),
    vendor: readString(value.vendor, 'product vendor'),
    productType: readString(value.productType, 'product type'),
    totalInventory: value.totalInventory === null ? null : readNumber(value.totalInventory, 'product total inventory'),
    variantsSummary: summarizeVariants(value.variants),
  };
}

function summarizeVariants(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.edges)) {
    return 'Unavailable';
  }

  const variants = value.edges.map((edge) => {
    const node = isRecord(edge) ? edge.node : undefined;

    if (!isRecord(node)) {
      return undefined;
    }

    const title = typeof node.title === 'string' && node.title.length > 0 ? node.title : 'Untitled variant';
    const sku = typeof node.sku === 'string' && node.sku.length > 0 ? node.sku : 'n/a';
    const inventory = typeof node.inventoryQuantity === 'number' && Number.isFinite(node.inventoryQuantity)
      ? node.inventoryQuantity.toString(10)
      : 'n/a';

    return `${title} (sku=${sku}, inventory=${inventory})`;
  }).filter((variant): variant is string => variant !== undefined);

  if (variants.length === 0) {
    return hasMoreVariants(value) ? 'No variants shown; additional variants omitted: …' : '0 variants';
  }

  if (hasMoreVariants(value)) {
    return `Showing first ${variants.length.toString(10)} variants; additional variants omitted: ${variants.join('; ')}; …`;
  }

  return `${variants.length.toString(10)} ${variants.length === 1 ? 'variant' : 'variants'}: ${variants.join('; ')}`;
}

function hasMoreVariants(value: Record<string, unknown>): boolean {
  const pageInfo = value.pageInfo;

  return isRecord(pageInfo) && pageInfo.hasNextPage === true;
}

function formatMarkdown(report: ProductsReport): string {
  const rows = [
    '| ID | GID | Title | Handle | Status | Vendor | Type | Inventory | Variants |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | --- |',
  ];

  for (const product of report.products) {
    rows.push(`| ${[
      markdownCell(product.id),
      markdownCell(product.gid),
      markdownCell(product.title),
      markdownCell(product.handle),
      markdownCell(product.status),
      markdownCell(product.vendor),
      markdownCell(product.productType),
      markdownCell(formatInventory(product.totalInventory)),
      markdownCell(product.variantsSummary),
    ].join(' | ')} |`);
  }

  return rows.join('\n');
}

function formatCsv(report: ProductsReport): string {
  const rows = ['id,gid,title,handle,status,vendor,productType,totalInventory,variantsSummary'];

  for (const product of report.products) {
    rows.push([
      product.id,
      product.gid,
      product.title,
      product.handle,
      product.status,
      product.vendor,
      product.productType,
      formatInventory(product.totalInventory),
      product.variantsSummary,
    ].map(csvCell).join(','));
  }

  return rows.join('\n');
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProductsReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProductsReportError(`Shopify Admin GraphQL response did not include expected ${field}.`);
  }

  return value;
}

function extractNumericId(gid: string): string {
  const segments = gid.split('/');
  return segments.at(-1) ?? gid;
}

function formatInventory(value: number | null): string {
  return value === null ? '' : value.toString(10);
}
