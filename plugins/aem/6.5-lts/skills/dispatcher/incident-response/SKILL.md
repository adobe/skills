---
name: incident-response
description: Investigate and triage runtime incidents involving the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEM 6.5 LTS environments only, using runtime MCP evidence.
license: Apache-2.0
compatibility: Requires Dispatcher MCP for AMS (`AEM_DEPLOYMENT_MODE=ams`) or AMS Dispatcher MCP SDK (pre-set to `ams`).
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Runtime Incident Response (AMS)

Investigate AMS runtime incidents involving the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration with an evidence-first workflow.

## Variant Scope

- This skill is AMS-only.
- Scope is fixed by this skill directory; do not ask the user to choose deployment variant.

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
2. Gather logs and traces (`tail_logs`, `trace_request`). To get the full log sequence for a specific request: use **tail_logs** to obtain entries (some include **pid** and **tid** from dispatcher debug lines), then call **trace_request(pid=..., tid=...)** to retrieve all log lines for that request. See [mcp-tool-orchestration.md](../config-authoring/references/config-authoring/mcp-tool-orchestration.md) § Trace by pid:tid.
3. Apply AMS 6.5 guardrails to triage hypotheses (tier/farm ordering, variable usage, flush exposure, immutable boundaries).
4. Inspect cache behavior (`inspect_cache`).
5. Correlate with static checks (`validate`, `lint`, `sdk`).
6. Return containment + remediation + rollback.

## Verification Scope Selection

Use shared references to select incident evidence depth:

- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)

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
- Do not claim runtime verification if host-path/log prerequisites were missing.
- Keep fixes reversible unless user explicitly requests high-risk change.

## References

- [runtime-investigation-checklist.md](./references/incident-response/runtime-investigation-checklist.md)
- [runtime-prompts-and-troubleshooting-scenarios.md](./references/incident-response/runtime-prompts-and-troubleshooting-scenarios.md) – runtime prompts and troubleshooting scenario map for tail_logs, trace_request, monitor_metrics, inspect_cache
- [incident-scenario-playbooks.md](./references/incident-response/incident-scenario-playbooks.md) – focused debug scenarios
- [symptom-hypothesis-matrix.md](./references/incident-response/symptom-hypothesis-matrix.md) – troubleshooting hypothesis shortcuts for faster evidence-driven diagnosis
- [incident-report-template.md](./references/incident-response/incident-report-template.md)
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – normalize repo root and select the incident path quickly
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – map the failing behavior to the relevant dispatcher file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – exact MCP command chains for incident playbooks
- [ams-6-5-guardrails.md](./references/dispatcher-foundation/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
