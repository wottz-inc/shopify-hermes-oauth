import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BULK_OPERATION_TEMPLATES,
  BulkOperationError,
  fetchBulkOperationResult,
  getBulkOperationTemplate,
  getCurrentBulkOperation,
  startBulkOperation,
  cancelBulkOperation,
  waitForBulkOperation,
} from '../src/bulk/operations.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('curated bulk operations', () => {
  it('defines read-only templates with scopes and output shapes without exposing raw GraphQL', () => {
    expect(BULK_OPERATION_TEMPLATES.map((template) => template.id)).toEqual([
      'products-basic',
      'orders-basic',
      'inventory-items-basic',
    ]);
    for (const template of BULK_OPERATION_TEMPLATES) {
      expect(template.access).toBe('read');
      expect(template.query.trim().startsWith('{')).toBe(true);
      expect(template.query).not.toMatch(/mutation|bulkOperationRunQuery|bulkOperationCancel/iu);
      expect(template.requiredScopes.length).toBeGreaterThan(0);
      expect(template.outputShape).toContain('JSONL');
    }
    expect(getBulkOperationTemplate('products-basic')?.requiredScopes).toEqual(['read_products']);
    expect(getBulkOperationTemplate('missing-template')).toBeUndefined();
  });

  it('starts a bulk operation using only an approved template query', async () => {
    const calls: unknown[] = [];
    const client = {
      query: (query: string, variables: unknown, options?: { readonly operationName?: string }) => {
        calls.push({ query, variables, options });
        return Promise.resolve({
          data: {
            bulkOperationRunQuery: {
              bulkOperation: { id: 'gid://shopify/BulkOperation/1', status: 'CREATED' },
              userErrors: [],
            },
          },
        });
      },
    };

    await expect(startBulkOperation({ client, templateId: 'products-basic' })).resolves.toEqual({
      templateId: 'products-basic',
      bulkOperation: { id: 'gid://shopify/BulkOperation/1', status: 'CREATED' },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls as [{ readonly query: string; readonly variables: unknown; readonly options?: { readonly operationName?: string } }];
    expect(call.query).toContain('bulkOperationRunQuery');
    expect(call.variables).toEqual({ query: getBulkOperationTemplate('products-basic')?.query });
    expect(call.options).toEqual({ operationName: 'BulkOperationRunQuery' });
  });

  it('surfaces user errors and invalid states as safe bulk operation errors', async () => {
    const client = {
      query: () => Promise.resolve({
        data: {
          bulkOperationRunQuery: {
            bulkOperation: null,
            userErrors: [{ field: ['query'], message: 'Access denied for read_products' }],
          },
        },
      }),
    };

    await expect(startBulkOperation({ client, templateId: 'products-basic' })).rejects.toMatchObject({
      name: 'BulkOperationError',
      code: 'BULK_OPERATION_USER_ERROR',
      message: 'Shopify bulk operation failed: Access denied for read_products',
    });
    await expect(startBulkOperation({ client, templateId: 'not-allowed' })).rejects.toMatchObject({
      code: 'BULK_OPERATION_INVALID_TEMPLATE',
    });
  });

  it('reads status, supports safe cancel, and preserves partial/failure state fields', async () => {
    const seen: string[] = [];
    let currentStatusCallCount = 0;
    const client = {
      query: (_query: string, _variables: unknown, options?: { readonly operationName?: string }) => {
        seen.push(options?.operationName ?? '');
        if (options?.operationName === 'CurrentBulkOperation') {
          currentStatusCallCount += 1;
          return Promise.resolve({
            data: {
              currentBulkOperation: {
                id: 'gid://shopify/BulkOperation/2',
                status: currentStatusCallCount === 1 ? 'FAILED' : 'RUNNING',
                errorCode: 'TIMEOUT',
                objectCount: '1200',
                fileSize: '2048',
                url: 'https://cdn.shopify.com/result.jsonl?signature=secret',
                partialDataUrl: 'https://cdn.shopify.com/partial.jsonl?signature=secret',
                createdAt: '2026-01-01T00:00:00Z',
                completedAt: '2026-01-01T00:01:00Z',
              },
            },
          });
        }
        return Promise.resolve({
          data: {
            bulkOperationCancel: {
              bulkOperation: { id: 'gid://shopify/BulkOperation/2', status: 'CANCELING' },
              userErrors: [],
            },
          },
        });
      },
    };

    const status = await getCurrentBulkOperation({ client });
    expect(status).toMatchObject({
      bulkOperation: {
        id: 'gid://shopify/BulkOperation/2',
        status: 'FAILED',
        errorCode: 'TIMEOUT',
        objectCount: 1200,
        fileSize: 2048,
        url: 'https://cdn.shopify.com/result.jsonl',
        partialDataUrl: 'https://cdn.shopify.com/partial.jsonl',
        createdAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:01:00Z',
      },
    });
    expect(status.bulkOperation?.urlHandle).toMatch(/^bulk-result:/u);
    expect(status.bulkOperation?.partialDataUrlHandle).toMatch(/^bulk-result:/u);
    if (status.bulkOperation?.urlHandle === undefined) {
      throw new Error('Missing bulk result handle');
    }
    await expect(fetchBulkOperationResult({
      fetch: (url) => {
        expect(url).toBe('https://cdn.shopify.com/result.jsonl?signature=secret');
        return Promise.resolve(new Response('{"id":"from-handle"}\n', { status: 200 }));
      },
      url: status.bulkOperation.urlHandle,
    })).resolves.toMatchObject({
      url: 'https://cdn.shopify.com/result.jsonl',
      lines: [{ id: 'from-handle' }],
    });
    await expect(cancelBulkOperation({ client, id: 'gid://shopify/BulkOperation/2' })).resolves.toEqual({
      bulkOperation: { id: 'gid://shopify/BulkOperation/2', status: 'CANCELING' },
    });
    expect(seen).toEqual(['CurrentBulkOperation', 'CurrentBulkOperation', 'BulkOperationCancel']);
  });

  it('expires opaque bulk result handles instead of retaining signed URLs indefinitely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const client = {
      query: () => Promise.resolve({
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/20',
            status: 'COMPLETED',
            url: 'https://cdn.shopify.com/result.jsonl?signature=short-lived',
          },
        },
      }),
    };

    const status = await getCurrentBulkOperation({ client });
    const handle = status.bulkOperation?.urlHandle;
    expect(handle).toMatch(/^bulk-result:/u);
    if (handle === undefined) {
      throw new Error('Missing bulk result handle');
    }

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await expect(fetchBulkOperationResult({
      fetch: () => Promise.resolve(new Response('{"id":"should-not-fetch"}\n', { status: 200 })),
      url: handle,
    })).rejects.toMatchObject({
      code: 'BULK_OPERATION_RESULT_URL_INVALID',
    });
  });

  it('fetches JSONL bulk result previews with line and byte limits', async () => {
    const fetch: typeof globalThis.fetch = (_url, init) => {
      expect(init).toEqual({ redirect: 'error' });
      return Promise.resolve(new Response('{"id":"1","title":"A"}\n{"id":"2","title":"B"}\n', { status: 200 }));
    };

    await expect(fetchBulkOperationResult({ fetch, url: 'https://cdn.shopify.com/result.jsonl?signature=secret', maxLines: 1, maxBytes: 10_000 })).resolves.toEqual({
      url: 'https://cdn.shopify.com/result.jsonl',
      lines: [{ id: '1', title: 'A' }],
      lineCount: 1,
      truncated: true,
    });
  });

  it('waits until a bulk operation reaches a terminal state', async () => {
    let callCount = 0;
    let elapsed = 0;
    const client = {
      query: () => {
        callCount += 1;
        return Promise.resolve({
          data: {
            currentBulkOperation: {
              id: 'gid://shopify/BulkOperation/3',
              status: callCount < 3 ? 'RUNNING' : 'COMPLETED',
              objectCount: String(callCount),
            },
          },
        });
      },
    };

    await expect(waitForBulkOperation({
      client,
      timeoutMs: 5_000,
      pollIntervalMs: 100,
      now: () => elapsed,
      sleep: (ms) => { elapsed += ms; return Promise.resolve(); },
    })).resolves.toEqual({
      bulkOperation: { id: 'gid://shopify/BulkOperation/3', status: 'COMPLETED', objectCount: 3 },
      pollCount: 3,
      timedOut: false,
    });
  });

  it('returns the latest partial state when polling times out', async () => {
    let elapsed = 0;
    const client = {
      query: () => Promise.resolve({
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/4',
            status: 'RUNNING',
            partialDataUrl: 'https://cdn.shopify.com/partial.jsonl',
          },
        },
      }),
    };

    await expect(waitForBulkOperation({
      client,
      timeoutMs: 200,
      pollIntervalMs: 100,
      now: () => elapsed,
      sleep: (ms) => { elapsed += ms; return Promise.resolve(); },
    })).resolves.toMatchObject({
      bulkOperation: {
        id: 'gid://shopify/BulkOperation/4',
        status: 'RUNNING',
        partialDataUrl: 'https://cdn.shopify.com/partial.jsonl',
      },
      pollCount: 3,
      timedOut: true,
    });
  });

  it('does not cancel a different or already terminal bulk operation', async () => {
    const client = {
      query: () => Promise.resolve({
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/5',
            status: 'RUNNING',
          },
        },
      }),
    };

    await expect(cancelBulkOperation({ client, id: 'gid://shopify/BulkOperation/6' })).rejects.toMatchObject({
      code: 'BULK_OPERATION_INVALID_RESPONSE',
    });
  });

  it('rejects non-HTTPS result URLs and oversized result downloads', async () => {
    const fetch: typeof globalThis.fetch = () => Promise.resolve(new Response('{"id":"1"}\n', { status: 200 }));

    await expect(fetchBulkOperationResult({ fetch, url: 'http://example.test/result.jsonl' })).rejects.toBeInstanceOf(BulkOperationError);
    await expect(fetchBulkOperationResult({ fetch, url: 'https://example.test/result.jsonl' })).rejects.toMatchObject({
      code: 'BULK_OPERATION_RESULT_URL_INVALID',
    });
    await expect(fetchBulkOperationResult({ fetch, url: 'https://cdn.shopify.com/result.jsonl', maxLines: 101 })).rejects.toMatchObject({
      code: 'BULK_OPERATION_RESULT_TOO_LARGE',
    });
    await expect(fetchBulkOperationResult({ fetch, url: 'https://cdn.shopify.com/result.jsonl', maxBytes: 2 })).rejects.toMatchObject({
      code: 'BULK_OPERATION_RESULT_TOO_LARGE',
    });
  });
});
