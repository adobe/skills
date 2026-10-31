---
name: performance-tuning
description: Optimize performance of the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration for AEM 6.5 / AMS workflows only, with AMS-specific baseline and runtime verification.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for AMS (`AEM_DEPLOYMENT_MODE=ams`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Performance Tuning (AMS)

Improve cache efficiency, latency, and throughput for AMS deployments that use the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration.

## Variant Scope

- This skill is AMS-only.
- Scope remains 6.5/AMS-only after target project evidence is confirmed; missing/conflicting evidence requires focused confirmation, not a directory-based assumption.

## Runtime and Availability Preflight

Before workflows, edits, or commands, confirm target module/runtime from active dependencies, deployment configuration, and Dispatcher layout, not this directory or `AEM_DEPLOYMENT_MODE` alone.

- Cloud: primary `aem-sdk-api` plus Cloud target/defaults; `opt-in/USE_SOURCES_DIRECTLY` marks flexible mode, but legacy Cloud may lack it. AMS: primary `uber-jar`/6.5 version plus AMS target/layout such as `ams_default.vars` and tier farms. Shared config directories alone prove neither runtime; confirm actual LTS version/hosting.
- On a wrong-runtime mismatch, STOP; explicitly route to the companion runtime's Dispatcher plugin with no wrong-mode commands. For missing/conflicting evidence, ask focused confirmation of target runtime/module/source root; make no runtime-specific edits or commands until resolved.
- Discover actual AMS MCP tools/host/log prerequisites separately from mode. All linked workflows and checklists are conditional: allow bounded conceptual explanation/static source review without MCP; report each required tool-dependent check BLOCKED / NOT VERIFIED with its missing prerequisite, leaving items incomplete.
- Never fabricate evidence or substitute another runtime's tools. Separate static review, AMS file/baseline/host syntax checks, and live target evidence; no runtime/release sign-off from incomplete checks or production proof from local results. Core-7 signatures are repository contracts, not publicly verified Adobe SDK interfaces; inspect exposed schemas/installed help before execution.

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
