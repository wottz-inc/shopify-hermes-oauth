export const WEBHOOK_SUBSCRIPTIONS_QUERY = `#graphql
query WebhookSubscriptions($first: Int!, $after: String) {
  webhookSubscriptions(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        topic
        format
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
          ... on WebhookEventBridgeEndpoint {
            arn
          }
          ... on WebhookPubSubEndpoint {
            pubSubProject
            pubSubTopic
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

export const WEBHOOK_SUBSCRIPTION_QUERY = `#graphql
query WebhookSubscription($id: ID!) {
  webhookSubscription(id: $id) {
    id
    topic
    format
    endpoint {
      __typename
      ... on WebhookHttpEndpoint {
        callbackUrl
      }
      ... on WebhookEventBridgeEndpoint {
        arn
      }
      ... on WebhookPubSubEndpoint {
        pubSubProject
        pubSubTopic
      }
    }
  }
}
`;

const DEFAULT_WEBHOOK_PAGE_SIZE = 50;
const MAX_WEBHOOK_PAGE_SIZE = 100;

export interface WebhookSubscriptionGraphqlClient {
  query(query: string, variables: WebhookSubscriptionsVariables | WebhookSubscriptionVariables, options?: WebhookSubscriptionGraphqlQueryOptions): Promise<unknown>;
}

export interface WebhookSubscriptionGraphqlQueryOptions {
  readonly operationName?: string;
}

export interface WebhookSubscriptionsVariables {
  readonly first: number;
  readonly after?: string;
}

export interface WebhookSubscriptionVariables {
  readonly id: string;
}

export interface WebhookSubscriptionSummary {
  readonly id: string;
  readonly topic: string;
  readonly format?: string;
  readonly endpoint: string;
  readonly endpointType: string;
}

export interface WebhookSubscriptionsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export interface WebhookSubscriptionsReport {
  readonly webhooks: readonly WebhookSubscriptionSummary[];
  readonly pageInfo: WebhookSubscriptionsPageInfo;
}

export interface ListWebhookSubscriptionsOptions {
  readonly client: WebhookSubscriptionGraphqlClient;
  readonly first?: number;
  readonly after?: string;
}

export interface GetWebhookSubscriptionOptions {
  readonly client: WebhookSubscriptionGraphqlClient;
  readonly id: string;
}

interface WebhookSubscriptionsResponse {
  readonly data?: {
    readonly webhookSubscriptions?: {
      readonly edges?: readonly WebhookSubscriptionEdge[];
      readonly pageInfo?: {
        readonly hasNextPage?: unknown;
        readonly endCursor?: unknown;
      };
    };
  };
}

interface WebhookSubscriptionResponse {
  readonly data?: {
    readonly webhookSubscription?: WebhookSubscriptionNode | null;
  };
}

interface WebhookSubscriptionEdge {
  readonly node?: WebhookSubscriptionNode | null;
}

interface WebhookSubscriptionNode {
  readonly id?: unknown;
  readonly topic?: unknown;
  readonly format?: unknown;
  readonly endpoint?: unknown;
}

export class WebhookSubscriptionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WebhookSubscriptionError';
  }
}

export async function listWebhookSubscriptions(options: ListWebhookSubscriptionsOptions): Promise<WebhookSubscriptionsReport> {
  const first = normalizePageSize(options.first);
  const response = await options.client.query(WEBHOOK_SUBSCRIPTIONS_QUERY, { first, ...(options.after === undefined ? {} : { after: options.after }) }, { operationName: 'WebhookSubscriptions' }) as WebhookSubscriptionsResponse;
  const connection = response.data?.webhookSubscriptions;
  if (connection === undefined || !isWebhookSubscriptionEdges(connection.edges) || connection.pageInfo === undefined) {
    throw new WebhookSubscriptionError('Shopify Admin GraphQL response did not include expected webhookSubscriptions connection.');
  }

  return {
    webhooks: connection.edges.map((edge) => normalizeWebhookNode(edge.node)),
    pageInfo: normalizePageInfo(connection.pageInfo),
  };
}

export async function getWebhookSubscription(options: GetWebhookSubscriptionOptions): Promise<{ readonly webhook: WebhookSubscriptionSummary }> {
  if (options.id.trim().length === 0) {
    throw new WebhookSubscriptionError('Webhook subscription id is required.');
  }
  const response = await options.client.query(WEBHOOK_SUBSCRIPTION_QUERY, { id: options.id }, { operationName: 'WebhookSubscription' }) as WebhookSubscriptionResponse;
  if (response.data?.webhookSubscription === undefined || response.data.webhookSubscription === null) {
    throw new WebhookSubscriptionError('Webhook subscription was not found.');
  }
  return { webhook: normalizeWebhookNode(response.data.webhookSubscription) };
}

function normalizePageSize(first: number | undefined): number {
  const pageSize = first ?? DEFAULT_WEBHOOK_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_WEBHOOK_PAGE_SIZE) {
    throw new WebhookSubscriptionError('Webhook subscription page size must be an integer between 1 and 100.');
  }
  return pageSize;
}

function isWebhookSubscriptionEdges(edges: unknown): edges is readonly WebhookSubscriptionEdge[] {
  return Array.isArray(edges);
}

function normalizePageInfo(pageInfo: { readonly hasNextPage?: unknown; readonly endCursor?: unknown }): WebhookSubscriptionsPageInfo {
  if (typeof pageInfo.hasNextPage !== 'boolean') {
    throw new WebhookSubscriptionError('Shopify Admin GraphQL webhookSubscriptions pageInfo was invalid.');
  }
  return {
    hasNextPage: pageInfo.hasNextPage,
    ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}),
  };
}

function normalizeWebhookNode(node: WebhookSubscriptionNode | null | undefined): WebhookSubscriptionSummary {
  if (node === undefined || node === null || typeof node.id !== 'string' || typeof node.topic !== 'string') {
    throw new WebhookSubscriptionError('Shopify Admin GraphQL response included an invalid webhook subscription node.');
  }
  const endpoint = normalizeEndpoint(node.endpoint);
  return {
    id: node.id,
    topic: node.topic,
    ...(typeof node.format === 'string' ? { format: node.format } : {}),
    endpoint: endpoint.value,
    endpointType: endpoint.type,
  };
}

function normalizeEndpoint(endpoint: unknown): { readonly value: string; readonly type: string } {
  if (typeof endpoint !== 'object' || endpoint === null || !('__typename' in endpoint) || typeof endpoint.__typename !== 'string') {
    throw new WebhookSubscriptionError('Shopify Admin GraphQL response included an invalid webhook endpoint.');
  }
  if (endpoint.__typename === 'WebhookHttpEndpoint' && 'callbackUrl' in endpoint && typeof endpoint.callbackUrl === 'string') {
    return { value: redactHttpEndpointQuery(endpoint.callbackUrl), type: 'http' };
  }
  if (endpoint.__typename === 'WebhookEventBridgeEndpoint' && 'arn' in endpoint && typeof endpoint.arn === 'string') {
    return { value: endpoint.arn, type: 'event_bridge' };
  }
  if (endpoint.__typename === 'WebhookPubSubEndpoint' && 'pubSubProject' in endpoint && typeof endpoint.pubSubProject === 'string' && 'pubSubTopic' in endpoint && typeof endpoint.pubSubTopic === 'string') {
    return { value: `${endpoint.pubSubProject}/${endpoint.pubSubTopic}`, type: 'pubsub' };
  }
  throw new WebhookSubscriptionError('Shopify Admin GraphQL response included an unsupported webhook endpoint.');
}

function redactHttpEndpointQuery(callbackUrl: string): string {
  try {
    const parsed = new URL(callbackUrl);
    return parsed.search.length === 0 ? callbackUrl : `${parsed.origin}${parsed.pathname}?[REDACTED]`;
  } catch {
    const queryIndex = callbackUrl.indexOf('?');
    return queryIndex === -1 ? callbackUrl : `${callbackUrl.slice(0, queryIndex)}?[REDACTED]`;
  }
}
