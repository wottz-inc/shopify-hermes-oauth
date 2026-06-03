import { describe, expect, it } from 'vitest';

import { SafeError, isSafeOperationError, safeErrorCode } from '../src/safe-errors.js';

describe('safe error codes', () => {
  it('only treats allowlisted internal error codes as safe operation errors', () => {
    const safe = new SafeError('No stored OAuth token found.', 'SHOP_VERIFICATION_MISSING_TOKEN');
    const nodeLikeError = Object.assign(new Error('connection reset with implementation details'), { code: 'ECONNRESET' });

    expect(isSafeOperationError(safe)).toBe(true);
    expect(safeErrorCode(safe, 'MCP_TOOL_CALL_FAILED')).toBe('SHOP_VERIFICATION_MISSING_TOKEN');
    expect(isSafeOperationError(nodeLikeError)).toBe(false);
    expect(safeErrorCode(nodeLikeError, 'MCP_TOOL_CALL_FAILED')).toBe('MCP_TOOL_CALL_FAILED');
  });
});
