import { hasGraphqlLikeSearchSyntax, isValidOpaqueCursor } from '../input-validation.js';

const DEFAULT_CUSTOMER_PAGE_SIZE = 25;
const MAX_CUSTOMER_PAGE_SIZE = 50;
const CUSTOMER_GID_PATTERN = /^gid:\/\/shopify\/Customer\/\d+$/u;

export const CUSTOMER_PII_POLICY = {
  redactedFields: ['displayName', 'email', 'phone', 'addresses', 'note', 'tags'] as const,
  email: 'domain_only',
  phone: 'presence_only',
} as const;

export const CUSTOMERS_QUERY = `#graphql
query Customers($first: Int!, $after: String, $query: String) {
  customers(first: $first, after: $after, query: $query) {
    edges {
      cursor
      node {
        id
        email
        phone
        createdAt
        updatedAt
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        lastOrder {
          name
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

export const CUSTOMER_QUERY = `#graphql
query Customer($id: ID!) {
  customer(id: $id) {
    id
    email
    phone
    createdAt
    updatedAt
    numberOfOrders
    amountSpent {
      amount
      currencyCode
    }
    lastOrder {
      name
    }
  }
}
`;

export interface CustomerGraphqlClient {
  query(query: string, variables: CustomerListVariables | CustomerGetVariables, options?: CustomerGraphqlQueryOptions): Promise<unknown>;
}

export interface CustomerGraphqlQueryOptions {
  readonly operationName?: string;
}

export interface CustomerListVariables {
  readonly first: number;
  readonly after?: string;
  readonly query?: string;
}

export interface CustomerGetVariables {
  readonly id: string;
}

export interface CustomerMoneySummary {
  readonly amount: string;
  readonly currencyCode: string;
}

export interface CustomerSummary {
  readonly id: string;
  readonly emailDomain?: string;
  readonly phonePresent: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly ordersCount?: number;
  readonly amountSpent?: CustomerMoneySummary;
  readonly lastOrderName?: string;
}

export interface CustomersAggregateSummary {
  readonly customerCount: number;
  readonly withEmailDomainCount: number;
  readonly withPhoneCount: number;
  readonly ordersCount: number;
  readonly amountSpent?: Readonly<Record<string, string>>;
}

export interface CustomersPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export interface CustomersReport {
  readonly customers: readonly CustomerSummary[];
  readonly summary: CustomersAggregateSummary;
  readonly pageInfo: CustomersPageInfo;
  readonly pii: typeof CUSTOMER_PII_POLICY;
}

export interface ListCustomersOptions {
  readonly client: CustomerGraphqlClient;
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface GetCustomerOptions {
  readonly client: CustomerGraphqlClient;
  readonly id: string;
}

interface CustomersResponse {
  readonly data?: {
    readonly customers?: {
      readonly edges?: readonly CustomerEdge[];
      readonly pageInfo?: {
        readonly hasNextPage?: unknown;
        readonly endCursor?: unknown;
      };
    };
  };
}

interface CustomerResponse {
  readonly data?: {
    readonly customer?: CustomerNode | null;
  };
}

interface CustomerEdge {
  readonly node?: CustomerNode | null;
}

interface CustomerNode {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly phone?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly numberOfOrders?: unknown;
  readonly amountSpent?: unknown;
  readonly lastOrder?: unknown;
}

export class CustomerSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CustomerSurfaceError';
  }
}

export async function listCustomers(options: ListCustomersOptions): Promise<CustomersReport> {
  const first = normalizePageSize(options.first);
  const variables: CustomerListVariables = {
    first,
    ...(options.after === undefined ? {} : { after: normalizeCursor(options.after, 'Customer cursor is invalid.') }),
    ...(options.query === undefined ? {} : { query: normalizeSearchQuery(options.query, 'Customer query is invalid.') }),
  };
  const response = await options.client.query(CUSTOMERS_QUERY, variables, { operationName: 'Customers' }) as CustomersResponse;
  const connection = response.data?.customers;
  const edges = connection?.edges;

  if (connection === undefined || !isCustomerEdges(edges) || connection.pageInfo === undefined) {
    throw new CustomerSurfaceError('Shopify Admin GraphQL response did not include expected customers connection.');
  }

  const customers = edges.map((edge) => normalizeCustomerNode(edge.node));
  return {
    customers,
    summary: summarizeCustomers(customers),
    pageInfo: normalizePageInfo(connection.pageInfo),
    pii: CUSTOMER_PII_POLICY,
  };
}

export async function getCustomer(options: GetCustomerOptions): Promise<{ readonly customer: CustomerSummary; readonly pii: typeof CUSTOMER_PII_POLICY }> {
  const id = normalizeCustomerId(options.id);
  const response = await options.client.query(CUSTOMER_QUERY, { id }, { operationName: 'Customer' }) as CustomerResponse;

  if (response.data?.customer === undefined || response.data.customer === null) {
    throw new CustomerSurfaceError('Customer was not found.');
  }

  return { customer: normalizeCustomerNode(response.data.customer), pii: CUSTOMER_PII_POLICY };
}

function normalizePageSize(first: number | undefined): number {
  const pageSize = first ?? DEFAULT_CUSTOMER_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_CUSTOMER_PAGE_SIZE) {
    throw new CustomerSurfaceError('Customer page size must be an integer between 1 and 50.');
  }
  return pageSize;
}

function normalizeCursor(value: string, message: string): string {
  if (!isValidOpaqueCursor(value)) {
    throw new CustomerSurfaceError(message);
  }
  return value;
}

function normalizeSearchQuery(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CustomerSurfaceError(message);
  }
  if (hasGraphqlLikeSearchSyntax(trimmed)) {
    throw new CustomerSurfaceError(message);
  }
  return value;
}

function normalizeCustomerId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CustomerSurfaceError('Customer id is required.');
  }
  if (!CUSTOMER_GID_PATTERN.test(trimmed)) {
    throw new CustomerSurfaceError('Customer id must be a Shopify Customer GID.');
  }
  return trimmed;
}

function isCustomerEdges(value: unknown): value is readonly CustomerEdge[] {
  return Array.isArray(value) && value.every((edge) => typeof edge === 'object' && edge !== null);
}

function normalizePageInfo(pageInfo: { readonly hasNextPage?: unknown; readonly endCursor?: unknown }): CustomersPageInfo {
  if (typeof pageInfo.hasNextPage !== 'boolean') {
    throw new CustomerSurfaceError('Shopify Admin GraphQL customers pageInfo was invalid.');
  }
  return {
    hasNextPage: pageInfo.hasNextPage,
    ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}),
  };
}

function normalizeCustomerNode(node: CustomerNode | null | undefined): CustomerSummary {
  if (node === undefined || node === null || typeof node.id !== 'string') {
    throw new CustomerSurfaceError('Shopify Admin GraphQL response included an invalid customer node.');
  }

  return {
    id: node.id,
    ...normalizeEmailDomain(node.email),
    phonePresent: typeof node.phone === 'string' && node.phone.trim().length > 0,
    ...(typeof node.createdAt === 'string' ? { createdAt: node.createdAt } : {}),
    ...(typeof node.updatedAt === 'string' ? { updatedAt: node.updatedAt } : {}),
    ...normalizeOrdersCount(node.numberOfOrders),
    ...normalizeAmountSpent(node.amountSpent),
    ...normalizeLastOrderName(node.lastOrder),
  };
}

function normalizeEmailDomain(email: unknown): Pick<CustomerSummary, 'emailDomain'> {
  if (typeof email !== 'string') {
    return {};
  }
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) {
    return {};
  }
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  return domain.length === 0 ? {} : { emailDomain: domain };
}

function normalizeOrdersCount(value: unknown): Pick<CustomerSummary, 'ordersCount'> {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return { ordersCount: value };
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return { ordersCount: Number(value) };
  }
  return {};
}

function normalizeAmountSpent(value: unknown): Pick<CustomerSummary, 'amountSpent'> {
  if (typeof value !== 'object' || value === null || !('amount' in value) || !('currencyCode' in value)) {
    return {};
  }
  if (typeof value.amount !== 'string' || typeof value.currencyCode !== 'string') {
    return {};
  }
  return { amountSpent: { amount: value.amount, currencyCode: value.currencyCode } };
}

function normalizeLastOrderName(value: unknown): Pick<CustomerSummary, 'lastOrderName'> {
  if (typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string' || value.name.trim().length === 0) {
    return {};
  }
  return { lastOrderName: value.name };
}

function summarizeCustomers(customers: readonly CustomerSummary[]): CustomersAggregateSummary {
  const amountByCurrency = new Map<string, number>();
  let ordersCount = 0;
  let withEmailDomainCount = 0;
  let withPhoneCount = 0;

  for (const customer of customers) {
    ordersCount += customer.ordersCount ?? 0;
    if (customer.emailDomain !== undefined) {
      withEmailDomainCount += 1;
    }
    if (customer.phonePresent) {
      withPhoneCount += 1;
    }
    if (customer.amountSpent !== undefined) {
      amountByCurrency.set(
        customer.amountSpent.currencyCode,
        (amountByCurrency.get(customer.amountSpent.currencyCode) ?? 0) + Number(customer.amountSpent.amount),
      );
    }
  }

  return {
    customerCount: customers.length,
    withEmailDomainCount,
    withPhoneCount,
    ordersCount,
    ...(amountByCurrency.size === 0 ? {} : { amountSpent: Object.fromEntries([...amountByCurrency.entries()].map(([currency, amount]) => [currency, amount.toFixed(2)])) }),
  };
}
