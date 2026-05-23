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
}

export interface AdminShopMetadataInput {
  readonly shop: string;
  readonly accessToken: string;
}

export interface ShopifyAdminGraphqlClientOptions {
  readonly apiVersion: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface GraphqlResponse {
  readonly data?: unknown;
  readonly errors?: unknown;
}

export class ShopifyAdminGraphqlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShopifyAdminGraphqlError';
  }
}

export function createShopifyAdminGraphqlClient(options: ShopifyAdminGraphqlClientOptions): ShopifyAdminClient & ShopifyAdminQueryClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async query<T>(input: AdminGraphqlQueryInput) {
      return postGraphql<T>(fetchImplementation, options.apiVersion, input);
    },
    async getShopMetadata(input: AdminShopMetadataInput) {
      const graphqlResponse = await postGraphql<GraphqlResponse>(fetchImplementation, options.apiVersion, {
        ...input,
        query: SHOP_METADATA_QUERY,
      });
      return parseShopMetadata(graphqlResponse);
    },
  };
}

async function postGraphql<T>(fetchImplementation: typeof globalThis.fetch, apiVersion: string, input: AdminGraphqlQueryInput): Promise<T> {
  const shop = normalizeTokenStoreShopDomain(input.shop);
  const url = `https://${shop}/admin/api/${encodeURIComponent(apiVersion)}/graphql.json`;
  let response: Response;

  try {
    response = await fetchImplementation(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': input.accessToken,
      },
      body: JSON.stringify(input.variables === undefined ? { query: input.query } : { query: input.query, variables: input.variables }),
    });
  } catch (error) {
    throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL request failed: ${redactError(error)}`);
  }

  let body: unknown;
  const bodyText = await response.text();

  try {
    body = bodyText.length === 0 ? {} : JSON.parse(bodyText);
  } catch {
    throw new ShopifyAdminGraphqlError('Shopify Admin GraphQL response was not valid JSON.');
  }

  if (!response.ok) {
    throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL HTTP ${response.status.toString(10)}: ${redactHttpBody(body, bodyText)}`);
  }

  if (isJsonPlainRecord(body) && body.errors !== undefined) {
    throw new ShopifyAdminGraphqlError(`Shopify Admin GraphQL returned errors: ${redactGraphqlErrors(body.errors)}`);
  }

  return body as T;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/giu, '$1[REDACTED]')
    .replace(/(X-Shopify-Access-Token\s*:\s*)\S+/giu, '$1[REDACTED]')
    .replace(/(Cookie\s*:\s*)[^\r\n]+/giu, '$1[REDACTED]')
    .replace(/((?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?)\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?\S+/giu, '$1[REDACTED]')
    .replace(/("[^"]*(?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?|x-shopify-access-token)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/giu, '$1"[REDACTED]"')
    .replace(/('[^']*(?:access[_-]?token|token|authorization|cookie|session|secret|password|api[_-]?key|private[_-]?key|credentials?|x-shopify-access-token)[^']*'\s*:\s*)'(?:[^'\\]|\\.)*'/giu, "$1'[REDACTED]'")
    .replace(/\b(?:shpat|shpca|shpss|shppa)_[A-Za-z0-9_-]+\b/giu, '[REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/giu, '[REDACTED]')
    .replace(/\bxox[a-z]-[A-Za-z0-9-]+\b/giu, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/giu, '[REDACTED]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{12,}/giu, '[REDACTED]');
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
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(String(error));
}

function isSensitiveKey(key: string): boolean {
  return /(?:secret|token|authorization|password|api[_-]?key|private[_-]?key|cookie|session|credentials?)/iu.test(key);
}
