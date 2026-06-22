# Curated ShopifyQL analytics reports

Issue #90 adds an optional curated ShopifyQL analytics MCP report surface. It is disabled by default and is not part of the least-privilege v0.1 install scope set.

## Tool

```text
shopify.analytics.shopifyql.summary
```

Inputs:

- `shop`: canonical `*.myshopify.com` shop domain.
- `report`: one of `sales_summary_by_period` or `top_products_by_sales`.
- `from` / `to`: inclusive `YYYY-MM-DD` date window.
- `granularity`: optional `day`, `week`, or `month` for `sales_summary_by_period`.
- `limit`: optional integer from 1 to 100.
- `format`: optional `markdown`, `json`, or `csv`.

No raw `query` argument is accepted, and arbitrary ShopifyQL text is rejected before a Shopify call is made.

## Required opt-in

Curated ShopifyQL analytics requires all of the following:

1. Configure the Shopify app with the additional Admin API scope `read_reports`.
2. Reinstall or re-authorize each affected shop after changing `SHOPIFY_HERMES_SCOPES` so the stored OAuth token actually includes `read_reports`.
3. Complete any required Shopify protected customer data / analytics approval for the app and shop. Shopify analytics/reporting fields may derive from customer/order data even when the connector returns only aggregate rows.
4. Set the explicit connector gate:

```bash
SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true
```

The gate is case-insensitive and ignores surrounding whitespace: `true`, `TRUE`, and ` true ` enable analytics. Other truthy-looking values such as `1`, `yes`, `on`, or `enabled` keep analytics disabled. Scope presence alone is not enough.

## Scope configuration example

Do not add `read_reports` to the default install unless this analytics surface is intentionally enabled for the deployment.

```bash
SHOPIFY_HERMES_SCOPES=read_products,read_orders,read_inventory,read_locations,read_reports
SHOPIFY_HERMES_ENABLE_ANALYTICS_REPORTS=true
```

Then restart the connector, reinstall/re-authorize the shop, and verify the stored shop token before calling the MCP report.

## Safety posture

- Native TypeScript only; no Python ShopifyQL package or subprocess is used.
- Hardcoded templates only; there is no raw ShopifyQL, raw GraphQL, or raw REST MCP escape hatch.
- Outputs are bounded and formatted as markdown/JSON/CSV.
- Parser errors, unsupported datasets/columns, throttles, missing `read_reports`, and disabled protected-data gate cases return safe guidance rather than raw provider payloads.
- Do not paste tokens, app secrets, raw ShopifyQL, or customer data into chat or logs.
- Do not use this surface for customer-level exports or small-cell PII analysis.
