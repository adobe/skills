# Cloud Verification Matrix

Use this matrix to select the minimum acceptable verification set for `cloud` mode.

## How To Use

1. Pick the change or incident type.
2. Execute required static checks.
3. Execute runtime checks when behavior is runtime-sensitive.
4. Record evidence in the skill output contract.

## Verification Matrix (`cloud`)

| Scenario | Required Static Checks | Required Runtime Checks | Minimum Evidence |
|---|---|---|---|
| Filter rule changes | `validate`, `lint`, `sdk(action="check-files")` | `trace_request` for allow + deny URL samples in SDK runtime | pass/fail outputs + two URL traces |
| Cache behavior changes | `validate`, `lint`, `sdk(action="check-files")`, `sdk(action="diff-baseline")` | `inspect_cache` + `monitor_metrics` hit ratio trend | cache object evidence + pre/post hit signal |
| Rewrite/redirect changes | `validate`, `lint` | `trace_request` for redirect chain in cloud local runtime | deterministic redirect outcome evidence, plus proof that `/systemready` and `/system/probes/*` remain untouched |
| Client header / host contract changes | `validate`, `lint`, `sdk(action="check-files")` | `trace_request` on affected feature path | final `/clientheaders` block review plus request-path evidence for host/auth/protocol behavior |
| Header/security hardening | `validate`, `lint` | `inspect_cache(show_metadata=true)` + optional external HTTP header probe (for example `curl -sI`) | static header directives + cache metadata + optional live probe output |
| Incident triage (4xx/5xx spike) | `validate`, `lint` | `monitor_metrics`, `tail_logs`, `trace_request`, `inspect_cache` | incident window + correlated evidence |
| Cloud readiness | `validate({"config":"<dispatcher.any content>","type":"cloud"})`, `lint`, `sdk(action="check-files")`, `sdk(action="diff-baseline")` | runtime checks in cloud SDK context if available | readiness findings + risk table, including symlink topology, wildcard `ServerAlias`, reserved probe-path safety, and include-graph compatibility |
| GraphQL persisted-query caching | `validate`, `lint`, `sdk(action="check-files")` | `trace_request` + `inspect_cache` on persisted-query and control URLs | cache/header evidence plus explicit CORS outcome |

## Skip Rules

You may skip runtime checks only when runtime prerequisites are unavailable. If skipped, state:

- exactly which checks were skipped
- why they were skipped
- what remains unverified
- what environment is required to complete verification

## Examples

### Example 1: Filter Rule Change

**Scenario:** Add allow rule for `/content/site/api/*` with `GET` method only.

```text
# Static checks
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
validate({"config":"<dispatcher.any content>","type":"cloud"})

# Runtime verification
trace_request({
  "url": "/content/site/api/products.json",
  "method": "GET",
  "config_path": "/path/to/dispatcher/src"
})
```

### Example 2: Cache Behavior Investigation

**Scenario:** Investigate why `/content/site/en.html` is not caching as expected.

```text
inspect_cache({"url":"/content/site/en.html","config_path":"/path/to/dispatcher/src"})
monitor_metrics({"window_minutes":10,"breakdown_by":"status_code"})
tail_logs({"lines":100,"filter_cache_status":"MISS"})
```

### Example 3: Cloud Readiness Validation

**Scenario:** Validate config works in cloud mode.

```text
validate({"config":"<dispatcher.any content>","type":"cloud"})
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
sdk({"action":"diff-baseline","config_path":"/path/to/dispatcher/src"})
```

**Common Issues Found:**
- hardcoded container paths
- Docker-specific directive mistakes
- include graph and filter logic regressions
- missing `ServerAlias "*.adobeaemcloud.net"` / `"*.adobeaemcloud.com"` coverage
- missing `/ignoreUrlParams` strategy for marketing/query parameter cache control
- custom rewrites intercepting `/systemready` or `/system/probes/*`
- dropped managed default includes or header forwarding causing feature regressions
