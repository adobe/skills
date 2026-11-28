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
3. Verify final destination is stable and single-hop where expected, and that `/systemready` and `/system/probes/*` are still untouched.
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

## Playbook 9: Validator Failure Signature Triage

1. Re-run `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` and `validate` to capture current failure text.
2. Map failure signatures quickly:
   - `unable to find any farm` -> check `conf.dispatcher.d/enabled_farms/*.farm` existence and symlinks
   - `no file found for matching pattern: conf.d/enabled_vhosts/*.vhost` -> check enabled vhost symlink topology
   - `included file (...) does not match any known file` -> move include back to validator-supported locations
   - `ServerName directive is set to '*'` -> set explicit server name and rely on `ServerAlias` for host coverage
   - `Statfileslevel ... below 0` -> restore non-negative `statfileslevel` and re-verify invalidation intent
3. Check for warnings that should still be resolved before release (`MissingRequiredServerAlias`, `ignoreUrlParams` warning).
4. Apply smallest patch that removes the error signature and re-run static checks before runtime validation.

## Playbook 10: Probe Or Readiness Endpoint Regression

1. Check whether the failing path is `/systemready` or one of `/system/probes/live`, `/system/probes/start`, `/system/probes/ready`, `/system/probes/health`.
2. Inspect recent vhost/rewrite changes first; these endpoints are cloud-reserved and should not be redirected or filtered by customer rules.
3. Use `trace_request` on the failing probe path and one normal content URL to isolate whether the regression is path-specific or global.
4. If managed rewrite maps are in use, account for readiness gating when `/tmp/rewrites/ready` is not present yet.
5. Restore the smallest prior-safe rewrite or vhost block and re-run static validation before declaring containment.
