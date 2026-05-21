import { describe, expect, it } from 'vitest';

import { ShopDomainValidationError, normalizeShopDomain } from '../src/shop-domain.js';

describe('normalizeShopDomain', () => {
  it('accepts valid myshopify.com domains and normalizes case', () => {
    expect(normalizeShopDomain('Example-Shop.myshopify.com')).toBe('example-shop.myshopify.com');
    expect(normalizeShopDomain('my-store-123.myshopify.com')).toBe('my-store-123.myshopify.com');
  });

  it('rejects leading/trailing whitespace and control characters instead of trimming them', () => {
    for (const input of [
      ' example.myshopify.com',
      'example.myshopify.com ',
      '\texample.myshopify.com',
      'example.myshopify.com\n',
      '\u0000example.myshopify.com',
    ]) {
      expect(() => normalizeShopDomain(input)).toThrow(ShopDomainValidationError);
    }
  });

  it('rejects protocol, path, query, and fragment input', () => {
    for (const input of [
      'https://example.myshopify.com',
      'http://example.myshopify.com',
      'example.myshopify.com/admin',
      'example.myshopify.com?code=abc',
      'example.myshopify.com#oauth',
    ]) {
      expect(() => normalizeShopDomain(input)).toThrow(ShopDomainValidationError);
    }
  });

  it('rejects Unicode, control characters, and spaces inside the domain', () => {
    for (const input of [
      'ｅxample.myshopify.com',
      'examplé.myshopify.com',
      'exa\u0000mple.myshopify.com',
      'exa\tmple.myshopify.com',
      'exa mple.myshopify.com',
    ]) {
      expect(() => normalizeShopDomain(input)).toThrow(ShopDomainValidationError);
    }
  });

  it('rejects non-myshopify domains, empty labels, underscores, and overly long labels', () => {
    const tooLongLabel = `${'a'.repeat(64)}.myshopify.com`;

    for (const input of [
      '',
      '   ',
      'example.com',
      'example.myshopify.co',
      'example.shopify.com',
      '.myshopify.com',
      'example..myshopify.com',
      '-example.myshopify.com',
      'example-.myshopify.com',
      'example_store.myshopify.com',
      tooLongLabel,
    ]) {
      expect(() => normalizeShopDomain(input)).toThrow(ShopDomainValidationError);
    }
  });

  it('fails closed with a safe error message that does not echo invalid input', () => {
    const input = 'https://redacted-user@example.com/path?code=redacted-code';

    expect(() => normalizeShopDomain(input)).toThrow('Invalid Shopify shop domain');

    try {
      normalizeShopDomain(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ShopDomainValidationError);
      expect((error as Error).message).not.toContain('redacted-user');
      expect((error as Error).message).not.toContain('redacted-code');
    }
  });

  it('rejects undefined runtime input with a safe custom error', () => {
    expect(() => normalizeShopDomain(undefined as unknown as string)).toThrow(ShopDomainValidationError);
    expect(() => normalizeShopDomain(undefined as unknown as string)).toThrow('Invalid Shopify shop domain');
  });
});
