---
name: performance-tuning
description: Optimize Dispatcher performance for AEM 6.5 / AMS workflows only, with AMS-specific baseline and runtime verification.
license: Apache-2.0
compatibility: Requires Dispatcher MCP for AMS (`AEM_DEPLOYMENT_MODE=ams`) or AMS Dispatcher MCP SDK (pre-set to `ams`).
allowed-tools:
  - validate
  - lint
  - sdk
  - trace_request
  - inspect_cache
  - monitor_metrics
  - tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Performance Tuning (AMS)

Improve cache efficiency, latency, and throughput for AMS deployments.

## Variant Scope

- This skill is AMS-only.
- Scope is fixed by this plugin path; do not ask the user to choose deployment variant.

## MCP Tool Contract

Use only these Dispatcher MCP tools:

- `validate`
- `lint`
- `sdk`
- `trace_request`
- `inspect_cache`
- `monitor_metrics`
- `tail_logs`

## Workflow

1. Capture baseline metrics and cache evidence.
2. Apply AMS 6.5 guardrails (tier boundaries, variable-driven config, flush ACL safety) to candidate optimizations.
3. Prioritize low-risk/high-impact changes.
4. Apply minimal edits.
5. Verify with `validate`, `lint`, and `sdk`.
6. Compare before/after runtime evidence.

## Verification Scope Selection

Use shared references to select optimization evidence depth:

- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)

## Output Contract

Always return:

- baseline metrics snapshot
- prioritized optimization list with impact/risk
- changed files and intent
- executed checks + before/after evidence
- selected test IDs and outcomes
- rollback plan and open risks

## Guardrails

- Do not claim improvement without measurable comparison.
- Keep high-risk tuning opt-in unless user explicitly requests it.
- Keep AMS assumptions explicit for each recommendation batch.

## References

- [optimization-patterns.md](./references/performance-tuning/optimization-patterns.md)
- [performance-scenario-playbooks.md](./references/performance-tuning/performance-scenario-playbooks.md) – scenario-driven tuning flows adapted from broader MCP prompt surfaces
- [load-testing-guidance.md](./references/performance-tuning/load-testing-guidance.md)
- [performance-monitoring-setup.md](./references/performance-tuning/performance-monitoring-setup.md)
- [ams-6-5-guardrails.md](../shared/references/technical-advisory/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
