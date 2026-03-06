---
name: technical-advisory
description: Provide Dispatcher/HTTPD advisory guidance for AEM 6.5 / AMS workflows only, with public-doc citations and AMS-specific MCP verification plans. Use for conceptual questions such as `statfileslevel`, filter rules, URL decomposition, cache invalidation behavior, rewrite behavior, and security headers.
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

# Dispatcher Technical Advisory (AMS)

Provide deterministic guidance for AEM 6.5/AMS dispatcher use cases.

## Variant Scope

- This skill is AMS-only.
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
2. Use [capability-coverage-map.md](./references/technical-advisory/capability-coverage-map.md) to route prompt/tool/resource intents to the right dispatcher skill flow.
3. Select a scenario path from [core7-capability-playbook.md](./references/technical-advisory/core7-capability-playbook.md) for development/debugging requests.
4. For conceptual questions (e.g. statfileslevel, filter order, URL decomposition, cache invalidation), use [concepts.md](./references/technical-advisory/concepts.md) and cite official docs.
5. Apply [ams-6-5-guardrails.md](../shared/references/technical-advisory/ams-6-5-guardrails.md) before recommendations (tier boundaries, variables, flush ACL, immutable constraints).
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

## References

- [core7-capability-playbook.md](./references/technical-advisory/core7-capability-playbook.md) – high-value development/debugging playbooks for the current core-7 MCP contract
- [capability-coverage-map.md](./references/technical-advisory/capability-coverage-map.md) – prompt/tool/resource coverage map to current dispatcher skill workflows
- [concepts.md](./references/technical-advisory/concepts.md) – key concepts (filter last-match, URL decomposition, statfileslevel, invalidate vs flush) for explanations
- [ams-6-5-guardrails.md](../shared/references/technical-advisory/ams-6-5-guardrails.md) – AMS topology/variables/flush and immutable-file constraints
- [public-docs-index.md](../shared/references/technical-advisory/public-docs-index.md)
- [public-doc-citation-rules.md](../shared/references/technical-advisory/public-doc-citation-rules.md)
- [mode-specific-verification-matrix.md](../shared/references/technical-advisory/mode-specific-verification-matrix.md)
- [test-case-catalog.md](../shared/references/technical-advisory/test-case-catalog.md)
- [change-risk-and-rollback-template.md](../shared/references/technical-advisory/change-risk-and-rollback-template.md)
- [request-router.md](./references/technical-advisory/request-router.md)
