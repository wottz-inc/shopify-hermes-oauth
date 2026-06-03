import { normalizeTokenStoreShopDomain } from '../tokens/local-token-store.js';
import { isJsonPlainRecord } from '../util/json.js';

export const SHOP_METADATA_QUERY = '{ shop { name myshopifyDomain currencyCode } }';

export interface AdminShopMetadata {
  readonly name: string;
  readonly myshopifyDomain: string;
  readonly currencyCode: string;
}

export interface ShopifyAdminClient {
  getShopMetadata(input: AdminShopMetadataInput): Promise<AdminShopMetadata>;
}

export interface ShopifyAdminQueryClient {
  query<T>(input: AdminGraphqlQueryInput): Promise<T>;
}

export interface AdminGraphqlQueryInput extends AdminShopMetadataInput {
  readonly query: string;
  readonly variables?: unknown;
  readonly operationName?: string;
}

export interface AdminShopMetadataInput {
  readonly shop: string;
  readonly accessToken: string;
}

export interface ShopifyAdminGraphqlClientOptions {
  readonly apiVersion: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly retryJitterMs?: number | (() => number);
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onTelemetry?: (telemetry: AdminGraphqlCostTelemetry) => void;
}

export interface AdminGraphqlCostTelemetry {
  readonly shop: string;
  readonly requestedQueryCost?: number;
  readonly actualQueryCost?: number;
  readonly throttleStatus?: {
    readonly maximumAvailable?: number;
    readonly currentlyAvailable?: number;
    readonly restoreRate?: number;
  };
}

interface GraphqlResponse {
  readonly data?: unknown;
  readonly errors?: unknown;
  readonly extensions?: unknown;
}

interface RetrySettings {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly retryJitterMs: number | (() => number);
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly onTelemetry?: (telemetry: AdminGraphqlCostTelemetry) => void;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

export class ShopifyAdminGraphqlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShopifyAdminGraphqlError';
  }
}

export function createShopifyAdminGraphqlClient(options: ShopifyAdminGraphqlClientOptions): ShopifyAdminClient & ShopifyAdminQueryClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const retrySettings = normalizeRetrySettings(options);

  return {
    async query<T>(input: AdminGraphqlQueryInput) {
      return postGraphql<T>(fetchImplementation, options.apiVersion, retrySettings, input);
    },
    async getShopMetadata(input: AdminShopMetadataInput) {
      const graphqlResponse = await postGraphql<GraphqlResponse>(fetchImplementation, options.apiVersion, retrySettings, {
        ...input,
        query: SHOP_METADATA_QUERY,
      });
      return parseShopMetadata(graphqlResponse);
    },
  };
}

async function postGraphql<T>(
  fetchImplementation: typeof globalThis.fetch,
  apiVersion: string,
  retrySettings: RetrySettings,
  input: AdminGraphqlQueryInput,
): Promise<T> {
  const shop = normalizeTokenStoreShopDomain(input.shop);
  const url = `https://${shop}/admin/api/${encodeURIComponent(apiVersion)}/graphql.json`;
  const context = formatOperationContext(shop);
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt <= retrySettings.maxRetries; attempt += 1) {
    let response: Response;

    try {
      response = await fetchImplementation(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': input.accessToken,
        },
        body: JSON.stringify(input.variables === undefined ? { query: input.query, operationName: input.operationName } : {
          query: input.query,
          variables: input.variables,
          operationName: input.operationName,
        }),
      });
    } catch (error) {
      lastNetworkError = error;
      if (attempt < retrySettings.maxRetries) {
        await retrySettings.sleep(calculateRetryDelayMs(attempt, retrySettings));
        continue;
      }

      throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL request failed (${context}): ${redactError(error)}`);
    }

    let body: unknown;
    const bodyText = await response.text();

    try {
      body = bodyText.length === 0 ? {} : JSON.parse(bodyText);
    } catch {
      if (isRetryableStatus(response.status) && attempt < retrySettings.maxRetries) {
        await retrySettings.sleep(calculateRetryDelayMs(attempt, retrySettings, response.headers.get('retry-after')));
        continue;
      }

      throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL response was not valid JSON (${context}).`);
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < retrySettings.maxRetries) {
        await retrySettings.sleep(calculateRetryDelayMs(attempt, retrySettings, response.headers.get('retry-after')));
        continue;
      }

      throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL HTTP ${response.status.toString(10)} (${context}): ${redactHttpBody(body, bodyText)}`);
    }

    emitCostTelemetry(retrySettings.onTelemetry, shop, body);

    if (isJsonPlainRecord(body) && body.errors !== undefined) {
      throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL returned errors (${context}): ${redactGraphqlErrors(body.errors)}`);
    }

    return body as T;
  }

  throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL request failed (${context}): ${redactError(lastNetworkError)}`);
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/giu, '$1[REDACTED]')
    .replace(/(X-Shopify-Access-Token\s*:\s*)\S+/giu, '$1[REDACTED]')
    .replace(/(Cookie\s*:\s*)[^\r\n]+/giu, '$1[REDACTED]')
    .replace(/\bcallback(?:_url)?=\S+/giu, 'callback=[REDACTED]')
    .replace(/\bhttps?:\/\/[^\s"'<>]+(?:callback|oauth|auth)[^\s"'<>]*/giu, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED]')
    .replace(/((?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?)\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?\S+/giu, '$1[REDACTED]')
    .replace(/("[^"]*(?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?|x-shopify-access-token)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/giu, '$1"[REDACTED]"')
    .replace(/('[^']*(?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?|x-shopify-access-token)[^']*'\s*:\s*)'(?:[^'\\]|\\.)*'/giu, "$1'[REDACTED]'")
    .replace(/\b(?:shpat|shpca|shpss|shppa)_[A-Za-z0-9_-]+\b/giu, '[REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/giu, '[REDACTED]')
    .replace(/\bxox[a-z]-[A-Za-z0-9-]+\b/giu, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/giu, '[REDACTED]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{12,}/giu, '[REDACTED]');
}

function normalizeRetrySettings(options: ShopifyAdminGraphqlClientOptions): RetrySettings {
  return {
    maxRetries: clampInteger(options.maxRetries, 0, 5, DEFAULT_MAX_RETRIES),
    retryDelayMs: clampInteger(options.retryDelayMs, 0, DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS),
    maxRetryDelayMs: clampInteger(options.maxRetryDelayMs, 0, 30_000, DEFAULT_MAX_RETRY_DELAY_MS),
    retryJitterMs: options.retryJitterMs ?? (() => Math.floor(Math.random() * 100)),
    sleep: options.sleep ?? sleep,
    onTelemetry: options.onTelemetry,
  };
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function calculateRetryDelayMs(attempt: number, settings: RetrySettings, retryAfterHeader?: string | null): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const baseDelayMs = retryAfterMs ?? (settings.retryDelayMs * (2 ** attempt));
  const jitterMs = retryAfterMs === undefined ? resolveJitterMs(settings.retryJitterMs) : 0;

  return Math.min(settings.maxRetryDelayMs, Math.max(0, Math.trunc(baseDelayMs + jitterMs)));
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null || value.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.trunc(seconds * 1_000));
  }

  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return undefined;
  }

  return Math.max(0, timestampMs - Date.now());
}

function resolveJitterMs(jitter: number | (() => number)): number {
  const value = typeof jitter === 'function' ? jitter() : jitter;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function formatOperationContext(shop: string): string {
  return `shop=${shop}, operation=admin_graphql`;
}

function emitCostTelemetry(
  onTelemetry: ((telemetry: AdminGraphqlCostTelemetry) => void) | undefined,
  shop: string,
  body: unknown,
): void {
  if (onTelemetry === undefined || !isJsonPlainRecord(body)) {
    return;
  }

  const extensions = body.extensions;
  if (!isJsonPlainRecord(extensions)) {
    return;
  }

  const cost = extensions.cost;
  if (!isJsonPlainRecord(cost)) {
    return;
  }

  const telemetry: AdminGraphqlCostTelemetry = {
    shop,
    ...numberField(cost, 'requestedQueryCost'),
    ...numberField(cost, 'actualQueryCost'),
    ...parseThrottleStatus(cost.throttleStatus),
  };

  onTelemetry(telemetry);
}

function numberField(record: Record<string, unknown>, key: 'requestedQueryCost' | 'actualQueryCost'): Partial<AdminGraphqlCostTelemetry> {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}

function parseThrottleStatus(value: unknown): Pick<AdminGraphqlCostTelemetry, 'throttleStatus'> {
  if (!isJsonPlainRecord(value)) {
    return {};
  }

  const throttleStatus: NonNullable<AdminGraphqlCostTelemetry['throttleStatus']> = {
    ...telemetryNumber(value, 'maximumAvailable'),
    ...telemetryNumber(value, 'currentlyAvailable'),
    ...telemetryNumber(value, 'restoreRate'),
  };

  return Object.keys(throttleStatus).length === 0 ? {} : { throttleStatus };
}

function telemetryNumber<T extends 'maximumAvailable' | 'currentlyAvailable' | 'restoreRate'>(
  record: Record<string, unknown>,
  key: T,
): Partial<Record<T, number>> {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } as Partial<Record<T, number>> : {};
}

export function redactSensitiveErrorMessage(text: string): string {
  const redacted = redactSensitiveText(text);
  return /x-shopify-access-token|authorization/iu.test(redacted) ? '[REDACTED]' : redacted;
}

export function redactHttpBody(parsedBody: unknown, rawBodyText: string): string {
  if (isJsonPlainRecord(parsedBody) || Array.isArray(parsedBody)) {
    return JSON.stringify(redactUnknown(parsedBody));
  }

  return redactSensitiveText(rawBodyText);
}

function parseShopMetadata(response: unknown): AdminShopMetadata {
  const data = isJsonPlainRecord(response) ? response.data : undefined;
  const shop = isJsonPlainRecord(data) ? data.shop : undefined;

  if (
    !isJsonPlainRecord(shop) ||
    typeof shop.name !== 'string' ||
    typeof shop.myshopifyDomain !== 'string' ||
    typeof shop.currencyCode !== 'string'
  ) {
    throw new ShopifyAdminGraphqlError('Shopify Admin GraphQL response did not include expected shop metadata.');
  }

  return {
    name: shop.name,
    myshopifyDomain: normalizeTokenStoreShopDomain(shop.myshopifyDomain),
    currencyCode: shop.currencyCode,
  };
}

function redactGraphqlErrors(errors: unknown): string {
  const redacted = redactUnknown(errors);
  return JSON.stringify(redacted);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveGraphqlString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (isJsonPlainRecord(value)) {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        output['[REDACTED]'] = '[REDACTED]';
      } else {
        output[key] = redactUnknown(item);
      }
    }

    return output;
  }

  return value;
}

function redactSensitiveGraphqlString(value: string): string {
  const redacted = redactSensitiveText(value);
  return /x-shopify-access-token|authorization/iu.test(redacted) ? '[REDACTED]' : redacted;
}

function redactError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveErrorMessage(error.message);
  }

  return redactSensitiveErrorMessage(String(error));
}

function isSensitiveKey(key: string): boolean {
  return /(?:secret|token|authorization|password|api[_-]?key|private[_-]?key|cookie|session|credentials?)/iu.test(key);
}
