export type ShopifyScopeInput = readonly string[] | string;

export interface ShopifyScopeComparison {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

export class MissingShopifyScopesError extends Error {
  public readonly shop: string;
  public readonly missingScopes: readonly string[];

  public constructor(shop: string, missingScopesInput: ShopifyScopeInput) {
    const missingScopes = normalizeShopifyScopes(missingScopesInput);
    super(formatMissingShopifyScopesMessage(shop, missingScopes));
    this.name = 'MissingShopifyScopesError';
    this.shop = shop;
    this.missingScopes = missingScopes;
  }
}

export function normalizeShopifyScopes(input: ShopifyScopeInput): readonly string[] {
  const rawScopes = typeof input === 'string' ? input.split(',') : input;
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawScope of rawScopes) {
    const scope = rawScope.trim().toLowerCase();

    if (scope.length === 0 || seen.has(scope)) {
      continue;
    }

    normalized.push(scope);
    seen.add(scope);
  }

  return normalized;
}

export function shopifyScopeSatisfies(grantedScopeInput: string, requiredScopeInput: string): boolean {
  const grantedScope = grantedScopeInput.trim().toLowerCase();
  const requiredScope = requiredScopeInput.trim().toLowerCase();

  if (grantedScope === requiredScope) {
    return true;
  }

  if (!requiredScope.startsWith('read_')) {
    return false;
  }

  return grantedScope === `write_${requiredScope.slice('read_'.length)}`;
}

export function missingShopifyScopes(grantedScopesInput: ShopifyScopeInput, requiredScopesInput: ShopifyScopeInput): readonly string[] {
  const grantedScopes = normalizeShopifyScopes(grantedScopesInput);
  const requiredScopes = normalizeShopifyScopes(requiredScopesInput);

  return requiredScopes.filter((requiredScope) => !grantedScopes.some((grantedScope) => shopifyScopeSatisfies(grantedScope, requiredScope)));
}

export function extraShopifyScopes(grantedScopesInput: ShopifyScopeInput, configuredScopesInput: ShopifyScopeInput): readonly string[] {
  const grantedScopes = normalizeShopifyScopes(grantedScopesInput);
  const configuredScopes = normalizeShopifyScopes(configuredScopesInput);

  return grantedScopes.filter((grantedScope) => !configuredScopes.some((configuredScope) => shopifyScopeSatisfies(configuredScope, grantedScope)));
}

export function compareShopifyScopes(options: {
  readonly granted: ShopifyScopeInput;
  readonly configured: ShopifyScopeInput;
}): ShopifyScopeComparison {
  return {
    missing: missingShopifyScopes(options.granted, options.configured),
    extra: extraShopifyScopes(options.granted, options.configured),
  };
}

export function formatMissingShopifyScopesMessage(shop: string, missingScopesInput: ShopifyScopeInput): string {
  const missingScopes = normalizeShopifyScopes(missingScopesInput);
  const plural = missingScopes.length === 1 ? 'scope' : 'scopes';

  return `Stored OAuth token for ${shop} is missing required Shopify Admin API ${plural}: ${missingScopes.join(', ')}. Reinstall or re-authorize the shop after configuring SHOPIFY_HERMES_SCOPES to include the required read-only scopes; do not paste tokens or secrets into chat.`;
}
