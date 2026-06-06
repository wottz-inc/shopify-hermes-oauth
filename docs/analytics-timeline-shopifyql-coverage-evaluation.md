# M8 analytics, timeline events, and ShopifyQL coverage evaluation

Issue #77 evaluates whether analytics, Admin timeline events, and ShopifyQL should be implemented for `shopify-hermes-oauth`. This is a research/decision note; no analytics extraction, event tooling, raw GraphQL/REST/ShopifyQL, or new MCP surface is implemented here.

## Decision

- **Implement later:** curated Admin GraphQL activity/timeline events for products/product variants and bounded order lifecycle events.
- **Defer:** customer activity, merchant comment events, arbitrary resource timelines, and webhook-backed historical activity stores.
- **Use #90 for ShopifyQL implementation:** ShopifyQL is feasible only as optional template-only reports behind an explicit protected-data gate; do not expose raw ShopifyQL input.
- **Out of scope:** unrestricted raw GraphQL/REST MCP, arbitrary ShopifyQL query editor, Python ShopifyQL subprocess/package integration, customer-level analytics exports, and raw timeline/comment/event payload dumps.

## ShopifyQL / analytics findings

Primary docs:

- [`shopifyqlQuery`](https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery)
- [ShopifyQL reference](https://shopify.dev/docs/api/shopifyql)
- [ShopifyQL through GraphQL Admin API](https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api)
- [ShopifyQL overview](https://shopify.dev/docs/apps/build/shopifyql)
- [Admin API access scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)

### ShopifyQL feasibility

`shopifyqlQuery` is technically feasible but high-risk for a default agent connector.

- Required scopes/gates: `read_reports`; Shopify docs also require Level 2 protected customer data access for analytics/reporting fields that may include customer name, address, phone, email, or customer-derived dimensions. Customer-data ShopifyQL may also require `read_customers`.
- Response shape: table columns with data types plus JSON rows and parse errors.
- Rate limits: separate ShopifyQL complexity throttling; docs describe HTTP 429 and a 60-second timer.
- API limitation: no public Admin GraphQL metadata endpoint for listing all available ShopifyQL datasets/columns before query execution.
- Safe design consequence: no arbitrary ShopifyQL input; use hardcoded templates only.

### Candidate ShopifyQL reports for #90

These are candidates for issue #90, not implemented in #77:

1. Sales summary by period
   - Scope/gate: `read_reports` + explicit protected-data gate.
   - Inputs: date window and day/week/month granularity only.
   - Limits: cap date range; aggregate metrics only; no customer fields.

2. Top products by sales
   - Scope/gate: `read_reports` + explicit protected-data gate.
   - Inputs: date window and limit, capped at 10/25.
   - Limits: product/title aggregates only; no customer dimensions.

3. Sales by region
   - Scope/gate: `read_reports` + explicit protected-data gate.
   - Privacy limitation: geography derives from order/customer data; aggregate only and avoid small-cell disclosure where possible.

4. Storefront conversion/product funnel
   - Scope/gate: `read_reports` + explicit protected-data gate.
   - Limitation: session and customer-event availability may vary by shop/plan/reporting history.

5. Customer acquisition trends
   - Decision: defer beyond first ShopifyQL implementation.
   - Scope/gate: likely `read_reports`, `read_customers`, and protected customer data approval.
   - Reason: direct customer dataset use raises PII/PCD risk.

### ShopifyQL guardrails

- Keep `read_reports` out of default scopes.
- Require an explicit connector config gate such as a protected-data/analytics opt-in, not just scope presence.
- Use native TypeScript and the existing Admin GraphQL client; do not add Python ShopifyQL runtime dependencies or subprocesses.
- Allow only hardcoded query templates with parameterized date/granularity/limit inputs.
- Cap date windows, metrics, dimensions, and result limits.
- Treat `parseErrors`, 429/complexity throttles, unsupported columns/datasets, empty analytics, and missing protected-data approval as structured safe statuses.
- Never log query results that could contain customer/order PII.
- Keep CSV formula neutralization if tabular exports are added.

## Admin timeline / events findings

Primary docs:

- [`events`](https://shopify.dev/docs/api/admin-graphql/latest/queries/events)
- [`Event`](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Event)
- [`HasEvents`](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/HasEvents)
- [`BasicEvent`](https://shopify.dev/docs/api/admin-graphql/latest/objects/BasicEvent)
- [`CommentEvent`](https://shopify.dev/docs/api/admin-graphql/latest/objects/CommentEvent)
- [`EventSortKeys`](https://shopify.dev/docs/api/admin-graphql/latest/enums/EventSortKeys)
- [`EventSubjectType`](https://shopify.dev/docs/api/admin-graphql/latest/enums/EventSubjectType)
- [`Order`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)
- [`Product`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product)
- [`Customer`](https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer)
- [`StaffMember`](https://shopify.dev/docs/api/admin-graphql/latest/objects/StaffMember)
- [`WebhookSubscriptionTopic`](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic)

### Event availability and limits

Admin GraphQL exposes a global `events` query and resource-level `HasEvents.events` connections. Events chronicle store activity and are retained for **1 year**.

Relevant filters/sort:

- Filters: `action`, `comments`, `created_at`, `id`, `subject_type`.
- Sort keys: `CREATED_AT`, `ID`.
- Implementations: `BasicEvent` and `CommentEvent`.

Safer fields:

- `id`, `createdAt`, `action`, `appTitle`, `attributeToApp`, `attributeToUser`, `criticalAlert`, `subjectType`, `subjectId`, pagination metadata.
- Formatted event `message` text is omitted by default because it can contain customer names, staff names, comments, notes, or merchant-authored freeform text; expose it only through a separate opt-in after sanitization/redaction.

Avoid by default:

- `additionalContent`, `additionalData`, `arguments`, `rawMessage`, `attachments`, `embed`, `author`, nested `subject`, freeform comments, and staff attribution.

### Candidate Admin GraphQL event reports

1. Product activity events
   - Recommendation: implement later.
   - Required scope: `read_products`.
   - Subject types: `PRODUCT`, `PRODUCT_VARIANT`.
   - Useful for product creation/update/publication/activity audits.
   - Risk: lower PII than order/customer events, but message is still formatted/freeform and should be treated as sensitive.

2. Order activity events
   - Recommendation: implement later, bounded.
   - Required scope: `read_orders`; optional `read_all_orders` only if Shopify grants older-order access.
   - Limitation: order object access is normally limited to the last 60 days without `read_all_orders`, while event retention is 1 year.
   - Omit customer identity, addresses, notes/tags, raw comments, nested order subject, and staff attribution.

3. Customer activity events
   - Recommendation: defer.
   - Required scope/gate: `read_customers` plus protected customer data review.
   - Prefer aggregate counts by action/day if ever implemented, not raw customer event rows.

4. Arbitrary `HasEvents` GID timeline
   - Recommendation: defer.
   - Reason: generic resource timelines can become a raw-GraphQL-like escape hatch unless strictly allowlisted by subject type and scope.

5. Comment events / merchant timeline comments
   - Recommendation: defer.
   - Reason: `CommentEvent` can expose freeform merchant comments, attachments, raw messages, embeds, and staff author data. Staff author data may require `read_users`, which is plan/support gated and PII-heavy.

6. Webhook-backed activity log
   - Recommendation: defer/separate design.
   - Reason: webhooks are forward-looking, operationally heavier, need HMAC/retry/persistence/privacy-retention design, and do not replace historical Admin event search.

## Recommended future event tool shape

If implemented, start with one curated MCP tool/report:

```text
shopify.activity.events
```

Inputs:

- `from` / `to` or `since`, with date-window caps.
- `subjectTypes`: allowlist initially `ORDER`, `PRODUCT`, `PRODUCT_VARIANT`.
- optional `actions` allowlist.
- `includeComments`: default `false`.
- `first`: default 25, cap 100.
- `after`: cursor.

Scope validation:

- `ORDER` requires `read_orders`.
- `PRODUCT` / `PRODUCT_VARIANT` require `read_products`.
- Reject `CUSTOMER` unless a separate customer-activity issue adds `read_customers` and protected customer data guardrails.

Safe output fields:

- `id`, `createdAt`, `action`, `subjectType`, `subjectId`, `appTitle`, `attributeToApp`, `attributeToUser`, `criticalAlert`, and pagination metadata.
- `message` / formatted event text remains omitted by default; any future opt-in must redact comments, staff names, customer names, emails, phone numbers, addresses, order notes, tags, and other freeform merchant text.

## Follow-up issues

- Use #90 for optional curated ShopifyQL analytics reports behind a protected-data gate.
- Create a separate future implementation issue only if activity events are prioritized: curated `shopify.activity.events` for product/product-variant and bounded order activity.

Close #77 as an evaluation issue once this note is merged.
