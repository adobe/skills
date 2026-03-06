---
name: technical-advisory
description: Provide Dispatcher/HTTPD advisory guidance for AEMaaCS cloud workflows only, with public-doc citations and cloud-specific MCP verification plans. Use for conceptual questions such as `statfileslevel`, filter rules, URL decomposition, cache invalidation behavior, rewrite behavior, and security headers.
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

# Dispatcher Technical Advisory (Cloud)

Provide deterministic guidance for AEMaaCS dispatcher use cases.

## Variant Scope

- This skill is cloud-service-only.
- Scope is fixed by this plugin path; do not ask the user to choose deployment variant.

## MCP Tool Contract

Use only these Dispatcher MCP tools when producing verification plans:

- `validate`
- `lint`
- `sdk`
- `trace_request`
- `inspect_cache`
- `monitor_metrics`
- `tail_logs`

## Workflow

1. Confirm scope and assumptions.
2. Apply [cloud-service-aemaacs-guardrails.md](../shared/references/technical-advisory/cloud-service-aemaacs-guardrails.md) to lock immutable/include constraints and CDN-vs-Dispatcher boundaries.
3. Use [capability-coverage-map.md](./references/technical-advisory/capability-coverage-map.md) to route prompt/tool/resource intents to the right dispatcher skill flow.
4. Select a scenario path from [core7-capability-playbook.md](./references/technical-advisory/core7-capability-playbook.md) for development/debugging requests.
5. For conceptual questions (e.g. statfileslevel, filter order, URL decomposition, cache invalidation), use [concepts.md](./references/technical-advisory/concepts.md) and cite official docs.
6. Use curated public references for recommendations in this variant.
7. Produce MCP verification steps for this variant when needed.
8. Route execution-heavy changes to this variant's execution skills.

## Verification Scope Selection

Use shared references for deterministic coverage:

- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)

## Output Contract

Use one of these output shapes:

- Explanation-only question: recommendation summary + citation list from curated public-docs index.
- Recommendation/change question: recommendation summary + citation list + MCP verification plan with expected evidence + risk/rollback guidance and open risks.

## Guardrails

- Do not claim a check was executed unless tool evidence exists.
- Keep variant assumptions explicit for every recommendation.
- For migration/cross-variant requests, produce a side-by-side variant delta plan from the verification matrix and flag when the companion variant plugin must be run separately.
- Follow citation discipline from `public-doc-citation-rules.md`.
- Keep cloud-service-only guardrails explicit: immutable/default include contracts and CDN-vs-Dispatcher ownership.

## References

- [core7-capability-playbook.md](./references/technical-advisory/core7-capability-playbook.md) – high-value development/debugging playbooks for the current core-7 MCP contract
- [capability-coverage-map.md](./references/technical-advisory/capability-coverage-map.md) – prompt/tool/resource coverage map to current dispatcher skill workflows
- [cloud-service-aemaacs-guardrails.md](../shared/references/technical-advisory/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [concepts.md](./references/technical-advisory/concepts.md) – key concepts (filter last-match, URL decomposition, statfileslevel, invalidate vs flush) for explanations
- [public-docs-index.md](../shared/references/technical-advisory/public-docs-index.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [request-router.md](./references/technical-advisory/request-router.md)
