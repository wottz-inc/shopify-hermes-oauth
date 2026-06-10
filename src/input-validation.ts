const MAX_OPAQUE_CURSOR_LENGTH = 2048;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9+/=._:-]+$/u;
const GRAPHQL_LIKE_INPUT_PATTERN = /[{}]|\b(?:mutation|query)\b/iu;

export function isValidOpaqueCursor(value: string): boolean {
  return value.length > 0 && value.length <= MAX_OPAQUE_CURSOR_LENGTH && value.trim() === value && OPAQUE_CURSOR_PATTERN.test(value);
}

export function hasGraphqlLikeSearchSyntax(value: string): boolean {
  return GRAPHQL_LIKE_INPUT_PATTERN.test(value);
}
