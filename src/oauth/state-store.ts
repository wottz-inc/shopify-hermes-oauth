import { randomBytes } from 'node:crypto';

import { normalizeShopDomain } from '../shop-domain.js';

const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const MAX_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_STATE_BYTES = 32;
const MAX_STATE_GENERATION_ATTEMPTS = 3;
const INVALID_STATE_MESSAGE = 'Invalid or expired OAuth state';

export interface OAuthStateRecord {
  readonly state: string;
  readonly shop: string;
  readonly redirectUri?: string;
  readonly expiresAt: number;
}

export interface CreateOAuthStateInput {
  readonly shop: string;
  readonly redirectUri?: string;
}

export interface OAuthStateStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly randomState?: () => string;
}

export class OAuthStateError extends Error {
  public constructor(message = INVALID_STATE_MESSAGE) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

export class InMemoryOAuthStateStore {
  private readonly records = new Map<string, OAuthStateRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly randomState: () => string;

  public constructor(options: OAuthStateStoreOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new OAuthStateError('OAuth state TTL must be a positive safe integer no greater than 15 minutes');
    }

    this.ttlMs = ttlMs;
    this.now = options.now ?? Date.now;
    this.randomState = options.randomState ?? defaultRandomState;
  }

  public create(input: CreateOAuthStateInput): OAuthStateRecord {
    assertCreateInput(input);

    this.cleanupExpired();

    const shop = normalizeShopDomain(input.shop);

    for (let attempt = 0; attempt < MAX_STATE_GENERATION_ATTEMPTS; attempt += 1) {
      const state = this.randomState();

      if (typeof state !== 'string' || state.length === 0) {
        throw new OAuthStateError('OAuth state generator returned an empty state');
      }

      if (this.records.has(state)) {
        continue;
      }

      const record: OAuthStateRecord = {
        state,
        shop,
        redirectUri: input.redirectUri,
        expiresAt: this.now() + this.ttlMs,
      };

      this.records.set(state, record);

      return record;
    }

    throw new OAuthStateError('OAuth state generator produced duplicate states');
  }

  public consume(state: string): OAuthStateRecord {
    assertStateInput(state);

    const record = this.records.get(state);

    if (record === undefined) {
      throwInvalidState();
    }

    this.records.delete(state);

    if (record.expiresAt <= this.now()) {
      throwInvalidState();
    }

    return record;
  }

  public cleanupExpired(): number {
    const now = this.now();
    let deletedCount = 0;

    for (const [state, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(state);
        deletedCount += 1;
      }
    }

    return deletedCount;
  }
}

function defaultRandomState(): string {
  return randomBytes(DEFAULT_STATE_BYTES).toString('base64url');
}

function assertCreateInput(input: unknown): asserts input is CreateOAuthStateInput {
  if (input === null || typeof input !== 'object') {
    throw new OAuthStateError('Invalid OAuth state creation input');
  }
}

function assertStateInput(state: unknown): asserts state is string {
  if (typeof state !== 'string' || state.length === 0) {
    throwInvalidState();
  }
}

function throwInvalidState(): never {
  throw new OAuthStateError();
}
