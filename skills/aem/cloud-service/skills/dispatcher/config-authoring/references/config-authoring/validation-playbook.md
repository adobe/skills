# Validation Playbook

Use this flow after every dispatcher/httpd change.

## 1) Local Project Validation

When available:

```bash
cd dispatcher && ./bin/validate.sh src
```

If unavailable, run the equivalent project command and record it.

## 2) MCP Static Checks

Run in order:

1. `validate`
2. `lint`
3. `sdk(action="check-files")`
4. `sdk(action="diff-baseline")` when compliance/drift is requested

## 3) MCP Runtime Checks (Conditional)

Run when runtime behavior is in scope:

1. `trace_request`
2. `inspect_cache`
3. `monitor_metrics`
4. `tail_logs`

## 4) SDK Runtime/Deep Checks (Conditional)

Use only when environment supports it:

- `sdk(action="validate")`
- `sdk(action="validate-full")`
- `sdk(action="three-phase-validate")`
- `sdk(action="docker-test")`

## 5) URL Verification Matrix

Cover at least one case each:

- expected allow URL
- expected deny URL
- expected cache-hit candidate
- expected cache-bypass candidate
- rewrite/redirect path (if rewrite changed)
- selector-sensitive URL (for example `.model.json` vs `.html`)
- suffix-bearing URL (for example `/page.html/suffix/path`)
- query-string variant that should not bypass filters unintentionally
- method variant (`GET`/`POST`/`OPTIONS`) when method constraints exist

When the config has a path matched by both a broader allow (e.g. `/content/*`) and a later deny (e.g. deny `/content/mysite*`), the **last rule (deny) must win**. Include at least one expected deny URL that exercises this (e.g. a path under the denied subtree). See [config-patterns.md](config-patterns.md) for filter evaluation order.

For each test URL, capture:

- URL decomposition (path/selectors/extension/suffix)
- expected matching rule ID(s)
- expected final decision (allow/deny/cacheable/non-cacheable)
- evidence source (`trace_request`, `inspect_cache`, or static rule analysis when runtime unavailable)

## 6) Reporting Requirements

Always report:

- executed checks and outcomes
- failed checks with exact error
- skipped checks and why
- confirmed facts vs assumptions
- next checks required for production confidence
- selected test case IDs from [test-case-catalog.md](../technical-advisory/test-case-catalog.md)
- rollback trigger and rollback action for behavior-changing edits
