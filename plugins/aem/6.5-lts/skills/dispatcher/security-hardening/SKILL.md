---
name: security-hardening
description: Perform security audits for the Adobe Dispatcher Apache HTTP Server module and Apache HTTPD in AEM 6.5 / AMS workflows only, with AMS-specific hardening verification.
license: Apache-2.0
compatibility: Requires Dispatcher MCP for AMS (`AEM_DEPLOYMENT_MODE=ams`) or AMS Dispatcher MCP SDK (pre-set to `ams`).
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Security Hardening (AMS)

Deliver evidence-backed security findings and remediations for AMS workflows that use the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration.

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

1. Define threat model and audit scope.
2. Gather baseline evidence (`validate`, `lint`, `sdk`).
3. Apply AMS 6.5 guardrails (tier boundaries, immutable constraints, flush ACL rules) before rating risk.
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
- Keep AMS assumptions explicit for each remediation recommendation.
- Separate mandatory remediations from defense-in-depth guidance.

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
- [ams-6-5-guardrails.md](./references/dispatcher-foundation/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
