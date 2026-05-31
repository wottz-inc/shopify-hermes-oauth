import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import '@shopify/shopify-api/adapters/node';
import { ApiVersion, LogSeverity, shopifyApi } from '@shopify/shopify-api';

import { MissingRequiredAdminApiScopesError } from './shopify-oauth-token-exchange.js';
import { normalizeShopDomain } from '../shop-domain.js';

const SERVICE_NAME = 'shopify-hermes-oauth';
const CALLBACK_PATH = '/auth/callback';
const START_PATH = '/auth/start';
const HEALTH_PATH = '/health';
const SHOPIFY_OAUTH_PATH = '/admin/oauth/authorize';
const DEFAULT_MAX_CALLBACK_AGE_MS = 5 * 60 * 1_000;
const MAX_SAFE_TIMESTAMP_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
const DEFAULT_REQUIRED_ADMIN_API_SCOPES = ['read_products', 'read_orders', 'read_inventory', 'read_locations'] as const;

export interface OAuthHttpServerConfig {
  readonly clientId: string;
  readonly clientSecret: string;
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

export interface OAuthHttpServerDependencies {
  readonly config: OAuthHttpServerConfig;
  readonly stateStore: OAuthStateStore;
  readonly tokenExchange: OAuthTokenExchange;
  readonly tokenStore: OAuthTokenStore;
  readonly now?: () => number;
  readonly maxCallbackAgeMs?: number;
}

export interface OAuthHttpServerInternalDependencies extends OAuthHttpServerDependencies {
  readonly hmacValidator: OAuthCallbackHmacValidator;
}

export function createOAuthHttpServerWithDependencies(
  dependencies: OAuthHttpServerInternalDependencies,
): Server {
  return createServer((request, response) => {
    void routeRequestSafely(request, response, dependencies);
  });
}

async function routeRequestSafely(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
): Promise<void> {
  try {
    await routeRequest(request, response, dependencies);
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
    handleAuthStart(url, response, dependencies);
    return;
  }

  if (url.pathname === CALLBACK_PATH) {
    await handleAuthCallback(url, response, dependencies);
    return;
  }

  sendText(response, 404, 'Not found');
}

function handleAuthStart(
  url: URL,
  response: ServerResponse,
  dependencies: OAuthHttpServerInternalDependencies,
): void {
  const shopParam = url.searchParams.get('shop');

  try {
    const shop = normalizeShopDomain(shopParam ?? '');
    const redirectUri = callbackUrl(dependencies.config.appUrl);
    const stateRecord = dependencies.stateStore.create({ shop, redirectUri });
    const oauthUrl = new URL(SHOPIFY_OAUTH_PATH, `https://${shop}`);
    oauthUrl.searchParams.set('client_id', dependencies.config.clientId);
    oauthUrl.searchParams.set('scope', normalizeScopes(dependencies.config.scopes).join(','));
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('state', stateRecord.state);

    redirect(response, oauthUrl.toString());
  } catch {
    sendText(response, 400, 'Invalid Shopify shop domain');
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
    throw new Error('Stale OAuth callback');
  }

  if (!(await dependencies.hmacValidator(callbackQuery(url.searchParams)))) {
    throw new Error('Invalid HMAC');
  }

  return { shop, code, state };
}

function assertNoDuplicateCallbackParams(params: URLSearchParams): void {
  const seen = new Set<string>();

  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new Error('Duplicate OAuth callback parameter');
    }

    seen.add(key);
  }
}

export function createShopifyHmacValidator(config: OAuthHttpServerConfig): OAuthCallbackHmacValidator {
  const shopify = shopifyApi({
    apiKey: config.clientId,
    apiSecretKey: config.clientSecret,
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
    throw new Error('Missing OAuth callback parameter');
  }

  return value;
}

function parseTimestamp(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error('Invalid timestamp');
  }

  const timestamp = Number(value);

  if (!Number.isSafeInteger(timestamp) || timestamp > MAX_SAFE_TIMESTAMP_SECONDS) {
    throw new Error('Invalid timestamp');
  }

  return timestamp;
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
