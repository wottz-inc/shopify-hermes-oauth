export interface NormalizedGraphqlPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor?: string;
}

export interface NormalizedGraphqlConnection {
  readonly edges: readonly unknown[];
  readonly pageInfo: Record<string, unknown>;
}

export type GraphqlNormalizationErrorFactory = (message: string) => Error;

export function createGraphqlResponseNormalizer(errorFactory: GraphqlNormalizationErrorFactory) {
  const fail = (message: string): never => {
    throw errorFactory(message);
  };

  return {
    isRecord,
    readPath,
    requireConnection(value: unknown, label: string): NormalizedGraphqlConnection {
      if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.pageInfo)) {
        fail(`Shopify Admin GraphQL response did not include expected ${label} connection.`);
      }

      const connection = value as { readonly edges: readonly unknown[]; readonly pageInfo: Record<string, unknown> };
      return { edges: connection.edges, pageInfo: connection.pageInfo };
    },
    readNode(edge: unknown, label: string): Record<string, unknown> {
      if (!isRecord(edge) || !isRecord(edge.node)) {
        fail(`Shopify Admin GraphQL response included an invalid ${label} edge.`);
      }

      return (edge as { readonly node: Record<string, unknown> }).node;
    },
    normalizePageInfo(pageInfo: Record<string, unknown>): NormalizedGraphqlPageInfo {
      if (typeof pageInfo.hasNextPage !== 'boolean') {
        fail('Shopify Admin GraphQL pageInfo was invalid.');
      }

      const hasNextPage = pageInfo.hasNextPage as boolean;
      return { hasNextPage, ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}) };
    },
    readString(value: unknown, label: string): string {
      if (typeof value !== 'string') {
        fail(`Shopify Admin GraphQL response included invalid ${label}.`);
      }

      return value as string;
    },
    requireRecord(value: unknown, label: string): Record<string, unknown> {
      if (!isRecord(value)) {
        fail(`Shopify Admin GraphQL response included invalid ${label}.`);
      }

      return value as Record<string, unknown>;
    },
  } as const;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}
