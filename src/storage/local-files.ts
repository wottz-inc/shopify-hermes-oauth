import {
  chmod as fsChmod,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  stat as fsStat,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

const DATA_DIRECTORY_MODE = 0o700;
const LOCAL_STATE_FILE_MODE = 0o600;
const LOCK_RETRY_INTERVAL_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 10 * 60_000;

interface LockMetadata {
  readonly owner: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
}

export interface LocalFileDependencies {
  readonly chmod?: (path: string, mode: number) => Promise<void> | void;
  readonly mkdir?: (path: string, options: { readonly recursive: true; readonly mode: number }) => Promise<void> | void;
  readonly readFile?: (path: string, encoding: BufferEncoding) => Promise<string> | string;
  readonly rename?: (from: string, to: string) => Promise<void> | void;
  readonly stat?: (path: string) => Promise<{ readonly mtimeMs: number }> | { readonly mtimeMs: number };
  readonly unlink?: (path: string) => Promise<void> | void;
  readonly writeFile?: (
    path: string,
    content: string,
    options: { readonly encoding: BufferEncoding; readonly mode: number; readonly flag?: string },
  ) => Promise<void> | void;
  readonly lockRetryIntervalMs?: number;
  readonly lockStaleMs?: number;
  readonly lockTimeoutMs?: number;
}

export async function ensureDataDirectory(
  path: string,
  dependencies: LocalFileDependencies = {},
): Promise<void> {
  const mkdir = dependencies.mkdir ?? fsMkdir;

  await mkdir(path, { recursive: true, mode: DATA_DIRECTORY_MODE });
  await chmodIfSupported(path, DATA_DIRECTORY_MODE, dependencies);
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  dependencies: LocalFileDependencies = {},
): Promise<void> {
  const directory = dirname(path);
  const tempPath = join(directory, `.${process.pid.toString(10)}-${randomUUID()}.tmp`);
  const writeFile = dependencies.writeFile ?? fsWriteFile;
  const rename = dependencies.rename ?? fsRename;
  const unlink = dependencies.unlink ?? fsUnlink;

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('Top-level value cannot be serialized as valid JSON.');
  }

  const serialized = JSON.stringify(value, null, 2);

  if (typeof serialized !== 'string') {
    throw new TypeError('Top-level value cannot be serialized as valid JSON.');
  }

  const content = `${serialized}\n`;

  await ensureDataDirectory(directory, dependencies);

  try {
    await writeFile(tempPath, content, {
      encoding: 'utf8',
      mode: LOCAL_STATE_FILE_MODE,
    });
    await chmodIfSupported(tempPath, LOCAL_STATE_FILE_MODE, dependencies);
    await rename(tempPath, path);
    await chmodIfSupported(path, LOCAL_STATE_FILE_MODE, dependencies);
  } catch (error) {
    await Promise.resolve(unlink(tempPath)).catch((unlinkError: unknown) => {
      if (!isNodeErrorCode(unlinkError, 'ENOENT')) {
        throw unlinkError;
      }
    });
    throw error;
  }
}

export async function readJsonFile<T>(
  path: string,
  dependencies: LocalFileDependencies = {},
): Promise<T | undefined> {
  const readFile = dependencies.readFile ?? fsReadFile;

  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
  dependencies: LocalFileDependencies = {},
): Promise<T> {
  const directory = dirname(path);
  const lockPath = `${path}.lock`;
  const writeFile = dependencies.writeFile ?? fsWriteFile;
  const unlink = dependencies.unlink ?? fsUnlink;
  const readFile = dependencies.readFile ?? fsReadFile;
  const stat = dependencies.stat ?? fsStat;
  const owner = randomUUID();

  await ensureDataDirectory(directory, dependencies);
  await acquireLock(lockPath, owner, writeFile, readFile, stat, unlink, dependencies);

  let result: T;
  try {
    result = await operation();
  } catch (error) {
    await releaseLock(lockPath, owner, readFile, unlink).catch(() => undefined);
    throw error;
  }

  await releaseLock(lockPath, owner, readFile, unlink);
  return result;
}

async function chmodIfSupported(
  path: string,
  mode: number,
  dependencies: LocalFileDependencies,
): Promise<void> {
  const chmod = dependencies.chmod ?? fsChmod;

  try {
    await chmod(path, mode);
  } catch (error) {
    if (!isUnsupportedPermissionError(error)) {
      throw error;
    }
  }
}

function isUnsupportedPermissionError(error: unknown): boolean {
  return ['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].some((code) => isNodeErrorCode(error, code));
}

async function acquireLock(
  lockPath: string,
  owner: string,
  writeFile: NonNullable<LocalFileDependencies['writeFile']>,
  readFile: NonNullable<LocalFileDependencies['readFile']>,
  stat: NonNullable<LocalFileDependencies['stat']>,
  unlink: NonNullable<LocalFileDependencies['unlink']>,
  dependencies: LocalFileDependencies,
): Promise<void> {
  const startedAt = Date.now();
  const metadata = lockMetadata(owner);

  for (;;) {
    try {
      await writeFile(lockPath, `${JSON.stringify(metadata)}\n`, {
        encoding: 'utf8',
        mode: LOCAL_STATE_FILE_MODE,
        flag: 'wx',
      });
      await chmodIfSupported(lockPath, LOCAL_STATE_FILE_MODE, dependencies);
      return;
    } catch (error) {
      if (!isNodeErrorCode(error, 'EEXIST')) {
        throw error;
      }

      await recoverStaleLock(lockPath, readFile, stat, unlink, dependencies.lockStaleMs ?? LOCK_STALE_MS);

      if (Date.now() - startedAt >= (dependencies.lockTimeoutMs ?? LOCK_TIMEOUT_MS)) {
        throw new Error('Timed out waiting for token store lock.', { cause: error });
      }

      await delay(dependencies.lockRetryIntervalMs ?? LOCK_RETRY_INTERVAL_MS);
    }
  }
}

function lockMetadata(owner: string): LockMetadata {
  return {
    owner,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
  };
}

async function recoverStaleLock(
  lockPath: string,
  readFile: NonNullable<LocalFileDependencies['readFile']>,
  stat: NonNullable<LocalFileDependencies['stat']>,
  unlink: NonNullable<LocalFileDependencies['unlink']>,
  staleMs: number,
): Promise<void> {
  const metadata = await readLockMetadata(lockPath, readFile);

  if (metadata === undefined) {
    if (!(await isMalformedLockStale(lockPath, stat, staleMs))) {
      return;
    }

    const reread = await Promise.resolve(readFile(lockPath, 'utf8')).catch((error: unknown) => {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return undefined;
      }

      throw error;
    });

    if (reread === undefined || parseLockMetadata(reread) !== undefined) {
      return;
    }

    await unlinkLockIfPresent(lockPath, unlink);
    return;
  }

  if (!isStaleLock(metadata, staleMs)) {
    return;
  }

  const reread = await Promise.resolve(readFile(lockPath, 'utf8')).catch((error: unknown) => {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  });

  if (reread === undefined || parseLockMetadata(reread)?.owner !== metadata.owner) {
    return;
  }

  await unlinkLockIfPresent(lockPath, unlink);
}

async function isMalformedLockStale(
  lockPath: string,
  stat: NonNullable<LocalFileDependencies['stat']>,
  staleMs: number,
): Promise<boolean> {
  const stats = await Promise.resolve(stat(lockPath)).catch((error: unknown) => {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  });

  return stats !== undefined && Date.now() - stats.mtimeMs >= staleMs;
}

async function unlinkLockIfPresent(
  lockPath: string,
  unlink: NonNullable<LocalFileDependencies['unlink']>,
): Promise<void> {
  await Promise.resolve(unlink(lockPath)).catch((error: unknown) => {
    if (!isNodeErrorCode(error, 'ENOENT')) {
      throw error;
    }
  });
}

async function releaseLock(
  lockPath: string,
  owner: string,
  readFile: NonNullable<LocalFileDependencies['readFile']>,
  unlink: NonNullable<LocalFileDependencies['unlink']>,
): Promise<void> {
  const metadata = await readLockMetadata(lockPath, readFile);

  if (metadata?.owner !== owner) {
    throw new Error('Token store lock ownership changed before release.');
  }

  await unlink(lockPath);
}

async function readLockMetadata(
  lockPath: string,
  readFile: NonNullable<LocalFileDependencies['readFile']>,
): Promise<LockMetadata | undefined> {
  try {
    return parseLockMetadata(await readFile(lockPath, 'utf8'));
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

function parseLockMetadata(content: string): LockMetadata | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<LockMetadata>;

    if (
      typeof parsed.owner !== 'string' ||
      parsed.owner.length === 0 ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.hostname !== 'string' ||
      parsed.hostname.length === 0 ||
      typeof parsed.createdAt !== 'string' ||
      parsed.createdAt.length === 0
    ) {
      return undefined;
    }

    return {
      owner: parsed.owner,
      pid: parsed.pid,
      hostname: parsed.hostname,
      createdAt: parsed.createdAt,
    };
  } catch {
    return undefined;
  }
}

function isStaleLock(metadata: LockMetadata, staleMs: number): boolean {
  const createdAt = Date.parse(metadata.createdAt);

  return Number.isFinite(createdAt) && Date.now() - createdAt >= staleMs;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
