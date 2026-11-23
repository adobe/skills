---
name: workflow-orchestrator
description: Orchestrate complete lifecycle work for the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEM as a Cloud Service, from design and implementation through validation, release readiness, and incident troubleshooting.
license: Apache-2.0
compatibility: Requires Dispatcher MCP configured for cloud variant (`AEM_DEPLOYMENT_MODE=cloud`).
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Workflow Orchestrator (Cloud)

Use this skill when users need end-to-end Dispatcher support instead of a single specialist workflow.

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
