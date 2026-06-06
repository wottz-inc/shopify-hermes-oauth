# M8 B2B and retail Admin GraphQL coverage evaluation

Issue #75 evaluates whether Shopify B2B and retail/POS Admin GraphQL surfaces should become curated Hermes MCP tools. This is a research/design closeout, not a raw GraphQL expansion.

## Guardrails

- Keep the default surface curated; do not add an unrestricted raw GraphQL MCP tool.
- Prefer read-only summaries with bounded pagination and explicit scope checks.
- Do not add B2B, POS, checkout, catalog, price-list, cash-drawer, staff, or fulfillment writes here.
- Do not expose customer/contact PII, staff PII, full variant price exports, theme assets, raw order/customer identifiers, adjustment notes, OAuth callback data, tokens, or app secrets.
- Unsupported-shop behavior must be structured and safe: distinguish missing scope, plan/feature unavailability, and permission limitations without returning raw provider errors.

## B2B Admin GraphQL findings

Shopify exposes B2B resources through Admin GraphQL, but they are optional-shop/plan capabilities rather than universal merchant resources.

Primary docs:

- [`Company`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Company) and [`companies`](https://shopify.dev/docs/api/admin-graphql/latest/queries/companies)
- [`CompanyLocation`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CompanyLocation) and [`companyLocations`](https://shopify.dev/docs/api/admin-graphql/latest/queries/companyLocations)
- [`CompanyContact`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CompanyContact) and [`CompanyContactRole`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CompanyContactRole)
- [`Catalog`](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Catalog), [`catalogs`](https://shopify.dev/docs/api/admin-graphql/latest/queries/catalogs), and [`CompanyLocationCatalog`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CompanyLocationCatalog)
- [`PriceList`](https://shopify.dev/docs/api/admin-graphql/latest/objects/PriceList) and [`priceLists`](https://shopify.dev/docs/api/admin-graphql/latest/queries/priceLists)
- [`Order.purchasingEntity`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [`PurchasingEntity`](https://shopify.dev/docs/api/admin-graphql/latest/unions/PurchasingEntity), and [`PurchasingCompany`](https://shopify.dev/docs/api/admin-graphql/latest/objects/PurchasingCompany)
- [B2B app requirements](https://shopify.dev/docs/apps/build/b2b)

### Scopes and plan constraints

- Companies and company locations require `read_companies` or `read_customers`; prefer `read_companies` for B2B tools to avoid broad customer-data coupling.
- Company contacts map to customer records and are PII-adjacent; avoid expanding contacts by default.
- Company-location catalogs and price lists require `read_products` plus catalog/company permissions.
- Market catalog context may also intersect with existing `read_markets` tooling; do not duplicate the existing markets/localization surface.
- B2B resources are not available to every shop. Shopify documents B2B plan/app constraints; tools must return a safe unavailable/unsupported status when a shop lacks B2B access.

### Recommended B2B workflows

Create follow-up implementation issue #122 only for optional, scoped, read-only B2B summaries:

1. `shopify.b2b.companies.summary`
   - Purpose: show whether B2B is available and summarize companies/locations.
   - Safe fields: company ID/name, company/location counts, location ID/name.
   - Omit: contact names/emails/phones, addresses, notes, tags, customer profiles, raw contact/customer records.
   - Scopes: `read_companies`; catalog assignment summaries stay in the separate catalog tool because they can require catalog/product permissions.

2. `shopify.b2b.catalogs.summary`
   - Purpose: summarize B2B company-location catalogs and price lists.
   - Safe fields: catalog ID/title/status/type, company-location assignment count, price-list ID/name/currency/fixed-price count.
   - Omit: full product lists, full variant price exports, quantity-rule dumps.
   - Scopes: `read_products`; possibly `read_companies` when joining company-location context.

3. Existing order tools may later expose B2B attribution from `Order.purchasingEntity`.
   - Safe fields: purchasing entity type, company ID/name, company-location ID/name, contact presence.
   - Omit: contact/customer name, email, phone, addresses, notes, tags, and raw customer profile expansion.
   - Scopes: existing `read_orders`, plus soft handling if Shopify requires company/customer access for nested attribution.

### B2B unsupported-shop behavior

Return structured safe statuses such as:

- `missing_scope` for absent `read_companies` / `read_products`.
- `b2b_unavailable` when Shopify rejects B2B fields because the shop/app/plan lacks B2B access.
- `catalog_permission_required` when catalog permissions are unavailable.

Do not include raw GraphQL error text, token-store contents, OAuth data, or PII in these responses.

## Retail / POS Admin GraphQL findings

Retail/POS coverage overlaps heavily with existing safe Admin Graph surfaces.

Primary docs:

- [`Location`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Location) and [`locations`](https://shopify.dev/docs/api/admin-graphql/latest/queries/locations)
- [`InventoryLevel`](https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryLevel), [`inventoryItems`](https://shopify.dev/docs/api/admin-graphql/latest/queries/inventoryItems), and [`inventoryLevel`](https://shopify.dev/docs/api/admin-graphql/latest/queries/inventoryLevel)
- [`FulfillmentOrder`](https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder) and [`fulfillmentOrders`](https://shopify.dev/docs/api/admin-graphql/latest/queries/fulfillmentOrders)
- [`Order`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [`orders`](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [`OrderApp`](https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderApp), and [`ChannelInformation`](https://shopify.dev/docs/api/admin-graphql/latest/objects/ChannelInformation)
- [`CashTrackingSession`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CashTrackingSession), [`cashTrackingSessions`](https://shopify.dev/docs/api/admin-graphql/latest/queries/cashTrackingSessions), and [`CashTrackingAdjustment`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CashTrackingAdjustment)
- [`StaffMember`](https://shopify.dev/docs/api/admin-graphql/latest/objects/StaffMember), [`staffMembers`](https://shopify.dev/docs/api/admin-graphql/latest/queries/staffMembers), and [`staffMember`](https://shopify.dev/docs/api/admin-graphql/latest/queries/staffMember)

### Already covered / no new issue needed

- Locations and retail inventory are already covered by `shopify.locations.list`, `shopify.locations.get`, `shopify.inventory.items.get`, `shopify.inventory.levels.list`, and `shopify.report_inventory`.
- Retail fulfillment is already covered by `shopify.fulfillment_orders.list/get`.
- POS order/channel questions are possible through Admin GraphQL order source/channel/location fields and filters, but the current curated order report/detail tools do not expose POS source/location filtering; treat this as a possible future order-tool enhancement, not current connector coverage.

### Keep out of default scope

- Staff/POS staff should remain out of default scope because `StaffMember` requires `read_users`, has plan/support gates, and exposes staff PII such as email, phone, name, avatar, locale, and account status.
- If staff is ever implemented, it should be a separate high-sensitivity issue with aggregate-only output and no staff names/emails/phones/private data.

### Optional POS candidate only if merchant demand exists

`shopify.pos.cash_sessions.summary` is the only clearly POS-specific future candidate.

- Scope: `read_cash_tracking`, optionally `read_locations`.
- Plan/feature gate: POS Pro cash-tracking locations.
- Safe fields: session ID/status, location ID/name, register name, opening/closing timestamps, opening/closing/expected balances, cash sales/refunds/adjustments/discrepancy totals.
- Omit: staff identity, adjustment notes, cash transaction details, order/customer identifiers, raw transaction payloads.
- Behavior: missing `read_cash_tracking` returns `missing_scope`; no POS Pro sessions returns a supported empty result plus limitation; unavailable feature returns `cash_tracking_unavailable` without raw errors.

## Recommendation

- Do not add B2B or retail/POS resources to the default connector scopes for v0.1.
- Create one B2B implementation follow-up if optional B2B support is desired: read-only company/location/catalog summaries plus B2B order attribution.
- Defer POS cash-session tooling unless a merchant explicitly needs POS Pro cash reconciliation; document it as an optional future candidate rather than implementing it now.
- Close #75 as an evaluation issue once this document is merged and linked from the README.
