import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import '@shopify/shopify-api/adapters/node';
import { ApiVersion, LogSeverity, shopifyApi } from '@shopify/shopify-api';

import { MissingRequiredAdminApiScopesError } from './shopify-oauth-token-exchange.js';
import { type SafeErrorCode } from '../safe-errors.js';
import { normalizeShopDomain, ShopDomainValidationError } from '../shop-domain.js';

const SERVICE_NAME = 'shopify-hermes-oauth';
const CALLBACK_PATH = '/auth/callback';
const START_PATH = '/auth/start';
const HEALTH_PATH = '/health';
const SHOPIFY_OAUTH_PATH = '/admin/oauth/authorize';
const DEFAULT_MAX_CALLBACK_AGE_MS = 5 * 60 * 1_000;
const DEFAULT_AUTH_START_RATE_LIMIT_MAX_REQUESTS = 30;
const DEFAULT_AUTH_START_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_AUTH_START_RATE_LIMIT_MAX_BUCKETS = 10_000;
const MAX_SAFE_TIMESTAMP_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
const DEFAULT_REQUIRED_ADMIN_API_SCOPES = ['read_products', 'read_orders', 'read_inventory', 'read_locations'] as const;

class OAuthCallbackError extends Error {
  public readonly code: SafeErrorCode;

  public constructor(message: string, code: SafeErrorCode = 'OAUTH_INVALID_CALLBACK') {
    super(message);
    this.name = 'OAuthCallbackError';
    this.code = code;
  }
}

export interface OAuthHttpServerConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly oldClientSecret?: string;
  readonly appUrl: string;
  readonly scopes: readonly string[];
}

export interface OAuthStateStore {
  create(input: { readonly shop: string; readonly redirectUri?: string }): {
    readonly state: string;
    readonly shop: string;
    readonly redirectUri?: string;
    readonly expiresAt: number;
  };
  consume(state: string): {
    readonly state: string;
    readonly shop: string;
    readonly redirectUri?: string;
    readonly expiresAt: number;
  };
}

export interface OAuthTokenExchangeInput {
  readonly shop: string;
  readonly code: string;
  readonly redirectUri: string;
}

export interface OAuthTokenExchangeResult {
  readonly accessToken: string;
  readonly scopes?: readonly string[] | string;
}

export interface OAuthStoredToken {
  readonly shop: string;
  readonly accessToken: string;
  readonly scopes: readonly string[];
}

export interface OAuthTokenStore {
  storeToken(token: OAuthStoredToken): Promise<void> | void;
}

export type OAuthTokenExchange = (
  input: OAuthTokenExchangeInput,
) => Promise<OAuthTokenExchangeResult> | OAuthTokenExchangeResult;

export type OAuthCallbackHmacValidator = (
  query: Readonly<Record<string, string | undefined>>,
) => Promise<boolean> | boolean;

export interface OAuthAuthStartRateLimitConfig {
  readonly maxRequests?: number;
  readonly windowMs?: number;
  readonly maxBuckets?: number;
}

export interface OAuthHttpServerDependencies {
  readonly config: OAuthHttpServerConfig;
  readonly stateStore: OAuthStateStore;
  readonly tokenExchange: OAuthTokenExchange;
  readonly tokenStore: OAuthTokenStore;
  readonly now?: () => number;
  readonly maxCallbackAgeMs?: number;
  readonly authStartRateLimit?: OAuthAuthStartRateLimitConfig;
}

export interface OAuthHttpServerInternalDependencies extends OAuthHttpServerDependencies {
  readonly hmacValidator: OAuthCallbackHmacValidator;
}

export function createOAuthHttpServerWithDependencies(
  dependencies: OAuthHttpServerInternalDependencies,
): Server {
  const authStartRateLimiter = createAuthStartRateLimiter(dependencies);

  return createServer((request, response) => {
    void routeRequestSafely(request, response, dependencies, authStartRateLimiter);
  });
}

interface AuthStartRateLimiter {
  check(input: { readonly ip: string; readonly shop: string }): { readonly allowed: boolean; readonly retryAfterSeconds?: number };
}

interface RateLimitBucket {
  windowStartedAt: number;
  count: number;
}

async function routeRequestSafely(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
  authStartRateLimiter: AuthStartRateLimiter,
): Promise<void> {
  try {
    await routeRequest(request, response, dependencies, authStartRateLimiter);
  } catch {
    trySendGenericError(response);
  }
}

function trySendGenericError(response: ServerResponse): void {
  try {
    if (!response.headersSent) {
      sendText(response, 500, 'Internal server error');
      return;
    }

    response.end();
  } catch {
    closeResponseSilently(response);
    // Best-effort generic fallback: do not turn response-write failures into
    // another unhandled rejection or leak internal exception details.
  }
}

function closeResponseSilently(response: ServerResponse): void {
  try {
    response.destroy();
  } catch {
    // Ignore best-effort close failures.
  }

  try {
    response.socket?.destroy();
  } catch {
    // Ignore best-effort close failures.
  }
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
  authStartRateLimiter: AuthStartRateLimiter,
): Promise<void> {
  const url = parseRequestUrl(request, dependencies.config.appUrl);

  if (url === undefined) {
    sendText(response, 400, 'Bad request');
    return;
  }

  if (request.method !== 'GET') {
    sendText(response, 405, 'Method not allowed', { Allow: 'GET' });
    return;
  }

  if (url.pathname === HEALTH_PATH) {
    sendJson(response, 200, { ok: true, service: SERVICE_NAME });
    return;
  }

  if (url.pathname === START_PATH) {
    handleAuthStart(request, url, response, dependencies, authStartRateLimiter);
    return;
  }

  if (url.pathname === CALLBACK_PATH) {
    await handleAuthCallback(url, response, dependencies);
    return;
  }

  sendText(response, 404, 'Not found');
}

function handleAuthStart(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
  authStartRateLimiter: AuthStartRateLimiter,
): void {
  const shopParam = url.searchParams.get('shop');

  try {
    const shop = normalizeShopDomain(shopParam ?? '');
    const rateLimit = authStartRateLimiter.check({ ip: clientIp(request), shop });

    if (!rateLimit.allowed) {
      sendText(response, 429, 'Too many requests', retryAfterHeaders(rateLimit.retryAfterSeconds));
      return;
    }

    const redirectUri = callbackUrl(dependencies.config.appUrl);
    const stateRecord = dependencies.stateStore.create({ shop, redirectUri });
    const oauthUrl = new URL(SHOPIFY_OAUTH_PATH, `https://${shop}`);
    oauthUrl.searchParams.set('client_id', dependencies.config.clientId);
    oauthUrl.searchParams.set('scope', normalizeScopes(dependencies.config.scopes).join(','));
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('state', stateRecord.state);

    redirect(response, oauthUrl.toString());
  } catch (error) {
    if (error instanceof ShopDomainValidationError) {
      sendText(response, 400, 'Invalid Shopify shop domain');
      return;
    }

    sendText(response, 503, 'OAuth install is temporarily unavailable');
  }
}

async function handleAuthCallback(
  url: URL,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
): Promise<void> {
  try {
    const callback = await validateCallbackRequest(url, dependencies);
    const stateRecord = dependencies.stateStore.consume(callback.state);

    if (stateRecord.shop !== callback.shop) {
      sendText(response, 400, canonicalShopMismatchMessage(callback.shop));
      return;
    }

    const redirectUri = stateRecord.redirectUri ?? callbackUrl(dependencies.config.appUrl);
    const token = await dependencies.tokenExchange({
      shop: callback.shop,
      code: callback.code,
      redirectUri,
    });
    const scopes = normalizeScopes(token.scopes ?? dependencies.config.scopes);

    if (scopes.length === 0) {
      throw new MissingRequiredAdminApiScopesError();
    }

    await dependencies.tokenStore.storeToken({
      shop: callback.shop,
      accessToken: token.accessToken,
      scopes,
    });

    sendText(response, 200, 'OAuth install complete');
  } catch (error) {
    sendText(response, 400, safeOAuthCallbackErrorMessage(error));
  }
}

function safeOAuthCallbackErrorMessage(error: unknown): string {
  if (isMissingRequiredAdminApiScopesError(error)) {
    return `Required Shopify Admin API scopes are missing. Configure at least one Required Admin API Scope for the app before retrying; optional scopes alone are insufficient. For v0.1 reports/MCP, use: ${DEFAULT_REQUIRED_ADMIN_API_SCOPES.join(', ')}.`;
  }

  return 'Invalid OAuth callback';
}

function isMissingRequiredAdminApiScopesError(error: unknown): boolean {
  return error instanceof MissingRequiredAdminApiScopesError
    || (error instanceof Error && error.message === 'At least one scope is required');
}

function canonicalShopMismatchMessage(callbackShop: string): string {
  return `Shopify returned a different canonical shop domain. Retry the install using ${callbackShop}.`;
}

async function validateCallbackRequest(
  url: URL,
  dependencies: OAuthHttpServerInternalDependencies,
): Promise<{ shop: string; code: string; state: string }> {
  assertNoDuplicateCallbackParams(url.searchParams);

  const shop = normalizeShopDomain(url.searchParams.get('shop') ?? '');
  const code = requiredParam(url, 'code');
  const state = requiredParam(url, 'state');
  // Shopify callback timestamps are seconds since epoch; keep freshness arithmetic in seconds.
  const timestamp = parseTimestamp(requiredParam(url, 'timestamp'));
  requiredParam(url, 'hmac');
  const now = dependencies.now ?? Date.now;
  const maxAgeMs = dependencies.maxCallbackAgeMs ?? DEFAULT_MAX_CALLBACK_AGE_MS;
  const nowMs = now();
  const earliestFreshTimestamp = Math.ceil((nowMs - maxAgeMs) / 1_000);
  const latestFreshTimestamp = Math.floor((nowMs + maxAgeMs) / 1_000);

  if (timestamp < earliestFreshTimestamp || timestamp > latestFreshTimestamp) {
    throw new OAuthCallbackError('Stale OAuth callback', 'OAUTH_STALE_CALLBACK');
  }

  if (!(await dependencies.hmacValidator(callbackQuery(url.searchParams)))) {
    throw new OAuthCallbackError('Invalid HMAC', 'OAUTH_INVALID_HMAC');
  }

  return { shop, code, state };
}

function assertNoDuplicateCallbackParams(params: URLSearchParams): void {
  const seen = new Set<string>();

  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new OAuthCallbackError('Duplicate OAuth callback parameter', 'OAUTH_INVALID_CALLBACK');
    }

    seen.add(key);
  }
}

export function createShopifyHmacValidator(config: OAuthHttpServerConfig): OAuthCallbackHmacValidator {
  const currentValidator = createShopifyHmacValidatorForSecret(config, config.clientSecret);
  const oldValidator = isPresent(config.oldClientSecret) && config.oldClientSecret !== config.clientSecret
    ? createShopifyHmacValidatorForSecret(config, config.oldClientSecret)
    : undefined;

  return async (query) => {
    if (await currentValidator(query)) {
      return true;
    }

    return oldValidator === undefined ? false : oldValidator(query);
  };
}

function createShopifyHmacValidatorForSecret(
  config: OAuthHttpServerConfig,
  clientSecret: string,
): OAuthCallbackHmacValidator {
  const shopify = shopifyApi({
    apiKey: config.clientId,
    apiSecretKey: clientSecret,
    apiVersion: ApiVersion.January26,
    hostName: new URL(config.appUrl).host,
    isEmbeddedApp: false,
    logger: { level: LogSeverity.Error },
    scopes: [...normalizeScopes(config.scopes)],
    _logDisabledFutureFlags: false,
  });

  return (query) => shopify.utils.validateHmac(query, { signator: 'admin' });
}

function callbackQuery(params: URLSearchParams): Record<string, string | undefined> {
  return Object.fromEntries(params.entries());
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);

  if (value === null || value.length === 0) {
    throw new OAuthCallbackError('Missing OAuth callback parameter', 'OAUTH_INVALID_CALLBACK');
  }

  return value;
}

function parseTimestamp(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new OAuthCallbackError('Invalid timestamp', 'OAUTH_INVALID_CALLBACK');
  }

  const timestamp = Number(value);

  if (!Number.isSafeInteger(timestamp) || timestamp > MAX_SAFE_TIMESTAMP_SECONDS) {
    throw new OAuthCallbackError('Invalid timestamp', 'OAUTH_INVALID_CALLBACK');
  }

  return timestamp;
}


function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function normalizeScopes(scopes: readonly string[] | string): readonly string[] {
  const scopeList = typeof scopes === 'string' ? scopes.split(',') : scopes;

  return scopeList
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function callbackUrl(appUrl: string): string {
  return new URL(CALLBACK_PATH, ensureTrailingSlash(appUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function createAuthStartRateLimiter(dependencies: OAuthHttpServerInternalDependencies): AuthStartRateLimiter {
  const maxRequests = dependencies.authStartRateLimit?.maxRequests ?? DEFAULT_AUTH_START_RATE_LIMIT_MAX_REQUESTS;
  const windowMs = dependencies.authStartRateLimit?.windowMs ?? DEFAULT_AUTH_START_RATE_LIMIT_WINDOW_MS;
  const maxBuckets = dependencies.authStartRateLimit?.maxBuckets ?? DEFAULT_AUTH_START_RATE_LIMIT_MAX_BUCKETS;

  if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) {
    throw new Error('Auth start rate-limit maxRequests must be a positive safe integer');
  }

  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new Error('Auth start rate-limit windowMs must be a positive safe integer');
  }

  if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) {
    throw new Error('Auth start rate-limit maxBuckets must be a positive safe integer');
  }

  const buckets = new Map<string, RateLimitBucket>();
  const now = dependencies.now ?? Date.now;

  return {
    check: ({ ip, shop }) => {
      const checkedAt = now();
      const key = `${ip}\u0000${shop}`;
      const bucket = buckets.get(key);

      if (bucket === undefined || checkedAt - bucket.windowStartedAt >= windowMs) {
        pruneExpiredRateLimitBuckets(buckets, checkedAt, windowMs);

        if (!buckets.has(key) && buckets.size >= maxBuckets) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1_000)) };
        }

        buckets.set(key, { windowStartedAt: checkedAt, count: 1 });
        return { allowed: true };
      }

      if (bucket.count >= maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStartedAt + windowMs - checkedAt) / 1_000)),
        };
      }

      bucket.count += 1;
      return { allowed: true };
    },
  };
}

function pruneExpiredRateLimitBuckets(
  buckets: Map<string, RateLimitBucket>,
  checkedAt: number,
  windowMs: number,
): void {
  for (const [key, bucket] of buckets) {
    if (checkedAt - bucket.windowStartedAt >= windowMs) {
      buckets.delete(key);
    }
  }
}

function retryAfterHeaders(retryAfterSeconds: number | undefined): Record<string, string> {
  if (retryAfterSeconds === undefined) {
    return {};
  }

  return { 'Retry-After': retryAfterSeconds.toString(10) };
}

function clientIp(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

function parseRequestUrl(request: IncomingMessage, appUrl: string): URL | undefined {
  if (request.url === undefined) {
    return undefined;
  }

  try {
    return new URL(request.url, appUrl);
  } catch {
    return undefined;
  }
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location });
  response.end();
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload).toString(10),
  });
  response.end(payload);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body).toString(10),
  });
  response.end(body);
}
