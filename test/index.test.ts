import { describe, expect, it } from 'vitest';

import {
  hello,
  InventoryReportError,
  OrdersReportError,
  ProductsReportError,
  version,
} from '../src/index.js';

describe('package smoke test', () => {
  it('exports a stable hello message and version', () => {
    expect(hello()).toBe('shopify-hermes-oauth ready');
    expect(version).toBe('0.1.0');
  });

  it('exports all report error classes from the public index', () => {
    expect(new ProductsReportError('products')).toBeInstanceOf(ProductsReportError);
    expect(new InventoryReportError('inventory')).toBeInstanceOf(InventoryReportError);
    expect(new OrdersReportError('orders')).toBeInstanceOf(OrdersReportError);
  });
});
