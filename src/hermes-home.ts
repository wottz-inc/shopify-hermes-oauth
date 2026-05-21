import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const SHOPIFY_HERMES_APP_DIR = 'shopify-hermes-oauth';

export interface HermesHomeResolverOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
}

export interface ShopifyHermesPaths {
  readonly hermesHome: string;
  readonly appHome: string;
  readonly envFile: string;
  readonly dataDir: string;
  readonly configFile: string;
  readonly tokenStore: string;
  readonly auditLog: string;
}

export function resolveHermesHome(options: HermesHomeResolverOptions = {}): string {
  const configuredHome = getPresentEnvValue(options.env, 'HERMES_HOME');

  if (configuredHome !== undefined) {
    return resolve(configuredHome);
  }

  return resolve(options.homeDir ?? homedir(), '.hermes');
}

export function resolveShopifyHermesPaths(
  options: HermesHomeResolverOptions = {},
): ShopifyHermesPaths {
  const hermesHome = resolveHermesHome(options);
  const appHome = join(hermesHome, SHOPIFY_HERMES_APP_DIR);
  const configuredDataDir = getPresentEnvValue(options.env, 'SHOPIFY_HERMES_DATA_DIR');
  const dataDir = configuredDataDir === undefined ? appHome : resolve(configuredDataDir);

  return {
    hermesHome,
    appHome,
    envFile: join(hermesHome, '.env'),
    dataDir,
    configFile: join(dataDir, 'config.json'),
    tokenStore: join(dataDir, 'tokens.json'),
    auditLog: join(dataDir, 'audit.jsonl'),
  };
}

function getPresentEnvValue(
  env: Readonly<Record<string, string | undefined>> | undefined,
  key: string,
): string | undefined {
  const value = env?.[key];

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
