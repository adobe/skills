# Incident Scenario Playbooks (Cloud, Core-7)

## Playbook 1: 5xx Spike

1. `monitor_metrics` incident window.
2. `tail_logs` collect failing samples.
3. `trace_request` failing + healthy URL comparison.
4. `inspect_cache` affected paths.
5. `validate({"config":"<suspect changed content>","type":"dispatcher"})` + `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` + `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` for config regressions.

## Playbook 2: Cache Miss Regression

1. `monitor_metrics` hit-ratio change.
2. `inspect_cache` sample URLs.
3. `trace_request` for cache-stage behavior.
4. `tail_logs` confirm MISS/PASS patterns.
5. Validate related filter/cache blocks.

## Playbook 3: Sudden 403/Blocked URL

1. `trace_request` URL+method.
2. map to filter rule order and last-match outcome.
3. confirm if policy-intended.
4. if not intended, propose minimal allow and re-verify.

## Playbook 4: Latency Regression

1. `monitor_metrics` p50/p95/p99 deltas.
2. `tail_logs` slow-path sampling.
3. `trace_request` stage timing on top offenders.
4. `inspect_cache` verify cacheability assumptions.
5. escalate to performance skill if structural tuning needed.

## Playbook 5: Redirect Loop or Multi-Hop Redirect

1. `trace_request` canonical URL and looping URL.
2. Compare vhost/rewrite blocks with `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})`.
3. Verify final destination is stable and single-hop where expected.
4. Record exact rollback rule for the offending redirect block.

## Playbook 6: SDK Validation Failure During Incident

1. Run targeted `sdk({"action":"validate","config_path":"<dispatcher src path>"})` or `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` on suspected scope.
2. Correlate failure output with `validate` and `lint` findings.
3. Classify as syntax, immutable-file, or environment/runtime dependency issue.
4. Propose minimal safe patch and re-run the smallest confirming check set.

## Playbook 7: Vanity URL Outage

1. Identify failing vanity paths and business impact window.
2. `trace_request` vanity URL to determine rewrite/filter failure stage.
3. `tail_logs` for 404/403/5xx evidence tied to vanity path.
4. Validate rewrite/filter edits and verify fixed vanity + non-vanity control URL.

## Playbook 8: Log-Driven Anomaly Triage

1. Use `tail_logs` sampling with status/cache filters.
2. Group pattern deltas in `monitor_metrics`.
3. Select one representative URL per anomaly class and run `trace_request`.
4. Build symptom->hypothesis table with confidence and disconfirming checks.
