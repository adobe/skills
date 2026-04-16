# Dispatcher Key Concepts (Advisory)

Use this reference when explaining Dispatcher behavior. Cite Experience League as the source of truth.

## Filter Rules – Evaluation Order

**When multiple filter patterns apply to a request, the last applied filter pattern is effective.**

- Source: [Dispatcher configuration – Content filter](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter).
- Rule IDs (e.g. `/0005`, `/0299`) are labels only; they do **not** determine order. Order in the config file determines which rule is "last" for a given request.
- To **deny** a path that is already matched by a broader **allow** (e.g. `/content/*`), place the deny rule **after** that allow (e.g. at the end of the filter file or after the include that contains the allow).

## URL Decomposition For Dispatcher Rules

**Sling URL decomposition is the default request model across Dispatcher:** filter rules, cache rules, and any other URL-based rules all reason about requests in terms of path, selectors, extension, and suffix. Use this decomposition whenever authoring or analyzing URL-based config.

Example URL:
`/content/wknd/us/en.page.print.a4.html/products/item?ref=nav`

- resource path: `/content/wknd/us/en`
- selectors: `page`, `print`, `a4`
- extension: `html`
- suffix: `/products/item`
- query string: `ref=nav` (outside Dispatcher path matching)

Source: [Dispatcher configuration – Content filter](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter)

Guidance:
- **Filters:** Use `/path`, `/selectors`, `/extension`, `/suffix` (not raw `/url`) for Sling-style URLs.
- **Cache rules:** Reason about what to cache using the same path/selectors/extension/suffix breakdown; globs or path patterns should align with this model.
- Match selectors/extension explicitly when behavior depends on render variant.
- Do not treat suffix as part of the resource path.
- When asked to "decompose a URL", return the five-part breakdown above before proposing rule changes.

## Cache – statfileslevel

- **`/statfileslevel`** controls folder-level cache invalidation. Dispatcher creates `.stat` files in folders from docroot up to the configured level (docroot = 0).
- When content is invalidated (e.g. on publish), only `.stat` files **along the path** to the invalidated resource are touched; sibling branches are not invalidated.
- Higher `statfileslevel` = more granular invalidation = better cache persistence for unchanged content.
- Source: [Invalidating files by folder level](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-files-by-folder-level).

## Cache – Invalidate vs Flush

- **Auto-invalidate** (e.g. on replication): Dispatcher touches `.stat` files; cached documents are refetched when requested if the `.stat` is newer than the cached file.
- **Flush** (explicit): Cache files are deleted (or a flush request is sent). Use for bulk or targeted flush from AEM.
- Source: [Invalidating Dispatcher cache from AEM](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-dispatcher-cache-from-aem).

## Cache – Freshness And Failure Controls

- **`/serveStaleOnError`** allows stale cache delivery when the backend is unavailable; it improves resilience but can hide origin instability if overused.
- **`/gracePeriod`** defines how long auto-invalidated stale resources may still be served during activation bursts.
- **`/enableTTL`** makes Dispatcher honor backend `Cache-Control`/`Expires` for cached resource expiry.
- **`/allowAuthorized "0"`** is the safe default for public publish traffic; do not enable authorized caching without a clear permission model and verification plan.

For cloud guidance, treat the current managed sample-farm values (`serveStaleOnError=1`, `gracePeriod=2`, `enableTTL=1`, `allowAuthorized=0`) as the baseline and justify any deviation explicitly.

## HTTPD / Dispatcher Integration Defaults

- **`DispatcherUseProcessedURL On`** means rewrite processing affects what Dispatcher evaluates and forwards.
- **`DispatcherPassError 0`** keeps backend error handling behavior at the Dispatcher/AEM boundary unless deliberately changed.
- **`DispatcherUseForwardedHost`** controls whether `X-Forwarded-Host` influences host handling; treat host-forwarding behavior as a cloud trust-boundary setting.
- **`DispatcherRestrictUncacheableContent On`** strips cache headers added by `mod_expires` from content that should stay uncacheable.

When reviewing regressions in routing, redirects, or cache semantics, verify whether one of these integration settings explains the behavior before editing filters or cache rules.

## Managed Default Includes Are Product Behavior, Not Noise

In AEMaaCS, the wrapper files (`rewrite.rules`, `filters.any`, `rules.any`, `clientheaders.any`, `virtualhosts.any`) extend managed defaults. Those defaults are not just examples; they encode supported cloud behavior.

Examples from the managed cloud baseline:
- `default_clientheaders.any` forwards auth/session/tracing headers needed by common AEM features
- `default_filters.any` allows supported endpoints for CSRF, GraphQL, persisted queries, Forms, and Screens
- `default_rules.any` denies caching on specific unsafe endpoints such as CSRF token responses
- `default_rewrite.rules` blocks common spoof/abuse patterns and rewrites persisted GraphQL requests for cache compatibility

Advice implication:
- do not remove or rewrite these includes casually
- when customizing, add the minimum delta around them and verify the supported feature path still behaves correctly

## Header Forwarding And Upstream Contract

`/clientheaders` controls which request headers reach AEM. Removing a header can break authentication, tracing, host handling, or feature behavior without producing obvious syntax failures.

High-sensitivity forwarded headers in the cloud baseline include:
- `Authorization`
- `Cookie`
- `Host`
- `X-Forwarded-Proto`
- `x-request-id`

When a feature fails only after a clientheaders change, audit the header contract before changing filters or rewrites.

## Persisted GraphQL Cache Rewrite

The managed default rewrite layer rewrites `^/graphql/execute.json` requests with a `;.json` suffix using `[PT]`. This is there so Dispatcher can cache persisted-query responses with a usable extension-backed cache file name.

Advice implication:
- if persisted-query caching or routing changes, verify this rewrite path still works
- treat persisted GraphQL behavior as the combination of filter rules, rewrite rules, cache settings, and CORS policy

## Cloud Runtime Reserved And Environment-Sensitive Paths

- `/systemready` and `/system/probes/*` are cloud-runtime endpoints, not normal customer routes.
- `/crx/(de|server)/` is intentionally proxied only in `ENVIRONMENT_DEV`.
- `/content/test-site/` is intentionally proxied in `ENVIRONMENT_DEV` and `ENVIRONMENT_STAGE`.
- Commerce GraphQL, frontend-static, and Dynamic Media delivery paths have managed proxy/no-rewrite behavior in the base cloud vhost.

Advice implication:
- do not recommend blanket denies or redirects on these paths without considering environment and cloud-managed behavior
- distinguish customer-exposed routes from cloud-managed baseline routes

## Security Posture

- Prefer deny-by-default: broad deny first, then explicit allows. Targeted denies for sensitive paths must appear **after** any matching allow (last match wins).
- Source: [Security checklist](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist).

## AEMaaCS-Specific

- For Cloud, also consider: [Caching in AEMaaCS](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/caching), [CDN](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn), [Traffic filter rules / WAF](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/traffic-filter-rules-including-waf).
