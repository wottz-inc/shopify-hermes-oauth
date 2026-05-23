import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureDataDirectory, withFileLock, writeJsonAtomic } from '../src/storage/local-files.js';

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

  it('recovers an owner-only stale lock left by a crashed writer', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');
    const lockFile = `${file}.lock`;
    await writeFile(
      lockFile,
      JSON.stringify({
        owner: 'crashed-owner',
        pid: 999_999,
        hostname: 'previous-host',
        createdAt: '2026-05-22T00:00:00.000Z',
      }),
      { mode: 0o600 },
    );

    await expect(withFileLock(file, () => Promise.resolve('recovered'))).resolves.toBe('recovered');

    await expect(readFile(lockFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a stale malformed lock left by a crash during lock creation', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');
    const lockFile = `${file}.lock`;
    await writeFile(lockFile, '{', { mode: 0o600 });

    await expect(
      withFileLock(file, () => Promise.resolve('recovered'), {
        lockStaleMs: 10,
        stat: () => ({ mtimeMs: Date.now() - 60_000 }),
      }),
    ).resolves.toBe('recovered');

    await expect(readFile(lockFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the operation error when lock cleanup also fails', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');
    const operationError = new Error('simulated operation failure');

    await expect(
      withFileLock(
        file,
        () => Promise.reject(operationError),
        {
          unlink: () => {
            throw new Error('simulated cleanup failure');
          },
        },
      ),
    ).rejects.toBe(operationError);
  });

  it('times out without removing an active non-stale lock', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');
    const existingLockError = Object.assign(new Error('lock exists'), { code: 'EEXIST' });
    let unlinkAttempted = false;

    await expect(
      withFileLock(file, () => Promise.resolve('not-run'), {
        writeFile: () => {
          throw existingLockError;
        },
        readFile: () =>
          JSON.stringify({
            owner: 'active-owner',
            pid: 12345,
            hostname: 'active-host',
            createdAt: new Date().toISOString(),
          }),
        unlink: () => {
          unlinkAttempted = true;
          throw new Error('active lock should not be removed');
        },
        lockRetryIntervalMs: 1,
        lockTimeoutMs: 5,
      }),
    ).rejects.toThrow('Timed out waiting for token store lock.');
    expect(unlinkAttempted).toBe(false);
  });

  it('throws lock cleanup errors only after successful operations', async () => {
    const root = await makeTempRoot();
    const file = join(root, 'tokens.json');

    await expect(
      withFileLock(file, () => Promise.resolve('completed'), {
        unlink: () => {
          throw new Error('simulated cleanup failure');
        },
      }),
    ).rejects.toThrow('simulated cleanup failure');
  });
});
