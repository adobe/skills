# AMS Verification Matrix

Use this matrix to select the minimum acceptable verification set for `ams` mode.

## How To Use

1. Pick the change or incident type.
2. Execute required static checks.
3. Execute runtime checks when behavior is runtime-sensitive.
4. Record evidence in the skill output contract.

## Verification Matrix (`ams`)

| Scenario | Required Static Checks | Required Runtime Checks | Minimum Evidence |
|---|---|---|---|
| Filter rule changes | `validate`, `lint`, `sdk(action="check-files")` | `trace_request` against AMS path and vhost behavior | pass/fail outputs + two URL traces |
| Cache behavior changes | `validate`, `lint`, `sdk(action="check-files")`, `sdk(action="diff-baseline")` | `inspect_cache` + `tail_logs` cache decisions | cache object evidence + cache decision log signal |
| AMS tier/farm routing changes | `validate({"config":"<dispatcher.any/farm content>","type":"ams"})`, `lint`, `sdk(action="check-files")` | `trace_request` with representative host/path per affected tier | tier routing evidence + no cross-tier leakage |
| Flush/invalidation ACL changes | `validate`, `lint`, `sdk(action="check-files")` | `trace_request` deny proof for non-allowlisted source (or documented limitation) | deny-first `/allowedClients` evidence + explicit allowlist entries |
| Rewrite/redirect changes | `validate`, `lint` | `trace_request` + `tail_logs` for rewrite evaluation | deterministic redirect outcome evidence |
| Header/security hardening | `validate`, `lint` | `inspect_cache(show_metadata=true)` + optional external HTTP header probe (for example `curl -sI`) | static header directives + cache metadata + optional live probe output |
| Incident triage (4xx/5xx spike) | `validate`, `lint` | `monitor_metrics`, `tail_logs`, `trace_request`, `inspect_cache` | incident window + correlated evidence |
| AMS readiness | `validate({"config":"<dispatcher.any content>","type":"ams"})`, `lint`, `sdk(action="check-files")`, `sdk(action="diff-baseline")` | runtime checks in AMS host-path context if available | readiness findings + risk table |

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
validate({"config":"<dispatcher.any content>","type":"ams"})

# Runtime verification
trace_request({
  "url": "/content/site/api/products.json",
  "method": "GET",
  "config_path": "/path/to/dispatcher/src"
})
tail_logs({"log_path":"/var/log/httpd/dispatcher.log","lines":100})
```

### Example 2: Cache Behavior Investigation

**Scenario:** Investigate why `/content/site/en.html` is not caching as expected.

```text
inspect_cache({"url":"/content/site/en.html","config_path":"/path/to/dispatcher/src"})
monitor_metrics({"window_minutes":10,"breakdown_by":"status_code"})
tail_logs({"log_path":"/var/log/httpd/dispatcher.log","lines":100})
```

### Example 3: AMS Readiness Validation

**Scenario:** Validate config works in AMS mode.

```text
validate({"config":"<dispatcher.any content>","type":"ams"})
lint({"mode":"directory","target":"/path/to/dispatcher/src","strict_mode":true})
sdk({"action":"check-files","config_path":"/path/to/dispatcher/src"})
sdk({"action":"diff-baseline","config_path":"/path/to/dispatcher/src"})
```

**Common Issues Found:**
- host-path assumptions and log path mismatches
- hardcoded render/docroot values instead of AMS variables
- immutable-file/include graph violations
- filter and rewrite regressions
