---
name: incident-response
description: Investigate and triage runtime incidents involving the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEM as a Cloud Service environments only, using runtime-backed MCP evidence.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for cloud (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Runtime Incident Response (Cloud)

Investigate cloud runtime incidents involving the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration with an evidence-first workflow.

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

- `monitor_metrics`
- `tail_logs`
- `trace_request`
- `inspect_cache`
- `validate`
- `lint`
- `sdk`

## Workflow

1. Quantify impact (`monitor_metrics`).
2. Classify whether issue belongs to Dispatcher layer or CDN/edge layer using cloud guardrails, including reserved probe-path behavior.
3. Gather logs and traces (`tail_logs`, `trace_request`). To get the full log sequence for a specific request: use **tail_logs** to obtain entries (some include **pid** and **tid** from dispatcher debug lines), then call **trace_request(pid=..., tid=...)** to retrieve all log lines for that request. See [mcp-tool-orchestration.md](../config-authoring/references/config-authoring/mcp-tool-orchestration.md) § Trace by pid:tid.
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
- Do not claim runtime verification if container/runtime prerequisites were missing.
- Keep fixes reversible unless user explicitly requests high-risk change.
- For cloud incidents, explicitly state when root cause is outside Dispatcher config scope (CDN/WAF/edge policy).

## References

- [runtime-investigation-checklist.md](./references/incident-response/runtime-investigation-checklist.md)
- [runtime-prompts-and-troubleshooting-scenarios.md](./references/incident-response/runtime-prompts-and-troubleshooting-scenarios.md) – runtime prompts and troubleshooting scenario map for tail_logs, trace_request, monitor_metrics, inspect_cache
- [incident-scenario-playbooks.md](./references/incident-response/incident-scenario-playbooks.md) – focused debug scenarios
- [symptom-hypothesis-matrix.md](./references/incident-response/symptom-hypothesis-matrix.md) – troubleshooting hypothesis shortcuts for faster evidence-driven diagnosis
- [incident-report-template.md](./references/incident-response/incident-report-template.md)
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – normalize repo root and select the incident path quickly
- [local-sdk-execution.md](./references/dispatcher-foundation/local-sdk-execution.md) – shipped local SDK launcher contract for local cloud-runtime reproduction
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – map the failing behavior to the relevant dispatcher file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – exact MCP command chains for incident playbooks
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](./references/dispatcher-foundation/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
