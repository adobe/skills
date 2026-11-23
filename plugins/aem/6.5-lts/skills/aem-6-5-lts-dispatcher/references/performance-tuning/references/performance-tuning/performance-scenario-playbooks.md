# Performance Scenario Playbooks (AMS, Core-7)

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
2. Review and tighten `/ignoreUrlParams` allow-list policy.
3. Validate/lint updated cache config.
4. Verify equivalent content resolves to consistent cache behavior.

## Playbook 6: Tail-Latency Hotspot Mitigation

1. Use `monitor_metrics` to isolate p95/p99 hotspots.
2. `trace_request` top offenders and identify filter/rewrite/backend causes.
3. Apply minimal changes with highest expected impact.
4. Re-measure p95/p99 and keep rollback thresholds explicit.

## Playbook 7: AMS Tier-Specific Performance Drift

1. Confirm whether regression is author-tier, publish-tier, or both.
2. Verify render/docroot variables are correct for affected tier (`AUTHOR_*` vs `PUBLISH_*`).
3. Check invalidation behavior for publish tier (`statfileslevel`, flush ACL correctness, sibling-path impact).
4. For vanity-heavy traffic, verify `/vanity_urls` refresh interval (`/delay`) is not over-aggressive.
5. Capture before/after metrics split by representative tier URL set.
