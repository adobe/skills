---
name: security-hardening
description: Perform Dispatcher and Apache HTTPD security audits for AEMaaCS cloud workflows only, with cloud-specific hardening verification.
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

# Dispatcher Security Hardening (Cloud)

Deliver evidence-backed security findings and remediations for cloud workflows.

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

1. Define threat model and audit scope.
2. Apply cloud guardrails (immutable/default include constraints and CDN-vs-Dispatcher ownership).
3. Gather baseline evidence (`validate`, `lint`, `sdk`).
4. Verify exposure controls (`trace_request`).
5. Verify cache/header protections (`inspect_cache`, `tail_logs`, `monitor_metrics`).
6. Return risk-rated findings, prioritized remediation, and rollback.

## Verification Scope Selection

Use shared references to select security evidence depth:

- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)

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
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](../shared/references/technical-advisory/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
