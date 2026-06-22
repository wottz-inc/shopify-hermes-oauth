import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { localHermesSkillContent } from '../src/cli.js';
import { version } from '../src/index.js';
import { startStdioMcpServer, type McpServerDependencies } from '../src/mcp/server.js';
import { packageVersion } from '../src/version.js';

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { readonly version?: unknown };
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }
  return packageJson.version;
}

function frontmatterVersion(markdown: string): string {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/u.exec(markdown);
  if (!frontmatterMatch?.[1]) {
    throw new Error('skill content must include YAML frontmatter');
  }
  const versionMatch = /^version:\s*(.+)$/mu.exec(frontmatterMatch[1]);
  if (!versionMatch?.[1]) {
    throw new Error('skill frontmatter must include a version');
  }
  return versionMatch[1].trim().replace(/^["']|["']$/gu, '');
}

function proposedSkillContent(markdown: string): string {
  const match = /```markdown\n(---\n[\s\S]*?\n---[\s\S]*?)\n```/u.exec(markdown);
  if (!match?.[1]) {
    throw new Error('upstream proposal doc must include a fenced markdown SKILL.md block');
  }
  return match[1];
}

describe('single-source package version', () => {
  it('uses package.json for runtime exports and skill frontmatter', () => {
    const expectedVersion = readPackageVersion();
    const repoSkill = readFileSync(new URL('../skills/productivity/shopify-hermes-oauth/SKILL.md', import.meta.url), 'utf8');
    const upstreamSkillProposal = readFileSync(new URL('../docs/UPSTREAM_HERMES_OPTIONAL_SKILL_PR.md', import.meta.url), 'utf8');

    expect(packageVersion).toBe(expectedVersion);
    expect(version).toBe(expectedVersion);
    expect(frontmatterVersion(localHermesSkillContent())).toBe(expectedVersion);
    expect(frontmatterVersion(repoSkill)).toBe(expectedVersion);
    expect(frontmatterVersion(proposedSkillContent(upstreamSkillProposal))).toBe(expectedVersion);
  });

  it('keeps the checked-in concise repo skill within its upstream size guard', () => {
    const repoSkill = readFileSync(new URL('../skills/productivity/shopify-hermes-oauth/SKILL.md', import.meta.url), 'utf8');

    expect(repoSkill.length).toBeLessThan(6000);
  });

  it('reports package.json version in MCP initialize serverInfo', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((value) => value.length > 0)) {
        lines.push(JSON.parse(line) as unknown);
      }
    });

    const server = startStdioMcpServer({} as McpServerDependencies, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);
    input.end();
    await server;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: {
          name: 'shopify-hermes-oauth',
          version: readPackageVersion(),
        },
      },
    });
  });
});
