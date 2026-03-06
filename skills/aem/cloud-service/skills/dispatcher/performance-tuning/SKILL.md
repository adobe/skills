---
name: performance-tuning
description: Optimize Dispatcher performance for AEMaaCS cloud workflows only, with cloud-specific baseline and runtime verification.
license: Apache-2.0
compatibility: Requires Dispatcher MCP configured for cloud variant (`AEM_DEPLOYMENT_MODE=cloud`).
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

# Dispatcher Performance Tuning (Cloud)

Improve cache efficiency, latency, and throughput for cloud deployments.

## Variant Scope

- This skill is cloud-service-only.
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
2. Apply cloud guardrails (immutable/default includes and CDN-vs-Dispatcher ownership) before proposing changes.
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
- Keep cloud assumptions explicit for each recommendation batch.
- Route edge/WAF/CDN-only concerns to CDN layer guidance instead of Dispatcher config changes.

## References

- [optimization-patterns.md](./references/performance-tuning/optimization-patterns.md)
- [performance-scenario-playbooks.md](./references/performance-tuning/performance-scenario-playbooks.md) – scenario-driven tuning flows adapted from broader MCP prompt surfaces
- [load-testing-guidance.md](./references/performance-tuning/load-testing-guidance.md)
- [performance-monitoring-setup.md](./references/performance-tuning/performance-monitoring-setup.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](../shared/references/technical-advisory/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
