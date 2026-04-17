# Config Scenario Playbooks (Cloud, Core-7)

Use these deterministic playbooks for high-precision config authoring with the current core-7 MCP tools.

## Playbook A: New Site Baseline

1. Define vhosts, content roots, and required public routes.
2. Build final merged `/filter` section (deny baseline -> business allows -> targeted denies).
3. Build `/cache` section with explicit `statfileslevel` rationale and an explicit `/ignoreUrlParams` decision.
4. Add vhost/rewrite/canonical-host logic while preserving reserved probe endpoints and required cloud aliases.
5. Run `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})` -> optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed -> `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` -> `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` -> `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` (if required).
6. Verify one allow + one deny + one cache candidate at runtime.

## Playbook B: Headless/API Enablement

1. Decompose API URLs into path/selectors/extension/suffix.
2. Allow only required methods and API paths.
3. Add targeted denies for sensitive selectors/extensions.
4. Align cache/header behavior for API endpoints.
5. Verify GET/POST/OPTIONS paths with allow/deny evidence.

## Playbook C: Multi-Site / Multi-Host Routing

1. Define explicit host->farm mapping and non-overlapping patterns.
2. Ensure per-site filter boundaries and shared-asset policy are explicit.
3. Validate canonical redirects, required `*.adobeaemcloud.net` and `*.adobeaemcloud.com` alias coverage, and no cross-host leakage.
4. Capture runtime traces for each major host.

## Playbook D: Cache Invalidation Tuning

1. Document current content tree depth and publish patterns.
2. Set/adjust `statfileslevel` with expected blast-radius explanation.
3. Verify one page invalidation path and one unaffected sibling path.
4. Confirm no accidental broad invalidation behavior.

## Playbook E: Security Hardening Change

1. Start from deny-by-default and keep sensitive path denies intact.
2. Ensure targeted deny rules remain after broad allows.
3. Validate headers and method restrictions.
4. Prove deny behavior on representative sensitive paths.

## Playbook F: Vanity URL + Redirect Hygiene

1. Define vanity URL ownership and canonical destination policy.
2. Validate rewrite/redirect blocks with `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})`.
3. Use `trace_request` to confirm single-hop final destination, no loop, and no interception of `/systemready` or `/system/probes/*`.
4. Confirm query-string handling and cache behavior for vanity paths.
5. Record rollback path for broken campaign URLs.

## Playbook G: Permission-Sensitive Caching (`/auth_checker`)

1. **Create and deploy the auth-check servlet (AEM side).** Without this, Dispatcher has nothing to call. Implement a servlet at `/bin/permissioncheck` that: accepts HEAD (and optionally GET), reads query param `uri`, uses the request session to check read permission on that path (e.g. `session.checkPermission(uri, Session.ACTION_READ)`), returns 200 if authorized and 403 if not. Register with `sling.servlet.paths=/bin/permissioncheck` and allowlist that path on publish (e.g. `config.publish/org.apache.sling.servlets.resolver.SlingServletResolver.cfg.json` with `sling.servlet.paths`). See [Cache secured content](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/permissions-cache).
2. Scope protected paths and auth-check endpoint contract.
3. Add/update `/auth_checker` in the farm with least-privilege path scope; set `/allowAuthorized "1"` in `/cache`.
4. Ensure filter allows only the required auth-check endpoint (e.g. GET/HEAD `/bin/permissioncheck` only).
5. Validate and lint for overexposure or bypass risk.
6. Verify one protected URL and one public URL with `trace_request` + `inspect_cache`.

## Playbook H: CORS and Preflight for APIs

1. Enumerate allowed origins, methods, and headers.
2. Add Apache header directives for response + preflight behavior.
3. Restrict OPTIONS to required API routes only.
4. Validate with `validate({"config":"<cors/preflight block>","type":"httpd"})` and `lint({"mode":"config","target":"<cors/preflight block>","analysis_depth":"standard"})`.
5. Verify OPTIONS + GET/POST request traces for allowed and denied origins.

## Playbook I: GraphQL Persisted Query Caching

1. Confirm the endpoint is a persisted-query path and that cache enablement is intentional.
2. If enabling `CACHE_GRAPHQL_PERSISTED_QUERIES`, align CORS headers and allowed methods before changing cache posture.
3. Preserve the default bypass path when persisted-query caching is intentionally disabled.
4. Validate the vhost/httpd change set, then verify one persisted-query request and one non-cacheable control request.
5. Confirm cache behavior, response headers, and no unintended API overexposure.

## Playbook J: SDI/SSI Component Caching

1. Identify shell-vs-fragment cache boundaries.
2. Configure include paths and TTL policy for dynamic fragments.
3. Ensure filter rules permit only intended fragment endpoints.
4. Validate/lint config and confirm no broad selector exposure.
5. Verify page shell caching plus fragment freshness via runtime checks.

## Playbook K: CI/Pre-Deploy Validation Gate

1. Define required static gates: `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})`, optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed, `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`, `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`, `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})`.
2. Add optional deep gates when environment supports: `sdk({"action":"validate-full","config_path":"<dispatcher src path>"})`, `sdk({"action":"docker-test","config_path":"<dispatcher src path>"})`, `sdk({"action":"three-phase-validate","config_path":"<dispatcher src path>"})`.
3. Add minimum runtime checks for changed behavior categories.
4. Require explicit fail/waive criteria with owner and expiration for waivers.
5. Publish go/no-go output with unresolved risks and rollback trigger.

## Playbook L: Probe-Safe Rewrite And Redirect Changes

1. Enumerate every custom rewrite, redirect, and canonical-host rule that can match root or system paths.
2. Preserve pass-through behavior for `/systemready` and `/system/probes/*`.
3. Validate vhost/rewrite syntax and trace the probe URLs plus one normal site URL.
4. Confirm readiness endpoints do not depend on customer redirect maps becoming active too early.
5. Record a rollback edit that restores the prior rewrite block verbatim.

## Playbook M: Validator Compatibility Hardening

1. Confirm topology first: `dispatcher.any` includes `enabled_farms/*.farm`; `dispatcher_vhost.conf` includes `enabled_vhosts/*.vhost`.
2. Verify enabled files are symlinks in `conf.d/enabled_vhosts` and `conf.dispatcher.d/enabled_farms`.
3. Ensure at least one vhost has `ServerAlias "*.adobeaemcloud.net"` and `ServerAlias "*.adobeaemcloud.com"`.
4. Ensure no vhost sets `ServerName "*"` and no farm include points to unknown include locations.
5. Check that probe paths and core cloud defaults (`AllowEncodedSlashes NoDecode`, `DirectorySlash Off`, `DispatcherUseProcessedURL On`, `DispatcherPassError 0`) were not broken by custom edits.
6. Run static chain (`validate` -> `lint` -> `sdk(check-files)` -> optional `sdk(diff-baseline)`).
7. If a local dispatcher validator is available, run `validator full <dispatcher-src>` as corroboration and map warnings/errors to exact file edits.

## Playbook N: Client Header Forwarding Or Host Contract Changes

1. Identify exactly which upstream behavior depends on the header change: auth, session, host routing, protocol awareness, tracing, or feature integration.
2. Preserve the managed `default_clientheaders.any` include unless there is a strong reason to replace it.
3. Validate the surrounding farm config, then review the final `/clientheaders` block for removals of `Authorization`, `Cookie`, `Host`, `X-Forwarded-Proto`, or `x-request-id`.
4. Verify one representative request path for the affected feature and one control path that should remain unchanged.
5. Record the feature-specific rollback in case backend auth or routing behavior regresses.

## Playbook O: Managed Default Compatibility Review

1. When changing `filters.any`, `rules.any`, `rewrite.rules`, or `clientheaders.any`, first list which managed default include the wrapper currently brings in.
2. Confirm whether the change adds a delta around the default or replaces the default behavior.
3. Preserve supported feature paths for CSRF, GraphQL, persisted queries, Forms, Screens, and managed rewrite protections unless the user explicitly wants to change them.
4. Run static validation plus at least one representative runtime trace for the touched feature family.
5. Call out any intentionally dropped default behavior as a release risk, not just a diff detail.
