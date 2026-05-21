import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureDataDirectory, writeJsonAtomic } from '../src/storage/local-files.js';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-storage-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('secure local file utilities', () => {
  it('creates data directories with owner-only permissions where supported', async () => {
    const root = await makeTempRoot();
    const dataDir = join(root, 'state');

    await ensureDataDirectory(dataDir);

    const mode = (await stat(dataDir)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('writes JSON atomically using a same-directory temp file and owner-only file mode', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');

    await writeJsonAtomic(file, { shop: 'example.myshopify.com', scopes: ['read_products'] });

    await expect(readFile(file, 'utf8')).resolves.toBe(
      '{\n  "shop": "example.myshopify.com",\n  "scopes": [\n    "read_products"\n  ]\n}\n',
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(['tokens.json']);
  });

  it('preserves the previous JSON file if the temp write cannot be completed', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'config.json');

    await writeJsonAtomic(file, { version: 1 });
    await expect(
      writeJsonAtomic(file, { version: 2 }, {
        writeFile: () => {
          throw new Error('simulated write failure');
        },
      }),
    ).rejects.toThrow('simulated write failure');

    await expect(readFile(file, 'utf8')).resolves.toBe('{\n  "version": 1\n}\n');
  });

  it.each([undefined, () => 'not-json', Symbol('not-json')])(
    'rejects top-level values that do not serialize as JSON and leaves existing file unchanged',
    async (invalidValue) => {
      const root = await makeTempRoot();
      const file = join(root, 'config.json');

      await writeJsonAtomic(file, { version: 1 });

      await expect(writeJsonAtomic(file, invalidValue)).rejects.toThrow(TypeError);
      await expect(readFile(file, 'utf8')).resolves.toBe('{\n  "version": 1\n}\n');
      expect(await readdir(root)).toEqual(['config.json']);
    },
  );

  it('rejects top-level toJSON results that do not serialize as JSON and leaves existing file unchanged', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'config.json');

    await writeJsonAtomic(file, { version: 1 });

    await expect(writeJsonAtomic(file, { toJSON: () => undefined })).rejects.toThrow(TypeError);
    await expect(readFile(file, 'utf8')).resolves.toBe('{\n  "version": 1\n}\n');
    expect(await readdir(root)).toEqual(['config.json']);
  });
});
