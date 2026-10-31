---
name: security-hardening
description: Perform security audits for the Adobe Dispatcher Apache HTTP Server module and Apache HTTPD in AEMaaCS cloud workflows only, with cloud-specific hardening verification.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for cloud (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Security Hardening (Cloud)

Deliver evidence-backed security findings and remediations for cloud workflows that use the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration.

## Variant Scope

- This skill is cloud-service-only.
- Scope remains Cloud-only after target project evidence is confirmed; missing/conflicting evidence requires focused confirmation, not a directory-based assumption.

## Runtime and Availability Preflight

Before workflows, edits, or commands, confirm target module/runtime from active dependencies, deployment configuration, and Dispatcher layout, not this directory or `AEM_DEPLOYMENT_MODE` alone.

- Cloud: primary `aem-sdk-api` plus Cloud target/defaults; `opt-in/USE_SOURCES_DIRECTLY` marks flexible mode, but legacy Cloud may lack it. AMS: primary `uber-jar`/6.5 version plus AMS target/layout such as `ams_default.vars` and tier farms. Shared config directories alone prove neither runtime; confirm actual LTS version/hosting.
- On a wrong-runtime mismatch, STOP; explicitly route to the companion runtime's Dispatcher plugin with no wrong-mode commands. For missing/conflicting evidence, ask focused confirmation of target runtime/module/source root; make no runtime-specific edits or commands until resolved.
- Discover actual Cloud MCP tools/prerequisites separately from mode. All linked workflows and checklists are conditional: allow bounded conceptual explanation/static source review without MCP; report each required tool-dependent check BLOCKED / NOT VERIFIED with its missing prerequisite, leaving items incomplete.
- Never fabricate evidence or substitute another runtime's tools. Separate static review, SDK file/baseline/startup checks, and live target evidence; no runtime/release sign-off from incomplete checks or production proof from local results. Core-7 signatures are repository contracts, not publicly verified Adobe SDK interfaces; inspect exposed schemas/installed help before execution.

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

1. Define threat model and audit scope.
2. Apply cloud guardrails (immutable/default include constraints, reserved probe-path behavior, and CDN-vs-Dispatcher ownership).
3. Gather baseline evidence (`validate`, `lint`, `sdk`).
4. Verify exposure controls (`trace_request`).
5. Verify cache/header protections (`inspect_cache`, `tail_logs`, `monitor_metrics`).
6. Return risk-rated findings, prioritized remediation, and rollback.

## Verification Scope Selection

Use shared references to select security evidence depth:

- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)

## Output Contract

Always return:

- scope + threat model assumptions
- risk-rated findings table
- evidence table (tool/input/result)
- prioritized remediation plan
- selected test IDs and outcomes
- rollback plan and residual risk

## Guardrails

- Do not downgrade severity without evidence.
- Do not claim a control is effective without verification evidence.
- Keep cloud assumptions explicit for each remediation recommendation.
- Separate mandatory remediations from defense-in-depth guidance.
- Separate Dispatcher hardening findings from CDN/WAF edge-policy findings.

## References

- [security-baseline-checklist.md](./references/security-hardening/security-baseline-checklist.md)
- [security-scenario-playbooks.md](./references/security-hardening/security-scenario-playbooks.md) – scenario-driven security workflows adapted from broader MCP prompt surfaces
- [security-headers-checklist.md](./references/security-hardening/security-headers-checklist.md)
- [sensitive-paths-catalog.md](./references/security-hardening/sensitive-paths-catalog.md)
- [owasp-coverage-matrix.md](./references/security-hardening/owasp-coverage-matrix.md)
- [security-audit-report-template.md](./references/security-hardening/security-audit-report-template.md)
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – single entry path for broad or first-time audits
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – map findings to actual dispatcher file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – exact MCP command chains for security playbooks
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](./references/dispatcher-foundation/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
