import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_QUERY,
  CUSTOMERS_QUERY,
  CustomerSurfaceError,
  getCustomer,
  listCustomers,
} from '../src/customers/index.js';

describe('customer Admin GraphQL helpers', () => {
  it('lists customers with bounded pagination, explicit query semantics, and minimal PII normalization', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => {
        queries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            customers: {
              edges: [
                {
                  cursor: 'cursor-1',
                  node: {
                    id: 'gid://shopify/Customer/1',
                              email: 'ada@example.test',
                    phone: '+15551234567',
                    createdAt: '2026-01-01T00:00:00Z',
                    updatedAt: '2026-01-02T00:00:00Z',
                    numberOfOrders: '3',
                    amountSpent: { amount: '123.45', currencyCode: 'USD' },
                    lastOrder: { name: '#1003' },
                    defaultAddress: { address1: '1 Privacy Way' },
                    note: 'private note',
                    tags: ['vip'],
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            },
          },
        });
      },
    };

    const result = await listCustomers({ client, first: 10, after: 'cursor-0', query: 'created_at:>=2026-01-01' });

    expect(result).toEqual({
      customers: [
        {
          id: 'gid://shopify/Customer/1',
          emailDomain: 'example.test',
          phonePresent: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          ordersCount: 3,
          amountSpent: { amount: '123.45', currencyCode: 'USD' },
          lastOrderName: '#1003',
        },
      ],
      summary: { customerCount: 1, withEmailDomainCount: 1, withPhoneCount: 1, ordersCount: 3, amountSpent: { USD: '123.45' } },
      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
      pii: { redactedFields: ['displayName', 'email', 'phone', 'addresses', 'note', 'tags'], email: 'domain_only', phone: 'presence_only' },
    });
    expect(queries).toEqual([{ query: CUSTOMERS_QUERY, variables: { first: 10, after: 'cursor-0', query: 'created_at:>=2026-01-01' }, options: { operationName: 'Customers' } }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Ada Lovelace');
    expect(serialized).not.toContain('ada@example.test');
    expect(serialized).not.toContain('+15551234567');
    expect(serialized).not.toContain('1 Privacy Way');
    expect(serialized).not.toContain('private note');
    expect(serialized).not.toContain('vip');
  });

  it('gets a single customer by stable GID with minimal fields', async () => {
    const queries: unknown[] = [];
    const client = {
      query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => {
        queries.push({ query, variables, options });
        return Promise.resolve({
          data: {
            customer: {
              id: 'gid://shopify/Customer/1',
                  email: 'ada@sub.example.test',
              phone: null,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
              numberOfOrders: 0,
              amountSpent: { amount: '0.00', currencyCode: 'USD' },
              lastOrder: null,
            },
          },
        });
      },
    };

    await expect(getCustomer({ client, id: 'gid://shopify/Customer/1' })).resolves.toEqual({
      customer: {
        id: 'gid://shopify/Customer/1',
        emailDomain: 'sub.example.test',
        phonePresent: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        ordersCount: 0,
        amountSpent: { amount: '0.00', currencyCode: 'USD' },
      },
      pii: { redactedFields: ['displayName', 'email', 'phone', 'addresses', 'note', 'tags'], email: 'domain_only', phone: 'presence_only' },
    });
    expect(queries).toEqual([{ query: CUSTOMER_QUERY, variables: { id: 'gid://shopify/Customer/1' }, options: { operationName: 'Customer' } }]);
  });

  it('rejects unsafe pagination and malformed customer responses safely', async () => {
    const client = { query: () => Promise.resolve({ data: { customers: { edges: [], pageInfo: { hasNextPage: true } } } }) };

    await expect(listCustomers({ client, first: 0 })).rejects.toThrow('Customer page size must be an integer between 1 and 50.');
    await expect(listCustomers({ client, first: 51 })).rejects.toThrow(CustomerSurfaceError);
    await expect(getCustomer({ client, id: '   ' })).rejects.toThrow('Customer id is required.');
    await expect(getCustomer({ client, id: 'gid://shopify/Order/1' })).rejects.toThrow('Customer id must be a Shopify Customer GID.');
  });
});
