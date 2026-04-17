# Dispatcher Test Case Catalog

Use these IDs when proposing or reporting verification scenarios.

## Filter Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `FILT-001` | Confirm deny-by-default baseline | non-whitelisted URL | denied | `trace_request` |
| `FILT-002` | Confirm explicit allow path | known public content URL | allowed | `trace_request` |
| `FILT-003` | Verify method restriction | `POST` to read-only URL | denied | `trace_request` |
| `FILT-004` | Verify selector/extension control | unexpected selector/extension | denied | `trace_request` |

## Cache Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `CACHE-001` | Static asset cache candidate | versioned asset URL | cache object exists | `inspect_cache` |
| `CACHE-002` | Personalized endpoint bypass | authenticated/personalized URL | bypass or non-cache | `trace_request` |
| `CACHE-003` | Invalidation behavior | URL after flush | refreshed content path | `inspect_cache` |
| `CACHE-004` | Hit-ratio trend sanity | incident window metrics | no sustained regression | `monitor_metrics` |
| `CACHE-005` | Managed non-cacheable endpoint preserved | `/libs/granite/csrf/token.json` | not cached | `inspect_cache` or `trace_request` |

## Rewrite/Redirect Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `RW-001` | Canonical redirect correctness | non-canonical host URL | single expected redirect | `trace_request` |
| `RW-002` | Loop prevention | path with rewrite chain | terminates without loop | `trace_request` |
| `RW-003` | Query-string preservation | URL with query params | preserved or dropped as designed | `trace_request` |
| `RW-004` | Reserved probe path safety | `/systemready` or `/system/probes/ready` | no customer redirect/rewrite interference | `trace_request` |
| `RW-005` | Environment-sensitive passthrough behavior | `/crx/de/index.jsp` or `/content/test-site/` | behavior matches intended environment only | `trace_request` |
| `RW-006` | Managed persisted-query rewrite preserved | `/graphql/execute.json/...` | request still follows intended persisted-query rewrite/caching path | `trace_request` |

## Header / Contract Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `HDR-001` | Preserve required forwarded auth/session headers | protected or authenticated feature request | no regression caused by dropped forwarded headers | `trace_request` + static review |
| `HDR-002` | Preserve host/protocol forwarding assumptions | canonical host or forwarded-host-sensitive URL | routing matches intended host/protocol contract | `trace_request` |

## Runtime Incident Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `INC-001` | Quantify impact window | incident timestamps | clear error/latency trend | `monitor_metrics` |
| `INC-002` | Capture concrete failing sample | failing request URL | correlated log evidence | `tail_logs` |
| `INC-003` | Compare healthy vs failing flow | one healthy + one failing URL | divergent stage identified | `trace_request` |
| `INC-004` | Validate cache contribution | incident-related cache key | cache role confirmed | `inspect_cache` |

## Mode Compatibility Coverage

| Test ID | Goal | Example Input | Expected Result | Primary Tool |
|---|---|---|---|---|
| `MODE-001` | Cloud static validity | config package in cloud mode | valid in `cloud` | `validate` |
| `MODE-002` | Required cloud alias coverage | enabled vhost set | `*.adobeaemcloud.net` and `*.adobeaemcloud.com` present | `sdk(action="check-files")` or validator |
| `MODE-003` | Include graph drift | changed include files | no unsafe drift | `sdk(action="diff-baseline")` |
| `MODE-004` | Cloud safety vhost posture | unmatched host behavior | catch-all and safety-vhost behavior still behave safely | static review + runtime trace when possible |

## Minimum Selection Rule

For configuration changes, include at least:

- one filter test
- one cache test
- one rewrite/redirect test if rewrite logic changed
- one mode test for selected `cloud` mode
