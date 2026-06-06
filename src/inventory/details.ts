import { isJsonPlainRecord as isRecord } from '../util/json.js';

export const LOCATIONS_QUERY = `
  query Locations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      edges { cursor node { id name isActive fulfillsOnlineOrders legacyResourceId } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const LOCATION_DETAIL_QUERY = `
  query LocationDetail($id: ID!) {
    location(id: $id) {
      id
      name
      isActive
      fulfillsOnlineOrders
      legacyResourceId
    }
  }
`;

export const INVENTORY_ITEM_DETAIL_QUERY = `
  query InventoryItemDetail($id: ID!) {
    inventoryItem(id: $id) {
      id
      sku
      tracked
      requiresShipping
      variant { id title product { id title } }
    }
  }
`;

export const INVENTORY_LEVELS_BY_ITEM_QUERY = `
  query InventoryLevelsByItem($first: Int!, $after: String, $inventoryItemId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      inventoryLevels(first: $first, after: $after) {
        edges { cursor node { id quantities(names: ["available", "committed", "incoming", "on_hand", "reserved"]) { name quantity } location { id name } item { id sku } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const INVENTORY_LEVELS_BY_LOCATION_QUERY = `
  query InventoryLevelsByLocation($first: Int!, $after: String, $locationId: ID!) {
    location(id: $locationId) {
      inventoryLevels(first: $first, after: $after) {
        edges { cursor node { id quantities(names: ["available", "committed", "incoming", "on_hand", "reserved"]) { name quantity } location { id name } item { id sku } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export interface InventoryDetailsGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface LocationListOptions {
  readonly client: InventoryDetailsGraphqlClient;
  readonly first?: number;
  readonly after?: string;
}

export interface LocationGetOptions {
  readonly client: InventoryDetailsGraphqlClient;
  readonly id: string;
}

export interface InventoryItemGetOptions {
  readonly client: InventoryDetailsGraphqlClient;
  readonly id: string;
}

export interface InventoryLevelsListOptions {
  readonly client: InventoryDetailsGraphqlClient;
  readonly inventoryItemId?: string;
  readonly locationId?: string;
  readonly first?: number;
  readonly after?: string;
}

export interface LocationSummary {
  readonly id: string;
  readonly name: string;
  readonly isActive?: boolean;
  readonly fulfillsOnlineOrders?: boolean;
  readonly legacyResourceId?: string;
}

export interface LocationsListResult {
  readonly locations: readonly LocationSummary[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string };
}

export interface InventoryItemDetail {
  readonly id: string;
  readonly sku?: string;
  readonly tracked?: boolean;
  readonly requiresShipping?: boolean;
  readonly variant?: {
    readonly id: string;
    readonly title?: string;
    readonly product?: { readonly id: string; readonly title?: string };
  };
}

export interface InventoryLevelSummary {
  readonly id: string;
  readonly quantities: readonly { readonly name: string; readonly quantity: number }[];
  readonly location?: { readonly id: string; readonly name: string };
  readonly inventoryItem?: { readonly id: string; readonly sku?: string };
}

export interface InventoryLevelsListResult {
  readonly inventoryLevels: readonly InventoryLevelSummary[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string };
}

export class InventoryDetailsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InventoryDetailsError';
  }
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

export async function listLocations(options: LocationListOptions): Promise<LocationsListResult> {
  const first = validatePageSize(options.first, 'Location');
  const response = await options.client.query(LOCATIONS_QUERY, { first, after: options.after ?? null }, { operationName: 'Locations' }) as { readonly data?: { readonly locations?: unknown } };
  const connection = response.data?.locations;
  if (!isConnection(connection)) {
    throw new InventoryDetailsError('Shopify Admin GraphQL response did not include expected locations connection.');
  }
  return {
    locations: connection.edges.map((edge) => normalizeLocationSummary(readNode(edge, 'location'))),
    pageInfo: normalizePageInfo(connection.pageInfo),
  };
}

export async function getLocation(options: LocationGetOptions): Promise<{ readonly location: LocationSummary }> {
  const id = validateGid(options.id, 'Location');
  const response = await options.client.query(LOCATION_DETAIL_QUERY, { id }, { operationName: 'LocationDetail' }) as { readonly data?: { readonly location?: unknown } };
  if (response.data?.location === null) {
    throw new InventoryDetailsError('Location was not found.');
  }
  return { location: normalizeLocationSummary(response.data?.location) };
}

export async function getInventoryItem(options: InventoryItemGetOptions): Promise<{ readonly inventoryItem: InventoryItemDetail }> {
  const id = validateGid(options.id, 'InventoryItem');
  const response = await options.client.query(INVENTORY_ITEM_DETAIL_QUERY, { id }, { operationName: 'InventoryItemDetail' }) as { readonly data?: { readonly inventoryItem?: unknown } };
  if (response.data?.inventoryItem === null) {
    throw new InventoryDetailsError('Inventory item was not found.');
  }
  return { inventoryItem: normalizeInventoryItemDetail(response.data?.inventoryItem) };
}

export async function listInventoryLevels(options: InventoryLevelsListOptions): Promise<InventoryLevelsListResult> {
  const inventoryItemId = options.inventoryItemId === undefined ? undefined : validateGid(options.inventoryItemId, 'InventoryItem');
  const locationId = options.locationId === undefined ? undefined : validateGid(options.locationId, 'Location');
  if ((inventoryItemId === undefined && locationId === undefined) || (inventoryItemId !== undefined && locationId !== undefined)) {
    throw new InventoryDetailsError('Provide exactly one of inventoryItemId or locationId.');
  }
  const first = validatePageSize(options.first, 'Inventory level');
  const byItem = inventoryItemId !== undefined;
  const variables = byItem
    ? { first, after: options.after ?? null, inventoryItemId }
    : { first, after: options.after ?? null, locationId };
  const response = await options.client.query(
    byItem ? INVENTORY_LEVELS_BY_ITEM_QUERY : INVENTORY_LEVELS_BY_LOCATION_QUERY,
    variables,
    { operationName: byItem ? 'InventoryLevelsByItem' : 'InventoryLevelsByLocation' },
  ) as { readonly data?: { readonly inventoryItem?: unknown; readonly location?: unknown } };
  const owner = inventoryItemId === undefined ? response.data?.location : response.data?.inventoryItem;
  if (owner === null) {
    throw new InventoryDetailsError(inventoryItemId === undefined ? 'Location was not found.' : 'Inventory item was not found.');
  }
  if (!isRecord(owner)) {
    throw new InventoryDetailsError('Shopify Admin GraphQL response did not include expected inventory levels owner.');
  }
  const connection = owner.inventoryLevels;
  if (!isConnection(connection)) {
    throw new InventoryDetailsError('Shopify Admin GraphQL response did not include expected inventory levels connection.');
  }
  return {
    inventoryLevels: connection.edges.map((edge) => normalizeInventoryLevel(readNode(edge, 'inventory level'))),
    pageInfo: normalizePageInfo(connection.pageInfo),
  };
}

function validatePageSize(value: number | undefined, label: 'Location' | 'Inventory level'): number {
  const first = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    throw new InventoryDetailsError(`${label} page size must be an integer between 1 and 50.`);
  }
  return first;
}

function validateGid(value: string, type: 'Location' | 'InventoryItem'): string {
  if (value.trim().length === 0) {
    throw new InventoryDetailsError(`${type} id is required.`);
  }
  if (!new RegExp(`^gid://shopify/${type}/[0-9]+$`, 'u').test(value)) {
    throw new InventoryDetailsError(`${type} id must be a Shopify ${type} GID.`);
  }
  return value;
}

interface Connection {
  readonly edges: readonly unknown[];
  readonly pageInfo: unknown;
}

function isConnection(value: unknown): value is Connection {
  return isRecord(value) && Array.isArray(value.edges) && isRecord(value.pageInfo);
}

function readNode(edge: unknown, label: string): unknown {
  if (!isRecord(edge) || !isRecord(edge.node)) {
    throw new InventoryDetailsError(`Shopify Admin GraphQL response included an invalid ${label} edge.`);
  }
  return edge.node;
}

function normalizePageInfo(value: unknown): { readonly hasNextPage: boolean; readonly endCursor?: string } {
  const record = requireRecord(value, 'pageInfo');
  return {
    hasNextPage: readBoolean(record.hasNextPage, 'pageInfo.hasNextPage'),
    ...readOptionalStringProperty(record, 'endCursor'),
  };
}

function normalizeLocationSummary(value: unknown): LocationSummary {
  const node = requireRecord(value, 'location node');
  return {
    id: readString(node.id, 'location id'),
    name: readString(node.name, 'location name'),
    ...readOptionalBooleanProperty(node, 'isActive'),
    ...readOptionalBooleanProperty(node, 'fulfillsOnlineOrders'),
    ...readOptionalStringProperty(node, 'legacyResourceId'),
  };
}

function normalizeInventoryItemDetail(value: unknown): InventoryItemDetail {
  const node = requireRecord(value, 'inventory item node');
  return {
    id: readString(node.id, 'inventory item id'),
    ...readOptionalStringProperty(node, 'sku'),
    ...readOptionalBooleanProperty(node, 'tracked'),
    ...readOptionalBooleanProperty(node, 'requiresShipping'),
    ...normalizeOptionalVariant(node.variant),
  };
}

function normalizeOptionalVariant(value: unknown): { readonly variant?: InventoryItemDetail['variant'] } {
  if (value === undefined || value === null) {
    return {};
  }
  const variant = requireRecord(value, 'inventory item variant');
  const product = variant.product === undefined || variant.product === null ? undefined : requireRecord(variant.product, 'inventory item variant product');
  return {
    variant: {
      id: readString(variant.id, 'variant id'),
      ...readOptionalStringProperty(variant, 'title'),
      ...(product === undefined ? {} : { product: { id: readString(product.id, 'product id'), ...readOptionalStringProperty(product, 'title') } }),
    },
  };
}

function normalizeInventoryLevel(value: unknown): InventoryLevelSummary {
  const node = requireRecord(value, 'inventory level node');
  return {
    id: readString(node.id, 'inventory level id'),
    quantities: normalizeQuantities(node.quantities),
    ...normalizeOptionalLevelLocation(node.location),
    ...normalizeOptionalLevelItem(node.item),
  };
}

function normalizeQuantities(value: unknown): readonly { readonly name: string; readonly quantity: number }[] {
  if (!Array.isArray(value)) {
    throw new InventoryDetailsError('Shopify Admin GraphQL response included invalid inventory level quantities.');
  }
  return value.map((entry) => {
    const quantity = requireRecord(entry, 'inventory quantity');
    return { name: readString(quantity.name, 'inventory quantity name'), quantity: readNumber(quantity.quantity, 'inventory quantity value') };
  });
}

function normalizeOptionalLevelLocation(value: unknown): { readonly location?: { readonly id: string; readonly name: string } } {
  if (value === undefined || value === null) {
    return {};
  }
  const location = requireRecord(value, 'inventory level location');
  return { location: { id: readString(location.id, 'location id'), name: readString(location.name, 'location name') } };
}

function normalizeOptionalLevelItem(value: unknown): { readonly inventoryItem?: { readonly id: string; readonly sku?: string } } {
  if (value === undefined || value === null) {
    return {};
  }
  const item = requireRecord(value, 'inventory level item');
  return { inventoryItem: { id: readString(item.id, 'inventory item id'), ...readOptionalStringProperty(item, 'sku') } };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InventoryDetailsError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new InventoryDetailsError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InventoryDetailsError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InventoryDetailsError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readOptionalStringProperty(record: Record<string, unknown>, key: string): Record<string, string> {
  return typeof record[key] === 'string' ? { [key]: record[key] } : {};
}

function readOptionalBooleanProperty(record: Record<string, unknown>, key: string): Record<string, boolean> {
  return typeof record[key] === 'boolean' ? { [key]: record[key] } : {};
}
