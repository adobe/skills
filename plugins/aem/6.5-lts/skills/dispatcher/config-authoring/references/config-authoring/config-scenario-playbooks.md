# Config Scenario Playbooks (AMS, Core-7)

Use these deterministic playbooks for high-precision config authoring with the current core-7 MCP tools.

## Playbook A: New Site Baseline

1. Define AMS tier scope (`author`, `publish`, optional `livecycle`) plus vhosts/content roots.
2. Keep farm routing deterministic (author-first, publish catch-all) and avoid overlap regressions.
3. Build final merged `/filter` section (deny baseline -> business allows -> targeted denies).
4. Build `/cache` section with explicit `statfileslevel` rationale and tier-appropriate behavior.
5. Add vhost/rewrite/canonical-host logic and keep render/docroot values variable-driven (`AUTHOR_*`, `PUBLISH_*`).
6. Run `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})` -> optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed -> `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})` -> `sdk({"action":"check-files","config_path":"<dispatcher src path>"})` -> `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` (if required).
7. Verify one allow + one deny + one cache candidate at runtime.

## Playbook B: Headless/API Enablement

1. Decompose API URLs into path/selectors/extension/suffix.
2. Allow only required methods and API paths.
3. Add targeted denies for sensitive selectors/extensions.
4. Align cache/header behavior for API endpoints.
5. Verify GET/POST/OPTIONS paths with allow/deny evidence.

## Playbook C: Multi-Site / Multi-Host Routing

1. Define explicit host->farm mapping and non-overlapping patterns.
2. Ensure per-site filter boundaries and shared-asset policy are explicit.
3. Validate canonical redirects and no cross-host leakage.
4. Capture runtime traces for each major host.

## Playbook D: Cache Invalidation Tuning

1. Document current content tree depth and publish patterns.
2. Set/adjust `statfileslevel` with expected blast-radius explanation.
3. Confirm flush ACL policy: deny-first `/allowedClients` + explicit publish IP allows only.
4. Verify one page invalidation path and one unaffected sibling path.
5. Confirm no accidental broad invalidation behavior.

## Playbook E: Security Hardening Change

1. Start from deny-by-default and keep sensitive path denies intact.
2. Ensure targeted deny rules remain after broad allows.
3. Validate headers and method restrictions.
4. Prove deny behavior on representative sensitive paths.

## Playbook F: Vanity URL + Redirect Hygiene

1. Define vanity URL ownership and canonical destination policy.
2. If using Dispatcher vanity servlet in AMS publish, keep `/vanity_urls` with explicit `/delay`.
3. Validate rewrite/redirect blocks with `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})`.
4. Use `trace_request` to confirm single-hop final destination and no loop.
5. Confirm query-string handling and cache behavior for vanity paths.
6. Record rollback path for broken campaign URLs.

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

## Playbook I: SDI/SSI Component Caching

1. Identify shell-vs-fragment cache boundaries.
2. Configure include paths and TTL policy for dynamic fragments.
3. Ensure filter rules permit only intended fragment endpoints.
4. Validate/lint config and confirm no broad selector exposure.
5. Verify page shell caching plus fragment freshness via runtime checks.

## Playbook J: CI/Pre-Deploy Validation Gate

1. Define required static gates: `validate({"config":"<changed dispatcher.any content>","type":"dispatcher"})`, optional `validate({"config":"<changed vhost/rewrite content>","type":"httpd","config_type":"vhost"})` when Apache files changed, `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`, `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`, `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})`.
2. Add optional deep gates when environment supports: `sdk({"action":"validate-full","config_path":"<dispatcher src path>"})`, `sdk({"action":"docker-test","config_path":"<dispatcher src path>"})`, `sdk({"action":"three-phase-validate","config_path":"<dispatcher src path>"})`.
3. Add minimum runtime checks for changed behavior categories.
4. Require explicit fail/waive criteria with owner and expiration for waivers.
5. Publish go/no-go output with unresolved risks and rollback trigger.

## Playbook K: AMS Tier Routing and Variable Safety

1. Confirm author/publish tier intent and which farm each route should hit.
2. Ensure render/docroot values use AMS variables instead of hardcoded host paths.
3. Verify author-only directives (`/sessionmanagement`, `/homepage`) do not leak into publish farm.
4. Verify publish-specific directives (`/vanity_urls` with `/delay`, flush ACLs) remain in publish context.
5. Validate with `type:"ams"` and capture one representative author and publish trace when available.
