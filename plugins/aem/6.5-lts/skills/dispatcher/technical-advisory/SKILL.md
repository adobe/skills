---
name: technical-advisory
description: Provide advisory guidance for the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEM 6.5 / AMS workflows only, with public-doc citations and AMS-specific MCP verification plans. Use for conceptual questions such as `statfileslevel`, filter rules, URL decomposition, cache invalidation behavior, rewrite behavior, and security headers.
license: Apache-2.0
compatibility: Requires Dispatcher MCP for AMS (`AEM_DEPLOYMENT_MODE=ams`) or AMS Dispatcher MCP SDK (pre-set to `ams`).
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Technical Advisory (AMS)

Provide deterministic guidance for AEM 6.5/AMS use cases involving the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration.

## Variant Scope

- This skill is AMS-only.
- Scope is fixed by this skill directory; do not ask the user to choose deployment variant.

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
2. If the repo layout or execution path is unclear, start with [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) and [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md).
3. Use [capability-coverage-map.md](./references/technical-advisory/capability-coverage-map.md) to route prompt/tool/resource intents to the right dispatcher skill flow.
4. Select a scenario path from [core7-capability-playbook.md](./references/technical-advisory/core7-capability-playbook.md) for development/debugging requests.
5. For conceptual questions (e.g. statfileslevel, filter order, URL decomposition, cache invalidation), use [concepts.md](./references/technical-advisory/concepts.md) and cite official docs.
6. Apply [ams-6-5-guardrails.md](./references/dispatcher-foundation/ams-6-5-guardrails.md) before recommendations (tier boundaries, variables, flush ACL, immutable constraints).
7. Convert the selected playbook to exact MCP commands with [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md).
8. Use curated public references for recommendations in this variant.
9. Produce MCP verification steps for this variant when needed.
10. Route execution-heavy changes to this variant's execution skills.

## Verification Scope Selection

Use shared references for deterministic coverage:

- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)

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
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – single entry path for broad or first-time requests
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – normalize repos to the dispatcher `src` root and likely file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – deterministic linkage from playbooks to MCP commands and tests
- [ams-6-5-guardrails.md](./references/dispatcher-foundation/ams-6-5-guardrails.md) – AMS topology/variables/flush and immutable-file constraints
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
- [request-router.md](./references/technical-advisory/request-router.md)
