import { describe, expect, it } from 'vitest';

import { isJsonPlainRecord } from '../src/util/json.js';

describe('JSON plain-record utility', () => {
  class CustomRecord {
    public readonly key = 'value';
  }

  it.each([
    ['plain object', { key: 'value' }, true],
    ['null-prototype object', Object.assign(Object.create(null) as Record<string, unknown>, { key: 'value' }), true],
    ['Date', new Date('2026-01-02T03:04:05.000Z'), false],
    ['Map', new Map([['key', 'value']]), false],
    ['array', [], false],
    ['null', null, false],
    ['class instance', new CustomRecord(), false],
  ] as const)('classifies %s strictly', (_name, value, expected) => {
    expect(isJsonPlainRecord(value)).toBe(expected);
  });
});
