---
name: config-authoring
description: Create, modify, review, and harden configuration for the Adobe Dispatcher Apache HTTP Server module and Apache HTTPD in AEM as a Cloud Service environments only. Use for `.any`, vhost, rewrite, cache, and filter changes.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for cloud (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# Dispatcher Config Authoring (Cloud)

Design minimal, deterministic changes for the Adobe Dispatcher Apache HTTP Server module and related HTTPD configuration in AEMaaCS, then verify with MCP evidence.

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

- `validate`
- `lint`
- `sdk`
- `trace_request`
- `inspect_cache`
- `monitor_metrics`
- `tail_logs`

## Workflow

```text
Cloud Config Progress
- [ ] 1) Confirm scope and acceptance criteria; if the repo layout is unclear, normalize it with `repo-layout-workflows.md`
- [ ] 2) Apply cloud guardrails (immutable files, required includes, symlink topology, required wildcard ServerAlias coverage, reserved probe paths, preserved cloud vhost defaults, CDN-vs-Dispatcher boundary)
- [ ] 3) Decompose target URLs (path/selectors/extension/suffix) and use that model for all URL-based rules—filters, cache rules, etc.—using `/path`, `/selectors`, `/extension`, `/suffix` or aligned globs (not raw `/url`) where applicable; then design complete section-level edits
- [ ] 4) Update config with least-privilege defaults (produce final merged section, not isolated rule snippets)
- [ ] 5) Run static checks: validate -> lint (deep/order-aware when filters changed)
- [ ] 6) Run SDK checks: `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`, `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` as needed
- [ ] 7) Run runtime verification in container-backed environment
- [ ] 8) Return diff, evidence table, risk/rollback, and citations
```

## Verification Scope Selection

Use the shared references to select the minimum evidence set:

- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)

## Output Contract

Always include:

- files changed + intent
- exact insertion location and final merged section content for each edited block
- checks executed + evidence
- selected test IDs
- risk/rollback plan
- residual risks and next checks

## Feature cross-boundary (Playbook G)

Permission-sensitive caching (`/auth_checker`) is end-to-end: it requires both Dispatcher config and an AEM servlet. When implementing Playbook G from scratch, create or verify the auth-check servlet in the project core bundle (path `/bin/permissioncheck`, HEAD/GET, 200 or 403) and allowlist it on publish; then add the `/auth_checker` block, filter allow for the endpoint, and `/allowAuthorized "1"` in `/cache`. See [config-scenario-playbooks.md](./references/config-authoring/config-scenario-playbooks.md) Playbook G and [reference-snippets.md](./references/config-authoring/reference-snippets.md).

## Guardrails

- Do not weaken deny-by-default security posture without explicit user approval.
- Do not claim runtime verification if container/runtime prerequisites were missing.
- Keep changes minimal and scoped.
- Enforce cloud guardrails from `cloud-service-aemaacs-guardrails.md` before proposing config edits.

## References

- [config-patterns.md](./references/config-authoring/config-patterns.md)
- [config-scenario-playbooks.md](./references/config-authoring/config-scenario-playbooks.md) – high-value development scenarios adapted from broader MCP surfaces to core-7 execution
- [reference-snippets.md](./references/config-authoring/reference-snippets.md) – reusable starter snippets for consistent config authoring
- [validation-playbook.md](./references/config-authoring/validation-playbook.md)
- [mcp-tool-orchestration.md](./references/config-authoring/mcp-tool-orchestration.md)
- For **runtime prompts** and **troubleshooting scenarios** (tail_logs, trace_request, monitor_metrics, inspect_cache), use the **incident-response** skill reference `runtime-prompts-and-troubleshooting-scenarios.md` when incident triage is needed.
- [quick-start-execution-path.md](./references/dispatcher-foundation/quick-start-execution-path.md) – single entry path for new users and broad requests
- [local-sdk-execution.md](./references/dispatcher-foundation/local-sdk-execution.md) – shipped local SDK launcher contract for `docker_run.sh`, hot reload, and runtime env vars
- [repo-layout-workflows.md](./references/dispatcher-foundation/repo-layout-workflows.md) – map the user repo to the dispatcher `src` root and likely file families
- [playbook-command-linkage.md](./references/dispatcher-foundation/playbook-command-linkage.md) – convert selected playbooks into exact MCP command chains
- [mode-specific-verification-matrix.md](./references/dispatcher-foundation/mode-specific-verification-matrix.md)
- [cloud-service-aemaacs-guardrails.md](./references/dispatcher-foundation/cloud-service-aemaacs-guardrails.md) – cloud-service-only immutable/include/runtime boundary checks from AEMaaCS patterns
- [test-case-catalog.md](./references/dispatcher-foundation/test-case-catalog.md)
- [change-risk-and-rollback-template.md](./references/dispatcher-foundation/change-risk-and-rollback-template.md)
- [public-doc-citation-rules.md](./references/dispatcher-foundation/public-doc-citation-rules.md)
- [public-docs-index.md](./references/dispatcher-foundation/public-docs-index.md)
- [core-7-tools-reference.md](./references/dispatcher-foundation/core-7-tools-reference.md)
