---
name: performance-tuning
description: Optimize performance of the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration for AEM 6.5 / AMS workflows only, with AMS-specific baseline and runtime verification.
license: Apache-2.0
compatibility: Requires Dispatcher MCP for AMS (`AEM_DEPLOYMENT_MODE=ams`) or AMS Dispatcher MCP SDK (pre-set to `ams`).
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Performance Tuning (AMS)

Improve cache efficiency, latency, and throughput for AMS deployments that use the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration.

## Variant Scope

- This skill is AMS-only.
- Scope is fixed by this skill directory; do not ask the user to choose deployment variant.

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

- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)

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
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – fast entry path for optimization requests
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – map performance findings to cache, farm, vhost, rewrite, and variable file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – exact MCP command chains for tuning playbooks
- [ams-6-5-guardrails.md](./references/dispatcher-foundation/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
