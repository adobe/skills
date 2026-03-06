# Symptom -> Hypothesis Matrix (Cloud, Core-7)

Use this table to form evidence-backed hypotheses quickly.

| Symptom | First Checks | Likely Dispatcher-Side Causes | Next Action |
|---|---|---|---|
| 502 spike | `monitor_metrics`, `tail_logs`, `trace_request` | render timeout/routing mismatch, upstream instability indicators in logs | compare failing vs healthy trace path; validate render/vhost config |
| 403 increase | `trace_request`, `tail_logs` | filter-order regression, method/selector deny overlap | map matching rules and verify last-match behavior |
| MISS surge | `monitor_metrics`, `inspect_cache`, `trace_request` | cache rule bypass, invalidation blast radius too broad, docroot mismatch | inspect cache object path and invalidation behavior |
| stale content | `inspect_cache`, `trace_request`, `tail_logs` | flush/invalidation not applied, `statfileslevel` mismatch, stale headers | verify invalidate path and stat file behavior |
| latency regression | `monitor_metrics`, `tail_logs`, `trace_request` | redirect chains, increased backend dependency, reduced cacheability | trace hot URLs and compare stage behavior pre/post |

Hypothesis discipline:

1. Mark each hypothesis with confidence (`low|medium|high`).
2. Attach at least one confirming or disconfirming check.
3. Do not present hypothesis as root cause until corroborated.
