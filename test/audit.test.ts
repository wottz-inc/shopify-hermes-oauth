import { constants } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AuditSecretError, AuditValidationError, appendAuditEvent } from '../src/audit.js';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shopify-hermes-audit-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('JSONL audit writer', () => {
  class CustomMetadata {
    public readonly requestId = 'req_123';
  }

  it('appends one safe JSON object per line', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await appendAuditEvent(auditLog, {
      action: 'oauth.callback',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: { scopes: ['read_products'], requestId: 'req_123' },
    }, { now: () => new Date('2026-01-02T03:04:05.000Z') });
    await appendAuditEvent(auditLog, {
      action: 'token.refresh',
      shop: 'example.myshopify.com',
      result: 'failure',
      metadata: { reason: 'expired' },
    }, { now: () => new Date('2026-01-02T03:05:06.000Z') });

    const lines = (await readFile(auditLog, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        timestamp: '2026-01-02T03:04:05.000Z',
        action: 'oauth.callback',
        shop: 'example.myshopify.com',
        result: 'success',
        metadata: { scopes: ['read_products'], requestId: 'req_123' },
      },
      {
        timestamp: '2026-01-02T03:05:06.000Z',
        action: 'token.refresh',
        shop: 'example.myshopify.com',
        result: 'failure',
        metadata: { reason: 'expired' },
      },
    ]);
  });

  it('rejects secret-like audit payloads before writing any sensitive line', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const sensitiveToken = 'shpat_sensitive_token_value';

    await appendAuditEvent(auditLog, {
      action: 'oauth.start',
      shop: 'example.myshopify.com',
      result: 'success',
      metadata: { requestId: 'safe-request' },
    }, { now: () => new Date('2026-01-02T03:04:05.000Z') });

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        shop: 'example.myshopify.com',
        result: 'success',
        metadata: { accessToken: sensitiveToken },
      }),
    ).rejects.toThrow(AuditSecretError);

    const content = await readFile(auditLog, 'utf8');
    expect(content).not.toContain(sensitiveToken);
    expect(content.trimEnd().split('\n')).toHaveLength(1);
  });

  it('rejects bearer tokens even when the field name is not sensitive', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const bearerToken = 'Bearer abc.def.ghi';

    await expect(
      appendAuditEvent(auditLog, {
        action: 'debug',
        result: 'failure',
        metadata: { value: bearerToken },
      }),
    ).rejects.toThrow(AuditSecretError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['bare Google OAuth token', ['ya', '29.fake-opaque-token'].join('')],
    ['embedded Google OAuth token', ['upstream returned ya', '29.fake-opaque-token in body'].join('')],
    ['bare Slack token', ['xo', 'xb-fakeOpaqueToken'].join('')],
    ['embedded Slack token', ['upstream returned xo', 'xb-fakeOpaqueToken in body'].join('')],
    ['bare OpenAI API key', ['s', 'k-fakeOpaqueTokenValue'].join('')],
    ['embedded OpenAI API key', ['upstream returned s', 'k-fakeOpaqueTokenValue in body'].join('')],
    ['bare Basic credential', ['Basic', ' ZmFrZVVzZXI6ZmFrZVBhc3N3b3Jk'].join('')],
    ['embedded Basic credential', ['upstream returned Basic', ' ZmFrZVVzZXI6ZmFrZVBhc3N3b3Jk'].join('')],
  ] as const)('rejects widened secret patterns in safe-looking metadata values: %s', async (_name, value) => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await expect(
      appendAuditEvent(auditLog, {
        action: 'debug',
        result: 'failure',
        metadata: { value },
      }),
    ).rejects.toThrow(AuditSecretError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects embedded Shopify token substrings even when the field name is not sensitive', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const embeddedToken = 'upstream error included shpat_real_token_value';

    await expect(
      appendAuditEvent(auditLog, {
        action: 'debug',
        result: 'failure',
        metadata: { value: embeddedToken },
      }),
    ).rejects.toThrow(AuditSecretError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects serialized JSON-like secret keys even when the field name is not sensitive', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const serializedSecret = '{ "clientSecret":"super-secret", "accessToken":"opaque-session-value" }';

    await expect(
      appendAuditEvent(auditLog, {
        action: 'debug',
        result: 'failure',
        metadata: { value: serializedSecret },
      }),
    ).rejects.toThrow(AuditSecretError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects authorization header strings even when the field name is not sensitive', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const headerValue = 'X-Shopify-Access-Token: shpat_header_value_must_not_leak';

    await expect(
      appendAuditEvent(auditLog, {
        action: 'debug',
        result: 'failure',
        metadata: { value: headerValue },
      }),
    ).rejects.toThrow(AuditSecretError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects metadata with toJSON functions before secret-like serialized data can bypass scanning', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const sensitiveToken = 'shpat_hidden_by_to_json';

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        result: 'success',
        metadata: {
          requestId: 'req_123',
          toJSON: () => ({ accessToken: sensitiveToken }),
        },
      }),
    ).rejects.toThrow(AuditValidationError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects accessor metadata before getters can leak secrets during final stringify', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const leakedBearer = 'Bearer leaked.secret';
    let readCount = 0;
    const metadata = {
      requestId: 'req_123',
      get value(): string {
        readCount += 1;
        return readCount < 3 ? 'safe-value' : leakedBearer;
      },
    };

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        result: 'success',
        metadata,
      }),
    ).rejects.toThrow(AuditValidationError);

    expect(readCount).toBe(0);
    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects nested accessor metadata before getters can leak Shopify tokens during stringify', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const leakedToken = 'shpat_hidden_accessor_token';
    const nested: Record<string, unknown> = { safe: true };
    Object.defineProperty(nested, 'value', {
      enumerable: true,
      get: () => leakedToken,
    });

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        result: 'success',
        metadata: { nested },
      }),
    ).rejects.toThrow(AuditValidationError);

    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects top-level metadata accessors before TOCTOU metadata can leak during stringify', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const leakedToken = 'shpat_top_level_toctou_token';
    let metadataReadCount = 0;
    let nestedReadCount = 0;
    const maliciousMetadata: Record<string, unknown> = { requestId: 'req_123' };
    Object.defineProperty(maliciousMetadata, 'value', {
      enumerable: true,
      get: () => {
        nestedReadCount += 1;
        return nestedReadCount < 2 ? 'safe-value' : leakedToken;
      },
    });
    const event = {
      action: 'oauth.callback',
      result: 'success' as const,
      get metadata(): Record<string, unknown> {
        metadataReadCount += 1;
        return metadataReadCount === 1 ? { requestId: 'safe-request' } : maliciousMetadata;
      },
    };

    await expect(appendAuditEvent(auditLog, event)).rejects.toThrow(AuditValidationError);

    expect(metadataReadCount).toBe(0);
    expect(nestedReadCount).toBe(0);
    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not allow runtime callers to override generated timestamps or add top-level fields', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await appendAuditEvent(auditLog, {
      action: 'oauth.callback',
      result: 'success',
      timestamp: '1999-01-01T00:00:00.000Z',
      injected: true,
    } as unknown as Parameters<typeof appendAuditEvent>[1], { now: () => new Date('2026-01-02T03:04:05.000Z') });

    const record = JSON.parse(await readFile(auditLog, 'utf8')) as Record<string, unknown>;
    expect(record).toEqual({
      timestamp: '2026-01-02T03:04:05.000Z',
      action: 'oauth.callback',
      result: 'success',
    });
  });

  it.each([
    ['empty action', { action: '', result: 'success' }],
    ['non-string action', { action: 123, result: 'success' }],
    ['invalid result', { action: 'oauth.callback', result: 'ok' }],
    ['non-string shop', { action: 'oauth.callback', result: 'success', shop: 123 }],
    ['non-object metadata', { action: 'oauth.callback', result: 'success', metadata: 'request' }],
    ['array metadata', { action: 'oauth.callback', result: 'success', metadata: [] }],
    ['Date metadata', { action: 'oauth.callback', result: 'success', metadata: new Date('2026-01-02T03:04:05.000Z') }],
    ['Map metadata', { action: 'oauth.callback', result: 'success', metadata: new Map([['requestId', 'req_123']]) }],
    ['class instance metadata', { action: 'oauth.callback', result: 'success', metadata: new CustomMetadata() }],
  ])('rejects invalid audit input: %s', async (_caseName, event) => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await expect(
      appendAuditEvent(auditLog, event as unknown as Parameters<typeof appendAuditEvent>[1]),
    ).rejects.toThrow(AuditValidationError);
    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['Date nested metadata', { createdAt: new Date('2026-01-02T03:04:05.000Z') }],
    ['Map nested metadata', { details: new Map([['requestId', 'req_123']]) }],
    ['Set nested metadata', { details: new Set(['req_123']) }],
    ['class instance nested metadata', { details: new CustomMetadata() }],
    ['Date in array metadata', { details: [new Date('2026-01-02T03:04:05.000Z')] }],
  ])('rejects non-plain object metadata values: %s', async (_caseName, metadata) => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        result: 'success',
        metadata,
      }),
    ).rejects.toThrow(AuditValidationError);
    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects circular metadata cleanly without overflowing secret scanning', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');
    const metadata: Record<string, unknown> = { requestId: 'req_123' };
    metadata.self = metadata;

    await expect(
      appendAuditEvent(auditLog, {
        action: 'oauth.callback',
        result: 'success',
        metadata,
      }),
    ).rejects.toThrow(AuditValidationError);
    await expect(readFile(auditLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlink audit paths instead of following them when the platform supports it', async () => {
    if (typeof constants.O_NOFOLLOW !== 'number') {
      return;
    }

    const root = await makeTempRoot();
    const target = join(root, 'target.jsonl');
    const auditLog = join(root, 'audit.jsonl');
    try {
      await symlink(target, auditLog);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['ENOSYS', 'ENOTSUP', 'EPERM'].includes(String(error.code))) {
        return;
      }

      throw error;
    }

    await appendAuditEvent(auditLog, { action: 'oauth.callback', result: 'success' }).then(
      () => {
        throw new Error('Expected symlink audit path to be rejected.');
      },
      (error: unknown) => {
        expect(error).toMatchObject({ code: expect.stringMatching(/^(?:ELOOP|EINVAL)$/u) as unknown });
      },
    );
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates audit files with mode 0600 and corrects permissive existing files', async () => {
    const root = await makeTempRoot();
    const auditLog = join(root, 'audit.jsonl');

    await appendAuditEvent(auditLog, { action: 'oauth.start', result: 'success' });
    expect((await stat(auditLog)).mode & 0o777).toBe(0o600);

    await chmod(auditLog, 0o666);
    await appendAuditEvent(auditLog, { action: 'oauth.callback', result: 'success' });
    expect((await stat(auditLog)).mode & 0o777).toBe(0o600);
  });
});
