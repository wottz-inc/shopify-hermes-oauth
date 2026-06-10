import { isValidOpaqueCursor } from '../input-validation.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const OWNER_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const METAOBJECT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const SUPPORTED_OWNER_TYPES = new Set(['PRODUCT', 'COLLECTION', 'PRODUCTVARIANT']);
const SUPPORTED_OWNER_GID_PATTERN = /^gid:\/\/shopify\/(Product|Collection|ProductVariant)\/\d+$/u;
const METAOBJECT_GID_PATTERN = /^gid:\/\/shopify\/Metaobject\/\d+$/u;

export const METAFIELD_DEFINITION_FIELDS = `#graphql
fragment SafeMetafieldDefinitionFields on MetafieldDefinition {
  key
  namespace
  name
  ownerType
  type { name category }
  validations { name value }
}
`;

export const METAFIELD_DEFINITIONS_QUERY = `#graphql
${METAFIELD_DEFINITION_FIELDS}
query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String, $namespace: String, $key: String) {
  metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after, namespace: $namespace, key: $key) {
    edges { node { ...SafeMetafieldDefinitionFields } }
    pageInfo { hasNextPage endCursor }
  }
}
`;
export const METAFIELD_DEFINITION_QUERY = METAFIELD_DEFINITIONS_QUERY;

export const RESOURCE_METAFIELDS_QUERY = `#graphql
query ResourceMetafields($ownerId: ID!, $first: Int!, $after: String, $namespace: String, $key: String) {
  node(id: $ownerId) {
    id
    __typename
    ... on HasMetafields {
      metafields(first: $first, after: $after, namespace: $namespace, key: $key) {
        edges {
          node {
            id
            namespace
            key
            type
            value
            definition { name type { name } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
`;

export const METAOBJECT_DEFINITIONS_QUERY = `#graphql
query MetaobjectDefinitions($first: Int!, $after: String, $type: String) {
  metaobjectDefinitions(first: $first, after: $after, type: $type) {
    edges {
      node {
        id
        type
        name
        fieldDefinitions { key name type { name } required }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const METAOBJECT_DEFINITION_QUERY = `#graphql
query MetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
    type
    name
    fieldDefinitions { key name type { name } required }
  }
}
`;

export const METAOBJECTS_QUERY = `#graphql
query Metaobjects($type: String!, $first: Int!, $after: String) {
  metaobjects(type: $type, first: $first, after: $after) {
    edges {
      node {
        id
        handle
        type
        updatedAt
        fields { key type value }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

export const METAOBJECT_QUERY = `#graphql
query Metaobject($id: ID!) {
  metaobject(id: $id) {
    id
    handle
    type
    updatedAt
    fields { key type value }
  }
}
`;

export interface CustomDataGraphqlClient {
  query(query: string, variables: Record<string, unknown>, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface PageInfo { readonly hasNextPage: boolean; readonly endCursor?: string }
export interface MetafieldSchema { readonly ownerType?: string; readonly namespace?: string; readonly key?: string }
export interface MetaobjectSchema { readonly type: string }

export interface ListMetafieldDefinitionsOptions { readonly client: CustomDataGraphqlClient; readonly ownerType: string; readonly namespace?: string; readonly key?: string; readonly first?: number; readonly after?: string }
export interface GetMetafieldDefinitionOptions { readonly client: CustomDataGraphqlClient; readonly ownerType: string; readonly namespace: string; readonly key: string }
export interface ListResourceMetafieldsOptions { readonly client: CustomDataGraphqlClient; readonly ownerId: string; readonly namespace?: string; readonly key?: string; readonly first?: number; readonly after?: string }
export interface ListMetaobjectDefinitionsOptions { readonly client: CustomDataGraphqlClient; readonly type?: string; readonly first?: number; readonly after?: string }
export interface GetMetaobjectDefinitionOptions { readonly client: CustomDataGraphqlClient; readonly type: string }
export interface ListMetaobjectsOptions { readonly client: CustomDataGraphqlClient; readonly type: string; readonly first?: number; readonly after?: string }
export interface GetMetaobjectOptions { readonly client: CustomDataGraphqlClient; readonly id: string }

export class CustomDataSurfaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CustomDataSurfaceError';
  }
}

export async function listMetafieldDefinitions(options: ListMetafieldDefinitionsOptions): Promise<Record<string, unknown>> {
  const variables = metafieldDefinitionVariables(options);
  const response = await options.client.query(METAFIELD_DEFINITIONS_QUERY, variables, { operationName: 'MetafieldDefinitions' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'metafieldDefinitions']), 'metafieldDefinitions');
  return { metafieldDefinitions: connection.edges.map((edge) => normalizeMetafieldDefinition(readNode(edge, 'metafield definition'))), pageInfo: normalizePageInfo(connection.pageInfo), schema: schemaFromVariables(variables) };
}

export async function getMetafieldDefinition(options: GetMetafieldDefinitionOptions): Promise<Record<string, unknown>> {
  const variables = metafieldDefinitionVariables({ ...options, first: 1 });
  const response = await options.client.query(METAFIELD_DEFINITION_QUERY, variables, { operationName: 'MetafieldDefinitions' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'metafieldDefinitions']), 'metafieldDefinitions');
  const node = connection.edges[0] === undefined ? undefined : readNode(connection.edges[0], 'metafield definition');
  if (node === undefined) throw new CustomDataSurfaceError('Metafield definition was not found.');
  return { metafieldDefinition: normalizeMetafieldDefinition(node), schema: schemaFromVariables(variables) };
}

export async function listResourceMetafields(options: ListResourceMetafieldsOptions): Promise<Record<string, unknown>> {
  const ownerId = normalizeOwnerId(options.ownerId);
  const variables = { ownerId, first: normalizePageSize(options.first), ...optionalCursor(options.after), ...optionalNamespace(options.namespace), ...optionalKey(options.key) };
  const response = await options.client.query(RESOURCE_METAFIELDS_QUERY, variables, { operationName: 'ResourceMetafields' }) as Record<string, unknown>;
  const node = requireRecord(readPath(response, ['data', 'node']), 'resource node');
  const connection = requireConnection(node.metafields, 'metafields');
  const ownerMatch = SUPPORTED_OWNER_GID_PATTERN.exec(ownerId);
  return { owner: { id: ownerId, type: ownerMatch?.[1] ?? readString(node.__typename, 'owner type') }, metafields: connection.edges.map((edge) => normalizeMetafield(readNode(edge, 'metafield'))), pageInfo: normalizePageInfo(connection.pageInfo), schema: schemaFromVariables(variables) };
}

export async function listMetaobjectDefinitions(options: ListMetaobjectDefinitionsOptions): Promise<Record<string, unknown>> {
  const variables = { first: normalizePageSize(options.first), ...optionalCursor(options.after), ...(options.type === undefined ? {} : { type: normalizeMetaobjectType(options.type) }) };
  const response = await options.client.query(METAOBJECT_DEFINITIONS_QUERY, variables, { operationName: 'MetaobjectDefinitions' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'metaobjectDefinitions']), 'metaobjectDefinitions');
  return { metaobjectDefinitions: connection.edges.map((edge) => normalizeMetaobjectDefinition(readNode(edge, 'metaobject definition'))), pageInfo: normalizePageInfo(connection.pageInfo), ...(typeof variables.type === 'string' ? { schema: { type: variables.type } } : {}) };
}

export async function getMetaobjectDefinition(options: GetMetaobjectDefinitionOptions): Promise<Record<string, unknown>> {
  const type = normalizeMetaobjectType(options.type);
  const response = await options.client.query(METAOBJECT_DEFINITION_QUERY, { type }, { operationName: 'MetaobjectDefinition' }) as Record<string, unknown>;
  const node = readPath(response, ['data', 'metaobjectDefinitionByType']);
  if (!isRecord(node)) throw new CustomDataSurfaceError('Metaobject definition was not found.');
  return { metaobjectDefinition: normalizeMetaobjectDefinition(node), schema: { type } };
}

export async function listMetaobjects(options: ListMetaobjectsOptions): Promise<Record<string, unknown>> {
  const type = normalizeMetaobjectType(options.type);
  const variables = { type, first: normalizePageSize(options.first), ...optionalCursor(options.after) };
  const response = await options.client.query(METAOBJECTS_QUERY, variables, { operationName: 'Metaobjects' }) as Record<string, unknown>;
  const connection = requireConnection(readPath(response, ['data', 'metaobjects']), 'metaobjects');
  return { metaobjects: connection.edges.map((edge) => normalizeMetaobject(readNode(edge, 'metaobject'))), pageInfo: normalizePageInfo(connection.pageInfo), schema: { type } };
}

export async function getMetaobject(options: GetMetaobjectOptions): Promise<Record<string, unknown>> {
  const id = normalizeMetaobjectId(options.id);
  const response = await options.client.query(METAOBJECT_QUERY, { id }, { operationName: 'Metaobject' }) as Record<string, unknown>;
  const node = readPath(response, ['data', 'metaobject']);
  if (!isRecord(node)) throw new CustomDataSurfaceError('Metaobject was not found.');
  return { metaobject: normalizeMetaobject(node) };
}

function metafieldDefinitionVariables(options: ListMetafieldDefinitionsOptions | GetMetafieldDefinitionOptions): Record<string, unknown> {
  return { ownerType: normalizeOwnerType(options.ownerType), first: normalizePageSize('first' in options ? options.first : 1), ...('after' in options ? optionalCursor(options.after) : {}), ...optionalNamespace(options.namespace), ...optionalKey(options.key) };
}
function schemaFromVariables(variables: Record<string, unknown>): MetafieldSchema { return { ...(typeof variables.ownerType === 'string' ? { ownerType: variables.ownerType } : {}), ...(typeof variables.namespace === 'string' ? { namespace: variables.namespace } : {}), ...(typeof variables.key === 'string' ? { key: variables.key } : {}) }; }
function normalizeOwnerType(value: string): string { const v = value.trim(); if (!OWNER_TYPE_PATTERN.test(v) || !SUPPORTED_OWNER_TYPES.has(v)) throw new CustomDataSurfaceError('Owner type is invalid.'); return v; }
function normalizeNamespace(value: string): string { const v = value.trim(); if (!NAMESPACE_PATTERN.test(v)) throw new CustomDataSurfaceError('Namespace is invalid.'); return v; }
function normalizeKey(value: string): string { const v = value.trim(); if (!KEY_PATTERN.test(v)) throw new CustomDataSurfaceError('Key is invalid.'); return v; }
function normalizeMetaobjectType(value: string): string { const v = value.trim(); if (!METAOBJECT_TYPE_PATTERN.test(v)) throw new CustomDataSurfaceError('Metaobject type is invalid.'); return v; }
function normalizeOwnerId(value: string): string { const v = value.trim(); if (!SUPPORTED_OWNER_GID_PATTERN.test(v)) throw new CustomDataSurfaceError('Owner id must be a supported Shopify resource GID.'); return v; }
function normalizeMetaobjectId(value: string): string { const v = value.trim(); if (!METAOBJECT_GID_PATTERN.test(v)) throw new CustomDataSurfaceError('Metaobject id must be a Shopify Metaobject GID.'); return v; }
function normalizePageSize(value: number | undefined): number { const pageSize = value ?? DEFAULT_PAGE_SIZE; if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new CustomDataSurfaceError('Page size must be an integer between 1 and 50.'); return pageSize; }
function optionalCursor(value: string | undefined): Record<string, string> { if (value === undefined) return {}; if (!isValidOpaqueCursor(value)) throw new CustomDataSurfaceError('Cursor is invalid.'); return { after: value }; }
function optionalNamespace(value: string | undefined): Record<string, string> { return value === undefined ? {} : { namespace: normalizeNamespace(value) }; }
function optionalKey(value: string | undefined): Record<string, string> { return value === undefined ? {} : { key: normalizeKey(value) }; }


function normalizeMetafieldDefinition(node: Record<string, unknown>): Record<string, unknown> { return { key: readString(node.key, 'metafield definition key'), namespace: readString(node.namespace, 'metafield definition namespace'), name: readString(node.name, 'metafield definition name'), ownerType: readString(node.ownerType, 'metafield definition owner type'), type: normalizeTypeRef(node.type), validations: Array.isArray(node.validations) ? node.validations.map(normalizeValidation) : [] }; }
function normalizeMetafield(node: Record<string, unknown>): Record<string, unknown> { return { id: readString(node.id, 'metafield id'), namespace: readString(node.namespace, 'metafield namespace'), key: readString(node.key, 'metafield key'), type: readString(node.type, 'metafield type'), ...summarizeValue(node.value), ...(isRecord(node.definition) ? { definition: { name: typeof node.definition.name === 'string' ? node.definition.name : undefined, type: isRecord(node.definition.type) ? { name: readString(node.definition.type.name, 'definition type') } : undefined } } : {}) }; }
function normalizeMetaobjectDefinition(node: Record<string, unknown>): Record<string, unknown> { return { id: readString(node.id, 'metaobject definition id'), type: readString(node.type, 'metaobject definition type'), name: readString(node.name, 'metaobject definition name'), fieldDefinitions: Array.isArray(node.fieldDefinitions) ? node.fieldDefinitions.map(normalizeFieldDefinition) : [] }; }
function normalizeMetaobject(node: Record<string, unknown>): Record<string, unknown> { return { id: readString(node.id, 'metaobject id'), ...optionalString(node, 'handle'), type: readString(node.type, 'metaobject type'), ...optionalString(node, 'updatedAt'), fields: Array.isArray(node.fields) ? node.fields.map(normalizeMetaobjectField) : [] }; }
function normalizeFieldDefinition(value: unknown): Record<string, unknown> { const node = requireRecord(value, 'field definition'); return { key: readString(node.key, 'field definition key'), name: readString(node.name, 'field definition name'), type: normalizeTypeRef(node.type), required: node.required === true }; }
function normalizeMetaobjectField(value: unknown): Record<string, unknown> { const node = requireRecord(value, 'metaobject field'); return { key: readString(node.key, 'metaobject field key'), type: readString(node.type, 'metaobject field type'), ...summarizeValue(node.value) }; }
function normalizeTypeRef(value: unknown): Record<string, string> { const node = requireRecord(value, 'type'); return { name: readString(node.name, 'type name'), ...(typeof node.category === 'string' ? { category: node.category } : {}) }; }
function normalizeValidation(value: unknown): Record<string, string> { const node = requireRecord(value, 'validation'); return { name: readString(node.name, 'validation name'), value: readString(node.value, 'validation value') }; }
function summarizeValue(value: unknown): Record<string, unknown> { const text = typeof value === 'string' ? value : ''; return { valuePresent: text.length > 0, valueLength: text.length }; }
function optionalString(node: Record<string, unknown>, key: string): Record<string, string> { return typeof node[key] === 'string' ? { [key]: node[key] } : {}; }
function requireConnection(value: unknown, label: string): { readonly edges: readonly unknown[]; readonly pageInfo: Record<string, unknown> } { if (!isRecord(value) || !Array.isArray(value.edges) || !isRecord(value.pageInfo)) throw new CustomDataSurfaceError(`Shopify Admin GraphQL response did not include expected ${label} connection.`); return { edges: value.edges, pageInfo: value.pageInfo }; }
function readNode(edge: unknown, label: string): Record<string, unknown> { if (!isRecord(edge) || !isRecord(edge.node)) throw new CustomDataSurfaceError(`Shopify Admin GraphQL response included an invalid ${label} edge.`); return edge.node; }
function normalizePageInfo(pageInfo: Record<string, unknown>): PageInfo { if (typeof pageInfo.hasNextPage !== 'boolean') throw new CustomDataSurfaceError('Shopify Admin GraphQL pageInfo was invalid.'); return { hasNextPage: pageInfo.hasNextPage, ...(typeof pageInfo.endCursor === 'string' ? { endCursor: pageInfo.endCursor } : {}) }; }
function readString(value: unknown, label: string): string { if (typeof value !== 'string') throw new CustomDataSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`); return value; }
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new CustomDataSurfaceError(`Shopify Admin GraphQL response included invalid ${label}.`); return value; }
function readPath(value: unknown, path: readonly string[]): unknown { let current = value; for (const key of path) { if (!isRecord(current)) return undefined; current = current[key]; } return current; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
