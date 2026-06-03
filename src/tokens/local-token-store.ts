import { normalizeShopDomain } from '../shop-domain.js';
import { normalizeShopifyScopes } from '../shopify/scopes.js';
import { type LocalFileDependencies, readJsonFile, withFileLock, writeJsonAtomic } from '../storage/local-files.js';

export interface TokenMetadata {
  readonly shopName?: string;
  readonly currencyCode?: string;
  readonly myshopifyDomain?: string;
  readonly [key: string]: string | undefined;
}

export interface StoredShopToken {
  readonly shop: string;
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly storedAt: string;
  readonly updatedAt: string;
  readonly metadata?: TokenMetadata;
}

export interface StoreShopTokenInput {
  readonly shop: string;
  readonly accessToken: string;
  readonly scopes: readonly string[] | string;
  readonly metadata?: TokenMetadata;
}

export interface TokenStore {
  storeToken(token: StoreShopTokenInput): Promise<void> | void;
  getToken(shop: string): Promise<StoredShopToken | undefined> | StoredShopToken | undefined;
  listTokens(): Promise<readonly StoredShopToken[]> | readonly StoredShopToken[];
  deleteToken(shop: string): Promise<boolean> | boolean;
}

export interface LocalJsonTokenStoreOptions {
  readonly path: string;
  readonly now?: () => string;
  readonly fileDependencies?: LocalFileDependencies;
}

interface TokenStoreFile {
  readonly version: 1;
  readonly shops: Record<string, StoredShopToken>;
}

export class LocalJsonTokenStore implements TokenStore {
  readonly #path: string;
  readonly #now: () => string;
  readonly #fileDependencies: LocalFileDependencies;

  public constructor(options: LocalJsonTokenStoreOptions) {
    this.#path = options.path;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#fileDependencies = options.fileDependencies ?? {};
  }

  public async storeToken(input: StoreShopTokenInput): Promise<void> {
    const shop = normalizeTokenStoreShopDomain(input.shop);
    const accessToken = normalizeAccessToken(input.accessToken);
    const scopes = normalizeScopes(input.scopes);
    const metadata = normalizeMetadata(input.metadata);

    await this.#withWriteLock(async () => {
      const file = await this.#readStoreFile();
      const existing = file.shops[shop];
      const now = this.#now();
      const record: StoredShopToken = {
        shop,
        accessToken,
        scopes,
        storedAt: existing?.storedAt ?? now,
        updatedAt: now,
        ...(metadata === undefined ? {} : { metadata }),
      };

      await this.#writeStoreFile({
        version: 1,
        shops: {
          ...file.shops,
          [shop]: record,
        },
      });
    });
  }

  public async getToken(shopInput: string): Promise<StoredShopToken | undefined> {
    const shop = normalizeTokenStoreShopDomain(shopInput);
    const file = await this.#readStoreFile();
    const record = file.shops[shop];

    return record === undefined ? undefined : cloneToken(record);
  }

  public async listTokens(): Promise<readonly StoredShopToken[]> {
    const file = await this.#readStoreFile();

    return Object.values(file.shops)
      .sort((left, right) => left.shop.localeCompare(right.shop))
      .map((record) => cloneToken(record));
  }

  public async deleteToken(shopInput: string): Promise<boolean> {
    const shop = normalizeTokenStoreShopDomain(shopInput);

    return await this.#withWriteLock(async () => {
      const file = await this.#readStoreFile();

      if (file.shops[shop] === undefined) {
        return false;
      }

      const remainingShops = Object.fromEntries(
        Object.entries(file.shops).filter(([storedShop]) => storedShop !== shop),
      );
      await this.#writeStoreFile({ version: 1, shops: remainingShops });
      return true;
    });
  }

  async #readStoreFile(): Promise<TokenStoreFile> {
    const raw = await readJsonFile<unknown>(this.#path, this.#fileDependencies);

    if (raw === undefined) {
      return { version: 1, shops: {} };
    }

    return parseLocalJsonTokenStoreFile(raw);
  }

  async #writeStoreFile(file: TokenStoreFile): Promise<void> {
    await writeJsonAtomic(this.#path, file, this.#fileDependencies);
  }

  async #withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    // Store and delete use a lock file to serialize read-modify-write cycles across
    // LocalJsonTokenStore instances and processes. If delete races with store, the
    // operations are applied in lock acquisition order; each operation reads the
    // state committed by the previous lock holder before writing its own update.
    return await withFileLock(this.#path, operation, this.#fileDependencies);
  }
}

export function createLocalJsonTokenStore(options: LocalJsonTokenStoreOptions): LocalJsonTokenStore {
  return new LocalJsonTokenStore(options);
}

export function parseLocalJsonTokenStoreFile(raw: unknown): TokenStoreFile {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.shops)) {
    throw new Error('Invalid token store file.');
  }

  const shops: Record<string, StoredShopToken> = {};

  for (const [key, value] of Object.entries(raw.shops)) {
    if (!isRecord(value)) {
      throw new Error('Invalid token store file.');
    }

    const shop = normalizeTokenStoreShopDomain(typeof value.shop === 'string' ? value.shop : key);
    shops[shop] = {
      shop,
      accessToken: normalizeAccessToken(value.accessToken),
      scopes: normalizeScopes(value.scopes),
      storedAt: normalizeTimestamp(value.storedAt, 'storedAt'),
      updatedAt: normalizeTimestamp(value.updatedAt, 'updatedAt'),
      ...(value.metadata === undefined ? {} : { metadata: normalizeMetadata(value.metadata) ?? {} }),
    };
  }

  return { version: 1, shops };
}

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Access token cannot be blank');
  }

  return value;
}

export function normalizeTokenStoreShopDomain(input: string): string {
  return normalizeShopDomain(input.includes('.') ? input : `${input}.myshopify.com`);
}

function normalizeScopes(value: unknown): readonly string[] {
  let scopes: unknown[] | undefined;

  if (typeof value === 'string') {
    scopes = value.split(',').map((scope) => scope.trim());
  } else if (Array.isArray(value)) {
    const scopeValues: readonly unknown[] = value;
    scopes = scopeValues.map((scope) => (typeof scope === 'string' ? scope.trim() : scope));
  }

  if (!scopes?.every((scope): scope is string => typeof scope === 'string')) {
    throw new Error('Scopes must be strings');
  }

  if (scopes.some((scope) => scope.length === 0)) {
    throw new Error('Scopes must be non-blank strings');
  }

  const normalizedScopes = normalizeShopifyScopes(scopes);

  if (normalizedScopes.length === 0) {
    throw new Error('At least one scope is required');
  }

  return normalizedScopes;
}

function normalizeMetadata(value: unknown): TokenMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('Metadata must be an object of non-blank strings');
  }

  const metadata: Record<string, string> = {};

  for (const [key, metadataValue] of Object.entries(value)) {
    if (metadataValue === undefined) {
      continue;
    }

    if (typeof metadataValue !== 'string' || metadataValue.trim().length === 0) {
      throw new Error('Metadata values must be non-blank strings');
    }

    metadata[key] = key === 'myshopifyDomain' ? normalizeTokenStoreShopDomain(metadataValue) : metadataValue;
  }

  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function normalizeTimestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Token ${name} must be a non-blank string`);
  }

  return value;
}

function cloneToken(record: StoredShopToken): StoredShopToken {
  return {
    shop: record.shop,
    accessToken: record.accessToken,
    scopes: [...record.scopes],
    storedAt: record.storedAt,
    updatedAt: record.updatedAt,
    ...(record.metadata === undefined ? {} : { metadata: { ...record.metadata } }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
