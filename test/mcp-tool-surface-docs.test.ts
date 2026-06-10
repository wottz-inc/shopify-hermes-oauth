import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CAPABILITY_REGISTRY } from '../src/capabilities.js';
import { localHermesSkillContent } from '../src/cli.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function registryMcpToolNames(): string[] {
  const toolNames: string[] = [];
  for (const capability of CAPABILITY_REGISTRY) {
    if (capability.surfaces.mcp !== undefined) {
      toolNames.push(capability.surfaces.mcp.toolName);
    }
  }
  return toolNames;
}

const START_MARKER = '<!-- MCP_TOOL_SURFACE_START -->';
const END_MARKER = '<!-- MCP_TOOL_SURFACE_END -->';

function markedToolSurface(markdown: string): string {
  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER);
  expect(start, `missing ${START_MARKER}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${END_MARKER}`).toBeGreaterThan(start);
  return markdown.slice(start + START_MARKER.length, end);
}

function documentedToolNames(markdown: string): string[] {
  const toolNames: string[] = [];
  for (const match of markedToolSurface(markdown).matchAll(/`(shopify\.[a-z0-9_.]+)`/gu)) {
    const toolName = match[1];
    if (toolName !== undefined) {
      toolNames.push(toolName);
    }
  }
  return [...new Set(toolNames)].sort();
}

function expectDocumentedToolSurface(path: string): void {
  const documented = documentedToolNames(readRepoFile(path));
  expect(documented).toEqual([...registryMcpToolNames()].sort());
}

describe('documented MCP tool surfaces', () => {
  it('keeps SECURITY_REVIEW MCP tool names in sync with CAPABILITY_REGISTRY', () => {
    expectDocumentedToolSurface('docs/SECURITY_REVIEW.md');
  });

  it('keeps the repo Hermes skill MCP tool names in sync with CAPABILITY_REGISTRY', () => {
    expectDocumentedToolSurface('skills/productivity/shopify-hermes-oauth/SKILL.md');
  });

  it('keeps the embedded local Hermes skill MCP tool names in sync with CAPABILITY_REGISTRY', () => {
    const documented = documentedToolNames(localHermesSkillContent());
    expect(documented).toEqual([...registryMcpToolNames()].sort());
  });

  it('keeps critical MCP safety guardrails documented across security review and skills', () => {
    const securityReview = readRepoFile('docs/SECURITY_REVIEW.md');
    const repoSkill = readRepoFile('skills/productivity/shopify-hermes-oauth/SKILL.md');
    const embeddedSkill = localHermesSkillContent();

    for (const markdown of [securityReview, repoSkill, embeddedSkill]) {
      expect(markdown).toContain('protected customer data / analytics approval');
      expect(markdown).toContain('SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true');
    }

    expect(securityReview).toContain('No merchant-data write MCP tools are exposed');
    expect(securityReview).toContain('Bulk lifecycle tools use constrained Admin GraphQL mutations only to start/cancel curated read-only export templates');
    expect(repoSkill).toContain('Bulk: curated read-only export templates only');
    expect(repoSkill).toContain('no arbitrary GraphQL');
    expect(embeddedSkill).toContain('Bulk: curated read-only export templates only');
  });
});
