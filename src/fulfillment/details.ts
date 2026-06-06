import { isJsonPlainRecord as isRecord } from '../util/json.js';

export const FULFILLMENT_ORDERS_BY_ORDER_QUERY = `
  query FulfillmentOrdersByOrder($id: ID!, $first: Int!, $after: String) {
    order(id: $id) {
      fulfillmentOrders(first: $first, after: $after) {
        edges {
          node {
            id
            status
            requestStatus
            deliveryMethod { methodType }
            assignedLocation { location { id name } }
            lineItems(first: 25) {
              edges { node { id totalQuantity remainingQuantity } }
              pageInfo { hasNextPage }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const FULFILLMENT_ORDER_DETAIL_QUERY = `
  query FulfillmentOrderDetail($id: ID!) {
    fulfillmentOrder(id: $id) {
      id
      status
      requestStatus
      deliveryMethod { methodType }
      assignedLocation { location { id name } }
      lineItems(first: 25) {
        edges { node { id totalQuantity remainingQuantity } }
        pageInfo { hasNextPage }
      }
    }
  }
`;

export const FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY = `
  query FulfillmentOrderLookupOrderByName($query: String!) {
    orders(first: 2, query: $query) {
      edges { node { id } }
    }
  }
`;

export const FULFILLMENT_ORDER_PII_POLICY = {
  redactedFields: ['destinationAddress', 'customer', 'email', 'phone', 'trackingNumber', 'trackingUrl', 'label', 'note', 'tags', 'metafields', 'transactions'] as const,
  note: 'Destination address, tracking numbers/URLs, customer contact, notes/tags, metafields, and transactions are omitted.',
} as const;

export interface FulfillmentOrderGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface FulfillmentOrdersListOptions {
  readonly client: FulfillmentOrderGraphqlClient;
  readonly orderId?: string;
  readonly orderName?: string;
  readonly first?: number;
  readonly after?: string;
}

export interface FulfillmentOrderGetOptions {
  readonly client: FulfillmentOrderGraphqlClient;
  readonly id: string;
}

export interface FulfillmentOrderLineItemSummary {
  readonly id: string;
  readonly totalQuantity: number;
  readonly remainingQuantity: number;
}

export interface FulfillmentOrderSummary {
  readonly id: string;
  readonly status?: string;
  readonly requestStatus?: string;
  readonly deliveryMethod?: { readonly methodType: string };
  readonly assignedLocation?: { readonly location: { readonly id: string; readonly name: string } };
  readonly lineItems: readonly FulfillmentOrderLineItemSummary[];
  readonly lineItemsTruncated: boolean;
}

export interface FulfillmentOrdersListResult {
  readonly fulfillmentOrders: readonly FulfillmentOrderSummary[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string };
  readonly pii: typeof FULFILLMENT_ORDER_PII_POLICY;
}

export interface FulfillmentOrderGetResult {
  readonly fulfillmentOrder: FulfillmentOrderSummary;
  readonly pii: typeof FULFILLMENT_ORDER_PII_POLICY;
}

export class FulfillmentOrderVisibilityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FulfillmentOrderVisibilityError';
  }
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

export async function listFulfillmentOrders(options: FulfillmentOrdersListOptions): Promise<FulfillmentOrdersListResult> {
  if ((options.orderId === undefined && options.orderName === undefined) || (options.orderId !== undefined && options.orderName !== undefined)) {
    throw new FulfillmentOrderVisibilityError('Provide exactly one of orderId or orderName.');
  }
  const orderId = options.orderId === undefined ? await resolveOrderIdByName(options.client, options.orderName) : validateOrderId(options.orderId);
  const first = validatePageSize(options.first);
  const response = await options.client.query(
    FULFILLMENT_ORDERS_BY_ORDER_QUERY,
    { id: orderId, first, after: options.after ?? null },
    { operationName: 'FulfillmentOrdersByOrder' },
  ) as { readonly data?: { readonly order?: unknown } };
  if (response.data?.order === null) {
    throw new FulfillmentOrderVisibilityError('Order was not found.');
  }
  const order = requireRecord(response.data?.order, 'order node');
  const connection = order.fulfillmentOrders;
  if (!isConnection(connection)) {
    throw new FulfillmentOrderVisibilityError('Shopify Admin GraphQL response did not include expected fulfillmentOrders connection.');
  }
  return {
    fulfillmentOrders: connection.edges.map((edge) => normalizeFulfillmentOrder(readNode(edge, 'fulfillment order'))),
    pageInfo: normalizePageInfo(connection.pageInfo),
    pii: FULFILLMENT_ORDER_PII_POLICY,
  };
}

export async function getFulfillmentOrder(options: FulfillmentOrderGetOptions): Promise<FulfillmentOrderGetResult> {
  const id = validateFulfillmentOrderId(options.id);
  const response = await options.client.query(FULFILLMENT_ORDER_DETAIL_QUERY, { id }, { operationName: 'FulfillmentOrderDetail' }) as { readonly data?: { readonly fulfillmentOrder?: unknown } };
  if (response.data?.fulfillmentOrder === null) {
    throw new FulfillmentOrderVisibilityError('Fulfillment order was not found.');
  }
  return { fulfillmentOrder: normalizeFulfillmentOrder(response.data?.fulfillmentOrder), pii: FULFILLMENT_ORDER_PII_POLICY };
}

async function resolveOrderIdByName(client: FulfillmentOrderGraphqlClient, name: string | undefined): Promise<string> {
  const orderName = validateOrderName(name);
  const response = await client.query(
    FULFILLMENT_ORDERS_LOOKUP_ORDER_BY_NAME_QUERY,
    { query: `name:${orderName}` },
    { operationName: 'FulfillmentOrderLookupOrderByName' },
  ) as { readonly data?: { readonly orders?: unknown } };
  const connection = response.data?.orders;
  if (!isRecord(connection) || !Array.isArray(connection.edges)) {
    throw new FulfillmentOrderVisibilityError('Shopify Admin GraphQL response did not include expected orders lookup connection.');
  }
  const edges: readonly unknown[] = connection.edges;
  if (edges.length !== 1) {
    throw new FulfillmentOrderVisibilityError(edges.length === 0 ? 'Order was not found.' : 'Order name matched multiple orders. Use a stable Order GID.');
  }
  const edge = edges[0];
  if (!isRecord(edge) || !isRecord(edge.node)) {
    throw new FulfillmentOrderVisibilityError('Shopify Admin GraphQL response included an invalid order lookup node.');
  }
  return validateOrderId(readString(edge.node.id, 'order id'));
}

function validateOrderId(value: string): string {
  if (value.trim().length === 0) {
    throw new FulfillmentOrderVisibilityError('Order id is required.');
  }
  if (!/^gid:\/\/shopify\/Order\/[0-9]+$/u.test(value)) {
    throw new FulfillmentOrderVisibilityError('Order id must be a Shopify Order GID.');
  }
  return value;
}

function validateFulfillmentOrderId(value: string): string {
  if (value.trim().length === 0) {
    throw new FulfillmentOrderVisibilityError('Fulfillment order id is required.');
  }
  if (!/^gid:\/\/shopify\/FulfillmentOrder\/[0-9]+$/u.test(value)) {
    throw new FulfillmentOrderVisibilityError('Fulfillment order id must be a Shopify FulfillmentOrder GID.');
  }
  return value;
}

function validateOrderName(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new FulfillmentOrderVisibilityError('Provide exactly one of orderId or orderName.');
  }
  const trimmed = value.trim();
  if (trimmed.length > 64 || !/^#?[A-Za-z0-9-]+$/u.test(trimmed)) {
    throw new FulfillmentOrderVisibilityError('Order name is invalid.');
  }
  return trimmed;
}

function validatePageSize(value: number | undefined): number {
  const first = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    throw new FulfillmentOrderVisibilityError('Fulfillment order page size must be an integer between 1 and 50.');
  }
  return first;
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
    throw new FulfillmentOrderVisibilityError(`Shopify Admin GraphQL response included an invalid ${label} edge.`);
  }
  return edge.node;
}

function normalizeFulfillmentOrder(value: unknown): FulfillmentOrderSummary {
  const node = requireRecord(value, 'fulfillment order node');
  return {
    id: readString(node.id, 'fulfillment order id'),
    ...readOptionalStringProperty(node, 'status'),
    ...readOptionalStringProperty(node, 'requestStatus'),
    ...normalizeDeliveryMethod(node.deliveryMethod),
    ...normalizeAssignedLocation(node.assignedLocation),
    lineItems: normalizeLineItems(node.lineItems),
    lineItemsTruncated: readHasNextPage(node.lineItems),
  };
}

function normalizeDeliveryMethod(value: unknown): { readonly deliveryMethod?: { readonly methodType: string } } {
  if (value === undefined || value === null) {
    return {};
  }
  const deliveryMethod = requireRecord(value, 'delivery method');
  return typeof deliveryMethod.methodType === 'string' ? { deliveryMethod: { methodType: deliveryMethod.methodType } } : {};
}

function normalizeAssignedLocation(value: unknown): { readonly assignedLocation?: { readonly location: { readonly id: string; readonly name: string } } } {
  if (value === undefined || value === null) {
    return {};
  }
  const assignedLocation = requireRecord(value, 'assigned location');
  if (assignedLocation.location === undefined || assignedLocation.location === null) {
    return {};
  }
  const location = requireRecord(assignedLocation.location, 'assigned location location');
  return { assignedLocation: { location: { id: readString(location.id, 'location id'), name: readString(location.name, 'location name') } } };
}

function normalizeLineItems(value: unknown): readonly FulfillmentOrderLineItemSummary[] {
  if (!isConnection(value)) {
    throw new FulfillmentOrderVisibilityError('Shopify Admin GraphQL response did not include expected fulfillment order lineItems connection.');
  }
  return value.edges.map((edge) => {
    const node = requireRecord(readNode(edge, 'fulfillment order line item'), 'fulfillment order line item node');
    return {
      id: readString(node.id, 'fulfillment order line item id'),
      totalQuantity: readNumber(node.totalQuantity, 'fulfillment order line item totalQuantity'),
      remainingQuantity: readNumber(node.remainingQuantity, 'fulfillment order line item remainingQuantity'),
    };
  });
}

function readHasNextPage(value: unknown): boolean {
  if (!isConnection(value)) {
    throw new FulfillmentOrderVisibilityError('Shopify Admin GraphQL response did not include expected fulfillment order lineItems connection.');
  }
  return readBoolean(requireRecord(value.pageInfo, 'pageInfo').hasNextPage, 'pageInfo.hasNextPage');
}

function normalizePageInfo(value: unknown): { readonly hasNextPage: boolean; readonly endCursor?: string } {
  const pageInfo = requireRecord(value, 'pageInfo');
  return {
    hasNextPage: readBoolean(pageInfo.hasNextPage, 'pageInfo.hasNextPage'),
    ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new FulfillmentOrderVisibilityError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new FulfillmentOrderVisibilityError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FulfillmentOrderVisibilityError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new FulfillmentOrderVisibilityError(`Shopify Admin GraphQL response included invalid ${label}.`);
  }
  return value;
}

function readOptionalStringProperty(record: Record<string, unknown>, key: string): Record<string, string> {
  return typeof record[key] === 'string' ? { [key]: record[key] } : {};
}
