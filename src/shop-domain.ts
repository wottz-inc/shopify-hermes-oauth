const INVALID_SHOP_DOMAIN_MESSAGE = 'Invalid Shopify shop domain';
const MYSHOPIFY_SUFFIX = '.myshopify.com';
const MAX_LABEL_LENGTH = 63;
const SHOP_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class ShopDomainValidationError extends Error {
  public constructor() {
    super(INVALID_SHOP_DOMAIN_MESSAGE);
    this.name = 'ShopDomainValidationError';
  }
}

export function normalizeShopDomain(input: string): string {
  assertShopDomainInput(input);

  if (!isAsciiPrintable(input)) {
    throw new ShopDomainValidationError();
  }

  const normalized = input.toLowerCase();

  if (normalized.includes('://') || /[/?#\\]/u.test(normalized) || /\s/u.test(normalized)) {
    throw new ShopDomainValidationError();
  }

  if (!normalized.endsWith(MYSHOPIFY_SUFFIX)) {
    throw new ShopDomainValidationError();
  }

  const shopLabel = normalized.slice(0, -MYSHOPIFY_SUFFIX.length);

  if (
    shopLabel.length === 0 ||
    shopLabel.length > MAX_LABEL_LENGTH ||
    shopLabel.includes('.') ||
    !SHOP_LABEL_PATTERN.test(shopLabel)
  ) {
    throw new ShopDomainValidationError();
  }

  return normalized;
}

function assertShopDomainInput(input: unknown): asserts input is string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ShopDomainValidationError();
  }
}

function isAsciiPrintable(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) {
      return false;
    }
  }

  return true;
}
