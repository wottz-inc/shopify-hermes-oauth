import { randomUUID } from 'node:crypto';

import { redactSensitiveText } from '../shopify/admin-client.js';
import { isJsonPlainRecord } from '../util/json.js';

const MAX_RESULT_PREVIEW_BYTES = 1_000_000;
const MAX_RESULT_PREVIEW_LINES = 100;
const SHOPIFY_BULK_RESULT_HOSTS = new Set(['storage.googleapis.com', 'cdn.shopify.com']);
const BULK_RESULT_HANDLE_PREFIX = 'bulk-result:';
const BULK_RESULT_HANDLE_TTL_MS = 15 * 60 * 1000;
const MAX_BULK_RESULT_HANDLES = 256;
const bulkResultUrlsByHandle = new Map<string, { readonly url: string; readonly expiresAt: number }>();

export type BulkOperationTemplateId = 'products-basic' | 'orders-basic' | 'inventory-items-basic';
export type BulkOperationStatus = 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELING' | 'CANCELED' | 'EXPIRED';
export type BulkOperationErrorCode =
  | 'BULK_OPERATION_INVALID_TEMPLATE'
  | 'BULK_OPERATION_USER_ERROR'
  | 'BULK_OPERATION_INVALID_RESPONSE'
  | 'BULK_OPERATION_RESULT_URL_INVALID'
  | 'BULK_OPERATION_RESULT_HTTP_ERROR'
  | 'BULK_OPERATION_RESULT_TOO_LARGE'
  | 'BULK_OPERATION_RESULT_INVALID_JSONL'
  | 'BULK_OPERATION_TIMEOUT';

export interface BulkOperationTemplate {
  readonly id: BulkOperationTemplateId;
  readonly description: string;
  readonly requiredScopes: readonly string[];
  readonly access: 'read';
  readonly query: string;
  readonly outputShape: string;
}

export interface BulkOperationRecord {
  readonly id: string;
  readonly status: BulkOperationStatus;
  readonly errorCode?: string;
  readonly createdAt?: string;
  readonly completedAt?: string;
  readonly objectCount?: number;
  readonly fileSize?: number;
  readonly url?: string;
  readonly urlHandle?: string;
  readonly partialDataUrl?: string;
  readonly partialDataUrlHandle?: string;
}

export interface BulkOperationClient {
  query(query: string, variables?: unknown, options?: { readonly operationName?: string }): Promise<unknown>;
}

export interface BulkOperationWaitResult {
  readonly bulkOperation?: BulkOperationRecord;
  readonly pollCount: number;
  readonly timedOut: boolean;
}

export class BulkOperationError extends Error {
  public readonly code: BulkOperationErrorCode;

  public constructor(message: string, code: BulkOperationErrorCode) {
    super(redactSensitiveText(message));
    this.name = 'BulkOperationError';
    this.code = code;
  }
}

export const BULK_OPERATION_TEMPLATES: readonly BulkOperationTemplate[] = [
  {
    id: 'products-basic',
    description: 'Read basic product, variant, and collection export rows.',
    requiredScopes: ['read_products'],
    access: 'read',
    outputShape: 'JSONL product rows with nested variants and collections.',
    query: `{
  products {
    edges {
      node {
        id
        title
        handle
        status
        vendor
        productType
        createdAt
        updatedAt
        variants {
          edges { node { id sku title price inventoryQuantity } }
        }
        collections {
          edges { node { id handle title } }
        }
      }
    }
  }
}`,
  },
  {
    id: 'orders-basic',
    description: 'Read basic order export rows for reconciliation and summaries.',
    requiredScopes: ['read_orders'],
    access: 'read',
    outputShape: 'JSONL order rows with totals, display status, and bounded line item fields.',
    query: `{
  orders {
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems {
          edges { node { id title quantity sku } }
        }
      }
    }
  }
}`,
  },
  {
    id: 'inventory-items-basic',
    description: 'Read inventory item and level export rows for large inventory snapshots.',
    requiredScopes: ['read_inventory', 'read_locations'],
    access: 'read',
    outputShape: 'JSONL inventory item rows with inventory levels and locations.',
    query: `{
  inventoryItems {
    edges {
      node {
        id
        sku
        tracked
        inventoryLevels {
          edges { node { id available location { id name } } }
        }
      }
    }
  }
}`,
  },
];

const START_BULK_OPERATION_MUTATION = `mutation BulkOperationRunQuery($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;

const CURRENT_BULK_OPERATION_QUERY = `query CurrentBulkOperation {
  currentBulkOperation {
    id
    status
    errorCode
    createdAt
    completedAt
    objectCount
    fileSize
    url
    partialDataUrl
  }
}`;

const CANCEL_BULK_OPERATION_MUTATION = `mutation BulkOperationCancel($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;

export function getBulkOperationTemplate(templateId: string): BulkOperationTemplate | undefined {
  return BULK_OPERATION_TEMPLATES.find((template) => template.id === templateId);
}

export async function startBulkOperation(input: { readonly client: BulkOperationClient; readonly templateId: string }): Promise<{ readonly templateId: BulkOperationTemplateId; readonly bulkOperation: BulkOperationRecord }> {
  const template = getBulkOperationTemplate(input.templateId);
  if (template === undefined) {
    throw new BulkOperationError('Bulk operation template is not allowed.', 'BULK_OPERATION_INVALID_TEMPLATE');
  }

  const response = await input.client.query(START_BULK_OPERATION_MUTATION, { query: template.query }, { operationName: 'BulkOperationRunQuery' });
  const payload = readPayload(response, 'bulkOperationRunQuery');
  throwIfUserErrors(payload.userErrors);
  return { templateId: template.id, bulkOperation: parseBulkOperation(payload.bulkOperation) };
}

export async function getCurrentBulkOperation(input: { readonly client: BulkOperationClient }): Promise<{ readonly bulkOperation?: BulkOperationRecord }> {
  const response = await input.client.query(CURRENT_BULK_OPERATION_QUERY, undefined, { operationName: 'CurrentBulkOperation' });
  const data = readData(response);
  if (data.currentBulkOperation === null || data.currentBulkOperation === undefined) {
    return {};
  }
  return { bulkOperation: parseBulkOperation(data.currentBulkOperation) };
}

export async function waitForBulkOperation(input: {
  readonly client: BulkOperationClient;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<BulkOperationWaitResult> {
  const timeoutMs = clampPositiveInteger(input.timeoutMs, 60_000);
  const pollIntervalMs = clampPositiveInteger(input.pollIntervalMs, 2_000);
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const deadline = now() + timeoutMs;
  let pollCount = 0;

  for (;;) {
    const status = await getCurrentBulkOperation({ client: input.client });
    pollCount += 1;
    if (status.bulkOperation === undefined || isTerminalBulkOperationStatus(status.bulkOperation.status)) {
      return { ...status, pollCount, timedOut: false };
    }
    if (now() >= deadline) {
      return { ...status, pollCount, timedOut: true };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

export async function cancelBulkOperation(input: { readonly client: BulkOperationClient; readonly id: string }): Promise<{ readonly bulkOperation: BulkOperationRecord }> {
  if (!/^gid:\/\/shopify\/BulkOperation\/\d+$/u.test(input.id)) {
    throw new BulkOperationError('Bulk operation id is invalid.', 'BULK_OPERATION_INVALID_RESPONSE');
  }
  const current = await getCurrentBulkOperation({ client: input.client });
  if (current.bulkOperation?.id !== input.id || isTerminalBulkOperationStatus(current.bulkOperation.status)) {
    throw new BulkOperationError('Bulk operation cancel is only allowed for the current non-terminal bulk operation.', 'BULK_OPERATION_INVALID_RESPONSE');
  }
  const response = await input.client.query(CANCEL_BULK_OPERATION_MUTATION, { id: input.id }, { operationName: 'BulkOperationCancel' });
  const payload = readPayload(response, 'bulkOperationCancel');
  throwIfUserErrors(payload.userErrors);
  return { bulkOperation: parseBulkOperation(payload.bulkOperation) };
}

export async function fetchBulkOperationResult(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly url: string;
  readonly maxLines?: number;
  readonly maxBytes?: number;
}): Promise<{ readonly url: string; readonly lines: readonly unknown[]; readonly lineCount: number; readonly truncated: boolean }> {
  const maxLines = readPreviewLimit(input.maxLines, MAX_RESULT_PREVIEW_LINES);
  const maxBytes = readPreviewLimit(input.maxBytes, MAX_RESULT_PREVIEW_BYTES);
  const url = parseBulkResultUrl(resolveBulkResultUrlInput(input.url));

  const response = await input.fetch(url.toString(), { redirect: 'error' });
  if (!response.ok) {
    throw new BulkOperationError(`Bulk operation result fetch failed with HTTP ${response.status.toString(10)}.`, 'BULK_OPERATION_RESULT_HTTP_ERROR');
  }
  const text = await readResponseTextWithLimit(response, maxBytes);

  const rawLines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  const selectedLines = rawLines.slice(0, maxLines);
  try {
    return {
      url: safeResultUrlForOutput(url),
      lines: selectedLines.map((line) => JSON.parse(line) as unknown),
      lineCount: selectedLines.length,
      truncated: rawLines.length > selectedLines.length,
    };
  } catch {
    throw new BulkOperationError('Bulk operation result was not valid JSONL.', 'BULK_OPERATION_RESULT_INVALID_JSONL');
  }
}

function parseBulkResultUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BulkOperationError('Bulk operation result URL is invalid.', 'BULK_OPERATION_RESULT_URL_INVALID');
  }
  if (url.protocol !== 'https:' || !SHOPIFY_BULK_RESULT_HOSTS.has(url.hostname)) {
    throw new BulkOperationError('Bulk operation result URL must be a Shopify bulk result HTTPS URL.', 'BULK_OPERATION_RESULT_URL_INVALID');
  }
  return url;
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new BulkOperationError('Bulk operation result exceeded the configured byte limit.', 'BULK_OPERATION_RESULT_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      return text + decoder.decode();
    }
    bytesRead += next.value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new BulkOperationError('Bulk operation result exceeded the configured byte limit.', 'BULK_OPERATION_RESULT_TOO_LARGE');
    }
    text += decoder.decode(next.value, { stream: true });
  }
}

function safeResultUrlForOutput(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function resolveBulkResultUrlInput(value: string): string {
  if (!value.startsWith(BULK_RESULT_HANDLE_PREFIX)) {
    return value;
  }
  const entry = bulkResultUrlsByHandle.get(value);
  if (entry === undefined || entry.expiresAt <= Date.now()) {
    bulkResultUrlsByHandle.delete(value);
    throw new BulkOperationError('Bulk operation result handle is unknown or expired.', 'BULK_OPERATION_RESULT_URL_INVALID');
  }
  return entry.url;
}

function readPayload(response: unknown, field: 'bulkOperationRunQuery' | 'bulkOperationCancel'): Record<string, unknown> {
  const data = readData(response);
  const payload = data[field];
  if (!isJsonPlainRecord(payload)) {
    throw new BulkOperationError('Shopify bulk operation response did not include expected payload.', 'BULK_OPERATION_INVALID_RESPONSE');
  }
  return payload;
}

function readData(response: unknown): Record<string, unknown> {
  const data = isJsonPlainRecord(response) ? response.data : undefined;
  if (!isJsonPlainRecord(data)) {
    throw new BulkOperationError('Shopify bulk operation response did not include expected data.', 'BULK_OPERATION_INVALID_RESPONSE');
  }
  return data;
}

function throwIfUserErrors(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }
  const messages = value
    .map((item) => isJsonPlainRecord(item) && typeof item.message === 'string' ? item.message : undefined)
    .filter((message): message is string => message !== undefined);
  throw new BulkOperationError(`Shopify bulk operation failed: ${messages.length === 0 ? 'unknown user error' : messages.join('; ')}`, 'BULK_OPERATION_USER_ERROR');
}

function parseBulkOperation(value: unknown): BulkOperationRecord {
  if (!isJsonPlainRecord(value) || typeof value.id !== 'string' || !isBulkOperationStatus(value.status)) {
    throw new BulkOperationError('Shopify bulk operation response included an invalid bulk operation.', 'BULK_OPERATION_INVALID_RESPONSE');
  }
  return {
    id: value.id,
    status: value.status,
    ...optionalStringField(value, 'errorCode'),
    ...optionalStringField(value, 'createdAt'),
    ...optionalStringField(value, 'completedAt'),
    ...optionalNumberField(value, 'objectCount'),
    ...optionalNumberField(value, 'fileSize'),
    ...optionalResultUrlField(value, 'url'),
    ...optionalResultUrlField(value, 'partialDataUrl'),
  };
}

function isBulkOperationStatus(value: unknown): value is BulkOperationStatus {
  return value === 'CREATED' || value === 'RUNNING' || value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELING' || value === 'CANCELED' || value === 'EXPIRED';
}

function isTerminalBulkOperationStatus(status: BulkOperationStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'EXPIRED';
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function optionalStringField(record: Record<string, unknown>, key: keyof BulkOperationRecord): Record<string, string> {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {};
}

function optionalResultUrlField(record: Record<string, unknown>, key: 'url' | 'partialDataUrl'): Record<string, string> {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  const url = parseBulkResultUrl(value);
  const handle = registerBulkResultUrl(url.toString());
  return { [key]: safeResultUrlForOutput(url), [`${key}Handle`]: handle };
}

function registerBulkResultUrl(url: string): string {
  const now = Date.now();
  for (const [handle, entry] of bulkResultUrlsByHandle) {
    if (entry.expiresAt <= now || bulkResultUrlsByHandle.size >= MAX_BULK_RESULT_HANDLES) {
      bulkResultUrlsByHandle.delete(handle);
    }
  }
  const handle = `${BULK_RESULT_HANDLE_PREFIX}${randomUUID()}`;
  bulkResultUrlsByHandle.set(handle, { url, expiresAt: now + BULK_RESULT_HANDLE_TTL_MS });
  return handle;
}

function optionalNumberField(record: Record<string, unknown>, key: keyof BulkOperationRecord): Record<string, number> {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { [key]: value };
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return { [key]: Number(value) };
  }
  return {};
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function readPreviewLimit(value: number | undefined, fallback: number): number {
  const limit = clampPositiveInteger(value, fallback);
  if (limit > fallback) {
    throw new BulkOperationError('Bulk operation result preview limit exceeds the hard maximum.', 'BULK_OPERATION_RESULT_TOO_LARGE');
  }
  return limit;
}
