# AEMaaCS Cloud Guardrails (Core-7)

Use this checklist before proposing or applying Dispatcher/HTTPD changes in AEMaaCS.

This guardrail is grounded in current cloud dispatcher configuration layouts, validator behavior, managed runtime defaults, and dispatcher/httpd semantics.

## 1) Source-Of-Truth Layout And Ownership

Treat `dispatcher/src` as the deployable config root (must contain `conf.d` and `conf.dispatcher.d`).

Do not edit cloud-managed defaults directly. Put customer intent in mutable wrappers:

- `conf.d/rewrites/rewrite.rules` (includes default rewrite rules)
- `conf.dispatcher.d/filters/filters.any` (includes default filters)
- `conf.dispatcher.d/cache/rules.any` (includes default cache rules)
- `conf.dispatcher.d/clientheaders/clientheaders.any` (includes default clientheaders)
- `conf.dispatcher.d/virtualhosts/virtualhosts.any` (includes default virtualhosts)
- custom `conf.d/available_vhosts/*.vhost` and `conf.dispatcher.d/available_farms/*.farm`

Treat these wrapper files as extension points, not replacement excuses. Preserve the include of the managed default unless there is a deliberate, evidence-backed reason to override the baseline:

- `conf.d/rewrites/rewrite.rules` should keep `default_rewrite.rules`
- `conf.dispatcher.d/filters/filters.any` should keep `default_filters.any`
- `conf.dispatcher.d/cache/rules.any` should keep `default_rules.any`
- `conf.dispatcher.d/clientheaders/clientheaders.any` should keep `default_clientheaders.any`
- `conf.dispatcher.d/virtualhosts/virtualhosts.any` should keep `default_virtualhosts.any`

Treat these as cloud-managed defaults whose semantics should be preserved unless platform documentation explicitly says otherwise:

- `conf.d/dispatcher_vhost.conf`
- `conf.dispatcher.d/dispatcher.any`
- `conf.d/available_vhosts/default.vhost`
- `conf.dispatcher.d/available_farms/default.farm`
- cloud-managed safety vhosts and unmatched-host catch-all behavior in `conf.d/dispatcher_vhost.conf`

## 2) Required Cloud Topology Invariants

Keep these invariants intact for validator compatibility:

- `conf.dispatcher.d/dispatcher.any` includes `enabled_farms/*.farm`
- `conf.d/dispatcher_vhost.conf` includes `conf.d/enabled_vhosts/*.vhost`
- `conf.d/enabled_vhosts/*.vhost` and `conf.dispatcher.d/enabled_farms/*.farm` are symlinks
- farm includes remain in known locations:
  - `/clientheaders` -> `../clientheaders/clientheaders.any`
  - `/virtualhosts` -> `../virtualhosts/virtualhosts.any`
  - `/renders` -> `../renders/default_renders.any`
  - `/filter` -> `../filters/filters.any`
  - `/cache/rules` -> `../cache/rules.any`
  - `/cache/allowedClients` -> `../cache/default_invalidate.any`
  - `/cache/ignoreUrlParams` -> `../cache/marketing_query_parameters.any` or a wrapper file at the validator-supported customer include location

If include topology changes, require explicit validator proof.

## 3) Validator-Enforced Contracts

For cloud readiness, assume these checks are mandatory:

- must find at least one enabled farm (`conf.dispatcher.d/enabled_farms/*.farm`)
- must find at least one enabled vhost (`conf.d/enabled_vhosts/*.vhost`)
- include targets must match known include locations (unknown include paths fail)
- `ServerName "*" ` is invalid and fails validation
- filename/symlink/file-size checks are part of `full`
- `ServerAlias "*.adobeaemcloud.net"` and `ServerAlias "*.adobeaemcloud.com"` are expected; currently warnings but treat as release blockers

Typical failure signatures seen in validator testdata:

- missing farm: `unable to find any farm in 'conf.dispatcher.d/enabled_farms'`
- missing vhost: `no file found for matching pattern: conf.d/enabled_vhosts/*.vhost`
- bad include location: `included file (...) does not match any known file`
- bad `ServerName`: `ServerName directive is set to '*'`
- invalid `statfileslevel`: `Statfileslevel set to -1... misconfiguration`

Important cloud warning to treat as action item:

- if `/ignoreUrlParams` is not configured, validator warns about marketing parameter strategy

## 4) Reserved Runtime Paths And Rewrite Safety

Do not repurpose or rewrite over cloud-managed health and probe paths:

- `/system/probes/live`
- `/system/probes/start`
- `/system/probes/ready`
- `/system/probes/health`
- `/systemready`

`dispatcher_vhost.conf` wires these paths for liveness, startup, readiness, and managed rewrite-map rollout behavior. Any vhost or rewrite customization must preserve their pass-through behavior and must not introduce redirects, auth gates, or filter denials on those endpoints.

When managed rewrite maps are enabled, readiness behavior depends on the rewrite-map readiness state. Do not assume redirect maps are active before readiness conditions are met.

Preserve cloud-managed vhost safety behavior as well:

- customer vhosts are included explicitly via `conf.d/enabled_vhosts/*.vhost`
- cloud-managed safety vhosts may exist ahead of customer vhosts
- an unmatched-host catch-all exists to avoid leaking customer site behavior to arbitrary hostnames

Do not remove or bypass these guards unless the user is intentionally working on those specific cloud-runtime behaviors and the change is validated end to end.

## 5) Runtime And Variable Assumptions

- prefer cloud variables (for example `${DOCROOT}`, `${AEM_IP}`) over hardcoded absolute paths
- avoid local-host assumptions in deployable files
- separate local-only SDK execution paths from final cloud config content

Preserve these cloud defaults unless the change explicitly requires otherwise and the impact is proven:

- `AllowEncodedSlashes NoDecode`
- `ModMimeUsePathInfo On`
- `DirectorySlash Off`
- `DispatcherUseProcessedURL On`
- `DispatcherPassError 0`
- `DispatcherUseForwardedHost` may be controlled by platform-provided configuration; treat host-forwarding behavior as a trust-boundary setting
- `DispatcherRestrictUncacheableContent On`

Preserve managed defaults in these extension surfaces unless the user is intentionally changing the feature:

- `default_clientheaders.any` forwards critical headers such as `Authorization`, `Cookie`, `Host`, `X-Forwarded-Proto`, and `x-request-id`
- `default_filters.any` carries supported allow rules for CSRF token fetches, GraphQL, persisted queries, Forms, Screens, clientlibs, and selected commerce-related routes
- `default_rules.any` keeps known deny cache rules such as CSRF token responses and Screens channel JSON
- `default_rewrite.rules` includes protections such as `X-Forwarded-For` spoof blocking, common abusive path blocking (`xmlrpc.php`, `wp-login`), and the persisted-query `;.json` pass-through rewrite used for cache file extension compatibility

Managed runtime behavior to respect:

- `CACHE_GRAPHQL_PERSISTED_QUERIES` requires matching CORS and endpoint verification when enabled
- `default.farm` enables `serveStaleOnError`, `gracePeriod`, and `enableTTL` by default; tune them deliberately, not accidentally

Cloud-managed environment-sensitive routes also exist:

- development-only and product-feature routes may be enabled by environment
- Commerce GraphQL endpoints, frontend-static passthrough, and Dynamic Media delivery paths may have dedicated proxy or no-rewrite handling in the cloud baseline

Do not classify these as unconditional vulnerabilities. Evaluate them by environment and by whether the behavior is intentional for the documented cloud baseline.

Design implication: do not depend on trace-level logging for production diagnostics.

## 6) CDN vs Dispatcher Decision Boundary

Use Dispatcher/HTTPD for:

- filter rules, cache rules, vhost/rewrite routing near AEM
- request handling that depends on farm/filter/cache semantics

Use CDN configuration for:

- edge traffic filtering, WAF, rate limiting
- CDN-native redirect/error-page and edge cache policy concerns

When both are possible, document why one layer is chosen.

## 7) Cloud Preflight Verification (Core-7)

Minimum static evidence before sign-off:

1. `validate({"config":"<changed dispatcher content>","type":"cloud"})`
2. `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`
3. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`
4. `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` for drift-sensitive changes

When a local dispatcher validator is available, corroborate with:

- `validator full <dispatcher-src>`
- `validator httpd <dispatcher-src>`
- `validator dispatcher <dispatcher-src>`

When local SDK runtime verification is required, use `local-sdk-execution.md` to record the launcher mode and any non-default environment variables that affect local behavior.

Runtime evidence when behavior changed:

- `trace_request({"url":"<representative url>","config_path":"<dispatcher src path>"})`
- `inspect_cache({"url":"<representative cacheable url>","config_path":"<dispatcher src path>"})`

Also verify these cloud-specific invariants when relevant:

- reserved probe paths still bypass custom rewrites/redirects
- platform-managed safety vhosts and unmatched-host behavior remain intact
- custom vhosts still provide the required `adobeaemcloud.net` and `adobeaemcloud.com` alias coverage
- query-parameter cache strategy is explicit if cache behavior changed
- GraphQL persisted-query caching changes include matching CORS verification
- default client header forwarding is still sufficient for the feature set in use
- default rewrite protections and supported product endpoint rewrites remain intact unless intentionally replaced

## 8) Output Expectations For Cloud Recommendations

Always include:

- explicit cloud assumption (`AEMaaCS`)
- whether immutable/default include contracts were impacted
- whether concern belongs to Dispatcher layer or CDN layer
- which validator/lint/runtime checks were executed vs skipped
- residual risk if runtime proof was not available

Reference docs:

- Cloud Dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview
- Validation/debugging and file rules: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/validation-debug
- Traffic filter rules / WAF: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/traffic-filter-rules-including-waf
- CDN overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn
