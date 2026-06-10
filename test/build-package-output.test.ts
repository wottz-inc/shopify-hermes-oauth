import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('production build/package output', () => {
  it('excludes source-only test seams from the TypeScript build', async () => {
    const tsconfig = JSON.parse(
      await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'),
    ) as { exclude?: string[] };

    expect(tsconfig.exclude).toContain('src/__test__/**');
  });

  it('keeps the published package surface limited to intentional production artifacts', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports?: Record<string, unknown>;
      files?: string[];
    };

    expect(packageJson.files).toEqual(['dist']);
    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual(['.', './cli']);
    expect(JSON.stringify(packageJson.exports)).not.toContain('__test__');
  });
});
