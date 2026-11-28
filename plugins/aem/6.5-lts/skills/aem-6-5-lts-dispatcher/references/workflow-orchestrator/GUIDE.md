# Dispatcher Workflow Orchestrator (AMS)

Use this skill when users need end-to-end Dispatcher support instead of a single specialist workflow.

## Scope

- Full lifecycle orchestration for AMS Dispatcher work:
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

## Exit Criteria

Always return:
- touched files and why
- executed checks (static + runtime) and evidence
- unresolved risks/gaps
- rollback trigger + rollback action
- next-step plan if prerequisites blocked verification

## Related Skills

- [config-authoring](../config-authoring/GUIDE.md)
- [technical-advisory](../technical-advisory/GUIDE.md)
- [security-hardening](../security-hardening/GUIDE.md)
- [performance-tuning](../performance-tuning/GUIDE.md)
- [incident-response](../incident-response/GUIDE.md)

## References

- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md)
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md)
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
