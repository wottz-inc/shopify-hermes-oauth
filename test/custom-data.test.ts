import { describe, expect, it } from 'vitest';

import {
  METAFIELD_DEFINITION_QUERY,
  METAFIELD_DEFINITIONS_QUERY,
  METAOBJECT_DEFINITION_QUERY,
  METAOBJECT_DEFINITIONS_QUERY,
  METAOBJECT_QUERY,
  METAOBJECTS_QUERY,
  RESOURCE_METAFIELDS_QUERY,
  getMetafieldDefinition,
  getMetaobject,
  getMetaobjectDefinition,
  listMetafieldDefinitions,
  listMetaobjectDefinitions,
  listMetaobjects,
  listResourceMetafields,
  type CustomDataGraphqlClient,
} from '../src/custom-data/index.js';

describe('custom data Admin GraphQL read helpers', () => {
  it('lists metafield definitions with owner type, namespace, and key validation', async () => {
    const calls: unknown[] = [];
    const client: CustomDataGraphqlClient = {
      query: (query, variables, options) => {
        calls.push({ query, variables, options });
        return Promise.resolve({ data: { metafieldDefinitions: { edges: [{ node: metafieldDefinitionNode() }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } });
      },
    };

    await expect(listMetafieldDefinitions({ client, ownerType: 'PRODUCT', namespace: 'custom', key: 'care_instructions', first: 1, after: 'cursor-0' })).resolves.toEqual({
      metafieldDefinitions: [{ key: 'care_instructions', namespace: 'custom', name: 'Care instructions', ownerType: 'PRODUCT', type: { name: 'single_line_text_field', category: 'TEXT' }, validations: [{ name: 'max', value: '120' }] }],
      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
      schema: { ownerType: 'PRODUCT', namespace: 'custom', key: 'care_instructions' },
    });
    expect(calls).toEqual([{ query: METAFIELD_DEFINITIONS_QUERY, variables: { ownerType: 'PRODUCT', first: 1, after: 'cursor-0', namespace: 'custom', key: 'care_instructions' }, options: { operationName: 'MetafieldDefinitions' } }]);
    expect(METAFIELD_DEFINITIONS_QUERY).not.toMatch(/mutation|metafieldsSet|metaobjectCreate/iu);
  });

  it('gets one metafield definition by owner type namespace and key', async () => {
    const client: CustomDataGraphqlClient = { query: () => Promise.resolve({ data: { metafieldDefinitions: { edges: [{ node: metafieldDefinitionNode() }], pageInfo: { hasNextPage: false } } } }) };
    await expect(getMetafieldDefinition({ client, ownerType: 'PRODUCT', namespace: 'custom', key: 'care_instructions' })).resolves.toEqual({
      metafieldDefinition: { key: 'care_instructions', namespace: 'custom', name: 'Care instructions', ownerType: 'PRODUCT', type: { name: 'single_line_text_field', category: 'TEXT' }, validations: [{ name: 'max', value: '120' }] },
      schema: { ownerType: 'PRODUCT', namespace: 'custom', key: 'care_instructions' },
    });
    expect(METAFIELD_DEFINITION_QUERY).toBe(METAFIELD_DEFINITIONS_QUERY);
  });

  it('lists resource metafields using a stable owner GID and bounded preview fields', async () => {
    const calls: unknown[] = [];
    const client: CustomDataGraphqlClient = { query: (query, variables, options) => {
      calls.push({ query, variables, options });
      return Promise.resolve({ data: { node: { id: variables.ownerId, metafields: { edges: [{ node: metafieldNode() }], pageInfo: { hasNextPage: false } } } } });
    } };

    await expect(listResourceMetafields({ client, ownerId: 'gid://shopify/Product/1', namespace: 'custom', key: 'care_instructions', first: 1 })).resolves.toEqual({
      owner: { id: 'gid://shopify/Product/1', type: 'Product' },
      metafields: [{ id: 'gid://shopify/Metafield/1', namespace: 'custom', key: 'care_instructions', type: 'single_line_text_field', valuePresent: true, valueLength: 17, definition: { name: 'Care instructions', type: { name: 'single_line_text_field' } } }],
      pageInfo: { hasNextPage: false },
      schema: { namespace: 'custom', key: 'care_instructions' },
    });
    expect(calls).toEqual([{ query: RESOURCE_METAFIELDS_QUERY, variables: { ownerId: 'gid://shopify/Product/1', first: 1, namespace: 'custom', key: 'care_instructions' }, options: { operationName: 'ResourceMetafields' } }]);
    expect(RESOURCE_METAFIELDS_QUERY).not.toContain('jsonValue');
  });

  it('lists and gets metaobject definitions with bounded field definitions', async () => {
    const client: CustomDataGraphqlClient = { query: (query, variables) => Promise.resolve({ data: query === METAOBJECT_DEFINITIONS_QUERY ? { metaobjectDefinitions: { edges: [{ node: metaobjectDefinitionNode(variables.type as string) }], pageInfo: { hasNextPage: false } } } : { metaobjectDefinitionByType: metaobjectDefinitionNode(variables.type as string) } }) };

    await expect(listMetaobjectDefinitions({ client, type: 'designer_profile', first: 1 })).resolves.toEqual({
      metaobjectDefinitions: [{ id: 'gid://shopify/MetaobjectDefinition/1', type: 'designer_profile', name: 'Designer profile', fieldDefinitions: [{ key: 'bio', name: 'Bio', type: { name: 'multi_line_text_field' }, required: false }] }],
      pageInfo: { hasNextPage: false },
      schema: { type: 'designer_profile' },
    });
    await expect(getMetaobjectDefinition({ client, type: 'designer_profile' })).resolves.toEqual({
      metaobjectDefinition: { id: 'gid://shopify/MetaobjectDefinition/1', type: 'designer_profile', name: 'Designer profile', fieldDefinitions: [{ key: 'bio', name: 'Bio', type: { name: 'multi_line_text_field' }, required: false }] },
      schema: { type: 'designer_profile' },
    });
    expect(METAOBJECT_DEFINITION_QUERY).not.toMatch(/mutation/iu);
  });

  it('lists and gets metaobjects with schema-aware field value presence and length only', async () => {
    const client: CustomDataGraphqlClient = { query: (query, variables) => Promise.resolve({ data: query === METAOBJECTS_QUERY ? { metaobjects: { edges: [{ node: metaobjectNode(variables.type as string) }], pageInfo: { hasNextPage: false } } } : { metaobject: metaobjectNode('designer_profile') } }) };

    await expect(listMetaobjects({ client, type: 'designer_profile', first: 1 })).resolves.toMatchObject({
      metaobjects: [{ id: 'gid://shopify/Metaobject/1', handle: 'ada', type: 'designer_profile', fields: [{ key: 'bio', type: 'multi_line_text_field', valuePresent: true, valueLength: 23 }] }],
      pageInfo: { hasNextPage: false },
      schema: { type: 'designer_profile' },
    });
    await expect(getMetaobject({ client, id: 'gid://shopify/Metaobject/1' })).resolves.toMatchObject({ metaobject: { id: 'gid://shopify/Metaobject/1', fields: [{ key: 'bio', valuePresent: true, valueLength: 23 }] } });
    expect(METAOBJECT_QUERY).not.toMatch(/mutation|jsonValue/iu);
  });

  it('enforces owner type, namespace, key, type, GID, and page bounds', async () => {
    const client: CustomDataGraphqlClient = { query: () => Promise.resolve({ data: { metafieldDefinitions: { edges: [], pageInfo: { hasNextPage: false } } } }) };
    await expect(listMetafieldDefinitions({ client, ownerType: 'PRODUCT; mutation' })).rejects.toThrow('Owner type is invalid');
    await expect(listMetafieldDefinitions({ client, ownerType: 'PRODUCT', namespace: 'bad space' })).rejects.toThrow('Namespace is invalid');
    await expect(listMetafieldDefinitions({ client, ownerType: 'PRODUCT', key: 'bad space' })).rejects.toThrow('Key is invalid');
    await expect(listMetafieldDefinitions({ client, ownerType: 'PRODUCT', first: 51 })).rejects.toThrow('Page size must be an integer between 1 and 50');
    await expect(listResourceMetafields({ client, ownerId: 'gid://shopify/Order/1', first: 1 })).rejects.toThrow('Owner id must be a supported Shopify resource GID');
    await expect(listMetaobjects({ client, type: 'bad type' })).rejects.toThrow('Metaobject type is invalid');
    await expect(getMetaobject({ client, id: 'gid://shopify/Product/1' })).rejects.toThrow('Metaobject id must be a Shopify Metaobject GID');
  });
});

function metafieldDefinitionNode(): Record<string, unknown> {
  return { key: 'care_instructions', namespace: 'custom', name: 'Care instructions', ownerType: 'PRODUCT', type: { name: 'single_line_text_field', category: 'TEXT' }, validations: [{ name: 'max', value: '120' }], pinnedPosition: 1 };
}

function metafieldNode(): Record<string, unknown> {
  return { id: 'gid://shopify/Metafield/1', namespace: 'custom', key: 'care_instructions', type: 'single_line_text_field', value: 'Machine wash cold', definition: { name: 'Care instructions', type: { name: 'single_line_text_field' } }, jsonValue: { secret: 'omitted' } };
}

function metaobjectDefinitionNode(type: string): Record<string, unknown> {
  return { id: 'gid://shopify/MetaobjectDefinition/1', type, name: 'Designer profile', fieldDefinitions: [{ key: 'bio', name: 'Bio', type: { name: 'multi_line_text_field' }, required: false }], access: { admin: 'MERCHANT_READ' } };
}

function metaobjectNode(type: string): Record<string, unknown> {
  return { id: 'gid://shopify/Metaobject/1', handle: 'ada', type, updatedAt: '2026-01-01T00:00:00Z', fields: [{ key: 'bio', type: 'multi_line_text_field', value: 'Ada makes durable bags.', jsonValue: { secret: 'omitted' } }] };
}
