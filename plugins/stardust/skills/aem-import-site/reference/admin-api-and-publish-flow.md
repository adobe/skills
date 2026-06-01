# admin.hlx.page + DA admin API — practical recipes

The admin surfaces (`admin.da.live` for source + `admin.hlx.page` for
preview/live/index) have rules that aren't obvious from a casual read
of the API docs. This file collects what's been verified by running
real batch migrations against them, generalized away from any specific
project.

Use this as the canonical recipe set for: token handling, the
PUT→preview→publish→index ordering, query-index population, dynamic
cross-page block wiring, URL-structure decisions made BEFORE the
first batch, and the unpublish trap.

## §1 Token lifecycle

`DA_TOKEN` is an OAuth bearer token from a logged-in admin.da.live
session. The same token authenticates **both** admin.da.live (DA
source) and admin.hlx.page (preview, live, index) operations.

**Expiry: 86 400 seconds = 24 hours** from issuance.

Practical implications for batch scripts:

- A full-site batch that runs longer than ~24h will hit 401 mid-run.
  Either split the batch into ≤ 24h chunks, OR refresh the token from
  `.env` at the start of each per-page operation (so the operator can
  paste a fresh token into `.env` while the batch is running without
  restarting it).
- The 401 surfaces inconsistently: PUT to admin.da.live returns a
  clean 401; POST to admin.hlx.page sometimes returns
  `error from content-bus` with HTTP 401 in the body. The
  content-bus error message is misleading — it's an auth failure on
  the admin side, not a DA-side propagation issue.
- For interactive (single-page) operations, surface a clear "DA_TOKEN
  expired — refresh in .env and retry" error rather than retrying.

```js
// Load fresh on every push so manual mid-batch refresh works
function loadToken() {
  const env = readFileSync('.env', 'utf8');
  return env.match(/^DA_TOKEN=(.+)$/m)?.[1]?.trim();
}
```

## §2 PUT → preview → publish → index — the canonical order

A page progresses through four states. Each state requires the
previous and serves a different consumer:

| State | Trigger | Consumer |
|---|---|---|
| **DA source** | `PUT admin.da.live/source/<org>/<repo>/<path>.html` | Authors editing in da.live |
| **Preview** | `POST admin.hlx.page/preview/<org>/<repo>/main/<path>` | `<branch>--<repo>--<org>.aem.page` URL |
| **Live** | `POST admin.hlx.page/live/<org>/<repo>/main/<path>` | `<branch>--<repo>--<org>.aem.live` URL |
| **Indexed** | `POST admin.hlx.page/index/<org>/<repo>/main/<path>` | `/query-index.json`, sitemaps, dynamic blocks |

Two non-obvious rules:

**Auth header is required on every step**, including the
`POST /preview/` call that triggers a preview build. Without
`Authorization: Bearer <DA_TOKEN>`, that endpoint returns HTTP 401
with body `error from content-bus`. The body wording suggests a
content propagation issue; it's actually an auth failure.

**Index requires .live, not preview.** `POST /index/...` returns
`requested path returned a 301 or 404` when the page exists only on
preview. The indexer fetches from `<branch>--<repo>--<org>.aem.live`,
not from preview. To populate `/query-index.json` you must publish
to live first, then trigger index.

For batch scripts that need cross-page features (dynamic blocks,
sitemaps, related-content): publish + index is **mandatory**, not
optional. A `--no-publish` flag is fine for staged content reviews,
but the dynamic block won't find anything until publish + index runs.

```js
// Recommended sequence in pushToDA()
await fetch(`https://admin.da.live/source/${org}/${repo}/${path}.html`, { method: 'PUT', headers: auth, body: fd });
await new Promise(r => setTimeout(r, 1500));  // small code-bus settle
await fetch(`https://admin.hlx.page/preview/${org}/${repo}/main/${path}`, { method: 'POST', headers: auth });
if (publish) {
  await fetch(`https://admin.hlx.page/live/${org}/${repo}/main/${path}`, { method: 'POST', headers: auth });
  await fetch(`https://admin.hlx.page/index/${org}/${repo}/main/${path}`, { method: 'POST', headers: auth });
}
```

## §3 helix-query.yaml + page-metadata = dynamic cross-page blocks

The pattern below replaces hand-authored "related" lists, "category
hub" listings, "recently added" rails, and any other block that
needs to discover other pages on the same site.

### Three pieces wired together

1. **`helix-query.yaml`** at the EDS repo root, declaring which
   fields the indexer should extract from every page:

   ```yaml
   version: 1
   indices:
     default:
       include: ['/**']
       exclude: ['/drafts/**', '/fragments/**', '/nav', '/footer']
       target: /query-index.json
       properties:
         title:    { select: head > meta[property="og:title"],     value: 'attribute(el, "content")' }
         image:    { select: head > meta[property="og:image"],     value: 'match(attribute(el, "content"), "https?://[^/]+(/.*)")' }
         template: { select: head > meta[name="template"],         value: 'attribute(el, "content")' }
         category: { select: head > meta[name="category"],         value: 'attribute(el, "content")' }
         # ...whatever other dimensions the cross-page blocks need...
   ```

2. **Page-metadata block on every page** carrying those fields:

   ```html
   <div class="metadata">
     <div><div>title</div><div>Some Title</div></div>
     <div><div>template</div><div>detail-template-v1</div></div>
     <div><div>category</div><div>some-category</div></div>
   </div>
   ```

   The fill script's `renderDA()` must emit this block. Pages
   without `template` + the discriminator field (category, tag,
   parent, etc.) won't be filterable by the dynamic block.

3. **Block JS that fetches and filters**:

   ```js
   import { createOptimizedPicture, getMetadata } from '../../scripts/aem.js';

   export async function decorateDynamic(block) {
     const template = getMetadata('template');
     const category = getMetadata('category');
     const here = window.location.pathname.replace(/\/$/, '');
     if (!template || !category) { block.closest('.section')?.remove(); return; }

     const res = await fetch('/query-index.json');
     const { data } = await res.json();
     const items = data
       .filter(r => r.template === template && r.category === category && r.path.replace(/\/$/, '') !== here)
       .slice(0, 3);

     if (!items.length) { block.closest('.section')?.remove(); return; }
     // ...render items into the block...
   }
   ```

### Empty-state contract

The block self-hides (removes its own `.section`) when zero matches
exist. This handles two real cases:

- A page belongs to a category that currently has only itself (e.g.,
  the first member of a new category).
- The migration is partial — sibling pages exist in the source but
  haven't been migrated to EDS yet.

A self-hiding block lets the fill script run on a single
representative page (Phase 3 in the canonical workflow) and produce
a clean output even before the rest of the batch fills out the
category.

### Index lag

`/query-index.json` is regenerated when pages are indexed (per §2).
A page that was just published may take 5–10 seconds before it
shows up in the index. The dynamic block fetches the index at page
load — visitors hitting the page during the lag window see the
empty state. The block self-hides; no broken UI.

### Three variants of the same dynamic block

The same block JS typically deploys in three filter variants across a
migrated catalog site. They share the pattern (fetch index, filter,
render) and differ only in scope:

| Variant | On page type | Filters by | Cap | Order |
|---|---|---|---|---|
| **`.related`** | detail pages | same `template` + same `category` + not-self | 3 | first 3 |
| **`.listing`** | category-listing pages | same `category` + path starts with parent URL prefix + `pageType !== 'listing'` | none (show all) | alpha by `modelName` |
| **`.hub`** | top-level hub pages (`/new`, `/used-equipment`, `/service`) | `pageType === 'listing'` + path starts with hub URL prefix | none | alpha |

The hub variant lists OTHER listing pages (one level up from
listings). Its rendered card needs a preview image, which listings
themselves rarely have. The fallback chain:

1. Use the listing's own `image` if non-default (curated source-side
   category hero, see § "Hub-card preview images" below).
2. Otherwise find any indexed `pageType !== 'listing'` child whose
   `category` matches, and use that detail's `image`.
3. Otherwise render the text-only fallback (dark tile + accent rail).

### Hub-card preview images — curated vs derived

When the source site has a top-level category-hub page (e.g.
`/new/machines/` listing all equipment families with curated
photos), extract that image map once during migration and inject it
into each category-listing's metadata:

```js
// One-off update — for each curated (slug → imageURL) pair, PUT the
// listing's source with an additional <div>image</div><div>URL</div>
// row in the metadata block. EDS converts to <meta property="og:image">,
// helix-query picks it up into the `image` field, the hub block reads it.
const html = currentSource.replace(
  /(<div>description<\/div>[\s\S]*?<\/div>\s*<\/div>)/,
  `$1\n    <div>\n      <div>image</div>\n      <div>${imageUrl}</div>\n    </div>`,
);
```

For categories without a curated source image (often: parent
categories like `excavators`, `dozers` whose actual detail pages
live under sub-category slugs `mini-excavators`, `large-dozers`),
the hub block's fallback to "find any matching child" produces 0
matches because `excavators` has zero direct children. Two
options:

- Inject the curated image at fill time so the hub doesn't need
  the fallback.
- Author a synthetic child page or skip parent categories from the
  hub display.

### Filename-hash dedup for path-prefixed media

DA stores the SAME uploaded media at path-prefixed URLs per page —
e.g., a placeholder "no photo" image used by 288 detail pages
across 28 categories appears in the index as:

```
/used-equipment/asphalt-pavers/media_1fe1b37fbb579a8....jpg?width=1200&...
/used-equipment/backhoe-loaders/media_1fe1b37fbb579a8....jpg?width=1200&...
/used-equipment/crushers/media_1fe1b37fbb579a8....jpg?width=1200&...
```

As strings, these URLs are all distinct. But they point to the
same underlying media file (same `media_<hash>`). String-equality
dedup misses them; **filename-based dedup catches them**:

```js
const imageKey = (src) => src ? src.split('/').pop() : null;
const imageCounts = candidates.reduce((acc, src) => {
  const k = imageKey(src);
  if (k) acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

// Reject images shared across ≥3 categories — they're stock placeholders
const previewImage = imageCounts[imageKey(candidate)] < 3 ? candidate : null;
```

This is the same trick documented for `.cards.related`'s nested-vs-
flat dedup (§5 of this file) — strip the directory, compare just
the filename.

### Sticky reveal-on-hover (image-tile UX)

For tile grids where a default-dark treatment looks better than a
photo at rest, but the photo adds discoverability on interaction:
reveal-once on first hover, never hide:

```js
// In the block JS, after rendering:
block.querySelectorAll(':scope > ul > li').forEach((li) => {
  if (!li.querySelector('.cards-card-image')) return;
  const reveal = () => li.classList.add('revealed');
  li.addEventListener('mouseenter', reveal, { once: true });
  li.addEventListener('focusin', reveal, { once: true });
  li.addEventListener('touchstart', reveal, { once: true, passive: true });
});
```

```css
.cards.hub > ul > li .cards-card-image { opacity: 0; transition: opacity 600ms; }
.cards.hub > ul > li.revealed .cards-card-image { opacity: 1; }
.cards.hub > ul > li::before {
  content: ""; position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(to top, rgba(18,18,18,0.85), rgba(18,18,18,0.55) 50%, rgba(18,18,18,0.40));
  opacity: 0; transition: opacity 600ms;
}
.cards.hub > ul > li.revealed::before { opacity: 1; }
```

`{ once: true }` removes the listener after first fire so the class
sticks. Three event types cover keyboard (`focusin`), mouse
(`mouseenter`), and touch (`touchstart`) without three separate
state machines.

### Metadata field-name lowercasing

DA's metadata block emits `<meta name="X">` with **`X` lowercased**.
Authoring `<div>pageType</div><div>listing</div>` produces
`<meta name="pagetype" content="listing">`. The helix-query.yaml
selector must match exact case:

```yaml
pageType:
  select: head > meta[name="pagetype"]   # NOT meta[name="pageType"]
  value: |
    attribute(el, "content")
```

The yaml KEY (`pageType`) becomes the JSON field name in
`/query-index.json` — keep that camelCase if your block JS reads it
as `r.pageType`. Only the `select` expression needs the lowercased
DOM-side name.

After changing helix-query.yaml, **already-indexed pages don't
pick up the new field automatically**. You must re-trigger the
index endpoint on each affected page so the indexer re-extracts
with the new schema, then trigger preview/live on
`/query-index.json` to regenerate the aggregated JSON.

## §4 URL structure — decide BEFORE the first batch

The biggest mid-migration headache is reorganizing URLs after pages
are already live. Decide the URL structure during template approval
(`stardust:prototype` phase or earlier).

### Three structural choices

| Choice | Example path | Trade-off |
|---|---|---|
| **Mirror source** | `/section/subsection/item` matching the source site 1:1 | SEO continuity from external backlinks, breadcrumbs are correct without translation, DA folder navigation matches source IA, supports per-category redirects. Verbose paths. |
| **Simplified hierarchy** | `/section/item` (one level shallower than source) | Shorter URLs, still organized for DA browsing and category filters. Loses 1:1 source mapping; needs explicit `/redirects.json` entries to preserve external SEO. |
| **Flat** | `/item` | Shortest URLs and simplest fill script. Becomes unmanageable in DA admin past ~1k pages; breaks breadcrumb hrefs that already reference deeper paths; loses URL semantics that hurt SEO. |

**Default to mirror-source** for any migration where the source site
already exists with backlinks. The cost (verbose paths) is small;
the benefit (SEO equity preserved, breadcrumbs work without
rewriting, easy redirect mapping) is large.

Reach for flat only when:
- Source site is being abandoned entirely (no SEO equity to preserve)
- Total page count is small (< ~200) and stays small
- Authors will never browse DA admin by folder

### Fill-script convention: `pagePath(data)` helper

Each per-template fill module exports a `pagePath(data)` helper that
produces the page's path from extracted data. Keep it the only
place that knows the URL pattern:

```js
// fill-<template>.mjs
export function pagePath(data) {
  return `section/${data.categorySlug}/${data.itemSlug}`;
}

// Used as:
//   PUT  https://admin.da.live/source/<org>/<repo>/<pagePath>.html
//   POST https://admin.hlx.page/preview/<org>/<repo>/main/<pagePath>
//   …
//   liveUrl: `${EDS_PREVIEW}/<pagePath>`
//   Output file: `<OUTPUT_DIR>/<pagePath>.html` (mirrored on local disk too)
```

Mirror the path on local disk too so `--skip-existing` checks just
need a `existsSync` against the same path the live URL would have.

### Restructure recipe — don't try to delete the old paths

If a URL restructure becomes necessary after pages are already live
(see §5 — admin.hlx.page DELETE is unreliable), the practical
sequence is:

1. Update `pagePath()` to the new structure
2. Re-batch — pages re-PUT to the new paths
3. Author `/redirects.json` mapping old paths → new paths (so
   external backlinks to old paths 301 to new) — see EDS redirects
   docs for the schema
4. Accept that old paths may continue to serve the cached content
   until manually cleaned via DA admin UI
5. Update any cross-page block (§3) to dedupe by trailing slug and
   prefer nested entries — see "Dedupe orphan duplicates" recipe
   in §5 below

Better than (4): plan the URL structure upfront so this never has
to happen.

## §5 The unpublish trap — admin.hlx.page DELETE is restricted

`DELETE https://admin.hlx.page/preview/<...>` and
`DELETE https://admin.hlx.page/live/<...>` return **HTTP 403 with
body `[admin] delete not allowed while source exists.`** regardless
of whether the DA source actually exists.

Verified behaviors:

- DELETE on the source endpoint (`admin.da.live`) does work (204).
  The DA source file is gone after that call.
- But .preview and .live continue serving the cached content.
- `POST /preview/<gone>` returns 404 (preview build sees no source)
  but **does not remove the cached preview/.live response**.
- `POST /index/<gone>` still finds the page on .live and re-adds
  it to `/query-index.json` with its original metadata.

There's no reliable API call that removes a page from .live once it
has been published. Practical mitigations:

### Dedupe orphan duplicates at the block level

When a URL restructure leaves old flat paths AND new nested paths
both serving in `/query-index.json`, dedupe by trailing slug in the
block JS:

```js
// Prefer nested-path entries over orphaned flat-path duplicates
const all = await loadIndex();
const byModel = new Map();
all.forEach((row) => {
  if (row.template !== template || row.category !== category) return;
  const slug = row.path.split('/').pop();
  const isNested = row.path.split('/').filter(Boolean).length > 1;
  const existing = byModel.get(slug);
  if (!existing || (isNested && !existing.isNested)) {
    byModel.set(slug, { ...row, isNested });
  }
});
const items = [...byModel.values()].slice(0, 3);
```

This keeps the cross-page block correct during the transition
window even while orphans persist.

### Don't write a "cleanup" script that depends on DELETE

A cleanup script that issues DELETEs on admin.hlx.page will appear
to succeed (HTTP 204 on the source call) but leave .live serving
the old content. Test the live URL after running cleanup before
trusting it.

### When orphan cleanup is genuinely needed

- Manual: delete from DA admin UI (da.live), which appears to
  cascade correctly through the admin surface
- Or PUT minimal redirect content at the orphan path and republish
  — the .live response now serves the redirect, achieving the SEO
  equivalent of unpublish without needing DELETE permission

## §6 Sitemap sub-chunking

Large source sites split their sitemap into multiple `<sitemapindex>`
chunks (Google's spec caps a single sitemap at 50 000 URLs or 50 MB).
Naive batch scripts that grep a single sitemap.xml file miss
everything past the first chunk.

Always walk the sitemap index first:

```js
const indexXml = await fetch(`${origin}/sitemap_index.xml`).then(r => r.text());
const chunkUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const allPageUrls = [];
for (const chunkUrl of chunkUrls) {
  if (!/<your-pattern>-sitemap.*\.xml/.test(chunkUrl)) continue;
  const chunkXml = await fetch(chunkUrl).then(r => r.text());
  allPageUrls.push(...[...chunkXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
}
```

The `cat_used_machine-sitemap.xml`-style suffixes (`sitemap2.xml`,
`sitemap3.xml`, etc.) are common in WordPress-based sites; assume
they exist until a sitemap-index probe proves otherwise.

## §7 DA media bus image-fetch race

When a page is PUT to DA with absolute image URLs (e.g., scene7 CDN
URLs), the DA pipeline fetches each image at content-process time to
add to its media bus. If the EDS code-bus hasn't propagated the
deployed assets yet, image fetches can fail and DA stores
`about:error` placeholders for the affected images.

This is most likely on the first PUT after a code change that
adds/renames asset paths. Symptoms:

- Images show as broken in DA's edit view
- Live page renders with broken images even though the source URL
  is valid
- Re-PUTting the same content "fixes" it

Two reliable mitigations:

1. After pushing a code-bus change (CSS/JS/asset rename),
   **wait 5–10 seconds** before the first DA PUT that references the
   new path.
2. After a batch, **re-PUT the small subset of pages whose images
   show `about:error`** in DA. Idempotent re-PUT triggers a fresh
   media-bus fetch.

## §8 Spec-catalog extraction patterns

For migrations where the source site renders structured product/
spec catalogs (Cat-style nested-accordion specs, real-estate
property tables, e-commerce spec sheets), the extractor needs three
cleanup passes on top of the basic DOM scrape:

### Numeric value normalization

Catalog values typed-in by humans (or rendered from a JSON-LD
property graph) often arrive with awkward unit encoding:

| Source value | Cleaned value |
|---|---|
| `1500/rpm` | `1500 rpm` (digit-slash-letter) |
| `5.4in` | `5.4 in` (missing space) |
| `927in²` | `927 in²` (number adjacent to first letter — leave the superscript) |
| `8mile/h` | `8 mile/h` (the slash between letters is a real unit; only digit-slash-letter is wrong) |
| `m3` | `m³` (data-* attributes often strip non-ASCII; restore from a known map) |

```js
const cleanValue = (v) => v
  .replace(/(\d)\/([a-zA-Z])/g, '$1 $2')               // 1500/rpm → 1500 rpm
  .replace(/(\d(?:[.,]\d+)?)([a-zA-Z])/g, '$1 $2')      // 5.4in    → 5.4 in
  .replace(/\bm3\b/g, 'm³').replace(/\bin2\b/g, 'in²')  // restore unicode
  .replace(/\byd3\b/g, 'yd³').replace(/\bft3\b/g, 'ft³')
  .replace(/\s+/g, ' ').trim();
```

### Footnote / disclaimer rows ship truncated — skip them

Catalog source data-* attributes are frequently capped at 255 chars
(database column limit on the publishing CMS). Long rows like
`Note (1)`, `Disclaimer`, or any prose row whose value is paragraphs
of compliance text will be truncated mid-word in the data-english /
data-metric attributes. The textContent version is the same
truncated content.

There's no recovery — the full text only exists in source PDFs.
Filter these rows out at extract time rather than rendering broken
ellipsis:

```js
// Skip rows whose label looks like a footnote marker
if (/^Note\s*\(/i.test(row.label)) continue;
```

### Filter "stat strip" candidates to numeric values

When picking 3–4 monumental key facts to feature in a stat-strip
band, filter to rows whose value starts with a digit. Otherwise a
row like `Engine Model: Cat® C18` ends up next to monumental
numbers like `580 hp` and `112,574 lb`, looking awkward.

```js
const isNumeric = (v) => /^[\d.,\-–]/.test(v) && v.length < 30;
const keyFacts = candidateRows.filter(r => isNumeric(r.value)).slice(0, 4);
```

The same filter shapes the at-a-glance display logic — strip
parenthetical metric-conversion suffixes (`4.7-13 m³ (6.2-17 yd³)`
→ `4.7-13 m³`) and add thousands commas to bare integers
(`112574` → `112,574`).

## §9 Per-template motion JS pattern

`scripts/scripts.js` auto-loads `/scripts/<theme>-motion.js` if it
exists, where `<theme>` comes from the page's `meta[name="template"]`
content. This lets each template have its own motion runtime
(lightboxes, smooth scroll, reveal-on-scroll) without polluting the
shared scripts.js.

Two guards required in the motion script:

1. **Wait for `data-block-status="loaded"`** before initializing
   behavior bound to a specific block. Both a blocks-ready
   observer AND a safety setTimeout can fire — guard against
   double-init with a flag:

   ```js
   let initialized = false;
   function safeInit() {
     if (initialized) return;
     if (!document.querySelector('.lightbox-target[data-block-status="loaded"]')) return;
     initialized = true;
     // ...do the init...
   }
   ```

2. **Reduced-motion fallback** — wrap motion-heavy work in
   `if (!matchMedia('(prefers-reduced-motion: reduce)').matches)`.

## Cross-reference

| Topic | Where |
|---|---|
| DA pipeline transforms (per-page) | `aem-import/reference/conventions.md` §1 |
| Decorate-function guards | `aem-import/reference/conventions.md` §2 |
| Per-block CSS patterns | `aem-import/reference/conventions.md` §4 |
| Per-variant inheritance traps | `aem-import/reference/conventions.md` §7 |
| Fill-script + batch pattern | `aem-import-site/reference/fill-script-pattern.md` |
| Template selection (A/B/C/D modes) | `aem-import-site/reference/template-modes.md` |
