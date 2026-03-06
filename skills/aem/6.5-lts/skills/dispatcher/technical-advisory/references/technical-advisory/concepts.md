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

## AMS Farm Ordering and Tier Routing

- AMS topologies commonly separate author/publish (and optional forms) into distinct farms with ordered matching.
- Keep farm routing deterministic so author routes do not leak into publish catch-all behavior.
- Source: [AMS basic file layout](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/basic-file-layout), [AMS config files](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/explanation-config-files).

## AMS Tier-Specific Directive Boundaries

- Author-tier patterns can include `/sessionmanagement` and `/homepage`.
- Publish-tier vanity polling uses `/vanity_urls` with `/delay`.
- Flush ACLs should remain deny-first with explicit allowed source IPs only.
- Sources: [Secure sessions/session management](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#enabling-secure-sessions-sessionmanagement), [Vanity URLs](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#enabling-vanity-urls), [AMS flushing](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-flushing).

## AMS Variable-Driven Configuration

- Prefer AMS variables (`PUBLISH_*`, `AUTHOR_*`, optional `LIVECYCLE_*`) for render/docroot and tier-specific configuration values.
- Hardcoded render/docroot values should be treated as environment-drift risk unless explicitly required.
- Source: [AMS variables](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/variables).

## Security Posture

- Prefer deny-by-default: broad deny first, then explicit allows. Targeted denies for sensitive paths must appear **after** any matching allow (last match wins).
- Source: [Security checklist](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist).
