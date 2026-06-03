import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveHermesHome,
  resolveShopifyHermesPaths,
} from '../src/hermes-home.js';
import {
  ConfigError,
  loadShopifyHermesConfig,
  redactConfig,
  redactValue,
} from '../src/config.js';

describe('Hermes home resolver', () => {
  it('uses HERMES_HOME when provided', () => {
    expect(
      resolveHermesHome({
        env: { HERMES_HOME: '/tmp/custom-hermes' },
        homeDir: '/home/alice',
      }),
    ).toBe('/tmp/custom-hermes');
  });

  it('falls back to ~/.hermes when HERMES_HOME is missing or blank', () => {
    expect(resolveHermesHome({ env: {}, homeDir: '/home/alice' })).toBe(
      '/home/alice/.hermes',
    );
    expect(
      resolveHermesHome({ env: { HERMES_HOME: '   ' }, homeDir: '/home/alice' }),
    ).toBe('/home/alice/.hermes');
  });

  it('resolves relative HERMES_HOME to an absolute path', () => {
    expect(
      resolveHermesHome({
        env: { HERMES_HOME: 'relative-hermes' },
        homeDir: '/home/alice',
      }),
    ).toBe(resolve('relative-hermes'));
  });

  it('defines Shopify Hermes OAuth data paths under Hermes home', () => {
    expect(
      resolveShopifyHermesPaths({
        env: { HERMES_HOME: '/var/hermes' },
        homeDir: '/unused',
      }),
    ).toEqual({
      hermesHome: '/var/hermes',
      appHome: '/var/hermes/shopify-hermes-oauth',
      envFile: '/var/hermes/.env',
      dataDir: '/var/hermes/shopify-hermes-oauth',
      configFile: '/var/hermes/shopify-hermes-oauth/config.json',
      tokenStore: '/var/hermes/shopify-hermes-oauth/tokens.json',
      auditLog: '/var/hermes/shopify-hermes-oauth/audit.jsonl',
    });
  });

  it('uses SHOPIFY_HERMES_DATA_DIR as the data directory override', () => {
    expect(
      resolveShopifyHermesPaths({
        env: {
          HERMES_HOME: '/var/hermes',
          SHOPIFY_HERMES_DATA_DIR: '/secure/shopify-data',
        },
        homeDir: '/unused',
      }),
    ).toEqual({
      hermesHome: '/var/hermes',
      appHome: '/var/hermes/shopify-hermes-oauth',
      envFile: '/var/hermes/.env',
      dataDir: '/secure/shopify-data',
      configFile: '/secure/shopify-data/config.json',
      tokenStore: '/secure/shopify-data/tokens.json',
      auditLog: '/secure/shopify-data/audit.jsonl',
    });
  });
});

describe('Shopify Hermes config loading', () => {
  it('uses the least-privilege v0.1 default scopes when SHOPIFY_HERMES_SCOPES is absent', () => {
    const config = loadShopifyHermesConfig({
      env: { HERMES_HOME: '/tmp/hermes' },
      homeDir: '/home/alice',
      readFile: () =>
        [
          'SHOPIFY_HERMES_CLIENT_ID=file-client-id',
          'SHOPIFY_HERMES_CLIENT_SECRET=file-client-secret',
          'SHOPIFY_HERMES_APP_URL=https://example.test',
        ].join('\n'),
    });

    expect(config.scopes).toEqual(['read_products', 'read_orders', 'read_inventory', 'read_locations']);
    expect(config.scopes).not.toContain('read_customers');
    expect(config.scopes).not.toContain('read_discounts');
    expect(config.scopes).not.toContain('read_reports');
  });

  it('loads SHOPIFY_HERMES_* config from .env and lets environment override it', () => {
    const config = loadShopifyHermesConfig({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_CLIENT_SECRET: 'env-client-secret',
      },
      homeDir: '/home/alice',
      readFile: (path) => {
        expect(path).toBe('/tmp/hermes/.env');
        return [
          'SHOPIFY_HERMES_CLIENT_ID=file-client-id',
          'SHOPIFY_HERMES_CLIENT_SECRET=file-client-secret',
          'SHOPIFY_HERMES_APP_URL=https://example.test',
          'SHOPIFY_HERMES_SCOPES=read_products,write_products',
        ].join('\n');
      },
    });

    expect(config).toEqual({
      clientId: 'file-client-id',
      clientSecret: 'env-client-secret',
      appUrl: 'https://example.test',
      scopes: ['read_products', 'write_products'],
      paths: {
        hermesHome: '/tmp/hermes',
        appHome: '/tmp/hermes/shopify-hermes-oauth',
        envFile: '/tmp/hermes/.env',
        dataDir: '/tmp/hermes/shopify-hermes-oauth',
        configFile: '/tmp/hermes/shopify-hermes-oauth/config.json',
        tokenStore: '/tmp/hermes/shopify-hermes-oauth/tokens.json',
        auditLog: '/tmp/hermes/shopify-hermes-oauth/audit.jsonl',
      },
    });
  });

  it('uses SHOPIFY_HERMES_DATA_DIR from .env when resolving data paths', () => {
    const config = loadShopifyHermesConfig({
      env: { HERMES_HOME: '/tmp/hermes' },
      homeDir: '/home/alice',
      readFile: (path) => {
        expect(path).toBe('/tmp/hermes/.env');
        return [
          'SHOPIFY_HERMES_CLIENT_ID=file-client-id',
          'SHOPIFY_HERMES_CLIENT_SECRET=file-client-secret',
          'SHOPIFY_HERMES_APP_URL=https://example.test',
          'SHOPIFY_HERMES_DATA_DIR=/secure/from-dotenv',
        ].join('\n');
      },
    });

    expect(config.paths.dataDir).toBe('/secure/from-dotenv');
    expect(config.paths.configFile).toBe('/secure/from-dotenv/config.json');
    expect(config.paths.tokenStore).toBe('/secure/from-dotenv/tokens.json');
    expect(config.paths.auditLog).toBe('/secure/from-dotenv/audit.jsonl');
  });

  it('preserves environment precedence for SHOPIFY_HERMES_DATA_DIR', () => {
    const config = loadShopifyHermesConfig({
      env: {
        HERMES_HOME: '/tmp/hermes',
        SHOPIFY_HERMES_DATA_DIR: '/secure/from-env',
      },
      homeDir: '/home/alice',
      readFile: () =>
        [
          'SHOPIFY_HERMES_CLIENT_ID=file-client-id',
          'SHOPIFY_HERMES_CLIENT_SECRET=file-client-secret',
          'SHOPIFY_HERMES_APP_URL=https://example.test',
          'SHOPIFY_HERMES_DATA_DIR=/secure/from-dotenv',
        ].join('\n'),
    });

    expect(config.paths.dataDir).toBe('/secure/from-env');
    expect(config.paths.configFile).toBe('/secure/from-env/config.json');
    expect(config.paths.tokenStore).toBe('/secure/from-env/tokens.json');
    expect(config.paths.auditLog).toBe('/secure/from-env/audit.jsonl');
  });

  it('treats blank environment values as absent instead of overriding .env values', () => {
    const config = loadShopifyHermesConfig({
      env: {
        SHOPIFY_HERMES_CLIENT_SECRET: '   ',
        SHOPIFY_HERMES_SCOPES: '\t',
        SHOPIFY_HERMES_DATA_DIR: '   ',
      },
      homeDir: '/home/alice',
      readFile: () =>
        [
          'SHOPIFY_HERMES_CLIENT_ID=file-client-id',
          'SHOPIFY_HERMES_CLIENT_SECRET=file-client-secret',
          'SHOPIFY_HERMES_APP_URL=https://example.test',
          'SHOPIFY_HERMES_SCOPES=read_products',
          'SHOPIFY_HERMES_DATA_DIR=/secure/from-dotenv',
        ].join('\n'),
    });

    expect(config.clientSecret).toBe('file-client-secret');
    expect(config.scopes).toEqual(['read_products']);
    expect(config.paths.dataDir).toBe('/secure/from-dotenv');
  });

  it('supports export prefixes and inline comments in .env values', () => {
    const config = loadShopifyHermesConfig({
      env: {},
      homeDir: '/home/alice',
      readFile: () =>
        [
          'export SHOPIFY_HERMES_CLIENT_ID=file-client-id # public app id',
          'SHOPIFY_HERMES_CLIENT_SECRET="file-client-secret # not a comment"',
          "SHOPIFY_HERMES_APP_URL='https://example.test' # callback base",
        ].join('\n'),
    });

    expect(config.clientId).toBe('file-client-id');
    expect(config.clientSecret).toBe('file-client-secret # not a comment');
    expect(config.appUrl).toBe('https://example.test');
  });

  it('reports missing config keys without leaking present secret values', () => {
    const secret = 'dummy-secret-that-must-not-leak';

    expect(() =>
      loadShopifyHermesConfig({
        env: { SHOPIFY_HERMES_CLIENT_SECRET: secret },
        homeDir: '/home/alice',
        readFile: () => '',
      }),
    ).toThrow(ConfigError);

    try {
      loadShopifyHermesConfig({
        env: { SHOPIFY_HERMES_CLIENT_SECRET: secret },
        homeDir: '/home/alice',
        readFile: () => '',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const { message } = error as Error;
      expect(message).toContain('SHOPIFY_HERMES_CLIENT_ID');
      expect(message).toContain('SHOPIFY_HERMES_APP_URL');
      expect(message).not.toContain(secret);
    }
  });
});

describe('config redaction', () => {
  it('redacts client secrets, tokens, authorization values, and nested token-like fields', () => {
    const raw = {
      SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
      SHOPIFY_HERMES_CLIENT_SECRET: 'dummy-client-secret',
      accessToken: 'dummy-access-token',
      nested: {
        refresh_token: 'dummy-refresh-token',
        Authorization: 'Bearer dummy-bearer-token',
        privateKey: 'dummy-private-key',
        cookie: 'dummy-cookie',
        session: 'dummy-session',
        credentials: 'dummy-credentials',
        hmac: 'dummy-hmac',
        signature: 'dummy-signature',
        code: 'ACCESS_DENIED',
        state: 'published',
        oauthCode: 'dummy-oauth-code',
        oauthState: 'dummy-oauth-state',
        id_token: 'dummy-id-token',
        old_client_secret: 'dummy-old-client-secret',
        headers: {
          'x-shopify-access-token': 'dummy-shopify-header-token',
        },
      },
    };

    expect(redactConfig(raw)).toEqual({
      SHOPIFY_HERMES_CLIENT_ID: 'public-client-id',
      SHOPIFY_HERMES_CLIENT_SECRET: '[REDACTED]',
      accessToken: '[REDACTED]',
      nested: {
        refresh_token: '[REDACTED]',
        Authorization: '[REDACTED]',
        privateKey: '[REDACTED]',
        cookie: '[REDACTED]',
        session: '[REDACTED]',
        credentials: '[REDACTED]',
        hmac: '[REDACTED]',
        signature: '[REDACTED]',
        code: 'ACCESS_DENIED',
        state: 'published',
        oauthCode: '[REDACTED]',
        oauthState: '[REDACTED]',
        id_token: '[REDACTED]',
        old_client_secret: '[REDACTED]',
        headers: {
          'x-shopify-access-token': '[REDACTED]',
        },
      },
    });

    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-client-secret');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-access-token');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-refresh-token');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-bearer-token');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-private-key');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-cookie');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-session');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-credentials');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-hmac');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-signature');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-oauth-code');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-oauth-state');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-id-token');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-old-client-secret');
    expect(JSON.stringify(redactConfig(raw))).not.toContain('dummy-shopify-header-token');
  });

  it('redacts token-looking scalar values even without sensitive keys', () => {
    expect(redactValue('shpat_1234567890abcdef')).toBe('[REDACTED]');
    expect(redactValue('Bearer abc.def.ghi')).toBe('[REDACTED]');
    expect(redactValue('public-value')).toBe('public-value');
  });
});
