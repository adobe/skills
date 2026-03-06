# Dispatcher Config Patterns

Use these patterns when creating or editing Dispatcher configs.

## Sling URL Decomposition (applies to all URL-based rules)

**Dispatcher uses Sling URL decomposition everywhere:** filter rules, cache rules, and any other config that matches or reasons about request URLs. Request path is split into:

- **path** – resource path (before the first dot)
- **selectors** – dot-separated before extension (e.g. `page.print.a4` in `en.page.print.a4.html`)
- **extension** – after the last dot before suffix (e.g. `html`)
- **suffix** – path segment after extension (e.g. `/products/item`)

When authoring or reviewing **any** URL-based rule (filter, cache, etc.), decompose the target URL first and use path/selectors/extension/suffix—or globs aligned to this model—rather than raw URL strings. Reference: [Dispatcher configuration – Content filter](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter).

## Filter Rules

**Evaluation order (Adobe):** When multiple filter patterns apply to a request, **the last applied filter pattern is effective.** (Source: [Dispatcher configuration – Content filter](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter).) So to deny a path that is already matched by a broader allow, place the **deny rule after** that allow (e.g. at the end of the filter file or after the include that contains the allow). Rule IDs (e.g. `/0005`, `/0299`) do not control evaluation order—file order does.

Preferred posture:
1. Start deny-first (broad deny baseline).
2. Add explicit allows per business route.
3. Keep targeted denies for sensitive/internal paths; place these **after** any broader allow that could match the same path so the deny wins.

Guidelines:
- Avoid broad allows such as `/url "*"` with weak constraints.
- Prefer path + method + selector/extension constraints.
- **Use Sling URL decomposition by default:** Per the section above, write allow/deny rules using `/path`, `/selectors`, `/extension`, `/suffix`—not raw `/url`—for Sling-style URLs (e.g. `/abc/a.html/abc.html` → path `/abc`, selectors `a`, extension `html`, suffix `/abc.html`).
- Keep ordering intentional to avoid accidental bypasses (remember: last match wins).
- Keep rule numbering deterministic and aligned to existing file conventions.

## Precision Authoring Blueprint

When generating or revising filters, always produce the **final merged `/filter` section** (or clearly scoped include file), not one-off standalone rules.

Recommended layout:

1. baseline deny-all rule block
2. business allow rules (paths/methods/selectors/extensions)
3. targeted deny block for sensitive paths/selectors/extensions that must override broad allows
4. method restrictions and edge-case deny rules

Precision requirements:

- Keep numbering blocks intentional (example: `000x` baseline, `010x` business allows, `020x+` targeted denies).
- For each new allow rule, list at least one explicit deny overlap check and show why it still denies as intended.
- Preserve stable ordering when editing existing files; avoid unnecessary renumbering churn.
- Document exact include/file location where the merged block belongs.

## Cache Rules

Guidelines:
- **Use Sling URL decomposition:** When targeting specific URLs in cache rules (allow/deny), reason in terms of path/selectors/extension/suffix; align `/glob` or path patterns with that model so cache behavior matches request structure.
- Cache only anonymous-safe, stable responses.
- Exclude authenticated/personalized endpoints by default.
- Treat query-parameter caching as opt-in and narrowly scoped.
- Keep invalidation behavior (`statfileslevel`, flush patterns) aligned with freshness requirements.

Content class defaults:
- Static versioned assets: long-lived cache candidates.
- HTML/content pages: conservative cache policy with revalidation.
- API/GraphQL: short or no cache unless stability is explicit.

## Vhosts and Farm Mapping

Guidelines:
- Keep host matching explicit and non-overlapping.
- Keep vhost -> farm mapping deterministic and documented.
- Keep canonical host/redirect behavior explicit.

Pitfalls:
- overlapping host globs sending traffic to wrong farms
- missing redirects causing duplicate-host behavior

## Rewrite Rules

Guidelines:
- Order from most specific to least specific.
- Prevent redirect loops and over-broad matches.
- Preserve query strings only when behavior requires it.
- Avoid rewriting internal/system paths unless explicitly intended.

## Headers and Hardening

Guidelines:
- Keep security headers consistent on public vhosts.
- Keep cache headers aligned with cache policy.
- Avoid exposing backend/internal headers.

## Include Hygiene

Before finalizing:
- confirm each new file is reachable from active farm/vhost includes
- follow existing numeric prefix/file order conventions
- remove dead files and contradictory duplicate directives

## Pre-Finalization Checklist

- Filter posture remains least-privilege.
- Cache and header policy are consistent.
- Rewrite behavior is deterministic and loop-free.
- Include graph contains all changed files exactly once where intended.
