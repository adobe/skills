# AEM 6.5 / AMS Guardrails (Core-7)

Use this checklist before proposing or applying Dispatcher/HTTPD changes in AMS deployments.

## 1) Tier Topology And Farm Ordering

Treat AMS as a multi-tier topology when applicable:

- author tier (`000_ams_author_farm.any`)
- optional LiveCycle/forms tier (`001_ams_lc_farm.any`)
- publish tier (`999_ams_publish_farm.any`)

Farm matching is order-sensitive; keep numeric-prefix ordering explicit and deterministic.

## 2) Variable-Driven Renders And Docroots

Prefer AMS variables over hardcoded endpoints and paths:

- publish: `${PUBLISH_IP}`, `${PUBLISH_PORT}`, `${PUBLISH_DOCROOT}`
- author: `${AUTHOR_IP}`, `${AUTHOR_PORT}`, `${AUTHOR_DOCROOT}`
- optional forms tier: `${LIVECYCLE_IP}`, `${LIVECYCLE_PORT}`, `${LIVECYCLE_DOCROOT}`

For 6.5/AMS guidance, flag hardcoded render hosts/docroots as drift risk unless intentionally required.

When advising where to manage defaults, point to `conf.d/variables/ams_default.vars`.

## 3) Author vs Publish Behavior Boundaries

Keep tier-specific directives in the correct farm:

- author-only patterns: `/sessionmanagement`, `/homepage`
- publish-only vanity polling: `/vanity_urls` with `/delay`
- cache policy defaults should explain why `statfileslevel`, `/enableTTL`, `/serveStaleOnError`, and `/gracePeriod` are chosen

Do not copy author session behavior into publish farms.

## 4) Flush/Invalidation Safety

Treat flush access as a security control:

- `/allowedClients` must be deny-first, then explicit publish IP allows
- avoid wildcard allow patterns for flush endpoints
- keep replication-based flush setup aligned across publish instances
- keep invalidate allow-list updates scoped to mutable AMS files (for example `ams_*_invalidate_allowed.any`)
- when recommending `statfileslevel`, include blast-radius reasoning and one sibling-path non-impact check

## 5) Immutable vs Mutable File Boundaries

Do not propose edits in Adobe-managed immutable defaults. Keep changes in mutable include points (custom vhost/rewrite/filter/cache/renders/clientheaders files and enabled symlink targets).

When a recommendation would touch immutable files, return a compliant alternative using mutable includes.

## 6) AMS Preflight Verification (Core-7 + Host Check)

Minimum static evidence before sign-off:

1. `validate({"config":"<changed dispatcher content>","type":"ams"})`
2. `lint({"mode":"directory","target":"<dispatcher src path>","strict_mode":true})`
3. `sdk({"action":"check-files","config_path":"<dispatcher src path>"})`
4. `sdk({"action":"diff-baseline","config_path":"<dispatcher src path>"})` for drift-sensitive changes

Runtime evidence when behavior changed:

- `trace_request({"url":"<representative url>","config_path":"<dispatcher src path>"})`
- `inspect_cache({"url":"<representative cacheable url>","config_path":"<dispatcher src path>"})`

Host syntax check when command access exists:

- `httpd -t` (or `apachectl configtest`)

## 7) Output Expectations For AMS Recommendations

Always include:

- explicit AMS assumption and affected tier (`author`/`publish`/`livecycle`)
- whether farm ordering or tier routing behavior changed
- variables affected (`PUBLISH_*`, `AUTHOR_*`, optional `LIVECYCLE_*`)
- flush ACL impact (`/allowedClients`) when invalidation paths are touched
- residual risk when runtime or host syntax checks were unavailable

## Public References

- AMS dispatcher intro: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/what-is-the-dispatcher
- AMS basic file layout: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/basic-file-layout
- AMS config files: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/explanation-config-files
- AMS variables: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/variables
- AMS immutable files: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/immutable-files
- AMS flushing: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-flushing
- AMS vanity URLs: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-vanity-url
- Dispatcher invalidation by folder level: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-files-by-folder-level
- Invalidating Dispatcher cache from AEM: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-dispatcher-cache-from-aem
