# IA extraction (sitemap + crawl)

How `extract` discovers the page inventory before crawling. This phase
runs **before** Playwright touches a single page; the goal is to know
the shape of the site so the user can confirm scope and the cap.

---

## Discovery order

1. **`<origin>/sitemap.xml`** — fetch with a `User-Agent: stardust/0.2`
   header. If 200 and well-formed XML, parse `<url><loc>` entries.
   Capture optional `<priority>` and `<lastmod>` for sorting.
2. **`<origin>/sitemap_index.xml`** — if (1) is missing or returns
   the index variant, parse all referenced sitemaps. **Recurse**: if
   any referenced sitemap is itself an index, follow it. Continue
   until every entry is a leaf (URL list, not another index). See
   § Recursive sitemap traversal.
3. **`<origin>/robots.txt`** — parse for `Sitemap:` directives. If
   present and pointing at a different URL than (1) or (2), fetch it.
   Apply the same recursion rule.
4. **BFS crawl** — fallback when no sitemap is reachable. Start from
   `<url>`, render with Playwright (same recipe as Phase 2 but only
   capturing `<a href>` and document title), enqueue same-origin
   internal links. Depth-limit 3, breadth-limit 200 visited URLs
   regardless of cap (so we have something to prioritise from). De-dup
   trailing slashes and `?utm_*`-style tracking params.

Every URL extracted from any source — `<loc>` value, robots
`Sitemap:` directive, BFS-found `<a href>` — must pass through
§ URL normalization before being added to the discovered set, and
every relative URL must pass through § Relative-URL resolution
before normalization.

If multiple discovery sources return overlapping URLs, prefer
sitemap-declared metadata (priority, lastmod) over crawl order.

## Relative-URL resolution

Sitemap protocol allows `<loc>` to be either absolute or relative.
Hugo, Rails, and many custom CMSs emit relative `<loc>` values
(`/newsletter/2023-06-23/` rather than
`https://example.com/newsletter/2023-06-23/`). A spec that doesn't
resolve them silently drops every URL.

For every `<loc>` value (and every `Sitemap:` directive in
`robots.txt`):

```
resolved = new URL(loc, sitemapUrl).href
```

Where `sitemapUrl` is the URL of the sitemap file the entry came from
(not `<origin>` — a sitemap may live at any path, e.g.
`https://example.com/sitemaps/pages.xml`). If resolution throws
(`Invalid URL`), drop the entry, record under
`_crawl-log.json#discovery.malformed[]` with the raw value, and
continue. Do not crash discovery on a single malformed entry.

## URL normalization

Apply to every URL before adding to the discovered set:

1. **Lowercase scheme and host.** `HTTPS://Example.COM/About` →
   `https://example.com/About`. Path case is preserved (paths are
   case-sensitive on most servers).
2. **Strip default ports.** `https://x.com:443/` → `https://x.com/`,
   `http://x.com:80/` → `http://x.com/`.
3. **Trailing slash on bare-host URLs.** `https://x.com` →
   `https://x.com/`. Other paths keep whatever trailing slash they
   came with (server behavior varies; the deduplication step handles
   collapsing).
4. **Strip fragments.** `/about#team` → `/about`. Already done for
   fragment-only links per § Filtering; this extends the rule to
   fragment-bearing real links.
5. **Decode percent-encoded reserved characters** in the path so
   `%2D` → `-`, `%5F` → `_`, etc. Do not decode reserved characters
   that change semantics (`%2F` stays as `%2F` in the path so it does
   not become a path separator).
6. **Strip tracking params** — `utm_*`, `gclid`, `fbclid`, `mc_*`,
   `_ga`, `ref`, `source`. Keep all other query strings; some sites
   serve distinct content at different `?` values.
7. **Collapse trailing-slash duplicates.** If both `/foo` and
   `/foo/` are seen, keep the form preferred by `<link rel="canonical">`
   if available on the page; otherwise keep the trailing-slash form
   (more common in sitemaps).

### www vs bare host

When both `https://example.com/` and `https://www.example.com/` are
seen during discovery (rare but happens with cross-host link
extraction during BFS):

1. Resolve the canonical via the home page's `<link rel="canonical">`
   if available — that wins.
2. Otherwise, prefer the form the user passed as `<url>` to the
   `extract` command.
3. Surface the divergence in `_crawl-log.json#discovery.notes` so
   the user knows what was deduplicated.

Treat the chosen form as canonical; rewrite every other-form URL to
the canonical before adding to the seen set.

## Recursive sitemap traversal

A sitemap may itself be an index of sitemaps. Recurse depth-first
until every leaf is a URL list:

1. Fetch the sitemap. Detect kind: `<sitemapindex>` vs `<urlset>`.
2. If `<urlset>`, extract `<loc>` entries (resolve + normalize per
   above) and stop.
3. If `<sitemapindex>`, extract child sitemap URLs (resolve +
   normalize per above) and recurse into each.
4. Concatenate the leaf URL sets.

Recursion safeguards:

- **Depth cap: 3.** Beyond that, drop deeper indexes and warn — a
  sitemap-index nested ≥4 levels deep is almost certainly a loop or a
  pathological structure.
- **Cycle detection.** Maintain a visited-sitemap-URLs set; refuse to
  re-fetch one already in flight.
- **Sanity limit: 10,000 page URLs concatenated.** When the limit
  triggers, truncate to the first 10,000 and emit an informational
  notice:

  ```
  Discovered 24,318 page URLs across 7 leaf sitemaps. Truncated
  discovery to the first 10,000 for scoring; the page-type
  checklist + IA-keyword scoring picks 5 from those. Pass --all
  to fetch every leaf sitemap if you need the full set.
  ```

  No confirmation gate — the post-discovery cap of 5 means the
  user is going to extract a small subset anyway, and the IA-keyword
  scoring is reliable at picking the right pages from a partial
  10,000 (the home page and IA pillars are virtually always in
  the first leaf sitemap by name; it's the deep blog archive that
  trails). If the user has passed `--all` AND the discovered count
  exceeds 100,000, **do** pause once with a "this will fetch X
  sitemap files and ~Y minutes — proceed? (y/n)" — the runtime
  cost crosses a threshold worth confirming.

- **Selective fallback.** When the truncation triggers, prioritise
  the sitemap whose URL most resembles a content sitemap — score
  by substring match against
  `{ pages, content, posts, articles, page }` and de-rank against
  `{ partition, image, video, products, news }`. This biases the
  10,000 retained URLs toward content pages rather than e.g.
  product-image partitions.

## Filtering

Apply **after** § URL normalization. Discard URLs that match:

- Different origin or different host (after normalization, since
  www-vs-bare has already been resolved per § URL normalization).
- Non-HTTP scheme (`mailto:`, `tel:`, `javascript:`, `#`-only).
- Common asset extensions: `.css`, `.js`, `.json`, `.xml`, `.txt`,
  `.pdf`, `.zip`, image extensions (`.png`, `.jpg`, `.jpeg`, `.gif`,
  `.webp`, `.avif`, `.svg` if served as media not page).
- Pagination (`?page=`, `/page/N/`) past page 1.
- API endpoints: paths starting with `/api/`, `/wp-json/`,
  `/.well-known/`.

Tracking parameters (`utm_*`, `gclid`, `fbclid`, `mc_*`, `_ga`,
`ref`, `source`) are already stripped during § URL normalization,
not here.

Keep but flag separately:

- Auth-walled paths (heuristic: paths containing `/account`,
  `/dashboard`, `/admin`, `/login`, `/signin`). Listed in
  `_crawl-log.json` under `requiresAuth[]`. Not crawled by default.

## Junk-page filter

WordPress and other CMS-driven sites often leave drafts, holiday
campaigns, and one-off A/B test pages in the public sitemap. Without
filtering, the small default cap (5 pages) fills with these and
squeezes out real pages. Apply the following filter **after** the
basic filtering above and **before** the priority sort. Disable with
`--no-junk-filter`.

Match the URL path (not the full URL) case-insensitively:

| pattern | rationale |
|---|---|
| `^/test(\b|-|\d|/)`, `/test-content/`, `/[a-z-]*-test(/|$)` | Drafts and developer test pages |
| `/sample-?page/`, `/page-sample/` | WordPress default sample page |
| `/staging/`, `/dev/` (as a path segment) | Staging clones |
| `/holiday[0-9]+(/|$)` | Numbered holiday campaign drafts |
| `/[^/]+-2(/|$)`, `/[^/]+-3(/|$)`, `/[^/]+-4(/|$)` *(only when a sibling without the suffix exists in the discovered list)* | Likely duplicates left from re-imports |
| `/[0-9]{3,}-[0-9]+(/|$)` | Numeric-only orphan slugs (e.g. `/7389-2/`) |
| `/[a-z]+[0-9]+(/|$)` *(only when ≥3 sequential siblings exist: `/foo1/`, `/foo2/`, `/foo3/`)* | Numbered campaign series |

**Do not filter** the following — these look like junk patterns but
are usually real:

- `/page-2/`, `/page/2/` — pagination (handled separately by the
  pagination filter)
- `/year-2024/`, `/year-2025/` — annual report / archive pages
- Any path matching the user's `--pages` argument

When the filter removes URLs, surface the cut list to the user
alongside the cap confirmation:

```
Discovered 94 pages. Filtered as likely junk (16): /test/, /test1/,
  /sample-page/, /holiday1/ ... (12 more)
  Override: include any of these explicitly with --pages, or pass
  --no-junk-filter to disable filtering entirely.

Proceeding with the 5 highest-priority of the remaining 78 pages.
```

Capture the full filtered list in `_crawl-log.json` under
`discovery.filteredAsJunk[]` with the matched pattern per URL, so the
audit trail is complete and the user can review what was dropped.

## Slug derivation

Slugs are filesystem-friendly identifiers used as keys in `state.json`,
filenames in `current/pages/<slug>.json`, and `prototypes/<slug>.html`.

Algorithm:

1. Take the URL path. Drop leading and trailing slashes.
2. If empty → slug is `home`.
3. Replace `/` with `__`. Example: `/blog/post-one` → `blog__post-one`.
4. Lowercase, ASCII-only, replace any non-`[a-z0-9_-]` with `-`.
5. Collapse runs of `-`. Trim leading/trailing `-`.
6. If the result is empty after normalisation → fall back to a hash
   of the URL prefixed with `_`.
7. If two URLs collapse to the same slug, suffix `-2`, `-3`, etc., in
   discovery order.

The slug is purely a filesystem name. The original URL is always
preserved in `state.json` and per-page JSON.

## Page selection — favour template variety over IA breadth

The most useful crawl is one that covers every distinct **page type**
the site has, not the highest-priority IA pillars in order. Two
"about" pages render identically; one "about" plus one "story" plus
one "form-heavy" page covers three different surfaces and exposes
three different problems.

When recommending a cap to the user — and when picking which pages to
keep when the cap binds — try to satisfy this checklist before adding
duplicate types:

1. Home (always)
2. One IA pillar page per top-nav section (whatever the user expects
   the site to "be about")
3. One long-form article / story page (body typography)
4. One listing or grid page (cards-in-grid pattern)
5. One form-heavy page (donate, contact, signup)
6. One data / embed page if any are present (likely embed-dominated)
7. One sub-section landing if the IA has depth

After hitting the checklist, fill remaining cap with high-priority IA
pages. The agent has to *infer* page type from URL slug + sitemap
hints + (when available) BFS-discovered `<title>` and link counts —
this is heuristic, not exact. When in doubt, ask the user to confirm
which discovered URLs map to which type.

This is editorial guidance: it shapes the *recommendation* the agent
shows the user, not a hard sort. The user remains free to override
with `--pages` or by replying with explicit slug lists.

## Priority for the cap

When discovered count exceeds the cap, the agent must show the user
the full list and the cut. The selection runs in two passes:

1. **Page-type checklist** (per § Page selection above) — fills as
   many checklist slots as data allows.
2. **Score-based ranking** within and beyond the checklist —
   compose the page-type signal with the IA-keyword signal so
   `/about`, `/pricing`, `/contact` outrank `/2/`, `/new/`,
   `/feed/` even when the page-type checklist isn't binding.

### Scoring

Score each URL by summing the rules below. Highest score wins;
ties broken by sitemap `<lastmod>` desc, then alphabetical.

| rule | delta | trigger |
|---|---|---|
| home | +10 | path is `/` or empty |
| IA-pillar keyword | +5 | path's first segment matches one of `{ about, pricing, products, product, services, service, contact, team, blog, help, docs, doc, support, features, feature, customers, work, case-studies, story, stories }` (case-insensitive, English-only — see § i18n caveat) |
| sitemap priority | +5 × `<priority>` | `<priority>` declared in the sitemap entry (most CMSs emit 1.0 for index, 0.8 for top-level, lower for deeper) |
| shallow path | +2 | exactly one path segment |
| extra depth | -1 per extra segment | path has ≥2 segments |
| date-like archive | -3 | path matches `^/\d{4}(/|-)\d{2}(/|-)\d{2}/?$` or `^/\d{4}/\d{2}/?$` — likely archive entries |
| version/test marker | -3 | path includes `/v\d+/`, `/v\d+\b`, `/2/` or `/3/` *(when not part of `/page/N/` pagination)*, or path component `-old`, `-archive`, `-legacy`, `-deprecated` |
| auth-walled | -5 | matches the auth-walled heuristic (path contains `/account`, `/dashboard`, `/admin`, `/login`, `/signin`) |

**Composition with the page-type checklist.** Checklist hits get a
+8 bonus on their score (so a checklist-matching page outranks a
generic IA-keyword match). When two URLs both hit the same
checklist slot, the score breaks the tie.

### i18n caveat

The IA-pillar keyword list is English-only. Sites with localized
slugs — `/chi-siamo` (it), `/à-propos` (fr), `/uber-uns` (de),
`/empresa` (es), `/quem-somos` (pt) — will not match the keyword
rule and rank lower than they should. The user can override with
`--pages` or by extending the keyword list at runtime; localized
keyword expansion is tracked as a v0.3 issue.

### Informational output (no confirmation gate)

The discover step does **not** pause for user confirmation when the
cap binds. The default of 5 pages is small enough that the common
case is "extract 5 pages and move on"; gating every run on a
yes/no reply is friction without value. Print the kept and cut
lists as informational output and proceed:

```
Discovered 38 pages on https://example.com (sitemap.xml).
Filtered as likely junk (5): /test/, /sample-page/, /holiday1/, ...
Selecting 5 highest-priority pages:
  - / (home)
  - /about
  - /pricing
  - /products
  - /contact

Cut (28 pages, --all to lift): /blog/post-1, /blog/post-2, ...

Extracting...
```

Users who want a different scope set it at command time
(`--cap N`, `--all`, `--pages <slug,slug>`, `--single`) or signal
intent in their prompt to the agent ("extract all pages", "look
at just home and pricing"). When the user's intent is spontaneous
in the prompt, the agent maps it to the equivalent flag and
applies it without re-confirming.

The default cap is intentionally small (5 pages). Cross-page brand
aggregation, system-component detection, and the brand-review
artifact all work usefully at that size as long as the 5 pages
cover distinct templates (per § Page selection). When the site
warrants more, the user lifts via `--cap N` or `--all` — but the
common case proceeds silently.

Capture the cap-resolution and per-URL scores in
`_crawl-log.json` under `discovery.cap`, `discovery.capSource`
(one of `default | --cap | --all | --single | --pages | prompt-intent`),
and `discovery.scores[]` for the audit trail. Surfacing the scores
lets the user see *why* a given page was kept or cut, not just
*that* it was — useful when the heuristic produces a surprising
selection.

#### When to ask anyway

Three narrow exceptions where the agent **does** pause for
confirmation, because silent proceed would surprise the user:

1. **The user's prompt is ambiguous about scope** ("extract this
   site" with no scope hint, but the site has 200+ pages and the
   user has previously expressed interest in non-default scope —
   inferred from session context). Ask once, briefly, with the
   default as the "go" reply.
2. **`--all` would extract more than 100 pages.** The runtime cost
   is high enough to warrant a one-line "this will extract 247
   pages, ~8 minutes — proceed? (y/n)". The 100-page threshold is
   a calibration; revisit if it produces friction.
3. **The page-type checklist cannot be satisfied** (per § Page
   selection — fewer than 3 distinct templates discoverable).
   Surface this as a warning and ask whether to continue with
   degraded coverage.

Outside these cases, proceed silently with the kept list as
informational output.

## `_crawl-log.json` shape

```json
{
  "_provenance": { "writtenBy": "stardust:extract", "writtenAt": "...", "stardustVersion": "0.2.0" },
  "discovery": {
    "source": "sitemap.xml",
    "sourceUrl": "https://example.com/sitemap.xml",
    "fetchedAt": "...",
    "discoveredCount": 38,
    "filteredCount": 33,
    "filteredAsJunk": [
      { "url": "https://example.com/test-content/", "pattern": "^/test(\\b|-|\\d|/)" }
    ],
    "waitMode": "medium",
    "waitModeAutoDetect": null,         // when --wait auto: { signal: "ssr", basis: "found <main> in initial HTML" }
    "cappedAt": 5,
    "cap": 5,
    "capSource": "default",          // default | --cap | --all | --single | --pages | prompt-intent
    "userChoice": null,              // null when no confirmation was needed (the common case); only populated when one of the three narrow exceptions triggered (see § Informational output)
    "kept": [
      { "url": "https://example.com/", "slug": "home", "priority": 1.0, "lastmod": "2026-04-12", "score": 18 }
    ],
    "cut": [
      { "url": "https://example.com/blog/post-1", "slug": "blog__post-1", "reason": "below cap", "score": 1 }
    ],
    "scores": {
      "rules": ["home", "IA-pillar keyword", "sitemap priority", "shallow path", "extra depth", "date-like archive", "version/test marker", "auth-walled", "page-type checklist"],
      "sample": { "url": "https://example.com/about", "total": 7, "breakdown": { "IA-pillar keyword": 5, "shallow path": 2 } }
    },
    "malformed": [],
    "requiresAuth": []
  },
  "crawl": {
    "startedAt": "...",
    "finishedAt": "...",
    "successes": 24,
    "failures": [
      { "slug": "contact", "url": "...", "errorClass": "TimeoutError", "message": "...", "at": "..." }
    ]
  }
  // errorClass is one of: HTTPError | ContentTypeError | EmptyPageError | TimeoutError | NetworkError
  // See playwright-recipe.md § Response validation for the trigger conditions.
}
```

This file is descriptive and append-only. Re-running `extract` adds a
new top-level entry under `runs[]` rather than overwriting.

## Incremental re-runs

The user may run `$stardust extract` again on the same site to add new
pages or refresh existing ones.

- Default behaviour: skip URLs whose slug is already in `state.json`
  with status `extracted` or beyond. Crawl only newly discovered URLs.
- `--refresh <slug>` re-extracts a single named page even if already
  extracted. The new per-page JSON overwrites, but state.json
  preserves the page's full lifecycle history.
- `--refresh-all` re-extracts every page in the cap. Rare; ask the
  user to confirm.
- A re-run that resolves a different `originUrl` is rejected (see
  `extract` SKILL.md § Setup, "Origin collision").

## Multi-locale and i18n

Sites with multiple language variants (`/en/`, `/de/`, `?locale=fr`):
v2 extracts the default locale only. Cross-locale crawl is out of
scope and would inflate the cap predictably. The user can run
multiple stardust projects per locale if needed; the SKILL.md should
mention this in the user report.
