---
name: migrate
description: Apply DESIGN, canon, and modules to every page in the inventory, producing a deployable static HTML site. Use to migrate or render the whole captured site into the redesigned static tree ("migrate the pages", "render the migrated site", "apply the design to all pages", "build the deployable site", "convert the approved prototype into the full site") — the page-rendering step between prototype and deploy/rollout. Three render branches (approved page, template-applied sibling, unique render), with a declared fidelity tier per page. Per-page, incremental, idempotent, content-preserving by default.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
metadata:
  version: "1.2.0"
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

**The procedure below is an outline.** The text of each phase is in `skills/migrate/reference/`, in the file the phase names. Read that file in full when you reach the phase; never work from a heading alone.

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

0. **Playwright re-probe (mandatory first step).** `--no-save` playwright
   installs from earlier phases are pruned by any later real `npm i`
   (extract SKILL.md § Setup → `--no-save` installs are ephemeral). Before
   any rendering step, probe
   `node -e "import('playwright').then(()=>process.exit(0))"` from the
   project root and re-install (`npm i -D playwright --no-save
   --legacy-peer-deps`) on failure.
1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup). **Flow guard.** If
   `stardust/state.json` exists without `flow` and the ask is a
   migration (a URL plus "migrate" / "to EDS" / "re-platform"), do not
   run: print the two-flow table from the master skill § Two migration
   flows and hand back to its routing — the flow is chosen and stamped
   there before any sub-skill runs
   (`skills/stardust/reference/state-machine.md` § Flow keys): `replica`
   unless the ask names a redesign.
   (Recorded: `migrate <url>` as the first command of two same-design
   migrations led to a hand-built compiler tuned by eye instead of the
   replica gate.)
2. Verify `stardust/state.json` exists with at least one
   `directed` page.
3. Verify project-root `DESIGN.md` and `DESIGN.json` exist with
   `DESIGN.json.extensions.canon` populated.
4. Verify `stardust/canon/` exists with at least
   `header.html`, `footer.html`, `canon.css`.

   **Canon auto-bootstrap (when steps 3–4 find no canon).** The
   documented `prototype → migrate → deploy` happy path does not
   run `prepare-migration`, so a first migrate legitimately arrives
   with no canon (observed on 4 of 6 e2e sites, where every run had
   to derive canon by hand to proceed — this is the fix). When
   canon is absent **and** at least one `approved` prototype exists,
   do not stop: run the canon write-back inline from the first
   approved prototype (the canon-author, default `home`) per
   `../prototype/reference/canon-extraction.md` § Five-step
   procedure — extract `header.html` / `footer.html` / `canon.css`
   to `stardust/canon/`, pin tokens + compositional moves to
   `DESIGN.json.extensions.canon`, and record
   `canon.source: "auto-bootstrap: <slug>"`. This is exactly what
   `prototype --prep` does on first approval; migrate performs it
   on demand so the core pipeline never dead-ends. Only stop and
   recommend `$stardust prepare-migration` when canon is absent
   **and** no approved prototype exists (there is nothing to derive
   canon from). Under `state.json.handsOff` the bootstrap is
   automatic and logged; interactively, surface it as a one-line
   notice before proceeding.
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
   § Mobile-adapt audit (viewport meta, mobile-first queries, the
   360px render checks).

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

Read `skills/migrate/reference/phase-1-plan.md` in full before you act on this section.

### Phase 2 — Per-page render

Read `skills/migrate/reference/phase-2-per-page-render.md` in full before you act on this section.

### Phase 3 — Sitewide assets and bundle finalisation

Read `skills/migrate/reference/phase-3-sitewide-assets.md` in full before you act on this section.

### Phase 4 — State and report

Read `skills/migrate/reference/phase-4-state-and-report.md` in full before you act on this section.

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

The driver (`node stardust/scripts/migrate/migrate.mjs render …`) writes
the per-page rows above (`index.html` / `<name>.html`, `_meta.json`,
bundled `assets/**`) and the `migrate` block of `state.json` (`pageMap[]`,
`bundledAssets[]`, `pages[]`, `missingAssets[]`, `lastRun`); status
changes, robots.txt and sitemap.xml stay with Phases 3–4.

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
- **No DESIGN.md or DESIGN.json.** Recommend `$stardust direct`.
- **No canon, but an approved prototype exists.** Do NOT stop —
  auto-bootstrap canon from the canon-author inline (Setup step 4).
- **No canon and no approved prototype.** Recommend
  `$stardust prepare-migration` (or approve a prototype first).
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
  (Phase 2 placeholder gate); surface the unsourced list and
  recommend sourcing real content (re-prototype, or edit the
  proposed file directly).
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
