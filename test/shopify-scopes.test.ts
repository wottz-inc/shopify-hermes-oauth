import { describe, expect, it } from 'vitest';

import {
  compareShopifyScopes,
  formatMissingShopifyScopesMessage,
  missingShopifyScopes,
  normalizeShopifyScopes,
  shopifyScopeSatisfies,
} from '../src/shopify/scopes.js';

describe('Shopify scope helpers', () => {
  it('normalizes comma strings and arrays by trimming blanks, deduplicating, and lowercasing', () => {
    expect(normalizeShopifyScopes(' Read_Products, ,read_orders,READ_PRODUCTS,, write_orders ')).toEqual([
      'read_products',
      'read_orders',
      'write_orders',
    ]);
    expect(normalizeShopifyScopes([' read_products ', '', 'READ_PRODUCTS', ' Write_Orders '])).toEqual([
      'read_products',
      'write_orders',
    ]);
  });

  it('treats write scopes as satisfying corresponding read scopes only', () => {
    expect(shopifyScopeSatisfies('write_orders', 'read_orders')).toBe(true);
    expect(shopifyScopeSatisfies('write_products', 'read_products')).toBe(true);
    expect(shopifyScopeSatisfies('read_orders', 'write_orders')).toBe(false);
    expect(shopifyScopeSatisfies('write_products', 'read_orders')).toBe(false);
    expect(shopifyScopeSatisfies('read_inventory', 'read_inventory')).toBe(true);
  });

  it('reports missing requirements after applying Shopify read/write implication', () => {
    expect(missingShopifyScopes(['read_products', 'write_orders'], ['read_products', 'read_orders'])).toEqual([]);
    expect(missingShopifyScopes(['write_products'], ['read_products', 'read_orders'])).toEqual(['read_orders']);
  });

  it('reports configured and granted drift extras, including over-privileged write grants', () => {
    expect(compareShopifyScopes({
      configured: 'read_products, read_orders',
      granted: 'read_products,write_orders,read_customers',
    })).toEqual({ missing: [], extra: ['write_orders', 'read_customers'] });

    expect(compareShopifyScopes({
      configured: 'write_orders',
      granted: 'read_orders',
    })).toEqual({ missing: ['write_orders'], extra: [] });
  });

  it('formats safe missing-scope remediation without tokens or low-level API details', () => {
    expect(formatMissingShopifyScopesMessage('example.myshopify.com', ['read_inventory', 'read_locations'])).toBe(
      'Stored OAuth token for example.myshopify.com is missing required Shopify Admin API scopes: read_inventory, read_locations. Reinstall or re-authorize the shop after configuring SHOPIFY_HERMES_SCOPES to include the required read-only scopes; do not paste tokens or secrets into chat.',
    );
  });
});
