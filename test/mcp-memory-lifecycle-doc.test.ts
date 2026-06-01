import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readText(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('MCP memory lifecycle investigation doc', () => {
  it('records the Shopify MCP child-process boundary and reconnect diagnostics for issue #60', async () => {
    const doc = await readText('docs/mcp-memory-lifecycle.md');

    for (const expected of [
      'Issue #60',
      'Hermes gateway owns MCP child process spawn, keepalive, reconnect, and force-kill policy',
      'the Shopify MCP server does not spawn nested MCP child processes',
      'shopify.health',
      'mcp.stdio.start',
      'mcp.stdio.stop',
      'stderr',
      'JSON-RPC stdout',
      'lifetimeMs',
      'reason',
      'repeated stdio start/stop churn',
      'no token-store contents',
    ]) {
      expect(doc).toContain(expected);
    }

    expect(doc).not.toMatch(/shpat_[a-z0-9_]+/iu);
    expect(doc).not.toMatch(/SHOPIFY_HERMES_CLIENT_SECRET\s*=\s*[^\s<]/iu);
  });
});
