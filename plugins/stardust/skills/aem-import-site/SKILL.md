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

## Procedure

The skill has six phases. Phases 0–1 plan; phases 2–5 execute.

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

Walk each `planned` template in order. Execute per mode:

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

### Phase 3 — Per-template fill script

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

The fill script also handles asset URL rewriting (captured wheelercat.com
URLs → DA-fetchable forms) and image deduplication checks.

### Phase 4 — Batch migrate

A single orchestrator script walks every page in every approved template:

```
for template in templates.approved:
  for page in template.pages (excluding representative):
    fill_script(page) → emits DA HTML
    PUT to DA admin source endpoint
    POST to admin.hlx.page preview
    record result (success / fail / image-error)
```

Reports per-template counts:

```
Batch migrate complete.

Template                          Planned    Pushed    Live    Failed
home                              1          1         1       0
customer-value-agreements         2          2         2       0
new                               6          6         6       0
equipment-detail-used             1001       1001      998     3
equipment-detail-new              249        249       249     0
attachment-detail                 1001       1001      999     2
static-content                    117        117       115     2
industries                        24         24        24      0
TOTAL                             2401       2401      2394    7

Failures recorded in stardust/aem-import-out/_failures.json — re-run
with --templates=<template> --retry-failed.
```

### Phase 5 — Batch verify

For each live URL, run a lightweight verification:

1. HTTP 200 check
2. Captured-text substring presence: every string from
   `pages/<slug>.json#body` that's ≥ 20 chars must appear in the rendered
   HTML (the verbatim guarantee, post-hoc)
3. Page-height delta vs the template baseline (the representative
   page's render). Flag pages > 15% larger or smaller — likely missing
   or duplicated content.
4. Image-load check: every img has naturalWidth > 0 (no broken images)

The skill writes `stardust/aem-import-out/_verification.json` and a
human-readable summary. For flagged pages, the LLM triages whether the
diff is acceptable (font wrap / acceptable padding) or a real issue.

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
  spec-catalog extraction patterns, per-template motion JS.

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
