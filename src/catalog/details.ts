import { isJsonPlainRecord as isRecord } from '../util/json.js';

export const PRODUCT_DETAIL_QUERY = `
  query ProductDetail($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      publishedAt
      onlineStoreUrl
      options { name values }
      variants(first: 25) {
        edges { node { id title sku price inventoryQuantity } }
        pageInfo { hasNextPage }
      }
      media(first: 10) {
        edges { node { mediaContentType alt status preview { image { url } } } }
        pageInfo { hasNextPage }
      }
      metafields(first: 20) {
        edges { node { namespace key type value } }
        pageInfo { hasNextPage }
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `
  query Collections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      edges { cursor node { id title handle updatedAt sortOrder } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const COLLECTION_DETAIL_QUERY = `
  query CollectionDetail($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
      updatedAt
      sortOrder
      products(first: 25) {
        edges { node { id title handle status } }
        pageInfo { hasNextPage }
      }
      metafields(first: 20) {
        edges { node { namespace key type value } }
        pageInfo { hasNextPage }
      }
    }
  }
`;

export interface CatalogGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface ProductCatalogOptions {
  readonly client: CatalogGraphqlClient;
  readonly id: string;
}

export interface CollectionListOptions {
  readonly client: CatalogGraphqlClient;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface CollectionGetOptions {
  readonly client: CatalogGraphqlClient;
  readonly id: string;
}

export interface CatalogMetafieldSummary {
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly valuePresent: boolean;
  readonly valueLength?: number;
}

export interface CatalogProductSummary {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
  readonly status?: string;
}

export interface ProductDetail extends CatalogProductSummary {
  readonly vendor?: string;
  readonly productType?: string;
  readonly publishedAt?: string | null;
  readonly onlineStoreUrl?: string | null;
  readonly options: readonly { readonly name: string; readonly values: readonly string[] }[];
  readonly variants: readonly { readonly id: string; readonly title: string; readonly sku?: string; readonly price?: string; readonly inventoryQuantity?: number }[];
  readonly variantsTruncated: boolean;
  readonly media: readonly { readonly mediaContentType: string; readonly alt?: string; readonly status?: string; readonly previewImageUrl?: string }[];
  readonly mediaTruncated: boolean;
  readonly metafields: readonly CatalogMetafieldSummary[];
  readonly metafieldsTruncated: boolean;
}

export interface CollectionSummary {
  readonly id: string;
  readonly title: string;
  readonly handle?: string;
  readonly updatedAt?: string;
  readonly sortOrder?: string;
}

export interface CollectionsListResult {
  readonly collections: readonly CollectionSummary[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string };
}

export interface CollectionDetail extends CollectionSummary {
  readonly products: readonly CatalogProductSummary[];
  readonly productsTruncated: boolean;
  readonly metafields: readonly CatalogMetafieldSummary[];
  readonly metafieldsTruncated: boolean;
}

export class CatalogSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CatalogSurfaceError';
  }
}

const DEFAULT_COLLECTION_PAGE_SIZE = 25;
const MAX_COLLECTION_PAGE_SIZE = 50;

export async function getProductDetail(options: ProductCatalogOptions): Promise<{ readonly product: ProductDetail }> {
  const id = validateGid(options.id, 'Product');
  const response = await options.client.query(PRODUCT_DETAIL_QUERY, { id }, { operationName: 'ProductDetail' }) as { readonly data?: { readonly product?: unknown } };
  if (response.data?.product === null) {
    throw new CatalogSurfaceError('Product was not found.');
  }
  return { product: normalizeProductDetail(response.data?.product) };
}

export async function listCollections(options: CollectionListOptions): Promise<CollectionsListResult> {
  const first = options.first ?? DEFAULT_COLLECTION_PAGE_SIZE;
  if (!Number.isInteger(first) || first < 1 || first > MAX_COLLECTION_PAGE_SIZE) {
    throw new CatalogSurfaceError('Collection page size must be an integer between 1 and 50.');
  }
  const variables = {
    first,
    after: options.after ?? null,
    query: options.query ?? null,
  };
  const response = await options.client.query(COLLECTIONS_QUERY, variables, { operationName: 'Collections' }) as { readonly data?: { readonly collections?: unknown } };
  const connection = response.data?.collections;
  if (!isConnection(connection)) {
    throw new CatalogSurfaceError('Shopify Admin GraphQL response did not include expected collections connection.');
  }
  return {
    collections: connection.edges.map((edge) => normalizeCollectionSummary(readNode(edge, 'collection'))),
    pageInfo: normalizePageInfo(connection.pageInfo),
  };
}

export async function getCollection(options: CollectionGetOptions): Promise<{ readonly collection: CollectionDetail }> {
  const id = validateGid(options.id, 'Collection');
  const response = await options.client.query(COLLECTION_DETAIL_QUERY, { id }, { operationName: 'CollectionDetail' }) as { readonly data?: { readonly collection?: unknown } };
  if (response.data?.collection === null) {
    throw new CatalogSurfaceError('Collection was not found.');
  }
  return { collection: normalizeCollectionDetail(response.data?.collection) };
}

function validateGid(value: string, type: 'Product' | 'Collection'): string {
  if (value.trim().length === 0) {
    throw new CatalogSurfaceError(`${type} id is required.`);
  }
  if (!new RegExp(`^gid://shopify/${type}/[0-9]+$`, 'u').test(value)) {
    throw new CatalogSurfaceError(`${type} id must be a Shopify ${type} GID.`);
  }
  return value;
}

function normalizeProductDetail(value: unknown): ProductDetail {
  const node = requireRecord(value, 'product node');
  return {
    ...normalizeProductSummary(node),
    ...readOptionalStringProperty(node, 'vendor'),
    ...readOptionalStringProperty(node, 'productType'),
    ...(typeof node.publishedAt === 'string' || node.publishedAt === null ? { publishedAt: node.publishedAt } : {}),
    ...(typeof node.onlineStoreUrl === 'string' || node.onlineStoreUrl === null ? { onlineStoreUrl: node.onlineStoreUrl } : {}),
    options: normalizeOptions(node.options),
    variants: normalizeConnectionNodes(node.variants, normalizeVariant, 'product variants'),
    variantsTruncated: readHasNextPage(node.variants),
    media: normalizeConnectionNodes(node.media, normalizeMedia, 'product media'),
    mediaTruncated: readHasNextPage(node.media),
    metafields: normalizeConnectionNodes(node.metafields, normalizeMetafield, 'product metafields'),
    metafieldsTruncated: readHasNextPage(node.metafields),
  };
}

function normalizeCollectionDetail(value: unknown): CollectionDetail {
  const node = requireRecord(value, 'collection node');
  return {
    ...normalizeCollectionSummary(node),
    products: normalizeConnectionNodes(node.products, normalizeProductSummary, 'collection products'),
    productsTruncated: readHasNextPage(node.products),
    metafields: normalizeConnectionNodes(node.metafields, normalizeMetafield, 'collection metafields'),
    metafieldsTruncated: readHasNextPage(node.metafields),
  };
}

function normalizeProductSummary(value: unknown): CatalogProductSummary {
  const node = requireRecord(value, 'product node');
  return {
    id: readString(node.id, 'product id'),
    title: readString(node.title, 'product title'),
    ...readOptionalStringProperty(node, 'handle'),
    ...readOptionalStringProperty(node, 'status'),
  };
}

function normalizeCollectionSummary(value: unknown): CollectionSummary {
  const node = requireRecord(value, 'collection node');
  return {
    id: readString(node.id, 'collection id'),
    title: readString(node.title, 'collection title'),
    ...readOptionalStringProperty(node, 'handle'),
    ...readOptionalStringProperty(node, 'updatedAt'),
    ...readOptionalStringProperty(node, 'sortOrder'),
  };
}

function normalizeVariant(value: unknown): ProductDetail['variants'][number] {
  const node = requireRecord(value, 'variant node');
  return {
    id: readString(node.id, 'variant id'),
    title: readString(node.title, 'variant title'),
    ...readOptionalStringProperty(node, 'sku'),
    ...readOptionalStringProperty(node, 'price'),
    ...(typeof node.inventoryQuantity === 'number' && Number.isFinite(node.inventoryQuantity) ? { inventoryQuantity: node.inventoryQuantity } : {}),
  };
}

function normalizeMedia(value: unknown): ProductDetail['media'][number] {
  const node = requireRecord(value, 'media node');
  const preview = isRecord(node.preview) && isRecord(node.preview.image) && typeof node.preview.image.url === 'string'
    ? { previewImageUrl: node.preview.image.url }
    : {};
  return {
    mediaContentType: readString(node.mediaContentType, 'media content type'),
    ...readOptionalStringProperty(node, 'alt'),
    ...readOptionalStringProperty(node, 'status'),
    ...preview,
  };
}

function normalizeMetafield(value: unknown): CatalogMetafieldSummary {
  const node = requireRecord(value, 'metafield node');
  return {
    namespace: readString(node.namespace, 'metafield namespace'),
    key: readString(node.key, 'metafield key'),
    type: readString(node.type, 'metafield type'),
    ...(typeof node.value === 'string' ? { valuePresent: node.value.length > 0, valueLength: node.value.length } : { valuePresent: false }),
  };
}

function normalizeOptions(value: unknown): ProductDetail['options'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((option) => {
    if (!isRecord(option) || typeof option.name !== 'string' || !Array.isArray(option.values)) {
      return [];
    }
    return [{ name: option.name, values: option.values.filter((entry): entry is string => typeof entry === 'string') }];
  });
}

function normalizeConnectionNodes<T>(value: unknown, normalize: (node: unknown) => T, label: string): readonly T[] {
  if (!isConnection(value)) {
    throw new CatalogSurfaceError(`Shopify Admin GraphQL response did not include expected ${label} connection.`);
  }
  return value.edges.map((edge) => normalize(readNode(edge, label)));
}

function isConnection(value: unknown): value is { readonly edges: readonly unknown[]; readonly pageInfo: Record<string, unknown> } {
  return isRecord(value) && Array.isArray(value.edges) && isRecord(value.pageInfo);
}

function readNode(edge: unknown, label: string): unknown {
  if (!isRecord(edge)) {
    throw new CatalogSurfaceError(`Shopify Admin GraphQL response included an invalid ${label} edge.`);
  }
  return edge.node;
}

function normalizePageInfo(pageInfo: Record<string, unknown>): CollectionsListResult['pageInfo'] {
  return {
    hasNextPage: pageInfo.hasNextPage === true,
    ...(typeof pageInfo.endCursor === 'string' && pageInfo.endCursor.length > 0 ? { endCursor: pageInfo.endCursor } : {}),
  };
}

function readHasNextPage(value: unknown): boolean {
  return isRecord(value) && isRecord(value.pageInfo) && value.pageInfo.hasNextPage === true;
}

function readOptionalStringProperty(node: Record<string, unknown>, key: string): Record<string, string> {
  const value = node[key];
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {};
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CatalogSurfaceError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CatalogSurfaceError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

