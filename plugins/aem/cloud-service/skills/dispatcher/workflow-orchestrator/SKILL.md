---
name: workflow-orchestrator
description: Orchestrate complete lifecycle work for the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEM as a Cloud Service, from design and implementation through validation, release readiness, and incident troubleshooting.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for cloud (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Workflow Orchestrator (Cloud)

Use this skill when users need end-to-end Dispatcher support instead of a single specialist workflow.

## Runtime and Availability Preflight

Before workflows, edits, or commands, confirm target module/runtime from active dependencies, deployment configuration, and Dispatcher layout, not this directory or `AEM_DEPLOYMENT_MODE` alone.

- Cloud: primary `aem-sdk-api` plus Cloud target/defaults; `opt-in/USE_SOURCES_DIRECTLY` marks flexible mode, but legacy Cloud may lack it. AMS: primary `uber-jar`/6.5 version plus AMS target/layout such as `ams_default.vars` and tier farms. Shared config directories alone prove neither runtime; confirm actual LTS version/hosting.
- On a wrong-runtime mismatch, STOP; explicitly route to the companion runtime's Dispatcher plugin with no wrong-mode commands. For missing/conflicting evidence, ask focused confirmation of target runtime/module/source root; make no runtime-specific edits or commands until resolved.
- Discover actual Cloud MCP tools/prerequisites separately from mode. All linked workflows and checklists are conditional: allow bounded conceptual explanation/static source review without MCP; report each required tool-dependent check BLOCKED / NOT VERIFIED with its missing prerequisite, leaving items incomplete.
- Never fabricate evidence or substitute another runtime's tools. Separate static review, SDK file/baseline/startup checks, and live target evidence; no runtime/release sign-off from incomplete checks or production proof from local results. Core-7 signatures are repository contracts, not publicly verified Adobe SDK interfaces; inspect exposed schemas/installed help before execution.

This orchestrator coordinates Dispatcher, not Granite Workflow.

## Scope

- Full lifecycle orchestration for cloud Dispatcher work:
  - requirements and design
  - config implementation and hardening
  - filter, cache, rewrite, vhost, and farm design
  - feature-specific flows such as `/auth_checker`, vanity URLs, GraphQL/CORS, Commerce proxy routes, frontend-static passthrough, and Dynamic Media delivery passthrough
  - static/runtime validation
  - release readiness and rollback planning
  - production incident triage

## Routing Model

1. Start in `config-authoring` for file design and edits.
2. Pull in `technical-advisory` for policy, documentation, cloud guardrails, and evidence planning.
3. Pull in `security-hardening` and `performance-tuning` for non-functional risk checks and environment-sensitive review.
4. Switch to `incident-response` for live failures, probe regressions, cache anomalies, or validator/runtime mismatches.
5. Return a single consolidated output: changes, evidence, risk, rollback, and follow-ups.

## Operational Packaging

Use these shared references to keep broad requests deterministic:

1. Start with [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) when the user is new, the repo root is ambiguous, or the request spans multiple concerns.
2. Normalize the repo to a dispatcher `src` root with [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md).
3. Convert the chosen specialist playbook into exact MCP commands with [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md).
4. Use the specialist skill references only after the path above is fixed.

## Entry Criteria

Use when user intent is any of:
- end-to-end implementation
- pre-release readiness review
- troubleshooting + fix + re-validation in one flow
- broad audit across config, security, and performance
- complete cloud-service dispatcher development from new feature to release gate
- “single point of development” requests that span authoring, validation, troubleshooting, and hardening

## Exit Criteria

Always return:
- touched files and why
- executed checks (static + runtime) and evidence
- selected scenario/playbook path
- unresolved risks/gaps
- rollback trigger + rollback action
- next-step plan if prerequisites blocked verification

## Related Skills

- [config-authoring](../config-authoring/SKILL.md)
- [technical-advisory](../technical-advisory/SKILL.md)
- [security-hardening](../security-hardening/SKILL.md)
- [performance-tuning](../performance-tuning/SKILL.md)
- [incident-response](../incident-response/SKILL.md)

## References

- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md)
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md)
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
