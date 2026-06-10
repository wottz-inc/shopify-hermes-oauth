import { describe, expect, it } from 'vitest';

import { InMemoryOAuthStateStore, OAuthStateError } from '../src/oauth/state-store.js';

const fixedState = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('InMemoryOAuthStateStore', () => {
  it('creates a short-lived state using injected clock/random generator and normalized shop', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 1_000,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });

    const record = store.create({ shop: 'Example.myshopify.com', redirectUri: 'https://app.example/callback' });

    expect(record).toEqual({
      state: fixedState,
      shop: 'example.myshopify.com',
      redirectUri: 'https://app.example/callback',
      expiresAt: 61_000,
    });
  });

  it('rejects invalid shop domains when creating state', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 1_000,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });

    expect(() => store.create({ shop: 'https://example.myshopify.com' })).toThrow('Invalid Shopify shop domain');
  });

  it('rejects undefined shop values with the shop domain custom error', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 1_000,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });

    expect(() => store.create({ shop: undefined as unknown as string })).toThrow('Invalid Shopify shop domain');
    expect(() => store.create(undefined as unknown as never)).toThrow(OAuthStateError);
  });

  it('consumes valid state once and rejects replay', () => {
    let now = 10_000;
    const store = new InMemoryOAuthStateStore({
      now: () => now,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });
    store.create({ shop: 'example.myshopify.com' });

    expect(store.consume(fixedState)).toEqual({
      state: fixedState,
      shop: 'example.myshopify.com',
      redirectUri: undefined,
      expiresAt: 70_000,
    });
    now = 10_001;
    expect(() => store.consume(fixedState)).toThrow(OAuthStateError);
    expect(() => store.consume(fixedState)).toThrow('Invalid or expired OAuth state');
  });

  it('rejects missing state without leaking details', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 0,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });

    expect(() => store.consume('missing-state-value')).toThrow(OAuthStateError);

    try {
      store.consume('missing-state-value');
    } catch (error) {
      expect((error as Error).message).toBe('Invalid or expired OAuth state');
      expect((error as Error).message).not.toContain('missing-state-value');
    }
  });

  it('deletes expired state and rejects it on subsequent attempts', () => {
    let now = 1_000;
    const store = new InMemoryOAuthStateStore({
      now: () => now,
      randomState: () => fixedState,
      ttlMs: 5_000,
    });
    store.create({ shop: 'example.myshopify.com' });

    now = 6_001;
    expect(() => store.consume(fixedState)).toThrow(OAuthStateError);
    expect(() => store.consume(fixedState)).toThrow(OAuthStateError);
  });

  it('requires non-empty state values on consume and positive ttl on construction', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 0,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });

    expect(() => store.consume('')).toThrow(OAuthStateError);
    expect(() => store.consume(undefined as unknown as string)).toThrow(OAuthStateError);
    expect(() => new InMemoryOAuthStateStore({ ttlMs: 0 })).toThrow(OAuthStateError);
  });

  it('uses a 15 minute default TTL and rejects TTLs above the maximum', () => {
    const store = new InMemoryOAuthStateStore({
      now: () => 2_000,
      randomState: () => fixedState,
    });

    expect(store.create({ shop: 'example.myshopify.com' }).expiresAt).toBe(902_000);
    expect(() => new InMemoryOAuthStateStore({ ttlMs: 15 * 60 * 1_000 + 1 })).toThrow(OAuthStateError);
  });

  it('prunes expired states on create and exposes cleanup', () => {
    let now = 1_000;
    let stateIndex = 0;
    const states = ['expired-state', 'fresh-state'];
    const store = new InMemoryOAuthStateStore({
      now: () => now,
      randomState: () => states[stateIndex++] ?? 'fallback-state',
      ttlMs: 5_000,
    });

    store.create({ shop: 'example.myshopify.com' });
    now = 7_000;
    const fresh = store.create({ shop: 'example.myshopify.com' });

    expect(fresh.state).toBe('fresh-state');
    expect(() => store.consume('expired-state')).toThrow(OAuthStateError);

    now = 13_000;
    expect(store.cleanupExpired()).toBe(1);
    expect(() => store.consume('fresh-state')).toThrow(OAuthStateError);
  });

  it('retries duplicate generated states and fails safely after bounded duplicate attempts', () => {
    let stateIndex = 0;
    const states = [fixedState, fixedState, 'unique-state'];
    const store = new InMemoryOAuthStateStore({
      now: () => 1_000,
      randomState: () => states[stateIndex++] ?? fixedState,
      ttlMs: 60_000,
    });

    expect(store.create({ shop: 'example.myshopify.com' }).state).toBe(fixedState);
    expect(store.create({ shop: 'example.myshopify.com' }).state).toBe('unique-state');

    const duplicateOnlyStore = new InMemoryOAuthStateStore({
      now: () => 1_000,
      randomState: () => fixedState,
      ttlMs: 60_000,
    });
    duplicateOnlyStore.create({ shop: 'example.myshopify.com' });

    expect(() => duplicateOnlyStore.create({ shop: 'example.myshopify.com' })).toThrow(OAuthStateError);
    expect(() => duplicateOnlyStore.create({ shop: 'example.myshopify.com' })).toThrow(
      'OAuth state generator produced duplicate states',
    );
  });

  it('generates default random states with base64url length and distinct values', () => {
    const store = new InMemoryOAuthStateStore({ now: () => 1_000, ttlMs: 60_000 });

    const first = store.create({ shop: 'example.myshopify.com' }).state;
    const second = store.create({ shop: 'example.myshopify.com' }).state;

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
  });

  it('rejects new unexpired states at the configured capacity without leaking state values', () => {
    let stateIndex = 0;
    const states = ['bounded-state-1', 'bounded-state-2', 'bounded-state-3'];
    const store = new InMemoryOAuthStateStore({
      maxRecords: 2,
      now: () => 1_000,
      randomState: () => states[stateIndex++] ?? 'bounded-state-fallback',
      ttlMs: 60_000,
    });

    expect(store.create({ shop: 'example.myshopify.com' }).state).toBe('bounded-state-1');
    expect(store.create({ shop: 'example.myshopify.com' }).state).toBe('bounded-state-2');

    expect(() => store.create({ shop: 'example.myshopify.com' })).toThrow(OAuthStateError);

    try {
      store.create({ shop: 'example.myshopify.com' });
    } catch (error) {
      expect((error as Error).message).toBe('OAuth state store is at capacity');
      expect((error as Error).message).not.toContain('bounded-state-1');
      expect((error as Error).message).not.toContain('bounded-state-2');
      expect((error as Error).message).not.toContain('bounded-state-3');
    }

    expect(store.consume('bounded-state-1').state).toBe('bounded-state-1');
    expect(store.consume('bounded-state-2').state).toBe('bounded-state-2');
    expect(() => store.consume('bounded-state-3')).toThrow(OAuthStateError);
  });

  it('frees capacity by pruning expired states before enforcing the bound', () => {
    let now = 1_000;
    let stateIndex = 0;
    const states = ['expired-bounded-state', 'fresh-bounded-state'];
    const store = new InMemoryOAuthStateStore({
      maxRecords: 1,
      now: () => now,
      randomState: () => states[stateIndex++] ?? 'fallback-bounded-state',
      ttlMs: 5_000,
    });

    store.create({ shop: 'example.myshopify.com' });
    now = 6_001;

    expect(store.create({ shop: 'example.myshopify.com' }).state).toBe('fresh-bounded-state');
    expect(() => store.consume('expired-bounded-state')).toThrow(OAuthStateError);
    expect(store.consume('fresh-bounded-state').state).toBe('fresh-bounded-state');
  });
});
