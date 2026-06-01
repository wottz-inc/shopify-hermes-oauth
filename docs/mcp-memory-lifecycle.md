# MCP memory lifecycle and reconnect triage

## Issue #60 investigation summary

Issue #60 tracks the 2026-05-28 Hermes gateway OOM incident where the Shopify MCP server was registered under the gateway service cgroup and gateway logs showed MCP keepalive/reconnect activity shortly before shutdown. The investigation found an important parent/child boundary:

- Hermes gateway owns MCP child process spawn, keepalive, reconnect, and force-kill policy.
- The Shopify MCP server runs as a stdio child that serves JSON-RPC over stdout until stdin closes.
- the Shopify MCP server does not spawn nested MCP child processes.

That means this connector can make the child process easier to observe and prove that its local stdio server cleanup is bounded, but it cannot by itself prove that a Hermes gateway reconnect never overlaps children. Any production incident analysis still needs gateway-side process-count/RSS evidence.

## Connector-side lifecycle behaviour

`shopify-hermes-oauth mcp serve` is an in-process Node stdio MCP server. It reads newline-delimited JSON-RPC requests from stdin, writes JSON-RPC responses to stdout, and exits when stdin ends. To keep protocol framing safe:

- JSON-RPC stdout is reserved for MCP protocol messages only.
- Lifecycle diagnostics are emitted to stderr.
- Logger failures are best-effort and do not break serving or shutdown.

The server now emits structured lifecycle events:

- `mcp.stdio.start` when the stdio loop begins.
- `mcp.stdio.stop` when the input stream ends.

Each lifecycle event includes non-secret diagnostics: service name, transport, PID, process uptime, and a memory snapshot. Stop events also include `lifetimeMs` and `reason`; the normal shutdown reason is `input-ended`.

These diagnostics are intended to correlate connector-side events with Hermes gateway logs such as keepalive failures, reconnects, graceful stop, force kill, and child exit events.

## `shopify.health`

The MCP allowlist includes `shopify.health`, a read-only diagnostic tool for lightweight process health checks. It returns:

- service: `shopify-hermes-oauth`;
- transport: `stdio`;
- status: `ok`;
- process PID;
- uptime in seconds;
- memory byte counts for RSS, heap total, heap used, external memory, and array buffers.

The health tool intentionally exposes no token-store contents, no environment variables, no request headers, no OAuth codes, no access tokens, no client secrets, and no callback URLs.

## Regression coverage

The issue #60 test coverage now covers the connector side of the lifecycle boundary:

1. `shopify.health` is included in the exact curated MCP tool allowlist.
2. `shopify.health` dispatches with the expected safe shape and is audited as a read-only MCP tool.
3. MCP tool output and audit metadata remain token-free.
4. `mcp.stdio.start` and `mcp.stdio.stop` lifecycle diagnostics are sent through an injected logger, which the CLI wires to stderr.
5. Lifecycle diagnostics do not pollute JSON-RPC stdout.
6. repeated stdio start/stop churn is exercised with in-memory streams and checks paired start/stop events plus bounded listener counts.
7. This document records the parent/child lifecycle boundary so future agents do not overclaim connector-side guarantees.

## What this repo can and cannot prove

This repo can prove that the Shopify MCP server:

- exits its stdio loop when stdin closes;
- emits non-secret health and lifecycle diagnostics;
- keeps JSON-RPC stdout clean while lifecycle logs go to stderr;
- does not leak obvious stream listeners across repeated local stdio start/stop churn;
- exposes enough local process diagnostics for future OOM/reconnect triage.

This repo cannot, on its own, prove that the Hermes gateway:

- starts only one child per configured MCP server;
- always terminates and awaits an old child before reconnecting;
- force-kills a stuck child after a bounded timeout;
- maintains stable RSS under failed gateway keepalive or DNS/network retry paths;
- avoids parent-side timers, tasks, or reconnect promises accumulating.

Those behaviours live in the Hermes gateway/MCP host. The correct follow-up for full acceptance is a gateway-side reconnect stress test that records child PIDs, process count, RSS over time, reconnect reason, stop/kill events, exit code, and elapsed time.

## Future incident runbook

When a future memory or reconnect incident appears:

1. Capture Hermes gateway logs around `keepalive failed`, reconnect, child spawn, graceful stop, force-kill, and process exit.
2. Compare those timestamps with connector stderr lifecycle events (`mcp.stdio.start`, `mcp.stdio.stop`, `lifetimeMs`, `reason`).
3. Call `shopify.health` through the MCP host when possible and record only the safe memory fields.
4. Check OS process tables for overlapping Shopify MCP node children under the gateway cgroup.
5. Avoid logging or sharing secrets: token-store contents, OAuth codes, client secrets, Shopify access tokens, headers, and callback URLs must remain redacted.

The connector-side answer to issue #60 is therefore bounded observability and local cleanup coverage. Full reconnect leak-proofing requires the Hermes gateway parent-side stress test described above.
