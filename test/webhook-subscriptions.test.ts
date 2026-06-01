import { describe, expect, it } from 'vitest';

import {
  getWebhookSubscription,
  listWebhookSubscriptions,
  WEBHOOK_SUBSCRIPTION_QUERY,
  WEBHOOK_SUBSCRIPTIONS_QUERY,
  WebhookSubscriptionError,
} from '../src/webhooks/subscriptions.js';

describe('webhook subscription Admin GraphQL helpers', () => {
  it('lists webhook subscriptions with bounded pagination and normalized endpoint unions', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: unknown) => {
        queries.push({ query, variables });
        return Promise.resolve({
          data: {
            webhookSubscriptions: {
              edges: [
                {
                  cursor: 'cursor-1',
                  node: {
                    id: 'gid://shopify/WebhookSubscription/1',
                    topic: 'ORDERS_CREATE',
                    format: 'JSON',
                    endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: 'https://example.test/webhooks/orders?signature=abc123' },
                  },
                },
                {
                  cursor: 'cursor-2',
                  node: {
                    id: 'gid://shopify/WebhookSubscription/2',
                    topic: 'PRODUCTS_UPDATE',
                    endpoint: { __typename: 'WebhookEventBridgeEndpoint', arn: 'arn:aws:events:eu-west-1:123456789012:event-bus/shopify' },
                  },
                },
                {
                  cursor: 'cursor-3',
                  node: {
                    id: 'gid://shopify/WebhookSubscription/3',
                    topic: 'APP_UNINSTALLED',
                    endpoint: { __typename: 'WebhookPubSubEndpoint', pubSubProject: 'project-a', pubSubTopic: 'topic-a' },
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-3' },
            },
          },
        });
      },
    };

    await expect(listWebhookSubscriptions({ client, first: 25, after: 'cursor-0' })).resolves.toEqual({
      webhooks: [
        {
          id: 'gid://shopify/WebhookSubscription/1',
          topic: 'ORDERS_CREATE',
          format: 'JSON',
          endpoint: 'https://example.test/webhooks/orders?[REDACTED]',
          endpointType: 'http',
        },
        {
          id: 'gid://shopify/WebhookSubscription/2',
          topic: 'PRODUCTS_UPDATE',
          endpoint: 'arn:aws:events:eu-west-1:123456789012:event-bus/shopify',
          endpointType: 'event_bridge',
        },
        {
          id: 'gid://shopify/WebhookSubscription/3',
          topic: 'APP_UNINSTALLED',
          endpoint: 'project-a/topic-a',
          endpointType: 'pubsub',
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: 'cursor-3' },
    });
    expect(queries).toEqual([{ query: WEBHOOK_SUBSCRIPTIONS_QUERY, variables: { first: 25, after: 'cursor-0' } }]);
  });

  it('gets a single webhook subscription by GID', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: unknown) => {
        queries.push({ query, variables });
        return Promise.resolve({
          data: {
            webhookSubscription: {
              id: 'gid://shopify/WebhookSubscription/1',
              topic: 'ORDERS_CREATE',
              format: 'JSON',
              endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: 'https://example.test/webhooks/orders' },
            },
          },
        });
      },
    };

    await expect(getWebhookSubscription({ client, id: 'gid://shopify/WebhookSubscription/1' })).resolves.toEqual({
      webhook: {
        id: 'gid://shopify/WebhookSubscription/1',
        topic: 'ORDERS_CREATE',
        format: 'JSON',
        endpoint: 'https://example.test/webhooks/orders',
        endpointType: 'http',
      },
    });
    expect(queries).toEqual([{ query: WEBHOOK_SUBSCRIPTION_QUERY, variables: { id: 'gid://shopify/WebhookSubscription/1' } }]);
  });

  it('rejects invalid page sizes and malformed Shopify responses safely', async () => {
    const client = { query: () => Promise.resolve({ data: { webhookSubscriptions: { edges: [], pageInfo: { hasNextPage: true } } } }) };

    await expect(listWebhookSubscriptions({ client, first: 0 })).rejects.toThrow(WebhookSubscriptionError);
    await expect(listWebhookSubscriptions({ client, first: 101 })).rejects.toThrow('Webhook subscription page size must be an integer between 1 and 100.');
    await expect(getWebhookSubscription({ client, id: '   ' })).rejects.toThrow('Webhook subscription id is required.');
  });
});
