import { isJsonPlainRecord as isRecord } from '../util/json.js';

export const ORDER_DETAIL_QUERY = `
  query OrderDetail($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      updatedAt
      processedAt
      cancelledAt
      cancelReason
      displayFinancialStatus
      displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      lineItems(first: 25) {
        edges { node { title quantity sku variant { id product { id } } } }
        pageInfo { hasNextPage }
      }
      fulfillments(first: 10) {
        id
        status
        displayStatus
        createdAt
        deliveredAt
        trackingInfo(first: 1) { company }
      }
      refunds(first: 10) {
        id
        createdAt
        totalRefundedSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

export const ORDER_LOOKUP_BY_NAME_QUERY = `
  query OrderLookupByName($query: String!) {
    orders(first: 2, query: $query) {
      edges { node { id } }
    }
  }
`;

export const ORDER_PII_POLICY = {
  redactedFields: ['customer', 'email', 'phone', 'billingAddress', 'shippingAddress', 'note', 'tags', 'trackingNumber', 'trackingUrl', 'transactions'] as const,
} as const;

export interface OrderGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface OrderGetOptions {
  readonly client: OrderGraphqlClient;
  readonly id?: string;
  readonly name?: string;
}

export interface MoneySummary {
  readonly amount: string;
  readonly currencyCode: string;
}

export interface OrderLineItemSummary {
  readonly title: string;
  readonly quantity: number;
  readonly sku?: string;
  readonly variantId?: string;
  readonly productId?: string;
}

export interface OrderFulfillmentSummary {
  readonly id: string;
  readonly status?: string;
  readonly displayStatus?: string;
  readonly createdAt?: string;
  readonly deliveredAt?: string;
  readonly trackingCompany?: string;
}

export interface OrderRefundSummary {
  readonly id: string;
  readonly createdAt?: string;
  readonly totalRefunded?: MoneySummary;
}

export interface OrderDetail {
  readonly id: string;
  readonly name: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly processedAt?: string;
  readonly cancelledAt?: string | null;
  readonly cancelReason?: string | null;
  readonly displayFinancialStatus?: string;
  readonly displayFulfillmentStatus?: string;
  readonly totalPrice?: MoneySummary;
  readonly subtotalPrice?: MoneySummary;
  readonly totalShippingPrice?: MoneySummary;
  readonly totalTax?: MoneySummary;
  readonly lineItems: readonly OrderLineItemSummary[];
  readonly lineItemsTruncated: boolean;
  readonly fulfillments: readonly OrderFulfillmentSummary[];
  readonly fulfillmentsTruncated: boolean;
  readonly refunds: readonly OrderRefundSummary[];
  readonly refundsTruncated: boolean;
}

export interface OrderDetailResult {
  readonly order: OrderDetail;
  readonly pii: typeof ORDER_PII_POLICY;
}

export class OrderSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OrderSurfaceError';
  }
}

export async function getOrderDetail(options: OrderGetOptions): Promise<OrderDetailResult> {
  const id = options.id === undefined ? await resolveOrderIdByName(options.client, options.name) : validateOrderId(options.id);
  if (options.id !== undefined && options.name !== undefined) {
    throw new OrderSurfaceError('Provide exactly one of order id or order name.');
  }
  const response = await options.client.query(ORDER_DETAIL_QUERY, { id }, { operationName: 'OrderDetail' }) as { readonly data?: { readonly order?: unknown } };
  if (response.data?.order === null) {
    throw new OrderSurfaceError('Order was not found.');
  }
  return { order: normalizeOrder(response.data?.order), pii: ORDER_PII_POLICY };
}

async function resolveOrderIdByName(client: OrderGraphqlClient, name: string | undefined): Promise<string> {
  const orderName = validateOrderName(name);
  const response = await client.query(ORDER_LOOKUP_BY_NAME_QUERY, { query: `name:${orderName}` }, { operationName: 'OrderLookupByName' }) as { readonly data?: { readonly orders?: unknown } };
  const connection = response.data?.orders;
  if (!isRecord(connection) || !Array.isArray(connection.edges)) {
    throw new OrderSurfaceError('Shopify Admin GraphQL response did not include expected orders lookup connection.');
  }
  if (connection.edges.length !== 1) {
    throw new OrderSurfaceError(connection.edges.length === 0 ? 'Order was not found.' : 'Order name matched multiple orders. Use a stable Order GID.');
  }
  const edge: unknown = connection.edges[0];
  if (!isRecord(edge) || !isRecord(edge.node)) {
    throw new OrderSurfaceError('Shopify Admin GraphQL response included an invalid order lookup node.');
  }
  return validateOrderId(readString(edge.node.id, 'order id'));
}

function validateOrderId(value: string): string {
  if (value.trim().length === 0) {
    throw new OrderSurfaceError('Order id is required.');
  }
  if (!/^gid:\/\/shopify\/Order\/[0-9]+$/u.test(value)) {
    throw new OrderSurfaceError('Order id must be a Shopify Order GID.');
  }
  return value;
}

function validateOrderName(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new OrderSurfaceError('Provide exactly one of order id or order name.');
  }
  const trimmed = value.trim();
  if (trimmed.length > 64 || !/^#?[A-Za-z0-9-]+$/u.test(trimmed)) {
    throw new OrderSurfaceError('Order name is invalid.');
  }
  return trimmed;
}

function normalizeOrder(value: unknown): OrderDetail {
  const node = requireRecord(value, 'order node');
  return {
    id: readString(node.id, 'order id'),
    name: readString(node.name, 'order name'),
    ...readOptionalString(node, 'createdAt'),
    ...readOptionalString(node, 'updatedAt'),
    ...readOptionalString(node, 'processedAt'),
    ...(typeof node.cancelledAt === 'string' || node.cancelledAt === null ? { cancelledAt: node.cancelledAt } : {}),
    ...(typeof node.cancelReason === 'string' || node.cancelReason === null ? { cancelReason: node.cancelReason } : {}),
    ...readOptionalString(node, 'displayFinancialStatus'),
    ...readOptionalString(node, 'displayFulfillmentStatus'),
    ...readMoneyProperty(node, 'totalPriceSet', 'totalPrice'),
    ...readMoneyProperty(node, 'subtotalPriceSet', 'subtotalPrice'),
    ...readMoneyProperty(node, 'totalShippingPriceSet', 'totalShippingPrice'),
    ...readMoneyProperty(node, 'totalTaxSet', 'totalTax'),
    lineItems: normalizeLineItems(node.lineItems),
    lineItemsTruncated: readHasNextPage(node.lineItems),
    fulfillments: normalizeFulfillments(node.fulfillments),
    fulfillmentsTruncated: Array.isArray(node.fulfillments) && node.fulfillments.length >= 10,
    refunds: normalizeRefunds(node.refunds),
    refundsTruncated: Array.isArray(node.refunds) && node.refunds.length >= 10,
  };
}

function normalizeLineItems(value: unknown): readonly OrderLineItemSummary[] {
  if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.pageInfo)) {
    throw new OrderSurfaceError('Shopify Admin GraphQL response did not include expected order lineItems connection.');
  }
  return value.edges.map((edge) => {
    if (!isRecord(edge) || !isRecord(edge.node)) {
      throw new OrderSurfaceError('Shopify Admin GraphQL response included an invalid order line item node.');
    }
    const node = edge.node;
    const variant = isRecord(node.variant) ? node.variant : undefined;
    const product = variant !== undefined && isRecord(variant.product) ? variant.product : undefined;
    return {
      title: readString(node.title, 'line item title'),
      quantity: readNumber(node.quantity, 'line item quantity'),
      ...readOptionalString(node, 'sku'),
      ...(variant !== undefined && typeof variant.id === 'string' ? { variantId: variant.id } : {}),
      ...(product !== undefined && typeof product.id === 'string' ? { productId: product.id } : {}),
    };
  });
}

function normalizeFulfillments(value: unknown): readonly OrderFulfillmentSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const node = requireRecord(item, 'fulfillment node');
    const trackingInfo = Array.isArray(node.trackingInfo) && isRecord(node.trackingInfo[0]) && typeof node.trackingInfo[0].company === 'string'
      ? { trackingCompany: node.trackingInfo[0].company }
      : {};
    return {
      id: readString(node.id, 'fulfillment id'),
      ...readOptionalString(node, 'status'),
      ...readOptionalString(node, 'displayStatus'),
      ...readOptionalString(node, 'createdAt'),
      ...readOptionalString(node, 'deliveredAt'),
      ...trackingInfo,
    };
  });
}

function normalizeRefunds(value: unknown): readonly OrderRefundSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const node = requireRecord(item, 'refund node');
    return {
      id: readString(node.id, 'refund id'),
      ...readOptionalString(node, 'createdAt'),
      ...readMoneyProperty(node, 'totalRefundedSet', 'totalRefunded'),
    };
  });
}

function readMoneyProperty(node: Record<string, unknown>, sourceKey: string, outputKey: string): Record<string, MoneySummary> {
  const value = node[sourceKey];
  if (!isRecord(value) || !isRecord(value.shopMoney)) {
    return {};
  }
  return { [outputKey]: { amount: readString(value.shopMoney.amount, `${sourceKey} amount`), currencyCode: readString(value.shopMoney.currencyCode, `${sourceKey} currency`) } };
}

function readHasNextPage(value: unknown): boolean {
  return isRecord(value) && isRecord(value.pageInfo) && value.pageInfo.hasNextPage === true;
}

function readOptionalString(node: Record<string, unknown>, key: string): Record<string, string> {
  const value = node[key];
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {};
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OrderSurfaceError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OrderSurfaceError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new OrderSurfaceError(`Shopify Admin GraphQL response included an invalid ${label}.`);
  }
  return value;
}
