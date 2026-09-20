# IA extraction (sitemap + crawl)

How `extract` discovers the page inventory before crawling. This phase
runs **before** Playwright touches a single page; the goal is to know
the shape of the site so the user can confirm scope and the cap.

---

## Discovery order

`crawl.mjs` `discoverInventory()` implements this order; every fetch
runs **in-page** from the probe tab (browser UA, admitted cookies — no
separate crawler UA, no extra hits on a bot-walled origin), and every
*guessed* URL counts as a probe (`discovery.probes`; typical run 2–3).
**Precedence is by source, first non-empty tier wins.** `<lastmod>` is
recorded per candidate (`maxLastmod`) but never decisive: dynamic
sitemaps stamp "today", and a stale legacy map was 3.5× larger than
the authoritative one.

1. **`<origin>/robots.txt`** `Sitemap:` directives — all of them (they
   commonly partition the site; one site declared 11). Relative
   directives resolve against the origin. Also read: `Crawl-delay`
   (→ the pacing gap, `extract/SKILL.md` § Concurrency).
2. **`<origin>/sitemap.xml`, then `/sitemap_index.xml`** — only when
   robots names nothing usable; the second is recorded
   `rejected: "lower-precedence"` without a fetch when the first has
   pages. A 200-but-empty map falls through.
3. **CMS conventions `/.sitemap.xml` (AEM), `/sitemap.aspx`** — only
   when tiers 1–2 are empty **and** the origin is not bot-walled
   (`botBlock` set → skipped).
4. **Nav union — always.** The probe page's same-origin `<a href>`
   links are unioned with the sitemap roster (`discovery.navOnly`
   counts the sitemap-blind pages).
5. **BFS fallback** — only when no tier yields a page *under the
   scope*: hop 1 is the probe page (0 hits); hops 2..`--depth N`
   (max 3) fetch HTML in-page and read `href`s (never full
   navigations); breadth `max(200, cap)`; depth 1 under a bot block.

**Subtree scope.** A non-root `<url>` path (`https://example.com/shop`)
scopes sitemap locs and BFS alike to that subtree. The prefix is the
path the user **typed**, captured before origin adoption: a root entry
that geo-redirects to `/us/en` is *not* scoped (`discovery.entryRedirect
.note`). `--pages` bypasses the scope. When the sitemaps have zero locs
under the scope, discovery falls to BFS (5) — the census of everything
declared is still logged.

Every URL from any source passes § URL normalization (and relative
URLs § Relative-URL resolution first) before entering the set. Kinds
are read from the sitemap **root tag** (`<sitemapindex>` vs
`<urlset>`), not the URL extension.

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

- **Depth cap: 3.** Beyond that, drop deeper indexes and record
  `deepDropped` on the sitemap candidate — a
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

Slugs key `state.json.pages[]`, `current/pages/<slug>.json|.html`,
`assets/screenshots/<slug>.png` and `prototypes/<slug>-proposed.html`.
`crawl.mjs` (`slugify` + `assignSlugs`) is the implementation and this
section describes it; downstream scripts key on
`state.json.pages[].slug` — never on a re-implemented slugify.

1. URL path only (query and hash ignored); drop leading and trailing
   slashes.
2. Every run of characters outside `[a-z0-9]` — `/` included — becomes
   one `-`; lowercase. `/blog/post-one` → `blog-post-one`.
3. Empty → `index` (the root page).
4. Longer than 200 chars → the first 180 chars + `-<sha1:8>` of the
   full slug (file-name cap: `<slug>.json` must fit the 255-byte limit).
5. Collision — distinct pages flattening to one slug (`/about-us` vs
   `/about/us`, or one path with different queries): the first claimant
   in discovery order keeps the clean slug; each later page gets
   `-<sha1:4>` of its dedupe key (`origin + path + query`). Stable
   across runs.

The original URL is always preserved in `state.json` and the per-page
JSON. Projects created before this rule may carry `home` for the root:
read it as a legacy alias of `index`, never write it.

A slug is not the DA path (D6): the delivery path is a per-segment fold of the
source URL path — `normalizeDaPath()` in `skills/stardust/scripts/da-path.mjs` —
never derived from, and never re-keying, the slug.

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
  "_provenance": { "writtenBy": "stardust:extract", "writtenAt": "...", "stardustVersion": "0.10.0" },
  "discovery": {                     // written by crawl.mjs discoverInventory()
    "fetchTechnique": "headless",    // ladder tier that captured; botBlock / escalations when a tier was rejected
    "count": 5,                      // pages kept (= kept.length)
    "concurrency": 4,                // 1 under a bot block or after a bare 429 (SKILL.md § Concurrency)
    "source": "robots.txt",          // robots.txt | sitemap.xml | sitemap_index.xml | .sitemap.xml | sitemap.aspx | nav | bfs | <source>+bfs | --pages
    "sourceUrl": "https://example.com/sitemaps/index.xml",   // string, or the array of robots-declared maps
    "subtree": null,                 // "/shop" when the typed path scoped the roster; null at root
    "entryRedirect": { "from": "/", "to": "/us/en", "note": "entry redirected to /us/en; not scoped" },  // only when it happened
    "census": { "total": 1044, "byPrefix": { "/products": 612, "/blog": 301, "/": 1 } },  // everything the winning tier declared, pre-scope
    "navOnly": 12,                   // probe-page nav links no sitemap declared (unioned into the roster)
    "probes": 1,                     // guessed URLs fetched (robots + standard paths + conventions); declared maps are not guesses
    "fetches": 4,                    // every discovery fetch, incl. index children and BFS hops
    "candidates": [                  // every sitemap consulted or skipped, in precedence order
      { "url": "https://example.com/sitemaps/index.xml", "tier": "robots", "count": 1044, "maxLastmod": "2026-04-12" },
      { "url": "https://example.com/sitemap.xml", "tier": "standard", "rejected": "lower-precedence" }   // rejected: lower-precedence | empty | unreachable
    ],
    "kept": [ "https://example.com/", "https://example.com/about" ],   // entry first, capped
    "cut": [ { "url": "https://example.com/blog/post-1", "reason": "cap" } ],   // first 2,000; cutTruncated = full count beyond
    "malformed": [],                 // <loc> values that did not parse (first 50)
    "bfs": { "depth": 2, "visited": 87, "fetched": 14 },   // fallback only
    "crawlDelay": 5,                 // robots Crawl-delay seconds, when declared
    "storageState": false,           // an admitted probe session was cloned into the workers / loaded from _storage-state.json
    "liveBudget": { "navPerMin": 10, "minGapMs": 5000, "source": "robots Crawl-delay" },
    "skippedExtracted": [ { "slug": "about", "url": "...", "status": "extracted" } ]   // re-runs only
    // filteredAsJunk[], scores, requiresAuth[], userChoice belong to the agent's page-selection
    // pass (§ Page selection, § Junk-page filter) and are added by it, never by crawl.mjs.
  },
  "crawl": {
    "startedAt": "...",
    "finishedAt": "...",
    "successes": 24,
    "failures": [                    // union across runs; an entry leaves only when its slug later succeeds
      { "slug": "contact", "url": "...", "errorClass": "TimeoutError", "message": "...", "at": "..." }
    ]
  },
  "runs": [                          // one entry per invocation, appended
    { "at": "...", "args": { "url": "...", "pages": null, "cap": 5, "wait": "medium", "concurrency": 4, "dynamics": false, "refresh": [], "force": false, "headed": null, "depth": 1, "cookie": ["agegate_confirmed"], "mobile": "entry", "dpr": 1, "prep": false },   // cookie = NAMES only, never values; prep = the --prep run (brand-surface.mjs never bounds it)
      "technique": "headless", "discovered": 38, "skipped": 0, "captured": 24, "failed": ["contact"],
      "assets": { "mode": "intercept", "saved": 61, "failed": 2, "bytes": 4183020, "fonts": 3, "iconFonts": 1, "transformSuspect": 0, "extraFetches": 0 } }   // the harvest (SKILL § Phase 2); extraFetches > 0 only under --assets full
  ]
  // errorClass is one of: HTTPError | ContentTypeError | EmptyPageError | TimeoutError | NetworkError | BotChallengeError | ProvenanceMissing | SchemaError
  // See playwright-recipe.md § Response validation for the trigger conditions; SchemaError = the written
  // record failed the schema gate (current-state-schema.md § Schema gate) — it stays on disk, never a success.
}
```

Append-only across runs, enforced by `crawl.mjs`: one `runs[]` entry
per invocation; `crawl.failures` is the union minus slugs that later
succeeded; `discovery` never shrinks (a `--pages` or narrower re-run
keeps the richer roster block and refreshes only the run-level fields:
`fetchTechnique`, `botBlock`, `escalations`, `concurrency`,
`storageState`, `liveBudget`, `skippedExtracted`, redirects); a failed page keeps its previous
record on disk.

## Incremental re-runs

The user may run `$stardust extract` again on the same site to add new
pages or refresh existing ones.

- Default: a discovered URL whose slug is already `extracted` (or
  beyond) in `state.json` is skipped and listed under
  `discovery.skippedExtracted[]`. `state.json` is read-only for the
  crawler; a missing file means no skip.
- `--refresh <slug,…>` re-extracts the named pages even when already
  extracted (a slug outside this run's list is appended from its
  `state.json` URL). The per-page JSON overwrites; state.json keeps
  the lifecycle history.
- `--force` re-extracts every page in scope.
- `--pages <path,…>` crawls exactly the listed paths — never skipped,
  never dropped, and the entry URL is included only when listed (or
  when the list is empty), so a single-page recapture does not re-hit
  the home page.
- A re-run that resolves a different `originUrl` is rejected (see
  `extract` SKILL.md § Setup, "Origin collision").

## Multi-locale and i18n

Sites with language trees (`/en/`, `/de/`, twins on another host): the default
locale is extracted first; the other trees are **discovered, typed and listed, not
crawled** in this pass. Discovery = `link[rel=alternate][hreflang]` on the probe
page (`crawl.mjs discover()`; every page record carries `alternates[]`) ∪ every
host sitemap ∪ a one-level BFS from each locale root, with the `source` recorded
per URL (`_crawl-log.json#discovery.urls[].source`: `sitemap:<path>` · `nav` ·
`hreflang` · `bfs` · `entry`; `#discovery.hreflang` counts declared and same-origin
twins and lists off-origin ones — listed, never probed); 301 twins are excluded
when typed. Typing = the twin's page type
first, the classifier as a check, disagreements listed. The list feeds
`stardust/trees.json` (`rollout/reference/multilingual.md` § Manifest
precondition) — the D3 wave runs per tree on the same block library; the crawl
cap is not inflated here.
