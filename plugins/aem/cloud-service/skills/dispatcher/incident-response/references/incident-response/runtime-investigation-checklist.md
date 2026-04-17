# Runtime Investigation Checklist

## Inputs To Gather

- deployment mode: `cloud`
- sample failing URL(s)
- sample healthy URL(s)
- incident time window
- known recent config/deploy changes

## Core Checks

1. `monitor_metrics` for error-rate and latency shifts.
2. `tail_logs` for concrete 4xx/5xx samples.
3. `trace_request` on failing and healthy URLs.
4. `inspect_cache` for cache presence/age path checks.
5. `validate` and `lint` for structural/security regressions.
6. `sdk(action="check-files")` for immutable/include drift.

Map these checks to `INC-*` IDs in [test-case-catalog.md](../dispatcher-foundation/test-case-catalog.md).

## Common Patterns

- Rising 5xx + render timeout patterns: backend/render instability or routing mismatch.
- High MISS rate + stale content complaints: invalidation/config drift or cache bypass rules.
- Sudden 403 spike: filter order/constraint regression.
- Probe/readiness failure: rewrite/vhost interference on `/systemready`, `/system/probes/*`, or managed rewrite-map readiness gating.
- Host-specific anomaly: missing required aliases, wrong vhost match, or catch-all host behavior taking traffic unexpectedly.
- Dev-only path behaving like prod (or vice versa): environment-sensitive passthrough on `/crx/(de|server)/` or `/content/test-site/`.

## Escalation Trigger

Escalate when:

- evidence indicates backend/AEM app failure outside dispatcher scope
- no deterministic dispatcher/config cause can be established
- incident persists after safe containment actions
