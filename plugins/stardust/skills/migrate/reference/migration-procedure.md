# Migration procedure

Per-page procedure `$stardust migrate` runs to produce
`stardust/migrated/<output-path>/index.html` plus a companion
`_meta.json` sidecar. Idempotent, deterministic where possible
(Path B and adapted Path A′ involve LLM judgment), content-
preserving by default.

---

## Inputs per page

- `stardust/current/pages/<slug>.json` — source structure +
  content + typed slots (the only content source; the live site
  is not re-fetched).
- `stardust/current/assets/` — extracted media and logo.
- `DESIGN.md` (project root) — target visual system.
- `DESIGN.json` (project root) — sidecar with `extensions.canon`,
  `extensions.modules[]`, `extensions.colorReservations[]`,
  `extensions.metadata`.
- `stardust/canon/header.html`, `footer.html`, `canon.css`,
  `modules/<id>.html` — canon files written by
  `prototype --prep`.
- `stardust/direction.md` — Active section (used to confirm
  content changes are authorised, if any).
- `stardust/prototypes/<slug>-proposed.html` — when this page is
  itself approved (Path A) **or** when a sibling of its `type`
  is approved (Path A′ archetype source).
- `stardust/state.json` — page status, type, direction reference,
  `site.deployUrl`.

## Three render branches

The render branch is chosen by LLM judgment per
`reference/template-and-module-rendering.md` § Render path
selection:

- **Path A** — page is itself `approved`. Use proposed.html
  verbatim; refresh `:root` from latest DESIGN.md; inject canon
  CSS alongside.
- **Path A′** — page is `directed`, type matches an approved
  sibling. Fork the sibling's structure, inject this page's
  typed slots, adapt where content doesn't fit. Procedure in
  T&M § Path A′.
- **Path B** — page typed `unique` or no template match. Render
  one-off using DESIGN.md/json + canon + modules. Procedure in
  T&M § Path B.

All three branches apply canon chrome (header, footer) verbatim;
all three apply the validation contracts; all three emit a
`_meta.json` sidecar.

## Output path mapping

The migrated tree's output path is determined by the **source
URL**, not the slug shape. Slugs are filesystem-friendly
identifiers used internally; the URL the page served at the live
origin is the authoritative spec for where it lands.

### Output path: URL-literal rule

```
source URL                          ->  output path
────────────────────────────────────────────────────
/                                   ->  index.html
/<slug>/                            ->  <slug>/index.html
/<dir>/<sub>/                       ->  <dir>/<sub>/index.html
/<slug>.html                        ->  <slug>.html           (preserve .html leaf)
/<dir>/<page>.html                  ->  <dir>/<page>.html     (preserve .html leaf)
/<slug>                             ->  <slug>/index.html     (default; record in _meta.json)
/<file>.<other-ext>                 ->  <file>.<other-ext>    (passthrough, skip HTML render)
```

The rule is "mirror the source URL literally". A page served at
`/about-us/history.html` lands at
`stardust/migrated/about-us/history.html` — not at
`stardust/migrated/about-us/history/index.html`. A page served at
`/beers/` lands at `stardust/migrated/beers/index.html`. A page
served at the bare `/beers` (no trailing slash) defaults to
`beers/index.html` and records the default choice in
`_meta.json.outputPathDefault: "trailing-slash"` so re-runs are
deterministic.

The output convention works on every static host (Netlify,
Vercel, Cloudflare Pages, S3+CloudFront, GitHub Pages, plain
nginx) without URL rewrite rules — and on `file://`, and at any
subpath, because internal references are rewritten relative to
each page's location per § Reference shape below.

### Page map (build once, use everywhere)

Migrate's first action in Phase 2 is to resolve every in-scope
source URL to its definitive output path and write the map to
`state.json.migrate.pageMap[]`:

```json
"pageMap": [
  { "sourceUrl": "/",                          "outputPath": "index.html",                    "slug": "home" },
  { "sourceUrl": "/beers-bev/",                "outputPath": "beers/index.html",              "slug": "beers" },
  { "sourceUrl": "/about-us/history.html",     "outputPath": "about-us/history.html",         "slug": "about-us__history" },
  { "sourceUrl": "/about-us/team/",            "outputPath": "about-us/team/index.html",      "slug": "about-us__team" }
]
```

Per-page rendering AND internal-link rewriting both consume this
map. Internal-link rewriting MUST look up the target's
`outputPath` via the map — NOT synthesize `<target>/index.html`
from the source slug. The synthesis bug is what turns
`/about-us/history.html` into `/about-us/history/index.html`;
the page map is the fix.

The map is built once per migrate run, before any page is
rendered, so cross-page link rewriting can resolve every target
deterministically. A target URL that has no `pageMap` entry is a
broken internal link — flagged `data-broken-link="true"` and
logged under `provenance.brokenInternalLinks[]` per
`content-preservation.md` § Internal link rewriting.

**Same-origin absolute URLs go through the page map too.** A
`<a href="https://example.com/beers/">` where `example.com`
matches `state.json.site.originUrl` is stripped to its path +
query + fragment per `content-preservation.md` § Internal link
rewriting step 3, then looked up in `pageMap[]` like any other
internal reference. Skipping this step lets same-origin absolute
links pass through verbatim — which would defeat the
portability claim under `file://` and at subpaths. The Phase 3
absolute-internal-ref grep is the runtime backstop.

### Reference shape (depth-aware relative paths)

For a page with `outputPath` O, the page's depth is
`segments(O) - 1`:

- `index.html`            → depth 0
- `beers/index.html`      → depth 1
- `about-us/history.html` → depth 1
- `about-us/team/index.html` → depth 2

The rewrite prefix is:

```
prefix = depth === 0 ? "./" : "../".repeat(depth)
```

Rewrites applied to every internal reference in the page's
final HTML and CSS:

```
/assets/foo                  -> <prefix>assets/foo
url(/assets/foo)             -> url(<prefix>assets/foo)
href="/"                     -> href="<prefix>index.html"
href="<source-url>"          -> href="<prefix><pageMap[source-url].outputPath>"
href="<source-url>#anchor"   -> href="<prefix><pageMap[source-url].outputPath>#anchor"
```

The explicit `index.html` (or the source URL's literal `.html`
leaf) in nav targets is mandatory — `file://` browsers don't
auto-resolve directory links. `href="./beers/"` works on a
webserver that resolves `/beers/` to `/beers/index.html`, but
opens an "index of beers/" listing or 404 on `file://`. The
fix is `href="./beers/index.html"`.

Absolute external URLs (`https://`, `http://`, `mailto:`,
`tel:`) pass through verbatim. The canonical `<link>` and
`og:url` `<meta>` stay absolute (they are external addresses
that identify the page on the deploy host, not internal
references — composed per `metadata-and-jsonld.md` using
`state.json.site.deployUrl`).

The depth-aware relative shape makes the bundle truly portable:

- `file://` works because every link resolves relative to the
  open HTML file with an explicit filename.
- Hosting at the host root works because `./` and `../` resolve
  exactly like a webserver would.
- Hosting at any subpath (`example.com/preview/`) works for the
  same reason. No rewriting needed at deploy time.

This is the **single shape** the bundle emits; there is no
alternative-mode flag. The contract is "one shape, works
everywhere".

## `_meta.json` sidecar

Every migrated page gets a sidecar JSON next to its HTML file.
The sidecar's name depends on the HTML leaf:

- `index.html` → `_meta.json` (same dir)
- `<other>.html` → `<other>._meta.json` (same dir, prefix matches
  the HTML basename so multiple `.html` siblings don't collide)

Examples:

- `migrated/index.html`              → `migrated/_meta.json`
- `migrated/about/index.html`        → `migrated/about/_meta.json`
- `migrated/docs/api/index.html`     → `migrated/docs/api/_meta.json`
- `migrated/about-us/history.html`   → `migrated/about-us/history._meta.json`
- `migrated/about-us/team.html`      → `migrated/about-us/team._meta.json`

Schema:

```json
{
  "slug":             "<slug>",
  "type":             "<page-type>",
  "renderBranch":     "A | A' | B",
  "template":         "<archetype-slug or null>",
  "modules":          ["<module-id>", "..."],
  "slotsFilled":      ["<slot-name>", "..."],
  "canonShas":        { "header": "<sha>", "footer": "<sha>", "css": "<sha>" },
  "deviations":       [ { "where": "header", "reason": "..." } ],
  "migrationDecisions": [ { "kind": "...", "...": "..." } ],
  "metadata":         { "title": "...", "description": "...", "...": "..." },
  "jsonLd":           { "@type": "Article", "...": "..." },
  "migratedAt":       "<ISO timestamp>",
  "designMdSha":      "<sha>",
  "designJsonSha":    "<sha>",
  "sourceCurrentSha": "<sha>",
  "sourceProposedSha": "<sha or null>"
}
```

The HTML provenance block (in `<head>`) carries a compact pointer
to the sidecar. Both are redundant on purpose — downstream
consumers can read either.

## `:root` block sourcing + canon CSS injection

Every migrated page exposes:

1. The full `:root` block defined in
   `skills/stardust/reference/token-contract.md`, with values
   from `DESIGN.json.extensions.canon.pinned` first (overriding
   DESIGN.md ranges where pinned), falling back to DESIGN.md
   frontmatter for tokens not pinned.
2. The contents of `stardust/canon/canon.css` injected as the
   second block in the page's first `<style>`.

When `prepare-migration` Phase 3 (canon write-back) updates
canon, the next migrate run re-renders every affected page —
canon shas in provenance no longer match.

## Asset references

The migrated site is **self-contained** under
`stardust/migrated/` — every asset referenced by a migrated page
is bundled under `stardust/migrated/assets/<subpath>` and every
HTML/CSS reference is rewritten to root-relative
`/assets/<subpath>`. The contract is in
`reference/asset-bundling.md`; the downstream-facing guarantee is
in `skills/stardust/reference/migrate-output-format.md`.

Highlights:

- The bundling phase is the last step of the per-page render
  (Phase 2 of SKILL.md). Detection covers six shapes: `src`,
  `href`, `srcset`, inline `style="…url()…"`, `<style>` blocks,
  external CSS files.
- Cross-page deduplication via a project-level Set seeded from
  `state.json.migrate.bundledAssets[]`.
- Missing source assets warn-and-skip — the bundle stays
  internally consistent; the missing files are deploy-time 404s
  the migrate report surfaces.
- Fonts are downloaded during `prepare-migration` Phase 4 to
  `stardust/migrated/assets/fonts/`; canon CSS already
  references them via local paths after that phase, and the
  bundling pass treats those references like any other asset
  reference.
- Logo + favicon variants: see
  `metadata-and-jsonld.md` § Favicon.

## Validation

Validation contracts split into strict and soft per
`reference/template-and-module-rendering.md` § Validation
contracts.

**Strict (refuse-on-fail):**

1. `:root` block present at top of first `<style>`.
2. Required `data-*` attributes (`data-template`,
   `data-section`, plus `data-module` and `data-slot` where
   applicable) present.
3. Provenance block present as first child of `<head>`.
4. Required template/module slots filled.
5. Color reservations not violated
   (`DESIGN.json.extensions.colorReservations[]`).
6. Impeccable hard rules respected, **with brand-faithful
   inversions lifted** per
   `DESIGN.json.extensions.divergence.brand_faithful_inversions[]`.
7. `_meta.json` sidecar written and well-formed.
8. Output path collisions refused (two slugs → same path).

**Soft (log + surface, don't refuse):**

- Template-conformance shape (Path A′ deviations expected).
- Canon deviations (logged with reason).
- Bespoke slots (counted toward auto-promotion at 3 instances).
- Content overflow (placed in overflow region, logged).
- Broken internal links (logged in provenance and run summary).
- Missing OG image / favicon variants (falls back to defaults).

If a strict contract fails, do **not** write the file. Surface
the failure with the specific rule violated and a suggested fix.

## Provenance

```html
<!-- stardust:migrate
  writtenBy:        stardust:migrate
  writtenAt:        2026-04-26T11:00:00Z
  page:             home
  slug:             home
  pagePath:         migrated/index.html
  renderBranch:     A | A' | B
  template:         article                                       (Path A' only)
  archetypePath:    stardust/prototypes/news__post-housing-summit-proposed.html (Path A' only)
  archetypeSha:     <short>                                                     (Path A' only)
  sourceProposed:   stardust/prototypes/home-proposed.html        (Path A only)
  sourceCurrent:    stardust/current/pages/home.json
  againstDirection: stardust/direction.md (Active 2026-04-25T15:42:00Z)
  designMd:         DESIGN.md (sha: <short hash>)
  designJson:       DESIGN.json (sha: <short hash>)
  canonShas:        header:<short> footer:<short> css:<short>
  decisionTrace:    _meta.json
  brokenInternalLinks: 0
  stardustVersion:  0.2.0
-->
```

The compact comment in HTML carries pointers; the full
`migrationDecisions[]` array, slot list, JSON-LD, and resolved
metadata live in the sidecar `_meta.json`.

## Idempotent skip

When re-running `$stardust migrate` (no flags), each page is
checked:

- If the migrated `index.html` exists AND its provenance shas
  match the current values for `designMd`, `designJson`,
  `sourceCurrent`, `sourceProposed` (Path A), `canonShas`, and
  `archetypeSha` (Path A′) → **skip the page** and report
  `unchanged`. The archetype is recorded as both `archetypePath`
  (for traceability) and `archetypeSha` (for skip detection).
- Otherwise re-render.

This makes mass re-runs cheap. Common cases that trigger
re-render: DESIGN.md edited; current page re-extracted; proposed
file re-iterated; canon updated by `prototype --prep`; archetype
sibling re-approved.

The idempotent skip applies to all three render branches with
the same sha-comparison logic — only the input set differs per
branch.

## What migrate never does

- **Re-fetch the live site.** Migrate is offline. The only
  network step in the whole pipeline was Phase 1 of `extract`.
- **Run `$impeccable critique` or `audit`.** Validation is the
  hard-rule pass; quality assessment is the user's call (a
  manual `$impeccable critique stardust/migrated/` after the
  fact is always available).
- **Touch the live site.** Stardust never deploys, never pushes,
  never modifies origin.
- **Generate AEM EDS markup, framework components, or CMS
  payloads.** Static HTML only. Downstream conversion is a
  separate plugin's concern; the `data-*` vocabulary plus the
  `_meta.json` sidecar are the contract.
- **Move past `migrated` state.** No further state. A separate
  skill takes the migrated output as input.
