import { describe, expect, it } from 'vitest';

import { createGraphqlResponseNormalizer } from '../src/graphql/normalization.js';
import { csvCell } from '../src/reports/csv.js';
import { markdownCell, sanitizeReportOutput } from '../src/reports/sanitize.js';

describe('shared report sanitization helpers', () => {
  it('preserves existing markdown and CSV escaping semantics for representative control characters', () => {
    const value = 'A|B\nC\rD\tE\u0000F\u0085G';

    expect(sanitizeReportOutput(value)).toBe('A|B\\nC\\rD\\tE\\u0000F\\u0085G');
    expect(markdownCell(value)).toBe('A\\|B\\nC\\rD\\tE\\u0000F\\u0085G');
    expect(csvCell('\t=1+1')).toBe('"\'\\t=1+1"');
  });
});

describe('shared GraphQL response normalization helpers', () => {
  class PreciseDomainError extends Error {
    public constructor(message: string) {
      super(message);
      this.name = 'PreciseDomainError';
    }
  }

  const normalizer = createGraphqlResponseNormalizer((message) => new PreciseDomainError(message));

  it('normalizes connections, pageInfo, nodes, strings, records, and paths with caller error types', () => {
    const response = {
      data: {
        products: {
          edges: [{ node: { id: 'gid://shopify/Product/1' } }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
      },
    };

    const connection = normalizer.requireConnection(normalizer.readPath(response, ['data', 'products']), 'products');
    const node = normalizer.readNode(connection.edges[0], 'product');

    expect(normalizer.normalizePageInfo(connection.pageInfo)).toEqual({ hasNextPage: true, endCursor: 'cursor-1' });
    expect(normalizer.readString(node.id, 'product id')).toBe('gid://shopify/Product/1');
    expect(normalizer.requireRecord(response, 'response')).toBe(response);
  });

  it('throws the caller-provided error type and precise Shopify GraphQL message', () => {
    expect(() => normalizer.requireConnection({ edges: [] }, 'products')).toThrow(PreciseDomainError);
    expect(() => normalizer.requireConnection({ edges: [] }, 'products')).toThrow(
      'Shopify Admin GraphQL response did not include expected products connection.',
    );
    expect(() => normalizer.readNode({ node: null }, 'product')).toThrow(
      'Shopify Admin GraphQL response included an invalid product edge.',
    );
  });
});
