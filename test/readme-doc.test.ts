import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');

function readReadme(): string {
  return readFileSync(readmePath, 'utf8');
}

function expectAllPresent(markdown: string, requiredSnippets: readonly string[]): void {
  for (const required of requiredSnippets) {
    expect(markdown).toContain(required);
  }
}

// SAFETY-CRITICAL documentation tests are non-negotiable guardrails. If one of
// these fails after a copy edit, update the documentation to preserve the safety
// contract rather than deleting or weakening the assertion.
describe('SAFETY-CRITICAL README documentation contracts', () => {
  it('enforces least-privilege OAuth scope guidance', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      'Least-privilege default OAuth scopes',
      'Required Admin API Scopes',
      'Optional scopes are not a substitute for required Admin API scopes',
      'read_products',
      'read_orders',
      'read_inventory',
      'read_locations',
      'No raw write-capable Shopify Admin GraphQL exposed to agents',
    ]);
  });

  it('documents canonical Shopify Admin shop domain usage', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      'canonical Admin `*.myshopify.com` domain',
      'If Shopify redirects back with a different canonical shop domain, retry the install using the callback shop domain',
    ]);
  });

  it('enforces nested connection limit guidance', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Nested connection limits',
      'first 100 variants per product',
      'first 50 line items per order',
      'more than 100 variants',
      'more than 50 inventory levels',
      'custom paginated Shopify Admin GraphQL workflow outside the curated v0.1 reports',
    ]);
  });

  it('tells maintainers which documentation assertions are non-negotiable', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Documentation test maintenance',
      'SAFETY-CRITICAL',
      'non-negotiable',
      'copy-polish',
    ]);
  });

  it('documents Bitwarden Secrets Manager setup without asking for secrets in chat', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Bitwarden Secrets Manager mode',
      'Hermes Bitwarden Secrets Manager',
      'self-hosted Bitwarden endpoint',
      '--server-url',
      'BWS_PROJECT_ID',
      'hermes secrets bitwarden status',
      'hermes secrets bitwarden sync',
      'SHOPIFY_HERMES_CLIENT_ID',
      'SHOPIFY_HERMES_CLIENT_SECRET',
      'SHOPIFY_HERMES_APP_URL',
      'Do not paste Shopify client secrets into chat',
      'Do not write secrets back to `.env`',
    ]);
  });

  it('documents chat-first interactive credential handoff without sharing secrets in chat', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Chat-safe credential handoff',
      'shopify-hermes-oauth credentials set',
      'Run this command in your local terminal or SSH/Termius shell, not in chat:',
      'The command prompts for the Shopify client ID and hides the client secret while you type.',
      'After it succeeds, reply `done` in chat without sharing the client ID or client secret.',
      'Do not paste Shopify client secrets into chat',
      'updates only `SHOPIFY_HERMES_CLIENT_ID` and `SHOPIFY_HERMES_CLIENT_SECRET` in `$HERMES_HOME/.env`',
      'chmods `.env` to `0600`',
    ]);
  });

  it('documents Shopify app client secret rotation cleanup without revealing which secret matched', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Shopify app client secret rotation',
      'SHOPIFY_HERMES_CLIENT_SECRET',
      'SHOPIFY_HERMES_OLD_CLIENT_SECRET',
      'tries the current secret first and then the old secret',
      'without logging or reporting which secret matched',
      'SHOPIFY_HERMES_OLD_CLIENT_SECRET_ROTATED_AT',
      'Remove `SHOPIFY_HERMES_OLD_CLIENT_SECRET` after the transition window',
      'rerun `shopify-hermes-oauth doctor` to confirm the rotation fallback is disabled',
      'Do not commit, print, or paste either client secret',
    ]);
  });

  it('documents curated order detail lookup separately from order reports', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Curated order detail lookup tool',
      '`shopify.report_orders` remains the aggregate/windowed report surface',
      '`shopify.orders.get`',
      'This tool requires `read_orders`',
      'read_all_orders',
      'omits customer identity/contact fields, billing/shipping addresses, notes, tags, tracking numbers/URLs, and transactions',
      'order detail caps line items at 25, fulfillments at 10, and refunds at 10',
    ]);
  });

  it('documents curated product and collection lookup tools separately from reports', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Curated product and collection lookup tools',
      '`shopify.report_products` remains the aggregate report/export surface',
      '`shopify.products.get`',
      '`shopify.collections.list`',
      '`shopify.collections.get`',
      'These tools require `read_products`',
      'no raw Admin GraphQL input',
      'not raw metafield values',
      'Product detail lookup caps variants at 25, media at 10, and metafield metadata at 20',
      'collection detail caps products at 25 and metafield metadata at 20',
    ]);
  });

  it('documents curated location and inventory lookup tools separately from inventory reports', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Curated location and inventory lookup tools',
      '`shopify.report_inventory` remains the aggregate inventory report surface',
      '`shopify.locations.list`',
      '`shopify.locations.get`',
      '`shopify.inventory.items.get`',
      '`shopify.inventory.levels.list`',
      'Location list/get requires `read_locations`',
      'inventory item get requires `read_inventory`',
      'inventory level list requires `read_inventory` and `read_locations`',
      'requires exactly one of `inventoryItemId` or `locationId`',
      'defaults to 25 and is capped at 50',
      'stable IDs such as `gid://shopify/Location/123` and `gid://shopify/InventoryItem/123`',
      'omit location addresses, phone/contact fields, metafields, and inventory adjustment history',
    ]);
  });

  it('documents curated fulfillment order visibility tools with safe omissions', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Curated fulfillment order visibility tools',
      '`shopify.fulfillment_orders.list`',
      '`shopify.fulfillment_orders.get`',
      'read_merchant_managed_fulfillment_orders',
      'read_assigned_fulfillment_orders',
      'read_third_party_fulfillment_orders',
      'Destination address, tracking numbers/URLs, customer contact, notes/tags, metafields, transactions, raw Admin GraphQL input, and all mutations are intentionally omitted',
      'fulfillment order lists cap page size at 50 and fulfillment order line items at 25',
    ]);
  });

  it('documents curated discounts and marketing event tools with safe omissions', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Curated discounts and marketing event tools',
      '`shopify.discounts.list`',
      '`shopify.discounts.get`',
      '`shopify.marketing_events.list`',
      '`codesCount.count` only',
      '`read_discounts`',
      '`read_marketing_events`',
      'Individual discount codes, customer/order data, usage attribution, customerSelection details, customer/order/conversion attribution, raw Admin GraphQL input, and all mutations are intentionally omitted',
      'Marketing event `manageUrl`/`previewUrl` query strings are redacted',
      'not raw IDs, cursors, titles, codes, or URLs',
    ]);
  });

  it('documents source installs and Hermes profile-local npm PATH expectations', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Local/source install and PATH diagnostics',
      'npm pack && npm install -g ./wottz-shopify-hermes-oauth-*.tgz',
      'Hermes profile-local npm bin directories such as `$HERMES_HOME/node/bin` or `~/.hermes/node/bin` may be visible to Hermes but not to an ordinary SSH shell',
      'export PATH="$HERMES_HOME/node/bin:$PATH"',
      'shopify-hermes-oauth doctor',
      'Connector CLI: installed but not on PATH',
    ]);
  });

  it('documents chat-first guided onboarding transcript', () => {
    const markdown = readReadme();

    expectAllPresent(markdown, [
      '## Guided chat-first onboarding',
      'shopify-hermes-oauth onboard --shop finbobaggins.myshopify.com --app-name hermes-oauth',
      'Agent can do:',
      'Human must do in Shopify:',
      'Application URL: https://<public-app-url>',
      'Allowed redirection URL: https://<public-app-url>/auth/callback',
      '/auth/start?shop=finbobaggins.myshopify.com',
      'shopify-hermes-oauth credentials set',
      'shopify-hermes-oauth hermes install',
      'shopify-hermes-oauth shops verify finbobaggins.myshopify.com',
      'The onboarding command never prints Shopify client secrets or token-store contents',
    ]);
  });
});
