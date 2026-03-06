# AEMaaCS Cloud Guardrails (Core-7)

Use this checklist before proposing or applying Dispatcher/HTTPD changes in AEMaaCS.

## 1) Cloud-Only Structure Constraints

Treat the cloud dispatcher tree as the source of truth (`dispatcher/src/...`).

Do not modify Adobe-managed immutable defaults directly. Customer changes belong in mutable files (for example custom `*.vhost`, `filters.any`, `rules.any`, `clientheaders.any`, `virtualhosts.any`, `rewrite.rules`, and custom farm files).

Reference docs:
- Cloud Dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview
- Validation/debugging and file rules: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/validation-debug

## 2) Required Include Invariants

Keep these invariants intact for cloud validation compatibility:

- `/renders` must include `../renders/default_renders.any`
- `/allowedClients` must include `../cache/default_invalidate.any`
- `$include` usage must stay in supported sections (`/clientheaders`, `/filters`, `/rules`, `/virtualhosts`)

If a proposal changes include topology, require explicit compatibility proof.

## 3) Path, Variable, and Runtime Assumptions

- Prefer cloud variables (for example `${DOCROOT}`) over hardcoded container paths.
- Avoid assumptions tied to local host file paths in final customer config.
- For local SDK checks, separate local execution paths from deployable cloud config.

## 4) Unsupported/Boundary Rules In Cloud

- Do not rely on `.htaccess`-based behavior for cloud dispatcher design.
- Do not propose custom invalidation handlers as a default cloud pattern.
- Keep `mod_security`/WAF concerns at CDN traffic-filter/WAF layer when applicable.

Reference docs:
- Traffic filter rules / WAF: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/traffic-filter-rules-including-waf
- CDN overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn

## 5) CDN vs Dispatcher Decision Boundary

Use Dispatcher/HTTPD for:
- filter rules, cache rules, vhost and rewrite behavior close to AEM routing
- request handling that depends on Dispatcher farm/filter/cache semantics

Use CDN configuration for:
- edge traffic filtering/WAF/rate limiting
- CDN-native redirects/error-page behavior and cache purge policies

When both are possible, document why one layer is chosen.

## 6) Cloud Preflight Verification (Core-7)

Minimum static evidence before sign-off:

1. `validate({"config":"<changed dispatcher content>","type":"cloud"})`
2. `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`
3. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`
4. `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` for drift-sensitive changes

Runtime evidence when behavior changed:

- `trace_request({"url":"<representative url>","config_path":"<dispatcher src path>"})`
- `inspect_cache({"url":"<representative cacheable url>","config_path":"<dispatcher src path>"})`

## 7) Output Expectations For Cloud Recommendations

Always include:
- explicit cloud assumption (`AEMaaCS`)
- whether any immutable/default include contract is impacted
- whether concern belongs to Dispatcher layer or CDN layer
- residual risk if runtime proof was not available
