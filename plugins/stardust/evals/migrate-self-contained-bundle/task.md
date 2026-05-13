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

- `stardust/state.json` lists 4 pages:
  - `home` — `approved` (proposed.html exists)
  - `about` — `directed`
  - `gallery` — `directed`
  - `docs__api` — `directed` (multi-segment slug)
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
  every detection shape:
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
  - One reference using root-relative `/assets/` (alternate
    authoring style):
    `<img src="/assets/generated/hero-1x.jpg">`
  - One reference to a missing asset:
    `<img src="../current/assets/generated/missing.jpg">`
  - One scheme-bearing CDN URL (must be skipped):
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`
  - One path-traversal attempt (must be refused):
    `<img src="/assets/../etc/passwd">`
- `stardust/canon/` populated.
- Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist
  with active direction.
- Impeccable installed.

## User prompt (run 1)

`$stardust migrate`

## Expected behavior (run 1 — full self-contained bundle)

1. The skill activates, prints the plan, and renders each of the
   4 pages per the standard render-branch logic.
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
3. HTML rewrites in `home-proposed.html` produce:
   - `src`/`href` references → `/assets/<subpath>`
   - `srcset` URLs each rewritten independently; descriptors
     preserved
   - inline `style="url(...)"` rewritten
   - `<style>` block `url()` references rewritten (including the
     `@font-face` src)
   - percent-encoded path preserved in HTML but decoded for
     file-system access (`photos/family portrait.jpg` lands on
     disk; HTML keeps `/assets/photos/family%20portrait.jpg`)
   - the already-`/assets/`-shaped reference passes through
     idempotently
4. **No file under `stardust/migrated/` contains the substring
   `../current/`.** Acceptance criterion #1.
5. `cd stardust/migrated && zip -r /tmp/out.zip .` and extracting
   the zip into an empty directory served over HTTP renders
   identically to the migrated tree opened directly. Acceptance
   criteria #2 and #3.
6. `state.json.migrate` is written with:
   ```json
   {
     "at":                  "<ISO>",
     "outputDir":           "stardust/migrated/",
     "selfContained":       true,
     "totalAssetsBundled":  7,
     "bundledAssets":       [ "favicon.svg", "generated/hero-1x.jpg",
                              "generated/hero-2x.jpg", "generated/parallax-bg.jpg",
                              "generated/orphan-only-1x.jpg",
                              "fonts/inter-var.woff2", "photos/family portrait.jpg" ],
     "pages":               [ { "slug": "home", ..., "assetsBundled": <n> }, ... ],
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
   ```
   Acceptance criteria #5 and #6.

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

## User prompt (run 4 — cross-page asset deduplication)

The user adds the same hero image reference (`/assets/generated/hero-1x.jpg`)
to `about-proposed.html` (a newly approved page). Re-runs
migrate.

## Expected behavior (run 4 — global dedup)

14. `about` enters the bundle. `home`'s sha hasn't changed → home
    is skipped.
15. The hero image is detected on `about` but is already in
    `state.json.migrate.bundledAssets[]` from the prior run; the
    bundler's global Set (seeded from state.json) reports it as
    deduped and does not re-copy.
16. `_meta.json` for `about` records `assetsBundled: 1` (the
    page references 1 asset).
17. `state.json.migrate.totalAssetsBundled` is unchanged.

## What this eval covers

| Behavior                                                  | Run | Acceptance criterion |
|-----------------------------------------------------------|-----|----------------------|
| Self-containment (`find ... -name '*.html' | xargs grep '../current/'` empty) | 1 | #1 |
| `zip -r` produces a deploy-ready archive                  | 1   | #2                   |
| Cross-project test (extract zip to isolated dir, serves)  | 1   | #3                   |
| Idempotency (re-run differs only in provenance timestamp) | 2   | #4                   |
| Asset-count surfaced in report                            | 1   | #5                   |
| Missing-asset surfaced in report + state.json             | 1   | #6                   |

| Edge case                                                 | Run | Detection shape    |
|-----------------------------------------------------------|-----|--------------------|
| `srcset` with multiple URLs + descriptors                  | 1   | shape #2           |
| Inline `style="background-image: url(...)"`              | 1   | shape #3           |
| `@font-face src: url(...)` in `<style>` block             | 1   | shapes #4/#5       |
| External CSS file `url()` (when emitted)                  | 1   | shape #4           |
| Root-relative `/assets/` authoring                        | 1   | prefix resolution  |
| Missing source assets warn-and-skip                       | 1   | edge case          |
| Cross-page deduplication via global Set                   | 4   | edge case          |
| Idempotency (re-runs byte-identical modulo timestamp)     | 2   | edge case          |
| Stale-asset cleanup behind `--clean`                      | 3   | edge case          |
| Path-traversal safety (`/assets/../etc/passwd` refused)   | 1   | edge case          |
| Percent-encoded subpath preserved in HTML, decoded on FS  | 1   | edge case          |
| Scheme-bearing CDN URL skipped (left external)            | 1   | edge case          |
