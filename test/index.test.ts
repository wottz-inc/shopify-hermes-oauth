import { describe, expect, it } from 'vitest';

import { hello, version } from '../src/index.js';

describe('package smoke test', () => {
  it('exports a stable hello message and version', () => {
    expect(hello()).toBe('shopify-hermes-oauth ready');
    expect(version).toBe('0.1.0');
  });
});
