# Optional curated B2B summaries

Issue #122 adds two optional, read-only MCP tools for Shopify B2B visibility:

```text
shopify.b2b.companies.summary
shopify.b2b.catalogs.summary
```

These tools are deliberately curated summaries. They do not expose raw GraphQL, raw REST, mutations, payment-terms writes, catalog assignment writes, price-list changes, contact/customer exports, or PII dumps.

## Tools and scopes

### `shopify.b2b.companies.summary`

- Required scope: `read_companies`.
- Bounded query: companies capped at 25; company locations capped at 10 per company.
- Safe fields: company ID/name, company location count, and location ID/name. Catalog assignment counts stay in the separate catalog summary surface because catalog fields can require product/catalog permissions.
- Omitted fields: contact names/emails/phones, addresses, notes/tags, customer profiles, raw contact/customer records, payment terms details.

### `shopify.b2b.catalogs.summary`

- Required scope: `read_products` (catalog and price-list visibility may also depend on the shop/app B2B catalog permissions).
- Bounded query: catalogs capped at 25; price lists capped at 25.
- Safe fields: catalog ID/title/status/type, company-location assignment count, price-list ID/name/currency/fixed-price count.
- Omitted fields: full product lists, full variant price exports, quantity-rule dumps, catalog assignment writes, price-list changes.

Do not add these scopes to the default install unless the deployment intentionally needs B2B summaries. After changing `SHOPIFY_HERMES_SCOPES`, reinstall or re-authorize each affected shop so the stored OAuth token includes the new scopes.

## Structured unsupported statuses

The tools fail closed with structured, safe statuses rather than raw provider payloads:

- `missing_scope`: stored token lacks `read_companies` for company summaries.
- `b2b_unavailable`: Shopify rejects company fields because B2B is not available for the shop/app/plan.
- `catalog_permission_required`: stored token lacks `read_products`, or Shopify rejects catalog/price-list fields due to catalog/B2B permissions.

Responses include a `pii.redactedFields` reminder and never include OAuth tokens, raw GraphQL errors, contact/customer records, addresses, notes, tags, full products, full variant prices, or quantity-rule details.
