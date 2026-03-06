---
name: workflow-orchestrator
description: Orchestrate complete Dispatcher lifecycle work for AEMaaCS cloud-service flavor, from design and implementation through validation, release readiness, and incident troubleshooting.
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

# Dispatcher Workflow Orchestrator (Cloud)

Use this skill when users need end-to-end Dispatcher support instead of a single specialist workflow.

## Scope

- Full lifecycle orchestration for cloud Dispatcher work:
  - requirements and design
  - config implementation and hardening
  - static/runtime validation
  - release readiness and rollback planning
  - production incident triage

## Routing Model

1. Start in `config-authoring` for file design and edits.
2. Pull in `technical-advisory` for policy, documentation, and evidence planning.
3. Pull in `security-hardening` and `performance-tuning` for non-functional risk checks.
4. Switch to `incident-response` for live failures or regressions.
5. Return a single consolidated output: changes, evidence, risk, rollback, and follow-ups.

## Entry Criteria

Use when user intent is any of:
- end-to-end implementation
- pre-release readiness review
- troubleshooting + fix + re-validation in one flow
- broad audit across config, security, and performance

## Exit Criteria

Always return:
- touched files and why
- executed checks (static + runtime) and evidence
- unresolved risks/gaps
- rollback trigger + rollback action
- next-step plan if prerequisites blocked verification

## Related Skills

- [config-authoring](../config-authoring/SKILL.md)
- [technical-advisory](../technical-advisory/SKILL.md)
- [security-hardening](../security-hardening/SKILL.md)
- [performance-tuning](../performance-tuning/SKILL.md)
- [incident-response](../incident-response/SKILL.md)
