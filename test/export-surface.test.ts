import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('production export surface', () => {
  it('keeps OAuth HTTP testing seams out of production server exports', async () => {
    const serverSource = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');

    expect(serverSource).not.toMatch(/export\s+function\s+createOAuthHttpServerForTesting\b/);
    expect(serverSource).not.toMatch(/export\s+\{[^}]*createOAuthHttpServerForTesting/s);
  });

  it('does not wildcard re-export server internals from the package entrypoint', async () => {
    const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

    expect(indexSource).not.toMatch(/export\s+\*\s+from\s+['"]\.\/server\.js['"]/);
    expect(indexSource).not.toMatch(/export\s+type\s+\*\s+from\s+['"]\.\/server\.js['"]/);
  });
});
