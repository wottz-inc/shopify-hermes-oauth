import { constants } from 'node:fs';
import { chmod as fsChmod, open as fsOpen } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ensureDataDirectory } from './storage/local-files.js';
import { isJsonPlainRecord } from './util/json.js';

const AUDIT_FILE_MODE = 0o600;

export type AuditResult = 'success' | 'failure';

export interface AuditEventInput {
  readonly action: string;
  readonly shop?: string;
  readonly result: AuditResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditEvent extends AuditEventInput {
  readonly timestamp: string;
}

type CanonicalMetadata = Record<string, JsonValue>;

type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

export interface AuditDependencies {
  readonly chmod?: (path: string, mode: number) => Promise<void> | void;
  readonly now?: () => Date;
  readonly open?: typeof fsOpen;
}

export class AuditSecretError extends Error {
  public constructor(path: string) {
    super(`Audit event contains secret-like data at ${path}; refusing to write audit log entry.`);
    this.name = 'AuditSecretError';
  }
}

export class AuditValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AuditValidationError';
  }
}

export async function appendAuditEvent(
  path: string,
  event: AuditEventInput,
  dependencies: AuditDependencies = {},
): Promise<void> {
  const eventSnapshot = canonicalizeAuditEvent(event);

  const record = buildAuditRecord(eventSnapshot, (dependencies.now ?? (() => new Date()))().toISOString());
  const secretPath = findSecretLikePath(record);

  if (secretPath !== undefined) {
    throw new AuditSecretError(secretPath);
  }

  const line = `${JSON.stringify(record)}\n`;
  const chmod = dependencies.chmod ?? fsChmod;

  await ensureDataDirectory(dirname(path), { chmod });
  await appendAuditLine(path, line, dependencies);
}

export function findSecretLikePath(value: unknown): string | undefined {
  return findSecretLikePathRecursive(value, '$', undefined, new WeakSet());
}

function buildAuditRecord(event: AuditEventInput, timestamp: string): AuditEvent {
  return {
    timestamp,
    action: event.action,
    ...(event.shop === undefined ? {} : { shop: event.shop }),
    result: event.result,
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
  };
}

function canonicalizeAuditEvent(event: AuditEventInput): AuditEventInput {
  if (!isObjectLike(event) || Array.isArray(event)) {
    throw new AuditValidationError('Audit event must be an object.');
  }

  for (const descriptorKey of Reflect.ownKeys(event)) {
    const descriptor = Object.getOwnPropertyDescriptor(event, descriptorKey);

    if (descriptor !== undefined && ('get' in descriptor || 'set' in descriptor)) {
      throw new AuditValidationError(
        `Audit event contains accessor data at $${metadataPathSegment(descriptorKey)}; refusing to write audit log entry.`,
      );
    }
  }

  const descriptors = Object.getOwnPropertyDescriptors(event) as PropertyDescriptorMap;
  const action = descriptors.action?.value as unknown;
  const result = descriptors.result?.value as unknown;
  const shop = descriptors.shop?.value as unknown;
  const metadata = descriptors.metadata?.value as unknown;

  if (typeof action !== 'string' || action.trim().length === 0) {
    throw new AuditValidationError('Audit action must be a non-empty string.');
  }

  if (result !== 'success' && result !== 'failure') {
    throw new AuditValidationError('Audit result must be either "success" or "failure".');
  }

  if (shop !== undefined && typeof shop !== 'string') {
    throw new AuditValidationError('Audit shop must be a string when provided.');
  }

  if (metadata !== undefined) {
    if (!isJsonPlainRecord(metadata)) {
      throw new AuditValidationError('Audit metadata must be an object when provided.');
    }

    return {
      action,
      ...(shop === undefined ? {} : { shop }),
      result,
      metadata: canonicalizeAuditMetadataObject(metadata, '$.metadata', new WeakMap()),
    };
  }

  return {
    action,
    ...(shop === undefined ? {} : { shop }),
    result,
  };
}

function canonicalizeAuditMetadata(value: unknown, path: string, seen: WeakMap<object, JsonValue>): JsonValue {
  if (typeof value === 'function') {
    throw new AuditValidationError(`Audit event contains function data at ${path}; refusing to write audit log entry.`);
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AuditValidationError(`Audit event contains non-finite number data at ${path}; refusing to write audit log entry.`);
    }

    return value;
  }

  if (value === undefined || typeof value === 'bigint' || typeof value === 'symbol') {
    throw new AuditValidationError(`Audit event contains non-JSON data at ${path}; refusing to write audit log entry.`);
  }

  if (Array.isArray(value)) {
    return canonicalizeAuditMetadataArray(value, path, seen);
  }

  if (isJsonPlainRecord(value)) {
    return canonicalizeAuditMetadataObject(value, path, seen);
  }

  throw new AuditValidationError(`Audit event contains non-JSON object data at ${path}; refusing to write audit log entry.`);
}

function canonicalizeAuditMetadataArray(value: readonly unknown[], path: string, seen: WeakMap<object, JsonValue>): JsonValue[] {
  if (seen.has(value)) {
    throw new AuditValidationError(`Audit event contains circular data at ${path}; refusing to write audit log entry.`);
  }

  const canonical: JsonValue[] = [];
  seen.set(value, canonical);

  for (const descriptorKey of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, descriptorKey);

    if (descriptor === undefined) {
      continue;
    }

    const descriptorPath = `${path}${metadataPathSegment(descriptorKey)}`;

    if ('get' in descriptor || 'set' in descriptor) {
      throw new AuditValidationError(
        `Audit event contains accessor data at ${descriptorPath}; refusing to write audit log entry.`,
      );
    }

    if (descriptorKey === 'length') {
      continue;
    }

    if (typeof descriptor.value === 'function') {
      throw new AuditValidationError(`Audit event contains function data at ${descriptorPath}; refusing to write audit log entry.`);
    }

    if (typeof descriptorKey === 'symbol' || !/^(?:0|[1-9]\d*)$/u.test(descriptorKey)) {
      throw new AuditValidationError(`Audit event contains non-JSON data at ${descriptorPath}; refusing to write audit log entry.`);
    }

    canonical[Number(descriptorKey)] = canonicalizeAuditMetadata(descriptor.value, descriptorPath, seen);
  }

  seen.delete(value);

  for (let index = 0; index < canonical.length; index += 1) {
    if (!Object.hasOwn(canonical, index)) {
      throw new AuditValidationError(`Audit event contains non-JSON data at ${path}[${index.toString(10)}]; refusing to write audit log entry.`);
    }
  }

  return canonical;
}

function canonicalizeAuditMetadataObject(
  value: Record<string, unknown>,
  path: string,
  seen: WeakMap<object, JsonValue>,
): CanonicalMetadata {
  if (seen.has(value)) {
    throw new AuditValidationError(`Audit event contains circular data at ${path}; refusing to write audit log entry.`);
  }

  const canonical: Record<string, JsonValue> = {};
  seen.set(value, canonical);

  for (const descriptorKey of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, descriptorKey);

    if (descriptor === undefined) {
      continue;
    }

    const descriptorPath = `${path}${metadataPathSegment(descriptorKey)}`;

    if ('get' in descriptor || 'set' in descriptor) {
      throw new AuditValidationError(
        `Audit event contains accessor data at ${descriptorPath}; refusing to write audit log entry.`,
      );
    }

    if (typeof descriptor.value === 'function') {
      throw new AuditValidationError(`Audit event contains function data at ${descriptorPath}; refusing to write audit log entry.`);
    }

    if (typeof descriptorKey === 'symbol') {
      throw new AuditValidationError(`Audit event contains non-JSON data at ${descriptorPath}; refusing to write audit log entry.`);
    }

    if (!descriptor.enumerable) {
      continue;
    }

    canonical[descriptorKey] = canonicalizeAuditMetadata(descriptor.value, descriptorPath, seen);
  }

  seen.delete(value);
  return canonical;
}

function metadataPathSegment(key: string | symbol): string {
  if (typeof key === 'symbol') {
    return `[${String(key)}]`;
  }

  return /^(?:0|[1-9]\d*)$/u.test(key) ? `[${key}]` : `.${key}`;
}

function findSecretLikePathRecursive(
  value: unknown,
  path: string,
  key: string | undefined,
  seen: WeakSet<object>,
): string | undefined {
  if (isSensitiveKey(key)) {
    return path;
  }

  if (typeof value === 'string') {
    return looksLikeSecretValue(value) ? path : undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);
    for (const [index, item] of value.entries()) {
      const secretPath = findSecretLikePathRecursive(item, `${path}[${index.toString(10)}]`, undefined, seen);

      if (secretPath !== undefined) {
        return secretPath;
      }
    }

    seen.delete(value);
    return undefined;
  }

  if (isJsonPlainRecord(value)) {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const secretPath = findSecretLikePathRecursive(
        entryValue,
        `${path}.${entryKey}`,
        entryKey,
        seen,
      );

      if (secretPath !== undefined) {
        return secretPath;
      }
    }

    seen.delete(value);
  }

  return undefined;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isSensitiveKey(key: string | undefined): boolean {
  if (key === undefined) {
    return false;
  }

  return /(?:secret|token|authorization|password|api[_-]?key|private[_-]?key|cookie|session|credentials?)/iu.test(
    key,
  );
}

function looksLikeSecretValue(value: string): boolean {
  return /(?:shpat|shpca|shpss|shppa)_[A-Za-z0-9_-]+/iu.test(value) ||
    /\bya29\.[A-Za-z0-9._-]+\b/iu.test(value) ||
    /\bxox[a-z]-[A-Za-z0-9-]+\b/iu.test(value) ||
    /\bsk-[A-Za-z0-9_-]{10,}\b/iu.test(value) ||
    /^(?:Bearer|Basic)\s+\S+$/iu.test(value) ||
    /(?:^|[^\w])Basic\s+[A-Za-z0-9+/]{8,}={0,2}(?=$|[^\w+/=])/iu.test(value) ||
    /(?:Authorization|X-Shopify-Access-Token)\s*:\s*(?:(?:Bearer|Basic)\s+)?\S+/iu.test(value) ||
    /["']?(?:access[_-]?token|accessToken|client[_-]?secret|clientSecret|api[_-]?key|apiKey|private[_-]?key|privateKey)["']?\s*[=:]\s*["']?\S+/iu.test(value);
}

async function appendAuditLine(
  path: string,
  line: string,
  dependencies: AuditDependencies,
): Promise<void> {
  const open = dependencies.open ?? fsOpen;
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollowFlag();
  const handle = await open(path, flags, AUDIT_FILE_MODE);

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error(`Audit log path is not a regular file: ${path}`);
    }

    await chmodHandleIfSupported(handle, path, AUDIT_FILE_MODE, dependencies.chmod ?? fsChmod);
    await handle.writeFile(line, { encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
}

async function chmodHandleIfSupported(
  handle: Awaited<ReturnType<typeof fsOpen>>,
  path: string,
  mode: number,
  chmod: (path: string, mode: number) => Promise<void> | void,
): Promise<void> {
  if (typeof handle.chmod === 'function') {
    try {
      await handle.chmod(mode);
      return;
    } catch (error) {
      if (!isUnsupportedPermissionError(error)) {
        throw error;
      }
    }
  }

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
