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
- `--refresh-stale` — re-migrate every page flagged `stale`.
  Default skips stale pages and surfaces the count.
- `--all` — migrate every page including stale ones.
- `--force` — re-migrate every page even when the idempotent
  skip would skip them.
- `--require-approved` — refuse to migrate any non-`approved`
  page. Default behaviour migrates `directed` pages too (using
  Path A′ or Path B per
  `reference/template-and-module-rendering.md`); this flag flips
  approval-gating on.
- `--allow-placeholder` — allow migration of pages whose
  proposed/archetype files contain `[data-placeholder]`
  elements (per
  `skills/prototype/reference/before-after-shell.md` § Content
  sourcing hierarchy). Default refuses; use this flag only when
  shipping placeholders is intentional (internal staging review).
- `--strict-canon` — refuse approvals that conflict with canon.
  Default logs the deviation and continues. Useful for projects
  where canon discipline matters more than per-template
  flexibility.

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
     `approved`, `stale: false` (or `--all` /
     `--refresh-stale` / explicit `<slug>`).
   - **skipped**: everything else, with reason captured.

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
  proposed file or archetype). Refuse without
  `--allow-placeholder` when `[data-placeholder]` elements or
  non-empty `_provenance.unsourcedContent[]` are present.
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
- **Write** the migrated `index.html` and the `_meta.json`
  sidecar in the same directory. Provenance block as first
  child of `<head>`.

### Phase 3 — Asset migration

Once page-level migration is done, ensure
`stardust/migrated/assets/` is consistent:

1. Copy `stardust/current/assets/logo.<ext>` to
   `stardust/migrated/assets/logo.<ext>` (only if missing or
   stale).
2. Copy each referenced media file from
   `stardust/current/assets/media/` to
   `stardust/migrated/assets/media/` (only files referenced by
   migrated pages).
3. Verify favicon variants and font files were generated by
   `prepare-migration` Phase 4. If absent, log a warning and
   continue (the migrated site renders without them, just
   missing some platform-specific affordances).
4. Add `stardust/migrated/robots.txt` and `sitemap.xml`
   derived from the migrated page inventory per
   `reference/metadata-and-jsonld.md` § Sitemap entry.

Asset migration is idempotent — files are content-hashed and
copied only when missing.

### Phase 4 — State and report

Update `state.json`:

- For each successfully migrated page: `status` advances to
  `migrated`, append a history entry, clear any `stale` flag,
  set `migratedPath`.
- For pages skipped via idempotent skip: leave state
  unchanged.
- For pages that failed validation: leave state unchanged, log
  the failure in `state.json.lastRun.failures[]`.

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

Output:  stardust/migrated/  (122 pages, 47 assets, 4.2 MB)

Next:
  - Review:    open stardust/migrated/index.html in a browser
  - Audit:     $impeccable critique stardust/migrated/
  - Deploy:    upload stardust/migrated/ to any static host
  - Refine:    edit DESIGN.md or canon files, then re-run $stardust migrate
```

## Outputs

| Path                                              | Purpose                                                |
|---------------------------------------------------|--------------------------------------------------------|
| `stardust/migrated/<slug-path>/index.html`        | Migrated page (one per slug, nested for URL fidelity). |
| `stardust/migrated/<slug-path>/_meta.json`        | Sidecar with full reasoning trace per page.            |
| `stardust/migrated/index.html`                    | The home page (special case).                          |
| `stardust/migrated/_meta.json`                    | Home sidecar.                                          |
| `stardust/migrated/assets/logo.<ext>`             | Brand logo.                                            |
| `stardust/migrated/assets/media/...`              | Referenced page media.                                 |
| `stardust/migrated/assets/favicon.<ext>` + variants| Favicon and apple-touch-icon, manifest icons.         |
| `stardust/migrated/assets/fonts/...`              | Downloaded font files (from canon @font-face URLs).    |
| `stardust/migrated/robots.txt`                    | Minimal robots.txt.                                    |
| `stardust/migrated/sitemap.xml`                   | Sitemap derived from migrated inventory + page types.  |
| `stardust/state.json`                             | Updated with `migrated` status and history.            |

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
- `$stardust migrate --refresh-stale` re-migrates each stale
  page, clearing the flag on success.
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
- **Placeholder content in proposed/archetype file.** Without
  `--allow-placeholder`, refuse to ship a page whose source
  contains `[data-placeholder]` elements. Surface the unsourced
  list and recommend either sourcing real content
  (re-prototype) or re-running with `--allow-placeholder` for
  staging review.
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
- Run `$impeccable live` or any iteration loop. Iteration
  belongs to `prototype`; migrate consumes the result.

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
