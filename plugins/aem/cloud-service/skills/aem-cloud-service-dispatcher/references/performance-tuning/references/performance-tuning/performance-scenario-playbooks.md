# Performance Scenario Playbooks (Cloud, Core-7)

## Playbook 1: Improve Cache Hit Ratio

1. Capture baseline via `monitor_metrics`.
2. Identify top MISS/PASS URLs using `tail_logs` and `trace_request`.
3. Validate candidate cache-rule changes with `validate` + `lint`.
4. Verify affected URLs using `inspect_cache`.
5. Compare post-change metrics.

## Playbook 2: Invalidation Blast-Radius Reduction

1. Document current invalidation behavior and `statfileslevel`.
2. Validate proposed changes with static checks.
3. Verify one invalidated path and one sibling unaffected path.
4. Confirm no stale-content regression indicators.

## Playbook 3: Rewrite/Redirect Latency Cleanup

1. Trace redirect-heavy URLs.
2. Remove redundant chains and re-validate.
3. Confirm deterministic final destination in one hop where possible.
4. Compare latency trends before/after.

## Playbook 4: Static Asset Delivery Optimization

1. Audit compression and cache-header posture for CSS/JS/fonts/images.
2. Validate Apache header/expires/deflate changes with `validate({"config":"<httpd header/expires/deflate block>","type":"httpd"})`.
3. Verify cacheability and response behavior on representative static assets.
4. Compare post-change cache-hit and latency metrics.

## Playbook 5: Query-Parameter Cache Fragmentation Cleanup

1. Sample high-traffic URLs with marketing/query params from logs.
2. Review and tighten `/ignoreUrlParams` allow-list policy (include marketing parameter strategy where applicable).
3. Validate/lint updated cache config and run `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`.
4. Reuse or mirror the existing `marketing_query_parameters.any` pattern for common tracking params when business-safe.
5. Ensure the common cloud validator warning about missing `/ignoreUrlParams` strategy is addressed.
6. Verify equivalent content resolves to consistent cache behavior.

## Playbook 6: Tail-Latency Hotspot Mitigation

1. Use `monitor_metrics` to isolate p95/p99 hotspots.
2. `trace_request` top offenders and identify filter/rewrite/backend causes.
3. Apply minimal changes with highest expected impact.
4. Re-measure p95/p99 and keep rollback thresholds explicit.

## Playbook 7: Persisted Query Cache Enablement

1. Confirm persisted-query traffic is a real latency or backend-load hotspot.
2. Check whether `CACHE_GRAPHQL_PERSISTED_QUERIES` is currently disabled by default and document the current bypass behavior.
3. If enabling cache, align CORS and preflight handling first so cached GraphQL responses do not break browser clients.
4. Validate httpd/vhost changes and verify one persisted-query path plus one non-cacheable GraphQL control path.
5. Compare cache behavior and latency after the change, with a rollback path that reverts only the persisted-query toggle and related headers.

## Playbook 8: Cloud Cache Operations Runbook (Enable/Disable/Purge)

1. Identify whether the need is targeted purge, temporary cache disable, or selective cache enablement.
2. Apply the smallest scope change first (single path/pattern before global behavior changes).
3. Validate config changes with `validate` + `lint`, then verify behavior with `inspect_cache` and `trace_request`.
4. If purge is used, confirm origin freshness and downstream CDN/dispatcher alignment to avoid stale rehydration loops.
5. Capture rollback steps and cite the cloud caching how-to guidance (enable, disable, purge).
