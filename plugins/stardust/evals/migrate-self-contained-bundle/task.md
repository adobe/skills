# Eval: migrate produces a self-contained, zip-and-deploy bundle

Validates that `$stardust migrate` produces output that is fully
self-contained — HTML + every referenced asset under
`stardust/migrated/`, with no `../current/` escapes — and that the
state.json `migrate` block signals the new contract. Exercises the
six detection shapes from `reference/asset-bundling.md`, the nine
edge cases, and the six acceptance criteria in the upstream spec.

Reference impl that the plugin's bundling phase generalises:
[paolomoz/wasatch](https://github.com/paolomoz/wasatch)
(`scripts/migrate.mjs`).

## Setup

A project where extract + direct + prototype have run and one
page is approved, ready for migrate:

- `stardust/state.json` lists 4 pages (each with `url` set so the
  URL-literal output mapping is exercised):
  - `home`            — `approved`, url `/`               (depth 0)
  - `beers`           — `directed`,  url `/beers/`         (depth 1, trailing-slash → `beers/index.html`)
  - `about__history`  — `directed`,  url `/about/history.html` (depth 1, `.html` leaf preserved → `about/history.html`)
  - `docs__api`       — `directed`,  url `/docs/api/`      (depth 2, → `docs/api/index.html`)
- `stardust/current/pages/<slug>.json` for each page exists.
- `stardust/current/assets/` populated with:
  - `logo.svg`
  - `favicon.svg`
  - `generated/hero-1x.jpg` and `generated/hero-2x.jpg`
  - `generated/parallax-bg.jpg`
  - `generated/orphan-only-1x.jpg` (referenced only by `home`)
  - `photos/family portrait.jpg` (note the space — exercises
    percent-encoding)
  - `fonts/inter-var.woff2`
  - **NO** `generated/missing.jpg` (intentionally absent —
    exercises the missing-asset surface)
- `stardust/prototypes/home-proposed.html` references assets in
  every detection shape AND internal pages via every authoring
  form the bundler must normalise:
  - `<link rel="icon" href="../current/assets/favicon.svg">`
  - `<img src="../current/assets/generated/hero-1x.jpg"
          srcset="../current/assets/generated/hero-1x.jpg 1x,
                  ../current/assets/generated/hero-2x.jpg 2x">`
  - `<picture><source srcset="../current/assets/generated/hero-2x.jpg 2x"></picture>`
  - `<section style="background-image: url('../current/assets/generated/parallax-bg.jpg')"></section>`
  - Inside an inline `<style>` block:
    ```
    @font-face { src: url("../current/assets/fonts/inter-var.woff2") format("woff2"); }
    .grid { background: url(../current/assets/generated/orphan-only-1x.jpg); }
    ```
  - One reference using percent-encoded subpath:
    `<img src="../current/assets/photos/family%20portrait.jpg">`
  - One reference using root-relative `/assets/` authoring
    (must be normalised to depth-aware relative on emit):
    `<img src="/assets/generated/hero-1x.jpg">`
  - One reference to a missing asset:
    `<img src="../current/assets/generated/missing.jpg">`
  - One scheme-bearing CDN URL (must be skipped, left external):
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`
  - One path-traversal attempt (must be refused):
    `<img src="/assets/../etc/passwd">`
  - Internal nav links exercising the pageMap rewrite, in three
    authoring styles the bundler must normalise:
    - root-absolute: `<a href="/beers/">Beers</a>`
    - same-origin absolute: `<a href="https://example.com/about/history.html">History</a>`
      (`example.com` matches `state.json.site.originUrl`)
    - directory-only (legacy authoring, must be normalised with
      explicit `index.html` leaf): `<a href="/docs/api/">API docs</a>`
  - One broken internal nav (no pageMap entry — must be flagged
    but not refuse the page): `<a href="/never-extracted/">…</a>`
- `stardust/canon/` populated.
- Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist
  with active direction.
- `state.json.site.originUrl` is `https://example.com`.
- Impeccable installed.

## User prompt (run 1)

`$stardust migrate`

## Expected behavior (run 1 — full self-contained, portable bundle)

1. The skill activates, prints the plan, and **builds
   `state.json.migrate.pageMap[]` BEFORE rendering any page** —
   per `migration-procedure.md` § Page map. The resulting map:
   ```json
   [
     { "sourceUrl": "/",                       "outputPath": "index.html",            "slug": "home" },
     { "sourceUrl": "/beers/",                 "outputPath": "beers/index.html",      "slug": "beers" },
     { "sourceUrl": "/about/history.html",     "outputPath": "about/history.html",    "slug": "about__history" },
     { "sourceUrl": "/docs/api/",              "outputPath": "docs/api/index.html",   "slug": "docs__api" }
   ]
   ```
   Note the URL-literal rule: `/about/history.html` preserves
   the `.html` leaf (does NOT synthesise `about/history/index.html`).
2. After Phase 2's per-page render, **asset bundling** runs:
   - All six detection shapes match. Subpaths surfaced:
     `favicon.svg`, `generated/hero-1x.jpg`, `generated/hero-2x.jpg`,
     `generated/parallax-bg.jpg`, `generated/orphan-only-1x.jpg`,
     `fonts/inter-var.woff2`, `photos/family portrait.jpg`,
     `generated/missing.jpg`.
   - Each present subpath is copied from
     `stardust/current/assets/<subpath>` to
     `stardust/migrated/assets/<subpath>` with subdir preserved.
   - `generated/missing.jpg` is logged as missing, skipped, and
     surfaced in `state.json.migrate.missingAssets[]`.
   - The path-traversal `/assets/../etc/passwd` is refused — no
     copy, no rewrite, logged under
     `_meta.json#migrationDecisions[]` with
     `kind: "asset-path-traversal"`.
   - The scheme-bearing `https://fonts.googleapis.com/...` URL is
     skipped (left external).
3. HTML rewrites in `home-proposed.html` (`outputPath:
   index.html`, **depth 0**, prefix `./`) produce:
   - `src`/`href` asset references → `./assets/<subpath>`
   - `srcset` URLs each rewritten independently; descriptors
     preserved verbatim
   - inline `style="url(...)"` rewritten to `./assets/...`
   - `<style>` block `url()` references rewritten (including the
     `@font-face` src and `.grid` background) to `./assets/...`
   - percent-encoded path preserved in HTML but decoded for
     file-system access (`photos/family portrait.jpg` lands on
     disk; HTML keeps `./assets/photos/family%20portrait.jpg`)
   - **root-relative authoring (`/assets/generated/hero-1x.jpg`)
     is normalised to `./assets/generated/hero-1x.jpg`** — the
     emitted contract is one shape (depth-aware relative), not
     "preserve whatever the author wrote"
   - **internal nav links resolve via pageMap[]:**
     - `<a href="/beers/">` → `<a href="./beers/index.html">`
     - `<a href="https://example.com/about/history.html">` →
       `<a href="./about/history.html">` (same-origin absolute
       stripped to path, looked up in pageMap)
     - `<a href="/docs/api/">` → `<a href="./docs/api/index.html">`
       (directory-only nav is rewritten with explicit
       `index.html` leaf)
     - `<a href="/never-extracted/">` → flagged
       `data-broken-link="true"`, logged under
       `provenance.brokenInternalLinks[]`; page still emits.
4. **Portability audit passes (Phase 3 step 5):**
   - No `../current/` escapes.
   - No absolute internal `href`/`src=/...`.
   - No absolute `url(/...)`.
   - No directory-only nav (`href=".../"`).
   - `pagemap-audit.mjs` exits 0.
   - `file-protocol-audit.mjs` exits 0 — `file://index.html`
     opens, BFS-walks every internal link, every target file
     exists and loads without `requestfailed`.
5. `cd stardust/migrated && zip -r /tmp/out.zip .` produces a
   zip that renders identically in three contexts: served at
   the host root, served at any subpath (e.g.
   `example.com/preview/`), and opened via `file://`. No 404s
   on any bundled asset.
6. `state.json.migrate` is written with `pageMap[]` first
   (built before rendering), then the asset-bundling fields:
   ```json
   {
     "at":                  "<ISO>",
     "outputDir":           "stardust/migrated/",
     "selfContained":       true,
     "pageMap":             [
       { "sourceUrl": "/",                       "outputPath": "index.html",            "slug": "home" },
       { "sourceUrl": "/beers/",                 "outputPath": "beers/index.html",      "slug": "beers" },
       { "sourceUrl": "/about/history.html",     "outputPath": "about/history.html",    "slug": "about__history" },
       { "sourceUrl": "/docs/api/",              "outputPath": "docs/api/index.html",   "slug": "docs__api" }
     ],
     "totalAssetsBundled":  7,
     "bundledAssets":       [ "favicon.svg", "generated/hero-1x.jpg",
                              "generated/hero-2x.jpg", "generated/parallax-bg.jpg",
                              "generated/orphan-only-1x.jpg",
                              "fonts/inter-var.woff2", "photos/family portrait.jpg" ],
     "pages":               [ { "slug": "home", "file": "stardust/migrated/index.html", "assetsBundled": <n> }, ... ],
     "missingAssets":       [ { "subpath": "generated/missing.jpg",
                                "referencedBy": ["home"] } ],
     "cleanedAssets":       []
   }
   ```
7. Run summary surfaces:
   ```
   Output:  stardust/migrated/  (4 pages, 7 bundled assets, ... MB) — self-contained, zip-and-deploy

   Missing assets: 1
     generated/missing.jpg     referenced by 1 page (home)

   Broken internal links: 1
     /never-extracted/         referenced by 1 page (home)
   ```

## User prompt (run 2 — immediately after run 1, no source changes)

`$stardust migrate`

## Expected behavior (run 2 — idempotency)

8. Every page sha-matches; no page is re-rendered. The asset-
   bundling pass is skipped (per-page; assets stay on disk
   untouched).
9. Bundled HTML is byte-identical to run 1's output **modulo the
   migrate-provenance timestamp**. Acceptance criterion #4. (To
   pin: `$stardust migrate --pin-timestamp 2026-05-13T22:30:00Z`
   produces strict byte-identity.)

## User prompt (run 3 — drop a referenced asset, re-run with --clean)

The user removes the `<img src="/assets/generated/orphan-only-1x.jpg">`
reference from `home-proposed.html` (the asset on disk under
`current/assets/generated/orphan-only-1x.jpg` stays). Then runs
`$stardust migrate --clean`.

## Expected behavior (run 3 — stale asset cleanup)

10. **`--clean` implies `--force`**: every page in scope
    re-renders, not just `home`. The migrate plan surfaces
    `--clean → --force on N pages`.
11. The new `bundledAssets` set is the complete union across
    every re-rendered page and no longer contains
    `generated/orphan-only-1x.jpg`.
12. The prior copy at
    `stardust/migrated/assets/generated/orphan-only-1x.jpg` is
    deleted. `state.json.migrate.cleanedAssets[]` records
    `["generated/orphan-only-1x.jpg"]`.
13. Without `--clean`, the run would have honored the idempotent
    skip (only `home` re-renders), the file would have remained
    on disk (additive default), and no deletions occur.

## User prompt (run 4 — cross-page asset deduplication + depth-aware emission)

The user adds the same hero image reference (`/assets/generated/hero-1x.jpg`)
to `about__history-proposed.html` (`outputPath:
about/history.html`, **depth 1**, prefix `../`). Re-runs
migrate.

## Expected behavior (run 4 — global dedup, depth-aware emission)

14. `about__history` enters the bundle. `home`'s sha hasn't
    changed → home is skipped.
15. The hero image is detected on the new page but is already
    in `state.json.migrate.bundledAssets[]` from the prior run;
    the bundler's global Set (seeded from state.json) reports
    it as deduped and does NOT re-copy.
16. **The page emits a depth-aware reference**:
    `<img src="../assets/generated/hero-1x.jpg">` — NOT the
    `./assets/...` form that home emits. The underlying file
    is the same single copy on disk; each page rewrites with
    its own prefix.
17. `_meta.json` for `about__history` records `assetsBundled: 1`
    (the page references 1 asset).
18. `state.json.migrate.totalAssetsBundled` is unchanged.

## What this eval covers

| Behavior                                                  | Run | Acceptance criterion |
|-----------------------------------------------------------|-----|----------------------|
| Self-containment (no `../current/` escapes)               | 1   | #1                   |
| `zip -r` produces a deploy-ready archive                  | 1   | #2                   |
| Cross-context portability (host root, subpath, file://)   | 1   | #2 + #3 + new        |
| Idempotency (re-run differs only in provenance timestamp) | 2   | #4                   |
| Asset-count surfaced in report                            | 1   | #5                   |
| Missing-asset surfaced in report + state.json             | 1   | #6                   |

| Behavior (0.7.1 contract)                                 | Run | Reference                          |
|-----------------------------------------------------------|-----|------------------------------------|
| pageMap[] built before rendering                          | 1   | migration-procedure.md § Page map  |
| URL-literal output (`.html` leaf preserved)               | 1   | § Output path: URL-literal rule    |
| Depth-aware relative paths emitted                        | 1, 4 | § Reference shape                 |
| Root-relative authoring normalised                        | 1   | § Reference shape                  |
| Same-origin absolute hrefs go through pageMap             | 1   | § Page map                         |
| Broken internal links flagged + logged                    | 1   | content-preservation.md § Link rw  |
| Portability audit (6-step Phase 3) passes                 | 1   | SKILL.md § Phase 3 step 5          |
| `file-protocol-audit.mjs` exits 0                         | 1   | fixtures/file-protocol-audit.mjs   |
| `pagemap-audit.mjs` exits 0                               | 1   | fixtures/pagemap-audit.mjs         |

| Edge case                                                 | Run | Detection shape    |
|-----------------------------------------------------------|-----|--------------------|
| `srcset` with multiple URLs + descriptors                  | 1   | shape #2           |
| Inline `style="background-image: url(...)"`              | 1   | shape #3           |
| `@font-face src: url(...)` in `<style>` block             | 1   | shapes #4/#5       |
| External CSS file `url()` (when emitted)                  | 1   | shape #4           |
| Missing source assets warn-and-skip                       | 1   | edge case          |
| Cross-page deduplication via global Set                   | 4   | edge case          |
| Idempotency (re-runs byte-identical modulo timestamp)     | 2   | edge case          |
| Stale-asset cleanup behind `--clean`                      | 3   | edge case          |
| Path-traversal safety (`/assets/../etc/passwd` refused)   | 1   | edge case          |
| Percent-encoded subpath preserved in HTML, decoded on FS  | 1   | edge case          |
| Scheme-bearing CDN URL skipped (left external)            | 1   | edge case          |
