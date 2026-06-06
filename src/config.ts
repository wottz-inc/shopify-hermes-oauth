import { existsSync, readFileSync } from 'node:fs';

import {
  type HermesHomeResolverOptions,
  type ShopifyHermesPaths,
  resolveShopifyHermesPaths,
} from './hermes-home.js';

const REDACTED = '[REDACTED]';
const DEFAULT_SHOPIFY_HERMES_SCOPES = ['read_products', 'read_orders', 'read_inventory', 'read_locations'] as const;
const REQUIRED_ENV_KEYS = [
  'SHOPIFY_HERMES_CLIENT_ID',
  'SHOPIFY_HERMES_CLIENT_SECRET',
  'SHOPIFY_HERMES_APP_URL',
] as const;

export interface ShopifyHermesConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly oldClientSecret?: string;
  readonly appUrl: string;
  readonly scopes: readonly string[];
  readonly enableAnalyticsReports: boolean;
  readonly paths: ShopifyHermesPaths;
}

export interface LoadShopifyHermesConfigOptions extends HermesHomeResolverOptions {
  readonly readFile?: (path: string) => string | undefined;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadShopifyHermesConfig(
  options: LoadShopifyHermesConfigOptions = {},
): ShopifyHermesConfig {
  const env = options.env ?? process.env;
  const initialPaths = resolveShopifyHermesPaths({ env, homeDir: options.homeDir });
  const envFileValues = parseDotEnv(readEnvFile(initialPaths.envFile, options.readFile));
  const values = mergeShopifyHermesEnv(envFileValues, env);
  const paths = resolveShopifyHermesPaths({
    env: { ...env, ...values },
    homeDir: options.homeDir,
  });
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !isPresent(values[key]));

  if (missingKeys.length > 0) {
    throw new ConfigError(
      `Missing required Shopify Hermes configuration: ${missingKeys.join(', ')}`,
    );
  }

  return {
    clientId: getRequiredValue(values, 'SHOPIFY_HERMES_CLIENT_ID'),
    clientSecret: getRequiredValue(values, 'SHOPIFY_HERMES_CLIENT_SECRET'),
    oldClientSecret: getOptionalValue(values, 'SHOPIFY_HERMES_OLD_CLIENT_SECRET'),
    appUrl: getRequiredValue(values, 'SHOPIFY_HERMES_APP_URL'),
    scopes: parseScopes(values.SHOPIFY_HERMES_SCOPES),
    enableAnalyticsReports: parseBooleanGate(values.SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS),
    paths,
  };
}

export function parseBooleanGate(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (looksLikeToken(value)) {
    return REDACTED;
  }

  return value;
}

export function redactConfig<T>(config: T): T {
  return redactUnknown(config) as T;
}

function readEnvFile(
  path: string,
  injectedReadFile: ((path: string) => string | undefined) | undefined,
): string {
  if (injectedReadFile !== undefined) {
    return injectedReadFile(path) ?? '';
  }

  if (!existsSync(path)) {
    return '';
  }

  return readFileSync(path, 'utf8');
}

function parseDotEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    let line = rawLine.trim();

    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('export ')) {
      line = line.slice('export '.length).trimStart();
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = stripInlineComment(line.slice(separatorIndex + 1)).trim();

    if (!key.startsWith('SHOPIFY_HERMES_')) {
      continue;
    }

    const value = unquoteDotEnvValue(rawValue);

    if (isPresent(value)) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function unquoteDotEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '"' || character === "'") && value[index - 1] !== '\\') {
      quote = quote === character ? undefined : (quote ?? character);
      continue;
    }

    if (
      character === '#' &&
      quote === undefined &&
      (index === 0 || /\s/u.test(value[index - 1] ?? ''))
    ) {
      return value.slice(0, index);
    }
  }

  return value;
}

function mergeShopifyHermesEnv(
  envFileValues: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...envFileValues };

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('SHOPIFY_HERMES_') && isPresent(value)) {
      merged[key] = value;
    }
  }

  return merged;
}

function parseScopes(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return [...DEFAULT_SHOPIFY_HERMES_SCOPES];
  }

  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function getRequiredValue(values: Record<string, string>, key: string): string {
  const value = values[key];

  if (!isPresent(value)) {
    throw new ConfigError(`Missing required Shopify Hermes configuration: ${key}`);
  }

  return value;
}

function getOptionalValue(values: Record<string, string>, key: string): string | undefined {
  const value = values[key];

  return isPresent(value) ? value : undefined;
}

function redactUnknown(value: unknown, key?: string): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    return redactValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactUnknown(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string | undefined): boolean {
  if (key === undefined) {
    return false;
  }

  return /(?:secret|token|authorization|password|api[_-]?key|private[_-]?key|cookie|session|credentials?|x-shopify-access-token|hmac|signature|id[_-]?token|oauth[_-]?(?:code|state)|authorization[_-]?code)/iu.test(
    key,
  );
}

function looksLikeToken(value: string): boolean {
  return /^(?:(?:shpat|shpca|shpss|shppa)_[A-Za-z0-9_-]+|Bearer\s+\S+)$/iu.test(
    value,
  );
}
