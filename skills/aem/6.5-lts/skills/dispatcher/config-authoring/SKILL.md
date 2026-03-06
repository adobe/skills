---
name: config-authoring
description: Create, modify, review, and harden Dispatcher and Apache HTTPD config for AEM 6.5 / AMS workflows (AMS workflows only). Use for `.any`, vhost, rewrite, cache, and filter changes.
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

# Dispatcher Config Authoring (AMS)

Design minimal, deterministic Dispatcher/HTTPD changes for AEM 6.5/AMS and verify with MCP evidence.

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

```text
AMS Config Progress
- [ ] 1) Confirm scope and acceptance criteria
- [ ] 2) Apply AMS 6.5 guardrails for tier routing, variables, flush ACL, and immutable boundaries
- [ ] 3) Decompose target URLs (path/selectors/extension/suffix) and use that model for all URL-based rules—filters, cache rules, etc.—using `/path`, `/selectors`, `/extension`, `/suffix` or aligned globs (not raw `/url`) where applicable; then design complete section-level edits
- [ ] 4) Update config with least-privilege defaults (produce final merged section, not isolated rule snippets)
- [ ] 5) Run static checks: validate -> lint (deep/order-aware when filters changed)
- [ ] 6) Run SDK checks: `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`, `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` as needed
- [ ] 7) Run runtime verification in host-path/log environment
- [ ] 8) Return diff, evidence table, risk/rollback, and citations
```

## Verification Scope Selection

Use the shared references to select the minimum evidence set:

- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)

## Output Contract

Always include:

- files changed + intent
- exact insertion location and final merged section content for each edited block
- checks executed + evidence
- selected test IDs
- risk/rollback plan
- residual risks and next checks

## Guardrails

- Do not weaken deny-by-default security posture without explicit user approval.
- Do not claim runtime verification if host-path/log prerequisites were missing.
- Keep changes minimal and scoped.

## References

- [config-patterns.md](./references/config-authoring/config-patterns.md)
- [config-scenario-playbooks.md](./references/config-authoring/config-scenario-playbooks.md) – high-value development scenarios adapted from broader MCP surfaces to core-7 execution
- [reference-snippets.md](./references/config-authoring/reference-snippets.md) – reusable starter snippets for consistent config authoring
- [validation-playbook.md](./references/config-authoring/validation-playbook.md)
- [mcp-tool-orchestration.md](./references/config-authoring/mcp-tool-orchestration.md)
- [ams-6-5-guardrails.md](../shared/references/technical-advisory/ams-6-5-guardrails.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
- [public-docs-index.md](../shared/references/technical-advisory/public-docs-index.md)
