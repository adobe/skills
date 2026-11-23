# Security Scenario Playbooks (AMS, Core-7)

## Playbook 1: Baseline Hardening Audit

1. Validate and lint current config.
2. Verify deny-by-default and sensitive path blocks.
3. Check headers and cache-related exposure controls.
4. Confirm runtime deny behavior for representative sensitive URLs.

## Playbook 2: URL Blocklist Verification

1. Select high-risk paths (`/crx/*`, `/system/*`, etc.).
2. Trace each path and confirm deny outcome.
3. Ensure targeted denies are ordered after any broader allows.
4. Record residual risk if any sensitive route remains reachable.

## Playbook 3: Pre-Release Security Gate

1. Run static chain: `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})` -> optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed -> `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` -> `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` -> optional `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})`.
2. Run runtime checks for key sensitive paths and header evidence.
3. Produce risk-rated findings and remediation priority.

## Playbook 4: Method and Selector Abuse Defense

1. Enumerate risky methods/selectors/extensions in project context.
2. Verify deny rules for non-required methods and dangerous selectors.
3. Validate overlap behavior where broad allows exist.
4. Re-test representative exploit-style URLs via `trace_request`.

## Playbook 5: Security Header Regression Audit

1. Inspect current response-header policy for top routes.
2. Validate Apache header directives syntax and placement.
3. Verify runtime header evidence on success and error paths.
4. Flag mandatory vs defense-in-depth header gaps separately.

## Playbook 6: Flush/Invalidation Exposure Review

1. Confirm `/allowedClients` is restricted and explicit.
2. Verify flush/invalidate routes are not publicly reachable.
3. Trace representative requests to ensure deny outcome externally.
4. Provide rollback-safe remediation sequence for exposure findings.

## Playbook 7: AMS Tier-Boundary Security Review

1. Confirm author-only directives and routes are not reachable from publish hostnames.
2. Verify publish catch-all routes cannot expose author/admin surfaces.
3. Validate farm/vhost ordering prevents cross-tier leakage.
4. Capture deny evidence for representative cross-tier abuse attempts.

## Playbook 8: AMS Variable and Immutable Drift Security Gate

1. Check render/docroot values for hardcoded endpoints that bypass environment controls.
2. Run `sdk(action="check-files")` for immutable/include drift.
3. Flag recommendations that require immutable edits and replace with mutable-include alternatives.
4. Return explicit risk if full host-level syntax/runtime proof is unavailable.

## Playbook 9: CSRF Endpoint Hardening Review

1. Confirm CSRF token endpoints remain explicitly reachable only as required by application flows.
2. Ensure CSRF token responses are excluded from cache rules and cannot be served stale from dispatcher cache.
3. Validate dispatcher and (if changed) Apache snippets, then trace one valid token request and one abuse-style variant.
4. Document exact deny/allow evidence and cite the Dispatcher CSRF hardening guidance.
