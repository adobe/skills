---
name: migrate
description: Apply DESIGN, canon, and modules to every page in the inventory, producing a deployable static HTML site. Three render branches (approved page, template-applied sibling, unique render). Per-page, incremental, idempotent, content-preserving by default.
license: Apache-2.0
---

# stardust:migrate

Apply the target spec authored by `direct`, the visual canon
written by `prototype --prep`, and the brand-module catalog
extracted during `prepare-migration` to every page in the
inventory. Produces a self-contained, deployable static HTML site
under `stardust/migrated/`. Per-page, incremental, idempotent.

`migrate` is the final stardust phase. Output is platform-
agnostic HTML — downstream conversion (AEM EDS, a CMS, a
framework) is the job of a separate plugin that consumes
`migrated/` plus `DESIGN.json` plus the per-page `_meta.json`
sidecars.

## Inputs

- `<slug>` — optional positional. Migrate just this page. Without
  it, migrate every page whose status is `directed`,
  `prototyped`, or `approved` (and not `stale`).
- `--all` — migrate every page including stale ones.
- `--force` — re-migrate every page even when the idempotent
  skip would skip them.
- `--require-approved` — refuse to migrate any non-`approved`
  page. Default behaviour migrates `directed` pages too (using
  Path A′ or Path B per
  `reference/template-and-module-rendering.md`); this flag flips
  approval-gating on.
- `--strict-canon` — refuse approvals that conflict with canon.
  Default logs the deviation and continues. Useful for projects
  where canon discipline matters more than per-template
  flexibility.
- `--clean` — delete assets previously bundled but no longer
  referenced from `stardust/migrated/assets/`. Off by default
  (migrate is additive). **Implies `--force`**: every page is
  re-rendered so the run's `bundledAssets` Set is the complete
  union of currently-referenced assets — otherwise `--clean`
  would risk deleting assets still referenced by
  idempotent-skipped pages. See
  `reference/asset-bundling.md` § Stale asset cleanup.
- `--pin-timestamp <ISO8601>` — pin the migrate-provenance
  timestamp so re-runs without source changes produce byte-
  identical HTML. Default re-uses the current wall clock, which
  is fine for normal use; CI deployment fingerprinting may want
  the pin.

The mobile-adapt audit, content-sourcing scan, and placeholder
refusal are all mandatory gates — there is no `--skip-*` or
`--allow-*` flag to bypass them. If a gate refuses a page, the
remediation is to fix the proposed file (re-prototype, edit
inline, or run an impeccable command) and re-invoke migrate.

## Setup

1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/state.json` exists with at least one
   `directed` page.
3. Verify project-root `DESIGN.md` and `DESIGN.json` exist with
   `DESIGN.json.extensions.canon` populated. If canon is empty,
   recommend `$stardust prepare-migration` and stop.
4. Verify `stardust/canon/` exists with at least
   `header.html`, `footer.html`, `canon.css`. Otherwise prep
   hasn't completed; recommend `$stardust prepare-migration`
   and stop.
5. Verify `stardust/direction.md` has an active (not pending)
   direction.
6. Read `state.json.pages[]` and partition into:
   - **inScope**: status `directed`, `prototyped`, or
     `approved`, `stale: false` (or `--all` / explicit
     `<slug>`).
   - **skipped**: everything else, with reason captured.
7. **Validate provenance on every in-scope page.** Call
   `validateProvenance(page)` per
   `skills/stardust/reference/state-machine.md` § Provenance
   validation for every page in `inScope`. Abort with the
   helper's error when any page lacks live-render evidence —
   migrating a synthesized page record produces deployable HTML
   that misrepresents the source site, the exact failure mode
   that motivated the validator. Surface `Provenance OK on N
   pages` in the migrate-plan output before Phase 1.
8. **Mobile-adapt audit on every Path A / Path A′ source.** For
   every page whose render branch consumes a proposed or
   archetype HTML file (Path A, Path A′ per
   `reference/template-and-module-rendering.md` § Render path
   selection), run the audit per `skills/prototype/SKILL.md`
   § Mobile-adapt audit:

   - `<meta name="viewport" content="width=device-width, ...">`
     present, width not pinned to a fixed pixel value.
   - At least one `@media (max-width: ...)` rule.
   - At least one mobile-targeted breakpoint at ≤ 640px.

   Refuse pages that fail — the audit is mandatory; there is no
   skip flag. The user fixes the proposed file (re-prototype or
   chat-driven impeccable command) and re-invokes migrate.
   Record the audit result per page in the migrate report and
   in the post-render `_meta.json#audit.adapt` sidecar. Path B
   (unique-renders) skips the audit because adapt hasn't run
   on those pages — a Path B page that needs mobile coverage
   gets it via `$impeccable adapt` invoked separately by the
   user. Surface this distinction in the report so it's not
   read as a silent skip.

## Procedure

### Phase 1 — Plan

Print the plan and wait for confirmation when the scope is large:

```
migrate plan
============

In scope: 127 pages
  Path A  (approved)                6 pages: home, news/post-housing-summit, news, ...
  Path A' (template-applied)      118 pages: 84 article, 5 listing, 11 program, 2 form, 16 static
  Path B  (unique)                  3 pages: 404, search, faq

Skipped:  0 stale, 0 unscoped

DESIGN.md sha:    1a2b3c4
DESIGN.json sha:  5d6e7f8
Canon shas:       header:7g8h9i  footer:9i0j1k  css:1k2l3m

Output:           stardust/migrated/  +  per-page _meta.json sidecars
Idempotent skip:  enabled (run with --force to override)

Reply "go" to proceed.
```

For 1-3 pages or `<slug>` invocation, skip the confirmation.

### Phase 2 — Per-page render

For each page in scope, follow
`reference/migration-procedure.md` and
`reference/template-and-module-rendering.md`:

- **Idempotent skip check** first (sha-compare across
  `designMd`, `designJson`, `sourceCurrent`, `sourceProposed`,
  `canonShas`, `archetypeSource`).
- **Placeholder gate** (Path A and Path A′ only — pages with a
  proposed file or archetype). Refuse when `[data-placeholder]`
  elements or non-empty `_provenance.unsourcedContent[]` are
  present — the user fills the missing content in the proposed
  file before re-invoking migrate. No bypass flag.
- **Render branch selection** (LLM judgment per T&M §
  Render path selection): A / A′ / B.
- **Render** per the chosen branch's procedure in T&M.
- **Canon application** — chrome injection, canon.css
  injection, deviation logging.
- **Module rendering** — render module instances via
  `stardust/canon/modules/<id>.html`; bespoke slots logged
  with `data-bespoke`.
- **Apply content-preservation rules** per
  `reference/content-preservation.md`. Internal-link rewriting
  always emits migrated-tree paths; missing slugs flagged
  broken.
- **Compose `<head>` metadata** per
  `reference/metadata-and-jsonld.md` (five categories;
  page-type-driven JSON-LD).
- **Validate** per T&M § Validation contracts. Strict contracts
  refuse the page; soft contracts log and continue.
- **Compute output path** per migration-procedure.md
  § Output path mapping.
- **Asset bundling.** Scan the final HTML for asset references
  (six detection shapes per
  `reference/asset-bundling.md` § Detection), copy each unique
  referenced subpath from `stardust/current/assets/<subpath>` to
  `stardust/migrated/assets/<subpath>` (preserving subdir
  structure), then rewrite every reference to the root-relative
  form `/assets/<subpath>`. Cross-page dedup uses a
  module-level Set seeded from
  `state.json.migrate.bundledAssets[]`. Missing source assets
  warn-and-skip per § Edge cases; the bundle stays internally
  consistent.
- **Write** the migrated `index.html` and the `_meta.json`
  sidecar in the same directory. Provenance block as first
  child of `<head>`. Record `assetsBundled` (count of unique
  asset refs on this page) in `_meta.json`.

### Phase 3 — Sitewide assets and bundle finalisation

Per-page asset bundling already happened in Phase 2 (every
referenced media subpath is on disk under
`stardust/migrated/assets/`). Phase 3 fills in the **sitewide
assets** that no individual page references explicitly:

1. Copy `stardust/current/assets/logo.<ext>` to
   `stardust/migrated/assets/logo.<ext>` (only if missing or
   stale). Record under `state.json.migrate.bundledAssets[]`.
2. Verify favicon variants and font files were generated by
   `prepare-migration` Phase 4. If absent, log a warning and
   continue (the migrated site renders without them, just
   missing some platform-specific affordances).
3. Add `stardust/migrated/robots.txt` and `sitemap.xml`
   derived from the migrated page inventory per
   `reference/metadata-and-jsonld.md` § Sitemap entry.
4. If `--clean` was passed, compute
   `stale = priorBundle.filter(p => !bundledAssets.has(p))`
   from `state.json.migrate.bundledAssets[]` and remove each
   stale subpath from `stardust/migrated/assets/`. Record the
   deletions under `state.json.migrate.cleanedAssets[]`. Per
   `reference/asset-bundling.md` § Stale asset cleanup.
5. Verify **portability**. The bundle must work via `file://`,
   at a webserver root, and at any subpath — "one shape, works
   everywhere". Run every audit; any non-empty grep output or
   non-zero fixture exit fails the run with the cited error
   message:

   ```bash
   # No source-tree escapes
   find stardust/migrated/ -type f -name '*.html' -exec grep -l '\.\./current/' {} +
   # Error: "asset still points outside the migrated tree; rewrite via the
   #   asset-bundling pass per reference/asset-bundling.md § Detection"

   # No absolute internal references in attribute values (404 on file:// and subpath)
   grep -rE '(href|src)="/[^/]' stardust/migrated/ --include='*.html'
   # Error: "absolute href `/beers/` will 404 on file:// and on subpath hosts;
   #   rewrite via the page map per migration-procedure.md § Reference shape"

   # No absolute internal references in url() (inline style, <style> blocks, CSS)
   grep -rE 'url\(\s*["'\'']?\s*/[^/]' stardust/migrated/ --include='*.html' --include='*.css'
   # Error: "absolute url(/...) reference will 404 on file:// and on subpath hosts;
   #   rewrite via the asset-bundling pass per asset-bundling.md § Rewrite"

   # No directory-only nav (doesn't resolve on file://). Pattern accepts
   # only relative or root-absolute hrefs (./, ../, /, or bare segment)
   # so external URLs like https://google.com/ aren't false-flagged.
   grep -rE 'href="(\.{0,2}/|[a-zA-Z0-9_-])[^:"#?]*/"' stardust/migrated/ --include='*.html'
   # Error: "directory-only href `./beers/` won't resolve on file://;
   #   append the explicit index.html (or the source URL's .html leaf)
   #   per § Reference shape"

   # pageMap consistency — every internal href appears as an outputPath
   node skills/migrate/fixtures/pagemap-audit.mjs stardust/migrated/ stardust/state.json
   # Error: "internal href has no pageMap entry; link rewriting bypassed the
   #   page map per § Page map (build once, use everywhere)"

   # Headless file:// round-trip — the test that proves zip-and-deploy works
   node skills/migrate/fixtures/file-protocol-audit.mjs stardust/migrated/
   # Error: "<offending file> linked <ref> that 404s under file://; see the
   #   Playwright network log printed above"
   ```

   The audits are mandatory — there is no skip flag. The contract
   is "self-contained, zip-and-deploy" and these audits are the
   verifiers that back the claim.

Asset migration is idempotent — files are content-hashed and
copied only when missing; per-page bundling deduplicates across
the run.

### Phase 4 — State and report

Update `state.json`:

- For each successfully migrated page: `status` advances to
  `migrated`, append a history entry, clear any `stale` flag,
  set `migratedPath`.
- For pages skipped via idempotent skip: leave state
  unchanged.
- For pages that failed validation: leave state unchanged, log
  the failure in `state.json.lastRun.failures[]`.
- Write the top-level `migrate` block per
  `skills/stardust/reference/migrate-output-format.md`
  § State.json contract: `selfContained: true`, `outputDir`,
  `totalAssetsBundled`, `bundledAssets[]`, per-page
  `assetsBundled` counts, `missingAssets[]`, `cleanedAssets[]`.
  This is the forward-compat signal downstream consumers test
  for.

Print the run summary:

```
migrate complete
================

 122 migrated         home, about, news/post-housing-summit, ...
   3 unchanged        about, programs/shelter, news/post-old (idempotent skip)
   2 failed           contact (validation: required slot missing),
                      legal/privacy (validation: color-reservation violated)
   0 stale skipped

Render branches:
  Path A   6   approved-from-prototype
  Path A'  116 template-applied (84 article, 5 listing, 11 program, 2 form, 14 static)
  Path B   3   unique-render (404, search, faq)

Pages with non-trivial decisions: 12
  about            canon-deviation: footer carries financials disclaimer
  donate           template-adapted: amount-pills slot moved above headline
  ...

Broken internal links: 5
  /events       referenced by 2 pages; not in inventory
  /press        referenced by 1 page; not in inventory
  ...

Bespoke slots crossing promotion threshold: 1
  hotline-211: "state"  (3 instances) — consider `$stardust prepare-migration --refine-module`

Missing assets: 2
  generated/orphan-1.jpg     referenced by 1 page  (home)
  generated/orphan-2.jpg     referenced by 2 pages (about, contact)
  (Re-extract or accept the gap — bundle is deployable; refs 404 at view time.)

Output:  stardust/migrated/  (122 pages, 47 bundled assets, 4.2 MB) — self-contained, zip-and-deploy

Next:
  - Review:    open stardust/migrated/index.html in a browser
  - Audit:     $impeccable critique stardust/migrated/
  - Deploy:    cd stardust/migrated && zip -r ../site.zip .
               upload the zip to any static host that serves at the host root
  - Refine:    edit DESIGN.md or canon files, then re-run $stardust migrate
```

## Outputs

| Path                                              | Purpose                                                |
|---------------------------------------------------|--------------------------------------------------------|
| `stardust/migrated/<source-url-path>`             | Migrated page. Output path mirrors the source URL literally (see `reference/migration-procedure.md` § Output path mapping). The bundle is **zip-and-deploy**: drop on any static host at any path, or open `index.html` directly via `file://`. Every internal reference is relative to the page that emits it; nav targets carry an explicit `index.html` (or the source URL's literal filename) so file:// resolves without a server. |
| _meta.json sidecar                                | Lives next to each migrated page. For `<dir>/index.html` the sidecar is `<dir>/_meta.json`; for `<dir>/<name>.html` the sidecar is `<dir>/<name>._meta.json` so multiple `.html` siblings don't collide. Per `reference/migration-procedure.md` § `_meta.json` sidecar. |
| `stardust/migrated/index.html`                    | The home page (special case).                          |
| `stardust/migrated/_meta.json`                    | Home sidecar.                                          |
| `stardust/migrated/assets/logo.<ext>`             | Brand logo (sitewide).                                 |
| `stardust/migrated/assets/<subpath>`              | Every asset referenced by any migrated page, bundled. Source subdir structure preserved verbatim. |
| `stardust/migrated/assets/favicon.<ext>` + variants| Favicon and apple-touch-icon, manifest icons.         |
| `stardust/migrated/assets/fonts/...`              | Downloaded font files (from canon @font-face URLs).    |
| `stardust/migrated/robots.txt`                    | Minimal robots.txt.                                    |
| `stardust/migrated/sitemap.xml`                   | Sitemap derived from migrated inventory + page types.  |
| `stardust/state.json`                             | Updated with `migrated` status, history, and the `migrate` block (`selfContained: true`, asset counts). |

## Idempotent and incremental

The whole pipeline is built around two properties:

- **Idempotent.** Re-running `$stardust migrate` with no
  changes produces zero file writes. Every page is sha-compared
  across designMd, designJson, sourceCurrent, sourceProposed
  (Path A), canonShas, archetypeSource (Path A′) — and skipped
  if all match.
- **Incremental.** Migrate 5 pages today, 20 pages tomorrow,
  fix one page's content next week — the migrated tree is
  always the union of every successful migration to date.

These properties hold even when DESIGN.md, canon, or modules are
edited mid-run: the edit changes the relevant sha, so the next
migrate run re-renders every affected page (canon and DESIGN.md
edits typically affect every page).

## Stale handling

When `direction.md`, canon, or the module catalog changes after
some pages have been migrated:

- Affected pages are flagged `stale: true` per
  `skills/stardust/reference/state-machine.md` § Stale flagging.
  Stale-flagging is content-aware in all three trigger cases.
- `$stardust migrate` (no flags) skips stale pages and reports
  the count.
- `$stardust migrate --all` re-migrates each stale page,
  clearing the flag on success.
- `$stardust migrate <slug>` always operates on the named page,
  stale or not.

The user decides whether stale pages should be refreshed —
direction/canon/module changes don't invalidate prior migrated
work, they just mark it as out-of-step.

## Failure modes

- **No directed pages.** Recommend `$stardust direct` (or
  `$stardust extract` if no extracted state).
- **No DESIGN.md, DESIGN.json, or canon.** Recommend
  `$stardust prepare-migration`.
- **Pending direction.** Refuse; user must resolve direction
  first.
- **Validation failure on a single page.** Skip that page,
  continue, log the failure under
  `state.json.lastRun.failures[]`. Do not abort the whole run.
- **Asset copy failure.** Continue the run; record the missing
  asset in the page's `migrationDecisions[]` with
  `kind: "asset-missing"`. The migrated `<img src>` keeps the
  original absolute URL as a fallback.
- **Output path collision.** Two slugs mapping to the same
  output path. Refuse to write the second one and surface to
  the user — manual slug rename needed.
- **Placeholder content in proposed/archetype file.** Refuse
  to ship a page whose source contains `[data-placeholder]`
  elements. Surface the unsourced list and recommend sourcing
  real content (re-prototype, or edit the proposed file
  directly). There is no bypass flag — shipping placeholders to
  a public site is the failure mode this gate exists to prevent.
- **Color reservation violated.** Refuse the page; surface to
  user with the offending color and the reserved-for context.
- **Brand-faithful inversion conflict.** A hard rule declared
  inverted in
  `extensions.divergence.brand_faithful_inversions[]` is lifted
  from validation per T&M § Brand-faithful inversion handling.
  Emit a one-line note in the run summary acknowledging the
  lift.

## What migrate does NOT do

- Critique or audit the migrated output. Run
  `$impeccable critique stardust/migrated/` after migration if
  you want a quality assessment.
- Deploy. Stardust does not push, upload, or modify origin.
- Generate AEM EDS, a CMS payload, or framework components. The
  output is platform-agnostic static HTML; downstream conversion
  is a separate plugin's job.
- Re-fetch the live site. Offline after extract Phase 1.
- Run any iteration loop. Iteration belongs to `prototype`;
  migrate consumes the result.

## References

- `reference/migration-procedure.md` — per-page render procedure,
  output path mapping, validation, provenance shape, idempotent
  skip, sidecar schema.
- `reference/template-and-module-rendering.md` — three render
  branches in detail, slot injection, deviation policy,
  validation contracts.
- `reference/metadata-and-jsonld.md` — head composition, JSON-LD
  per page-type, canonical strategy.
- `reference/content-preservation.md` — what's kept,
  transformed, dropped; internal-link rewriting; asset path
  rewriting; form handling.
- `reference/asset-bundling.md` — detection / copy / rewrite
  contract for the per-page asset-bundling phase.
- `skills/stardust/reference/migrate-output-format.md` — the
  self-contained-bundle contract downstream consumers can rely
  on (asset reference shape, directory layout,
  `state.json.migrate` block).
- `skills/stardust/reference/token-contract.md` — `:root` block
  refreshed from DESIGN.md on every render.
- `skills/stardust/reference/data-attributes.md` — structural
  attributes including `data-template`, `data-module`,
  `data-slot`, `data-canon`, `data-deviation`, `data-bespoke`,
  `data-broken-link`.
- `skills/stardust/reference/state-machine.md` — page lifecycle,
  page typing, stale-flagging cascade.
- `skills/stardust/reference/artifact-map.md` — provenance shape
  for migrated artifacts; canon files; sidecar shape.
- `skills/prototype/reference/canon-extraction.md` — how canon
  is built (input to migrate).
- `skills/prepare-migration/SKILL.md` — the cascade that
  produces every input migrate consumes.
