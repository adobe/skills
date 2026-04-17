# Security Scenario Playbooks (Cloud, Core-7)

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
2. Run runtime checks for key sensitive paths, reserved probe paths, and header evidence.
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

## Playbook 7: Probe And Health Endpoint Safety Review

1. Check `/systemready` and `/system/probes/*` against vhost, rewrite, and filter rules.
2. Verify customer redirects, canonical-host logic, or auth rules do not intercept these endpoints.
3. Confirm readiness and health paths stay reachable according to cloud defaults.
4. Escalate any interception as a release-blocking finding because it can break platform health behavior.

## Playbook 8: CSRF Endpoint Hardening Review

1. Confirm CSRF token endpoints remain explicitly reachable only where required by application behavior.
2. Ensure cache rules continue to bypass CSRF token responses and that no custom rewrite/filter change weakens this.
3. Validate dispatcher/httpd changes, then trace one valid token flow and one abuse-style variant.
4. Document runtime evidence and cite Dispatcher CSRF hardening plus cloud default compatibility rationale.
