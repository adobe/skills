---
name: aem-import-site
description: Orchestrate site-wide migration to AEM Edge Delivery Services. Walks the template inventory, picks a per-template input mode (existing prototype / new prototype / build-direct / skip), delegates per-template imports to stardust:aem-import, then writes fill scripts and batch-migrates every page.
license: Apache-2.0
---

# stardust:aem-import-site

**Scope:** project-wide. This is the orchestrator for migrating an entire
existing site to EDS. Where [`stardust:aem-import`](../aem-import/SKILL.md)
handles ONE template at a time, `aem-import-site` plans and executes the
migration of N templates covering thousands of pages.

The skill's value is in the **multiplier pattern**: an LLM crafts one
prototype + one EDS template per template-cluster, then a fill script
deterministically maps captured content into the template for every other
page in that cluster. The LLM does the rare creative work, scripts do the
repeated mechanical work, and captured content carries verbatim with zero
LLM-at-fill-time so there's no paraphrase risk at scale.

## When to use

You're migrating an existing site that:
- has > 50 pages (below that, do them one-by-one with `aem-import`)
- has been crawled by `stardust:extract` so `stardust/current/pages/` is populated
- has some prototypes already authored by `stardust:prototype` (optional but typical)
- needs every page's content carried verbatim from the captured snapshot

If you have fewer than ~50 pages or you're shipping a single hero artifact,
use `stardust:aem-import <slug>` directly — the per-template overhead of
this orchestrator isn't worth it.

## Inputs

- `--eds-project <path>` — required. The EDS project root. Same as
  `stardust:aem-import`.
- `--re-plan` — optional. Re-do the template inventory + per-template mode
  decisions. By default, second runs honor an existing
  `stardust/templates.json` (the locked plan from the first interactive
  pass).
- `--templates <slug,slug,...>` — optional. Execute only the named
  templates from the inventory (skip the rest in this run). Useful for
  resuming after a failure or focusing iteration.
- `--dry-run` — optional. Print the plan without executing. Useful to
  preview the per-template work before committing.

## Setup

1. Run the master skill's setup (`../stardust/SKILL.md` § Setup).
2. Verify `stardust/state.json` exists and reports `site.crawled > 0`. If
   not, recommend `stardust:extract` first and stop.
3. Verify `--eds-project` has been bootstrapped (engine patch applied,
   blocks-CSS layered per `aem-import/reference/engine-patch.md`). If not,
   run the patch as a first action; the patch is idempotent.
4. Read `stardust/templates.json` if present. If absent, treat this as a
   fresh planning run (Phase 0 + Phase 1 will create it).
5. Scaffold `scripts/utils/` with the standard utility templates (see
   References below — link-audit, build-redirects, mass-edit-template,
   measure-cls). They're each ~50 lines, project-agnostic, and used
   from Phase 6 onward. Copy from existing aem-import-site project or
   from the reference snippets.

## Procedure

The skill runs in 10 ordered phases. Phases -1 through 1 plan;
phases 2 through 6 execute templates; phases 7 through 9 close
the long tail. Each phase has an explicit completion artifact and
(where indicated) a user-review gate before moving on.

| # | Phase | Output | Gate |
|---|---|---|---|
| -1 | Pre-flight | `_preflight.json` | green checks |
| 0 | Site inventory + template clustering | `templates.json` | — |
| 1 | Per-template mode-pick + pageType | `templates.json` (filled) | user confirms |
| 2 | Per-template execution: one representative | EDS preview URLs | user review + CLS gate |
| 3 | Hub landing pages FIRST | chrome destinations live | — |
| 4 | Per-template fill script | `scripts/aem-import/fill-<template>.mjs` | — |
| 5 | Smoke-test batch (`--limit 5`) | 5 sample pages live | user review |
| 6 | Full batch + verify | `_batch-results.json`, `_verification.json` | — |
| 7 | Link audit | `/tmp/link-audit.csv` | — |
| 8 | Gap-fill sprint | top-N missing pages live | user reviews priorities |
| 9 | Polish (CLS, redirects, dynamic conversions, cleanup) | post-polish state | — |
| (10) | Completion report | `stardust/completion-report.md` | — |

### Phase -1 — Pre-flight check

Before any work, validate the environment. Fail fast on:

- **DA_TOKEN present and not stale** — read from `.env`, GET a known
  source path to confirm it returns 200 (not 401)
- **helix-bot push access** — verify GitHub remote is writeable
  (`git ls-remote --heads origin` succeeds)
- **admin.hlx.page reachable** — POST `/preview/.../<known-published-path>`
  returns 200 (catches CDN auth issues early)
- **DA repo structure intact** — confirm `helix-query.yaml`, `head.html`,
  `styles/styles.css`, `blocks/header/`, `blocks/footer/` all exist
- **Engine patch present** — confirm scripts.js has the blocks-mode
  tolerance marker (see `aem-import/reference/engine-patch.md`)

Write `_preflight.json` with each check + status. If any fails,
stop and surface a clear remediation.

This phase is fast (< 30 s) and saves the embarrassing mid-batch
"token expired in hour 14" failures.

### Phase 0 — Site inventory + template clustering

Walk the discovered page list (from `stardust/current/_crawl-log.json` +
the public sitemap if the crawl was capped). Cluster URLs into templates
by URL pattern and heading shape:

- URL pattern: top-level segment + depth (e.g., `/new/<x>/<y>/` →
  equipment-detail, `/used-equipment/<x>/<y>/` → equipment-detail-used,
  `/about/<x>/` → static-content)
- Heading shape: cross-page heading-sequence similarity for pages that
  don't fall cleanly under a URL pattern

For each cluster, identify a **representative page** (the most central
example, ideally one whose snapshot is already in
`stardust/current/pages/`).

Emit `stardust/templates.json`:

```json
{
  "_provenance": { "writtenBy": "stardust:aem-import-site", "writtenAt": "..." },
  "templates": [
    {
      "name": "home",
      "count": 1,
      "representative": "home",
      "examples": ["/"],
      "mode": null,
      "prototype": null,
      "theme": null,
      "status": "unplanned"
    },
    {
      "name": "equipment-detail-used",
      "count": 1001,
      "representative": "used-equipment__track-excavators__2022-cat-304-c3-tha",
      "examples": ["/used-equipment/track-excavators/2022-cat-304-c3-tha/", "..."],
      "mode": null,
      "prototype": null,
      "theme": null,
      "status": "unplanned"
    }
  ]
}
```

`mode` / `prototype` / `theme` are filled in Phase 1.

### Phase 1 — Per-template mode picking (interactive)

For each template in `templates.json`, the skill auto-matches available
prototypes by slug (e.g., `home` template → `stardust/prototypes/home-A-rich-proposed.html`
if it exists), then asks the user **one question per template**:

```
Template: home (1 page)
  Available prototype: stardust/prototypes/home-A-rich-proposed.html

  Pick a mode:
  (a) MODE A — Import this prototype as the template (recommended)
  (b) MODE B — Author a new prototype first via stardust:prototype, then import
  (c) MODE C — Build directly as EDS (skip static prototype)
  (d) MODE D — Skip this template (no migration)
```

```
Template: equipment-detail-used (1001 pages)
  No prototype available.

  Pick a mode:
  (b) MODE B — Author a new prototype first via stardust:prototype, then import
  (c) MODE C — Build directly as EDS (skip static prototype, EDS preview = review surface)
  (d) MODE D — Skip this template (no migration)
```

Default recommendation per template type:
- **High-stakes** (home, hero landing, brand-critical): A if prototype exists, else B
- **Medium-stakes** (category hubs, programs): A if prototype exists, else C
- **Long-tail** (detail pages, blog posts): C (build direct)
- **One-offs / legal / deprecated**: D (skip)

The user can override any default. The chosen mode is written back to
`templates.json` with provenance:

```json
{
  "name": "equipment-detail-used",
  "mode": "C",
  "prototype": null,
  "theme": "wheelercat-equipment-used-v2",
  "representativeUrl": "https://main--<repo>--<owner>.aem.page/used-304-c3-tha",
  "status": "planned",
  "_modeDecidedAt": "2026-05-31T..."
}
```

After the loop, the skill prints a planning summary:

```
Plan locked. Templates planned: 8.
  3 × MODE A  (from-prototype): home, customer-value-agreements, new
  1 × MODE B  (new-prototype):  industries
  3 × MODE C  (build-direct):   equipment-detail-used, equipment-detail-new, attachment-detail
  1 × MODE D  (skip):           legacy (12 pages excluded)

Total pages this migration will produce: 2,492 (excluding 12 legacy).

Run with --templates=<name> to execute a specific template, or no flag
to walk all in order.
```

The user can edit `templates.json` directly before Phase 2 if they want
to adjust modes without re-running Phase 1.

### Phase 2 — Per-template execution

**Critical sequencing rule: do hubs FIRST.** Walk `planned` templates
in this order, regardless of count or complexity:

1. **Hub templates** (the chrome destinations: `/new`, `/used-equipment`,
   `/service`, `/parts`, `/rental`, `/contact`, `/quotes`, etc.)
2. **Sub-hubs** that chrome links to (`/parts/lookup`, `/service/field`)
3. **Category-listing templates**
4. **Detail templates** (the long-tail high-count ones)
5. **Info / location / portal templates** (last — they're often the
   least-linked-from)

**Rationale**: chrome verbs (BUY / RENT / SERVICE / PARTS) link to hub
destinations on every page. If detail-page batches ship before hubs
exist, every chrome verb 404s — even with thousands of pages live the
site feels navigationally broken. Hubs first means the chrome works
from the very first detail-page batch.

Initial hubs can be minimal stubs (just title + CTA + dynamic block
placeholder). The dynamic block on each hub will fill in as detail
pages get batched. Empty hubs are cheap; absent hubs are expensive.

Walk each `planned` template in this hubs-first order. Execute per mode:

#### Mode A — Import existing prototype
1. Verify the prototype file exists at the recorded path.
2. Invoke `stardust:aem-import <representative-slug> --eds-project <path>`
   with `--theme=<auto-derived-or-recorded>`.
3. Iterate: user reviews EDS preview, requests fixes, skill applies
   them. Standard `aem-import` per-template loop.
4. On approval, update `templates.json` with `status: "approved"` and
   record the live EDS preview URL.

#### Mode B — New prototype first
1. Invoke `stardust:prototype <representative-slug>` to author the
   static prototype + shape brief.
2. User reviews/approves the prototype.
3. Once approved, switch to Mode A flow with the newly-authored prototype.

#### Mode C — Build direct
1. The skill (an LLM) authors the per-theme CSS + chrome fragments + DA
   content for the representative page directly, using:
   - Tokens / chrome / base inherited from the project's canonical theme
     (typically `<brand>-home-v2` or the first approved theme)
   - Per-template variants emitted in `@layer variant` per the
     [theme-css-template.md](../aem-import/reference/theme-css-template.md)
     scaffold
2. PUT to DA, trigger preview.
3. Iterate: user reviews EDS preview, requests fixes, skill applies.
4. On approval, update `templates.json` with `status: "approved"`.

#### Mode D — Skip
No work. Record `status: "skipped"`.

**User-review gate**: every representative page must pass the **CLS
Day-1 checklist** before Phase 4 begins. The checklist lives in
[`../aem-import/reference/conventions.md`](../aem-import/reference/conventions.md)
§8 "Day 1 checklist for new templates". Throttled-mobile CLS must
be < 0.1 — fixing CLS after detail-page batches have shipped means
re-rendering thousands of pages with already-deployed CSS that's
still wrong.

### Phase 3 — Hub landing pages live

After Phase 2 produces a representative for each template, but
**before** any detail-page batch runs in Phase 6, author every
remaining hub destination in the site.

This phase exists because chrome verbs (BUY / RENT / SERVICE /
PARTS / etc.) link to hub pages on every single page in the site
— including every detail page about to be batched. If a chrome
destination doesn't exist when its first inbound page ships, every
chrome verb 404s. Authoring 5-15 minimal hub stubs upfront unlocks
the chrome from page 1 of N.

For each hub identified in Phase 0 (pageType=`hub`):

1. Author a minimal hub stub: title + tagline + dynamic-block
   placeholder + CTA. ~5 minutes per hub.
2. PUT to DA, preview, publish, index.
3. The dynamic block (e.g., `.cards.hub.dynamic`) fills in
   automatically as detail / listing pages get batched in Phase 6.
   Empty hubs are cheap; absent hubs are expensive.

Phase 3 also covers any **sub-hub** destinations chrome may link
to that aren't part of the catalog templating (action pages like
`/contact`, `/quotes`, `/request-service`; portal stubs like
`/login`, external-system gateways).

See [`reference/page-shape-inventory.md`](reference/page-shape-inventory.md)
for the typical hub inventory; see
[`reference/dynamic-vs-static.md`](reference/dynamic-vs-static.md)
for what to author static vs dynamic on each hub.

### Phase 4 — Per-template fill script

For each approved template, author a Node script at
`scripts/aem-import/fill-<template>.mjs` that:

1. Takes a page slug as input.
2. Reads `stardust/current/pages/<slug>.json` (and `<slug>.bodies.json`
   if present).
3. Maps captured fields onto the template's slot map (locked at template
   approval time and recorded in `templates.json` under
   `<template>.slotMap`).
4. Outputs DA-ready HTML to `stardust/aem-import-out/<template>/<slug>.html`.

**The fill script is strict: no LLM at fill time.** Missing required
slots → page added to a failure bucket, not silently placeholdered. This
is the verbatim-at-scale guarantee.

The fill script also handles asset URL rewriting (captured source-site
URLs → DA-fetchable forms) and image deduplication checks.

Pair each fill script with a batch orchestrator at
`scripts/aem-import/batch-<template>.mjs` supporting the required CLI
flag set (`--limit`, `--skip-existing`, `--retry-failed`,
`--concurrency`, `--no-publish`) — see
[`reference/fill-script-pattern.md`](reference/fill-script-pattern.md)
for the contract.

### Phase 5 — Smoke-test batch

Run each template's batch with `--limit 5`. User reviews the 5 sample
pages in EDS preview, confirms the structure renders as expected,
then proceeds to Phase 6 (full batch).

This phase is short (5 min per template) but catches most "the
fill script generates broken HTML for unusual source pages" bugs
before they ship across thousands of pages. Skipping it has cost
multi-thousand-page re-batches in the past.

### Phase 6 — Full batch + verify

After the smoke-test passes (Phase 5), each template's batch
orchestrator walks the full sitemap. Per-template orchestrator scripts
(one per template) use the shared CLI contract documented in
[`reference/fill-script-pattern.md`](reference/fill-script-pattern.md):

```
node scripts/aem-import/batch-<template>.mjs --concurrency 4
```

Default concurrency 4 is the safe sustained rate against admin.hlx.page
(see admin-api §2 "Concurrency ceiling"). Each batch:

1. Walks the source sitemap chunks for the template.
2. Fills, PUTs, previews, publishes, indexes each page (per-page result
   recorded in `_batch-results.json`).
3. Reports per-template counts.

Reports look like:

```
Template                  Planned    Live    Failed
home                      1          1       0
hubs                      10         10      0
<detail-family-A>         <X>        <X>     <small>
<detail-family-B>         <Y>        <Y>     <small>
listings                  <L>        <L>     0
locations                 <N>        <N>     0
info pages                <I>        <I>     <small>
TOTAL                     <Σ>        <Σ>     <σ>
```

Per-template failures are recoverable via `--retry-failed` (reads
the previous `_batch-results.json` and re-runs only the failed
slugs). Most failures are transient network errors that clear on
the retry pass.

**Verification** runs immediately after each batch completes:

1. HTTP 200 check on each live URL.
2. Captured-text substring presence: every string from
   `pages/<slug>.json#body` that's ≥ 20 chars must appear in the rendered
   HTML (the verbatim guarantee, post-hoc).
3. Page-height delta vs the template baseline (the representative
   page's render). Flag pages > 15% larger or smaller — likely missing
   or duplicated content.
4. Image-load check: every img has naturalWidth > 0 (no broken images).

The skill writes `stardust/aem-import-out/_verification.json` and a
human-readable summary. For flagged pages, the LLM triages whether the
diff is acceptable (font wrap / acceptable padding) or a real issue.

### Phase 7 — Link audit

After batches are live, the link audit identifies which **not-yet-
migrated** pages would unlock the most cross-page navigation if
authored. Run the standard utility:

```
node scripts/utils/link-audit.mjs
```

See [`reference/link-audit-workflow.md`](reference/link-audit-workflow.md)
for the full recipe + interpretation. The output ranks missing
destinations by weighted inbound-link count (chrome links count as
N × inbound where N = total page count, main-content links scale
by template-family size, dynamic-block-generated links count as 1).

The top-30 missing list typically reveals:
- A handful of chrome-linked hub pages still missing (highest
  priority — every page references them)
- Action-page destinations (`/contact`, `/quotes`, etc.) linked from
  every detail page's CTA bar
- One-off destinations linked from a single template family
- Long-tail one-inbound destinations (low priority)

### Phase 8 — Gap-fill sprint

Author the highest-impact missing pages identified in Phase 7. Most
gaps are minimal landing pages (5-20 lines of HTML each) that share
the same hub template introduced in Phase 3.

Typical sprint scope after a multi-thousand-page batch is ~10-20
pages. User reviews the prioritized gap list from Phase 7 and confirms
which to author this sprint vs defer.

After the gap-fill sprint, re-run Phase 7 (link audit) to confirm
the gap closed and surface any remaining one-off destinations.

### Phase 9 — Polish

Standardized post-batch hardening steps:

1. **`/redirects.json`** — generate from `/query-index.json` to cover
   trailing-slash mismatches and any URL-shape drift introduced by
   the source site's WordPress conventions. See `scripts/utils/
   build-redirects.mjs` + admin-api §3 "Trailing-slash → no-slash
   via /redirects.json". One file fixes thousands of would-be 404s
   without re-batching any content.

2. **Dynamic-block conversions for derive-from-URL content** — e.g.,
   if pages were authored with static breadcrumb HTML, convert to
   the dynamic `blocks/breadcrumb/breadcrumb.js` pattern + run the
   mass-edit utility to strip the static authoring (see
   [`reference/mass-edit-utility.md`](reference/mass-edit-utility.md)).
   Standard targets: breadcrumbs, count strings, locale-derived
   labels.

3. **CLS re-measurement** — sample one page per (template, pageType)
   bucket via the diagnostic recipe in
   `aem-import/reference/conventions.md` §8. Confirm throttled
   CLS < 0.1 across all samples. If Phase 2 enforced the CLS
   Day-1 checklist, this is a no-op.

4. **Chrome consistency** — header/footer fragments are the same
   across themes? Active-verb highlight (BUY/RENT/SERVICE/PARTS)
   highlights based on URL prefix?

5. **Orphan management** — pages still in `/query-index.json` with
   no DA source (typically old paths from a mid-migration URL
   restructure). See admin-api §5 "The unpublish trap" — orphans
   persist because admin.hlx.page DELETE is restricted; dedupe-at-
   block-level in the dynamic blocks already handles them invisibly.
   Optional manual cleanup via DA admin UI.

### Phase 10 — Completion report

Generate the project's final deliverable per
[`reference/completion-report.md`](reference/completion-report.md):
a written record at `stardust/completion-report.md` (+ JSON sidecar)
listing inventory, per-template counts, link-audit results, CLS
audit, deferred work, and known issues.

This is the single source of truth for "are we done?" — and the
starting point for any future re-engagement.

## What this skill does NOT do

- Doesn't crawl the site — assumes `stardust:extract` already ran.
- Doesn't invent design — defers to either an existing prototype (Mode A)
  or `stardust:prototype` (Mode B) for design authority. In Mode C the
  design comes from the project's canonical theme; the skill applies
  brand-faithful variants but doesn't change brand direction.
- Doesn't replace `stardust:aem-import` — it orchestrates per-template
  invocations of it.
- Doesn't author per-page content. The fill script's job is mechanical
  field mapping. New content for a page = re-run extract → fill.

## Outputs

```
stardust/
  templates.json              ← inventory + per-template mode + slot map
  aem-import-out/
    _failures.json            ← batch migration failures
    _verification.json        ← post-batch verification report
    <template>/
      <slug>.html             ← per-page DA content emitted by fill script
      _shape.json             ← slot map locked at template approval

<eds-project>/
  styles/<theme>.css          ← per-template stylesheet
  fragments/<theme>/          ← chrome
  assets/<theme>/             ← assets
  scripts/<theme>-motion.js   ← per-template motion (if needed)
  scripts/aem-import/
    fill-<template>.mjs       ← per-template fill script
    batch-migrate.mjs         ← orchestrator
    verify.mjs                ← verification runner
```

## Relationship to other skills

| Phase | Delegates to | Why |
|---|---|---|
| Phase 0 (cluster) | inline scripts | Mechanical, no design judgement needed |
| Phase 1 (plan) | inline LLM (asks user) | Creative judgement — which template gets which mode |
| Phase 2A (import) | `stardust:aem-import` | Reuses the existing single-template skill |
| Phase 2B (prototype) | `stardust:prototype` | The existing prototype skill, then 2A |
| Phase 2C (build direct) | inline LLM | Authors theme CSS + DA content from scratch |
| Phase 3 (fill script) | inline LLM | LLM writes the script ONCE per template |
| Phase 4 (batch) | inline Node scripts | Pure mechanical execution at scale |
| Phase 5 (verify) | inline Node scripts + LLM triage | Script captures metrics; LLM judges acceptability |

## References

- [`../aem-import/SKILL.md`](../aem-import/SKILL.md) — the per-template
  import skill this one orchestrates.
- [`../aem-import/reference/theme-css-template.md`](../aem-import/reference/theme-css-template.md)
  — the cascade-layer scaffold every per-template theme must use.
- [`../aem-import/reference/conventions.md`](../aem-import/reference/conventions.md)
  — DA pipeline quirks + per-variant inheritance traps. Read by both
  Mode A and Mode C paths.
- [`reference/template-modes.md`](reference/template-modes.md) — detailed
  comparison of the four modes with worked examples from the wheelercat
  reference engagement.
- [`reference/fill-script-pattern.md`](reference/fill-script-pattern.md) —
  the verbatim-at-scale guarantee, with code structure.
- [`reference/admin-api-and-publish-flow.md`](reference/admin-api-and-publish-flow.md)
  — token lifecycle, PUT→preview→publish→index ordering, helix-query.yaml
  + dynamic cross-page block wiring, URL-structure decisions, the
  admin.hlx.page DELETE trap, sitemap sub-chunking, DA media-bus race,
  spec-catalog extraction patterns, per-template motion JS, **concurrency
  ceiling**, derive-from-URL blocks, /redirects.json pattern,
  mass-edit recipe.
- [`reference/page-type-taxonomy.md`](reference/page-type-taxonomy.md)
  — the 7 canonical `pageType` values (`detail` / `listing` / `hub` /
  `location` / `info` / `industry` / `portal`); how they drive every
  dynamic block; helix-query field mapping with the lowercasing trap.
- [`reference/page-shape-inventory.md`](reference/page-shape-inventory.md)
  — the typical page-shape inventory for catalog/dealer sites
  (counts, pageTypes, suggested modes); Day 1 planning reference for
  Phase 0.
- [`reference/dynamic-vs-static.md`](reference/dynamic-vs-static.md) —
  decision tree for when to author content statically vs derive at
  render time; common false positives + false negatives.
- [`reference/link-audit-workflow.md`](reference/link-audit-workflow.md)
  — Phase 7 deliverable: crawl + cross-check + sorted-by-inbound
  missing destinations; canonical utility script.
- [`reference/mass-edit-utility.md`](reference/mass-edit-utility.md) —
  the standard GET / mutate / PUT recipe for post-batch amendments
  (strip authored blocks, inject metadata, fix global links). Each
  amendment is a one-off copy + mutate-function-edit; the recipe
  + retry conventions stay constant.
- [`reference/completion-report.md`](reference/completion-report.md) —
  Phase 10 deliverable shape: inventory, per-template counts, link
  audit, CLS audit, deferred work, known issues. Single source of
  truth for "are we done?".

## Provenance

This skill was derived from the wheelercat reference engagement (3 repos:
`uplift-wheelercat`, `uplift-wheelercat-eds`, `redesign-adobecom-plugin-source`)
where 3 templates were imported via Mode A (home, CVA, service, new),
1 template via Mode C (equipment-used-v2), and the remaining ~8
templates + 2,400 pages remained as the proof case for this orchestrator.
The fill-script pattern was validated by the equipment-used template
where Hero structure + specs grid + 32-image gallery + 35-feature list
mapped cleanly from one captured page's snapshot to the template, with
the same script structure intended to handle the other 1,000 used-machine
pages.
