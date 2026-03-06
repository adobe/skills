---
name: incident-response
description: Investigate and triage Dispatcher runtime incidents for AEMaaCS cloud workflows only, using container-backed MCP evidence.
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

# Dispatcher Runtime Incident Response (Cloud)

Investigate incidents with evidence-first workflow for cloud runtime.

## Variant Scope

- This skill is cloud-service-only.
- Scope is fixed by this plugin path; do not ask the user to choose deployment variant.

## MCP Tool Contract

Use only these Dispatcher MCP tools:

- `monitor_metrics`
- `tail_logs`
- `trace_request`
- `inspect_cache`
- `validate`
- `lint`
- `sdk`

## Workflow

1. Quantify impact (`monitor_metrics`).
2. Classify whether issue belongs to Dispatcher layer or CDN/edge layer using cloud guardrails.
3. Gather logs and traces (`tail_logs`, `trace_request`).
4. Inspect cache behavior (`inspect_cache`).
5. Correlate with static checks (`validate`, `lint`, `sdk`).
6. Return containment + remediation + rollback.

## Verification Scope Selection

Use shared references to select incident evidence depth:

- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)

## Output Contract

Always return:

- incident summary (symptom, impact window, blast radius)
- evidence table (tool, input, finding)
- selected test IDs and outcomes
- probable cause + confidence level
- containment, durable remediation, and rollback
- open risks and missing evidence

## Guardrails

- Distinguish observations from inference.
- Do not claim root-cause certainty without corroborating evidence.
- Do not claim runtime verification if container/runtime prerequisites were missing.
- Keep fixes reversible unless user explicitly requests high-risk change.
- For cloud incidents, explicitly state when root cause is outside Dispatcher config scope (CDN/WAF/edge policy).

## References

- [runtime-investigation-checklist.md](./references/incident-response/runtime-investigation-checklist.md)
- [incident-scenario-playbooks.md](./references/incident-response/incident-scenario-playbooks.md) – focused debug scenarios adapted from broader MCP prompt surfaces
- [symptom-hypothesis-matrix.md](./references/incident-response/symptom-hypothesis-matrix.md) – troubleshooting hypothesis shortcuts for faster evidence-driven diagnosis
- [incident-report-template.md](./references/incident-response/incident-report-template.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](../shared/references/technical-advisory/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
