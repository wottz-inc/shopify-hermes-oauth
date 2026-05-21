import {
  chmod as fsChmod,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIRECTORY_MODE = 0o700;
const LOCAL_STATE_FILE_MODE = 0o600;

export interface LocalFileDependencies {
  readonly chmod?: (path: string, mode: number) => Promise<void> | void;
  readonly mkdir?: (path: string, options: { readonly recursive: true; readonly mode: number }) => Promise<void> | void;
  readonly readFile?: (path: string, encoding: BufferEncoding) => Promise<string> | string;
  readonly rename?: (from: string, to: string) => Promise<void> | void;
  readonly unlink?: (path: string) => Promise<void> | void;
  readonly writeFile?: (
    path: string,
    content: string,
    options: { readonly encoding: BufferEncoding; readonly mode: number; readonly flag?: string },
  ) => Promise<void> | void;
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
