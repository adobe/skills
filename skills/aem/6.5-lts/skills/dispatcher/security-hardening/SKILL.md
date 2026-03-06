---
name: security-hardening
description: Perform Dispatcher and Apache HTTPD security audits for AEM 6.5 / AMS workflows only, with AMS-specific hardening verification.
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

# Dispatcher Security Hardening (AMS)

Deliver evidence-backed security findings and remediations for AMS workflows.

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

1. Define threat model and audit scope.
2. Gather baseline evidence (`validate`, `lint`, `sdk`).
3. Apply AMS 6.5 guardrails (tier boundaries, immutable constraints, flush ACL rules) before rating risk.
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
- Keep AMS assumptions explicit for each remediation recommendation.
- Separate mandatory remediations from defense-in-depth guidance.

## References

- [security-baseline-checklist.md](./references/security-hardening/security-baseline-checklist.md)
- [security-scenario-playbooks.md](./references/security-hardening/security-scenario-playbooks.md) – scenario-driven security workflows adapted from broader MCP prompt surfaces
- [security-headers-checklist.md](./references/security-hardening/security-headers-checklist.md)
- [sensitive-paths-catalog.md](./references/security-hardening/sensitive-paths-catalog.md)
- [owasp-coverage-matrix.md](./references/security-hardening/owasp-coverage-matrix.md)
- [security-audit-report-template.md](./references/security-hardening/security-audit-report-template.md)
- [ams-6-5-guardrails.md](../shared/references/technical-advisory/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
