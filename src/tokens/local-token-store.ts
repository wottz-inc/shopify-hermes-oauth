import { type SafeErrorCode } from '../safe-errors.js';
import { normalizeShopDomain } from '../shop-domain.js';
import { normalizeShopifyScopes } from '../shopify/scopes.js';
import { type LocalFileDependencies, readJsonFile, withFileLock, writeJsonAtomic } from '../storage/local-files.js';

export interface TokenMetadata {
  readonly shopName?: string;
  readonly currencyCode?: string;
  readonly myshopifyDomain?: string;
  readonly [key: string]: string | undefined;
}

export type TokenAccessMode = 'offline' | 'online';
export type TokenSource = 'authorization_code' | 'token_exchange' | 'client_credentials' | 'manual_import';

export interface AssociatedUserMetadata {
  readonly id?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly accountOwner?: boolean;
  readonly locale?: string;
  readonly collaborator?: boolean;
}

export interface StoredShopToken {
  readonly schemaVersion?: number;
  readonly shop: string;
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly accessMode?: TokenAccessMode;
  readonly expiresAt?: string;
  readonly refreshToken?: string;
  readonly refreshTokenExpiresAt?: string;
  readonly grantedScopes?: readonly string[];
  readonly requestedScopes?: readonly string[];
  readonly tokenSource?: TokenSource;
  readonly associatedUser?: AssociatedUserMetadata;
  readonly storedAt: string;
  readonly updatedAt: string;
  readonly metadata?: TokenMetadata;
}

export interface StoreShopTokenInput {
  readonly shop: string;
  readonly accessToken: string;
  readonly scopes: readonly string[] | string;
  readonly accessMode?: TokenAccessMode;
  readonly expiresAt?: string;
  readonly refreshToken?: string;
  readonly refreshTokenExpiresAt?: string;
  readonly grantedScopes?: readonly string[] | string;
  readonly requestedScopes?: readonly string[] | string;
  readonly tokenSource?: TokenSource;
  readonly associatedUser?: AssociatedUserMetadata;
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

export class TokenStoreError extends Error {
  public readonly code: SafeErrorCode = 'TOKEN_STORE_ERROR';

  public constructor(message: string) {
    super(message);
    this.name = 'TokenStoreError';
  }
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
    const inputAccessMode = input.accessMode === undefined ? undefined : normalizeAccessMode(input.accessMode);
    const inputGrantedScopes = input.grantedScopes === undefined ? undefined : normalizeScopes(input.grantedScopes);
    const inputRequestedScopes = input.requestedScopes === undefined ? undefined : normalizeScopes(input.requestedScopes);
    const inputTokenSource = input.tokenSource === undefined ? undefined : normalizeTokenSource(input.tokenSource);
    const inputExpiresAt = normalizeOptionalTimestamp(input.expiresAt, 'expiresAt');
    const inputRefreshToken = normalizeOptionalSecret(input.refreshToken, 'refreshToken');
    const inputRefreshTokenExpiresAt = normalizeOptionalTimestamp(input.refreshTokenExpiresAt, 'refreshTokenExpiresAt');
    const inputAssociatedUser = normalizeAssociatedUser(input.associatedUser);

    await this.#withWriteLock(async () => {
      const file = await this.#readStoreFile();
      const existing = file.shops[shop];
      const now = this.#now();
      const expiresAt = input.expiresAt === undefined ? existing?.expiresAt : inputExpiresAt;
      const refreshToken = input.refreshToken === undefined ? existing?.refreshToken : inputRefreshToken;
      const refreshTokenExpiresAt = input.refreshTokenExpiresAt === undefined ? existing?.refreshTokenExpiresAt : inputRefreshTokenExpiresAt;
      const associatedUser = input.associatedUser === undefined ? existing?.associatedUser : inputAssociatedUser;
      const record: StoredShopToken = {
        schemaVersion: 1,
        shop,
        accessToken,
        scopes,
        accessMode: inputAccessMode ?? existing?.accessMode ?? 'offline',
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(refreshToken === undefined ? {} : { refreshToken }),
        ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
        grantedScopes: inputGrantedScopes ?? existing?.grantedScopes ?? scopes,
        requestedScopes: inputRequestedScopes ?? existing?.requestedScopes ?? scopes,
        tokenSource: inputTokenSource ?? existing?.tokenSource ?? 'authorization_code',
        ...(associatedUser === undefined ? {} : { associatedUser }),
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
    throw new TokenStoreError('Invalid token store file.');
  }

  const shops: Record<string, StoredShopToken> = {};

  for (const [key, value] of Object.entries(raw.shops)) {
    if (!isRecord(value)) {
      throw new TokenStoreError('Invalid token store file.');
    }

    const shop = normalizeTokenStoreShopDomain(typeof value.shop === 'string' ? value.shop : key);
    const scopes = normalizeScopes(value.scopes);
    const grantedScopes = normalizeScopes(value.grantedScopes ?? value.scopes);
    const requestedScopes = normalizeScopes(value.requestedScopes ?? value.scopes);
    const expiresAt = normalizeOptionalTimestamp(value.expiresAt, 'expiresAt');
    const refreshToken = normalizeOptionalSecret(value.refreshToken, 'refreshToken');
    const refreshTokenExpiresAt = normalizeOptionalTimestamp(value.refreshTokenExpiresAt, 'refreshTokenExpiresAt');
    const associatedUser = normalizeAssociatedUser(value.associatedUser);

    shops[shop] = {
      schemaVersion: normalizeSchemaVersion(value.schemaVersion),
      shop,
      accessToken: normalizeAccessToken(value.accessToken),
      scopes,
      accessMode: normalizeAccessMode(value.accessMode ?? 'offline'),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
      grantedScopes,
      requestedScopes,
      tokenSource: normalizeTokenSource(value.tokenSource ?? 'authorization_code'),
      ...(associatedUser === undefined ? {} : { associatedUser }),
      storedAt: normalizeTimestamp(value.storedAt, 'storedAt'),
      updatedAt: normalizeTimestamp(value.updatedAt, 'updatedAt'),
      ...(value.metadata === undefined ? {} : { metadata: normalizeMetadata(value.metadata) ?? {} }),
    };
  }

  return { version: 1, shops };
}

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TokenStoreError('Access token cannot be blank');
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
    throw new TokenStoreError('Scopes must be strings');
  }

  if (scopes.some((scope) => scope.length === 0)) {
    throw new TokenStoreError('Scopes must be non-blank strings');
  }

  const normalizedScopes = normalizeShopifyScopes(scopes);

  if (normalizedScopes.length === 0) {
    throw new TokenStoreError('At least one scope is required');
  }

  return normalizedScopes;
}

function normalizeMetadata(value: unknown): TokenMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TokenStoreError('Metadata must be an object of non-blank strings');
  }

  const metadata: Record<string, string> = {};

  for (const [key, metadataValue] of Object.entries(value)) {
    if (metadataValue === undefined) {
      continue;
    }

    if (typeof metadataValue !== 'string' || metadataValue.trim().length === 0) {
      throw new TokenStoreError('Metadata values must be non-blank strings');
    }

    metadata[key] = key === 'myshopifyDomain' ? normalizeTokenStoreShopDomain(metadataValue) : metadataValue;
  }

  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function normalizeTimestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TokenStoreError(`Token ${name} must be a non-blank string`);
  }

  return value;
}

function normalizeOptionalTimestamp(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : normalizeTimestamp(value, name);
}

function normalizeOptionalSecret(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : normalizeSecret(value, name);
}

function normalizeSecret(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TokenStoreError(`Token ${name} must be a non-blank string`);
  }

  return value;
}

function normalizeSchemaVersion(value: unknown): number {
  if (value === undefined) {
    return 1;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TokenStoreError('Token schemaVersion must be a positive integer');
  }

  return value;
}

function normalizeAccessMode(value: unknown): TokenAccessMode {
  if (value === 'offline' || value === 'online') {
    return value;
  }

  throw new TokenStoreError('Token accessMode must be offline or online');
}

function normalizeTokenSource(value: unknown): TokenSource {
  if (value === 'authorization_code' || value === 'token_exchange' || value === 'client_credentials' || value === 'manual_import') {
    return value;
  }

  throw new TokenStoreError('Token source is invalid');
}

function normalizeAssociatedUser(value: unknown): AssociatedUserMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TokenStoreError('Associated user metadata must be an object');
  }

  const associatedUser: AssociatedUserMetadata = {
    ...normalizeOptionalStringField(value.id, 'id', 'associatedUser.id'),
    ...normalizeOptionalStringField(value.firstName, 'firstName', 'associatedUser.firstName'),
    ...normalizeOptionalStringField(value.lastName, 'lastName', 'associatedUser.lastName'),
    ...normalizeOptionalStringField(value.email, 'email', 'associatedUser.email'),
    ...normalizeOptionalBooleanField(value.accountOwner, 'accountOwner', 'associatedUser.accountOwner'),
    ...normalizeOptionalStringField(value.locale, 'locale', 'associatedUser.locale'),
    ...normalizeOptionalBooleanField(value.collaborator, 'collaborator', 'associatedUser.collaborator'),
  };

  return Object.keys(associatedUser).length === 0 ? undefined : associatedUser;
}

function normalizeOptionalStringField(value: unknown, key: keyof AssociatedUserMetadata, name: string): Partial<AssociatedUserMetadata> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TokenStoreError(`Token ${name} must be a non-blank string`);
  }

  return { [key]: value };
}

function normalizeOptionalBooleanField(value: unknown, key: keyof AssociatedUserMetadata, name: string): Partial<AssociatedUserMetadata> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'boolean') {
    throw new TokenStoreError(`Token ${name} must be a boolean`);
  }

  return { [key]: value };
}

function cloneToken(record: StoredShopToken): StoredShopToken {
  const token: StoredShopToken = {
    shop: record.shop,
    accessToken: record.accessToken,
    scopes: [...record.scopes],
    storedAt: record.storedAt,
    updatedAt: record.updatedAt,
    ...(record.metadata === undefined ? {} : { metadata: { ...record.metadata } }),
  };

  if (record.schemaVersion !== undefined) {
    (token as { schemaVersion: number }).schemaVersion = record.schemaVersion;
  }
  if (record.accessMode !== undefined) {
    (token as { accessMode: TokenAccessMode }).accessMode = record.accessMode;
  }
  if (record.expiresAt !== undefined) {
    (token as { expiresAt: string }).expiresAt = record.expiresAt;
  }
  if (record.refreshToken !== undefined) {
    (token as { refreshToken: string }).refreshToken = record.refreshToken;
  }
  if (record.refreshTokenExpiresAt !== undefined) {
    (token as { refreshTokenExpiresAt: string }).refreshTokenExpiresAt = record.refreshTokenExpiresAt;
  }
  if (record.grantedScopes !== undefined) {
    (token as { grantedScopes: readonly string[] }).grantedScopes = [...record.grantedScopes];
  }
  if (record.requestedScopes !== undefined) {
    (token as { requestedScopes: readonly string[] }).requestedScopes = [...record.requestedScopes];
  }
  if (record.tokenSource !== undefined) {
    (token as { tokenSource: TokenSource }).tokenSource = record.tokenSource;
  }
  if (record.associatedUser !== undefined) {
    (token as { associatedUser: AssociatedUserMetadata }).associatedUser = { ...record.associatedUser };
  }

  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
