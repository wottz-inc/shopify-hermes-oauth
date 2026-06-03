export const SAFE_ERROR_CODES = [
  'INVALID_API_VERSION',
  'INVALID_OPERATION_NAME',
  'NETWORK_ERROR',
  'INVALID_JSON',
  'HTTP_ERROR',
  'GRAPHQL_ERRORS',
  'INVALID_SHOP_METADATA',
  'OAUTH_INVALID_START',
  'OAUTH_INVALID_CALLBACK',
  'OAUTH_STALE_CALLBACK',
  'OAUTH_INVALID_HMAC',
  'OAUTH_MISSING_REQUIRED_SCOPES',
  'OAUTH_TOKEN_EXCHANGE_HTTP_ERROR',
  'OAUTH_TOKEN_EXCHANGE_INVALID_RESPONSE',
  'TOKEN_STORE_ERROR',
  'SHOP_VERIFICATION_MISSING_TOKEN',
  'SHOP_VERIFICATION_MISSING_SCOPES',
  'SHOP_VERIFICATION_ADMIN_ERROR',
  'MCP_TOOL_NOT_ALLOWED',
  'MCP_TOOL_CALL_FAILED',
] as const;

export type SafeErrorCode = typeof SAFE_ERROR_CODES[number];

export interface SafeOperationError extends Error {
  readonly code: SafeErrorCode;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export class SafeError extends Error implements SafeOperationError {
  public readonly code: SafeErrorCode;
  public readonly diagnostics?: Readonly<Record<string, unknown>>;

  public constructor(message: string, code: SafeErrorCode, diagnostics?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'SafeError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function safeErrorCode(error: unknown, fallback: SafeErrorCode): SafeErrorCode {
  return isSafeOperationError(error) ? error.code : fallback;
}

export function isSafeOperationError(error: unknown): error is SafeOperationError {
  const code = error instanceof Error ? (error as { readonly code?: unknown }).code : undefined;
  return typeof code === 'string' && (SAFE_ERROR_CODES as readonly string[]).includes(code);
}
