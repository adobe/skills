# Validation Playbook

Use this flow after every dispatcher/httpd change.

## 1) Local Project Validation

When available:

```bash
cd dispatcher && ./bin/validate.sh src
```

If unavailable, run the equivalent project command and record it.

When an equivalent local validator binary or source build is available, run a corroborating pass against a representative dispatcher config root:

```bash
validator full /path/to/dispatcher/src
validator httpd /path/to/dispatcher/src
validator dispatcher /path/to/dispatcher/src
```

Expected baseline in a valid sample config:

- `full` returns success with a warning about `/ignoreUrlParams` strategy
- `httpd` returns success
- `dispatcher` returns success with the same `/ignoreUrlParams` warning

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

## 6) Cloud Structure Assertions (Always Check)

- `conf.d/enabled_vhosts/*.vhost` and `conf.dispatcher.d/enabled_farms/*.farm` are symlinks
- at least one vhost provides `ServerAlias "*.adobeaemcloud.net"` and `ServerAlias "*.adobeaemcloud.com"`
- no `ServerName "*"` directives remain
- farm include paths remain validator-compatible (`clientheaders`, `virtualhosts`, `default_renders.any`, `filters.any`, `rules.any`, `default_invalidate.any`)
- `/ignoreUrlParams` strategy is explicit (recommended to include marketing parameter handling)
- reserved cloud probe paths (`/system/probes/live`, `/system/probes/start`, `/system/probes/ready`, `/system/probes/health`, `/systemready`) are not intercepted by custom rewrites, redirects, or filters
- core cloud vhost defaults remain intact or intentionally replaced with evidence: `AllowEncodedSlashes NoDecode`, `ModMimeUsePathInfo On`, `DirectorySlash Off`, `DispatcherUseProcessedURL On`, `DispatcherPassError 0`, and the intended host-forwarding behavior
- GraphQL persisted-query caching changes include explicit CORS verification if `CACHE_GRAPHQL_PERSISTED_QUERIES` is enabled
- wrapper includes still retain managed defaults unless intentionally replaced (`default_clientheaders.any`, `default_filters.any`, `default_rules.any`, `default_rewrite.rules`, `default_virtualhosts.any`)
- `clientheaders.any` changes preserve required auth/session/tracing headers unless feature evidence proves otherwise
- rewrite changes preserve default spoof/abuse protections and persisted-query cache rewrite semantics unless the replacement is explicitly validated

## 7) Reporting Requirements

Always report:

- executed checks and outcomes
- failed checks with exact error
- skipped checks and why
- confirmed facts vs assumptions
- next checks required for production confidence
- selected test case IDs from [test-case-catalog.md](../dispatcher-foundation/test-case-catalog.md)
- rollback trigger and rollback action for behavior-changing edits
