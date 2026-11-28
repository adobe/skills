# Core-7 Capability Playbook (AMS)

Use this guide to achieve high-precision Dispatcher development/debugging outcomes with the **current 7-tool MCP contract**:

- `validate`
- `lint`
- `sdk`
- `trace_request`
- `inspect_cache`
- `monitor_metrics`
- `tail_logs`

This playbook captures high-value behavior previously spread across broader tool/prompt/resource surfaces and adapts it to the core execution contract.

For complete prompt/tool/resource coverage mapping, use `capability-coverage-map.md`.

## Capability -> Core-7 Mapping

| Capability | Core-7 equivalent pattern |
|---|---|
| `generate` config snippets | Use `config-patterns.md` + produce full merged section, then `validate` + `lint` |
| `simulate` invalidation/rewrite/request flow | Use `trace_request` and `inspect_cache` for runtime evidence; use static rule reasoning when runtime unavailable |
| `rewrite_rules` helper | Use Apache-focused `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})` + redirect-chain traces via `trace_request` |
| `troubleshoot` helper | Use scenario playbooks below with `monitor_metrics`, `tail_logs`, `trace_request`, `inspect_cache`. To get the full log trace for one request: use **tail_logs** to obtain entries (some include **pid** and **tid**), then **trace_request(pid=..., tid=...)** — see config-authoring [mcp-tool-orchestration.md](../../../config-authoring/references/config-authoring/mcp-tool-orchestration.md) § Trace by pid:tid. |
| `explain` directive helper | Use `concepts.md` + `public-docs-index.md` citation mapping |
| `get_knowledge` helper | Use curated docs index and citation rules; cite source set explicitly |
| MCP prompts/resources discovery | Use these deterministic playbooks and output contracts in skill references |

## Development Playbooks

### 1) New Config / Major Refactor

1. Decompose representative URLs (path/selectors/extension/suffix).
2. Apply `ams-6-5-guardrails.md` for tier boundaries, variable usage, flush ACL policy, and immutable constraints.
3. Produce full merged sections for `/filter`, `/cache`, vhost/rewrite blocks.
4. `validate({"config":"<merged dispatcher content>","type":"dispatcher"})`; for Apache blocks also run `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})`.
5. `lint({"mode":"config","target":"<merged dispatcher content>","analysis_depth":"deep"})` for filter-heavy edits.
6. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`; `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` when drift matters.
7. Runtime checks on one allow, one deny, one cache candidate.

Deliver:
- file-level change intent
- final merged sections
- test IDs + outcomes
- risk/rollback

### 2) Filter Rule Authoring

1. Build deny-by-default baseline.
2. Add explicit business allows.
3. Add targeted sensitive denies **after** broad allows (last-match wins).
4. Verify selector/suffix-specific URLs and method constraints.
5. `validate({"config":"<filter section content>","type":"dispatcher","config_type":"filter"})` + `lint({"mode":"config","target":"<filter section content>","analysis_depth":"deep"})`.
6. `trace_request` on allow/deny overlap URLs.

Deliver:
- final `/filter` section with stable ordering
- overlap proof where deny still wins

### 3) Rewrite and Redirect Changes

1. Validate Apache rewrite blocks with `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})`.
2. Validate dispatcher blocks separately with `validate({"config":"<dispatcher.any section>","type":"dispatcher","config_type":"dispatcher.any"})`.
3. Use `trace_request` to confirm canonical single-hop redirects and no loop.
4. Confirm query-string behavior explicitly.

Deliver:
- redirect-chain evidence
- loop-prevention evidence

### 4) Cache Strategy Changes

1. Validate `/cache`, invalidation, and related headers.
2. `lint` for cache-policy regressions.
3. `inspect_cache` for one cache-hit and one expected bypass.
4. `monitor_metrics` to verify no sustained hit-ratio regression.

Deliver:
- pre/post cache evidence
- invalidation scope rationale (`statfileslevel`)

### 5) Pre-Deploy Gate

1. `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})` -> optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed -> `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` -> `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` -> `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})`.
2. Run minimum runtime checks for changed behavior type.
3. Record skipped checks and required environment for completion.

Deliver:
- go/no-go with unresolved risks

## Debugging Playbooks

### 6) Cache Miss Investigation

1. `inspect_cache` target URL.
2. `trace_request` to identify filter/cache stage behavior.
3. `tail_logs` for correlated request lines.
4. `monitor_metrics` for broader MISS trend.
5. Validate related config blocks (`validate`, `lint`).

### 7) 502/5xx Spike Investigation

1. `monitor_metrics` incident window and error trend.
2. `tail_logs` representative failures.
3. `trace_request` failing vs healthy URL.
4. `inspect_cache` for collateral cache impact.
5. `validate({"config":"<suspect changed content>","type":"dispatcher"})` + `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` + `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` for recent config regressions.

### 8) URL Blocked / Unexpected 403

1. `trace_request` target URL and method.
2. Map URL decomposition to matching filter rules.
3. Prove whether block is intended by policy.
4. If change required, add minimal allow without weakening sensitive denies.
5. Re-run allow+deny overlap tests.

## Source Discipline

- Use `public-docs-index.md` for source selection.
- Follow `public-doc-citation-rules.md` topic-to-citation minimums.
- Separate tool evidence from doc-based guidance.

## Completion Criteria

A response is complete when it includes:

1. exact files/sections changed (or proposed)
2. executed checks and evidence
3. selected test IDs from `test-case-catalog.md`
4. clear rollback trigger + action
5. citations for non-trivial claims
6. AMS tier and variable assumptions for behavior-changing guidance
