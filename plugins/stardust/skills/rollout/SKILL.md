---
name: rollout
description: Deliver a WHOLE redesigned site to AEM Edge Delivery Services. The full-site sibling of `deploy` (which converts one page). Inventories the platform-agnostic migrated tree (stardust/migrated/ + _meta.json sidecars) into a delivery coverage ledger, then delivers each page by invoking the `deploy` methodology, tracking what is done and what is missing across the whole site. Use when the user has a migrated stardust site and wants to push the entire site to AEM, not just one page. Supports archetypes-only mode: if only the template archetype pages have been migrated, rollout can deploy all block code immediately and register the remaining pages as content-pending for later population.
license: Apache-2.0
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

`deploy` converts **one** page to AEM. `rollout` delivers the **whole site**: it
inventories the agnostic output of `migrate`, then drives `deploy` across every
page, tracking delivery coverage so you always know what's done and what's left.

`rollout` is **delivery-only** — it does not redesign. The page-by-page redesign
(`extract → direct → prototype → migrate`) and `deploy` itself are **unchanged**;
`rollout` is the across-pages layer on top. The full design rationale, the
coverage model, and the phasing are in
[`notes/rollout/PLAN.md`](../../notes/rollout/PLAN.md).

> **The full flow is built**: inventory + page coverage (P1); first-class block
> dedup + site assembly + verify (P2); multi-source optimize + AEM autofix (P3);
> and the dashboard (P4). The flow runs **A→I** below.

## When to use

**Full mode** — the user has:
1. A fully migrated stardust site at `stardust/migrated/` (the output of
   `stardust migrate`: per-page HTML + `_meta.json` sidecars). This is the
   explicit handoff `migrate` documents for downstream AEM conversion.
2. An EDS/AEM project + DA destination (the same target `deploy` needs — see
   `skills/deploy/SKILL.md` and `da-deploy-protocol.md`).
3. A goal to deliver the **entire** site, incrementally and resumably.

**Archetypes-only mode** — the user has:
1. One migrated archetype page per template in `stardust/migrated/` (the
   representative pages, not every sibling), plus a full page inventory in
   `stardust/state.json` with `type` assignments for all pages.
2. The same EDS/AEM project + DA destination as above.
3. A goal to ship all block code immediately without waiting for every page to
   be individually migrated. Sibling pages are registered as `content-pending`
   in the coverage ledger; their document content is populated later through a
   separate content track.

If there is no `stardust/migrated/` tree at all, recommend `stardust migrate`
on at least the archetype pages first. For a single page, use `stardust deploy`
directly — `rollout` is for the whole site.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/migrated/` exists and contains at least one `*.html` page.
   If not, recommend `stardust migrate` on the template archetypes and stop.
   - **Full mode**: `migrated/` covers all pages in scope.
   - **Archetypes-only mode**: `migrated/` covers only the archetype pages (one
     per template). Verify `stardust/state.json` exists and has `type` populated
     for all pages whose siblings need coverage. If `state.json` is absent or
     lacks `type` assignments, recommend resolving those before proceeding.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport
   — it reuses `deploy`'s.

## Procedure

### Phase A — Inventory (build the coverage)

Run the inventory script to project the migrated tree into the delivery coverage:

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout

# archetypes-only mode: supplement migrated/ with the full page roster from state.json
node skills/rollout/scripts/inventory.mjs --site-url <source-url> --state stardust/state.json
```

It writes:
- `stardust/rollout/coverage/pages.json` — one row per page: slug, delivered
  `path`, `templateId` (from the sidecar `template`/`type`), the `blocks` it
  composes (from the sidecar `modules`), a `sourceHash`, and the per-page
  `delivery` status.
- `stardust/rollout/coverage/templates.json` — pages grouped by template (drives
  delivery order and per-template roll-ups).
- `stardust/rollout/rollout.json` — target + DA config + a `lastRun` counts
  summary.

**Archetypes-only mode** (triggered by `--state`): inventory reads `state.json`
for the full page roster and merges it with `migrated/`:
- Pages with a `_meta.json` in `migrated/` are seeded from their sidecar
  exactly as in full mode.
- Pages present only in `state.json` (not yet individually migrated) are seeded
  with `templateId` inferred from their `type` field and `blocks` inferred from
  the archetype sidecar for that template. Their `sourceHash` is derived from
  `state.json[].currentStatePath` content. Their initial `delivery.status` is
  `content-pending`.

The inventory is **idempotent and incremental**: existing delivery status is
preserved; a page whose migrated HTML changed after it was delivered is
re-flagged `stale`. Re-run it any time `migrate` re-emits pages or `state.json`
adds new pages.

Fill in the DA coordinates in `stardust/rollout/rollout.json` (`site.da.org`,
`site.site`, `site.da.ref`, and `site.liveHost`) if the inventory didn't infer
them — `deploy` needs them for the push and `verify` needs the host.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

Derive the distinct block set and the dedup-driven delivery plan **up front** —
this is what makes "convert each block once" a driving step, not a cleanup:

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance across the site (the per-page
  `modules` + chrome) into the **distinct** set, assigns each a canonical
  `edsBlockName` (kebab; reserved-class-guarded per deploy #15), and records
  `usedByPages` / `instanceCount`. Chrome (`header`/`nav`/`footer`) is marked
  `kind: chrome` → delivered as site-wide fragments, not per-page blocks. In
  archetypes-only mode the distinct block set is fully determined by the archetype
  sidecars alone — `content-pending` sibling pages add no new blocks.
- `plan.mjs` orders pages **representative-first per template**, walks them once,
  and assigns each distinct block a **single conversion point**: the first page
  in order that uses it CONVERTS it; every later page REUSES it by name. The
  per-page `convert` / `reuse` lists are exactly `deploy`'s Step-7 brief input
  (*"Existing blocks — REUSE, do not recreate: …"*), so each block converts once
  **without changing deploy**. `content-pending` pages are always assigned
  `convert: []` / `reuse: [all template blocks]` — they never introduce new blocks.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the page's migrated HTML (`source.migratedHtml`) to AEM via
   the `deploy` methodology (`skills/deploy/SKILL.md`). **Pass the page's plan
   step into deploy's brief**: create only the blocks in `convert`; for every
   block in `reuse`, instruct deploy to REUSE the existing block by its
   `edsBlockName` (do not recreate). This is the dedup contract in action.

   **`content-pending` pages** (archetypes-only mode): these pages have no
   migrated HTML. Skip the document push entirely — do not create a shell or
   placeholder document. Record them as `content-pending` in the coverage ledger
   and surface them in the report as "awaiting content track." Block code for
   these pages is already deployed via their template's archetype; no conversion
   work remains.

2. **Record outcomes** with the state-writer (never hand-edit the ledger):

   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   # for each block this page converts:
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name <name>
   # … run the deploy steps …
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   # for content-pending pages (no document push):
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending
   ```

   On failure: `--status failed --error "<reason>"` and continue (one page's
   failure never aborts the rollout — mirrors `migrate`).

Parallelism: deliver multiple template clusters concurrently (one agent per
cluster, non-overlapping page sets), as `deploy` Step 7 dispatches per-archetype
agents. **Deliver each template's representative — the page that converts that
template's blocks — before its siblings**, so the blocks exist to be reused. The
state-writer is per-unit so concurrent updates don't collide.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates the artifacts that only make sense site-wide: `sitemap.xml` +
`robots.txt` from the delivered paths, and a **fragments manifest** mapping the
chrome blocks to `fragments/header.html` / `fragments/footer.html` with their
`canon/*.html` source. `deploy` lifts and pushes the actual fragment content
(Step 6); `assemble` prepares and records what to push.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url>   (explicit host)   |   --root <dir>   (offline, against a local export)
```

For every delivered page, `verify` confirms it's reachable (HTTP 200), has no
`about:error` (broken-image ingestion, deploy #75), and that every internal
`href="/…"` resolves to a known delivered path — then flips each page to
`verified` or `failed` with the reason. It exits non-zero if any page failed.

### Phase F — Optimize: multi-source audit + gate (delivery quality)

The in-flow **quality gate**. optimize aggregates findings from **existing audit
skills** into one ledger (`optimize/findings.json` + `optimize/scorecard.json`),
tags each by **fixability**, and gates the rollout. Sources (see
`reference/audit-sources.md` for the full mapping):

1. **`rollout:baseline`** — built-in deterministic detectors. Run it directly:

   ```bash
   node skills/rollout/scripts/optimize.mjs        # uses rollout.json site.liveHost
   # or: --base <url> | --root <dir> | --slug <s> | --all
   ```

2. **`impeccable:critique` + `impeccable:audit`** — run them against the delivered
   output for design quality (P-levels) and a11y/perf/responsiveness.
3. **The marketing SEO skills** (`coreyhaines31/marketingskills`) — `seo-audit`,
   `schema`, `ai-seo`, `site-architecture`.
4. **`stardust:tensions`** — the mechanical design tensions from
   `stardust/current/brand-review.html` (type-scale, CTA-vocab, content-free
   links, generic/empty alt, contrast…).

These are referenced as **dependencies** (run them by invocation — nothing is
vendored). Normalize each one's findings into the ledger with the writer:

```bash
node skills/rollout/scripts/findings.mjs record \
  --source marketing:seo-audit --layer seo --check thin-content \
  --severity P2 --fixability platform-migration \
  --scope-ids blog/post --evidence "…" --recommend "…"
# resolve/accept/wontfix a finding:
node skills/rollout/scripts/findings.mjs resolve <id> --status accepted --note "…"
```

All sources share one id space, dedup, scorecard, and the **detect → fix →
verify loop**: re-running a source resolves *its own* findings no longer present
(a baseline run never resolves another source's finding); a regressed `fixed`
finding re-opens; human `accepted`/`wontfix` are preserved. Each finding also
carries an **`autofix`** descriptor (the registered AEM fixer, if any).

**Fixability routing:** `platform-migration` → the AEM autofix engine / re-deploy
fixes it; `design-pass` → upstream (surface only); `out-of-scope` → informational.

The gate **exits non-zero if any open P1 is in scope** — a page is delivery-clean
only when verify passes *and* the ledger has no open P1.

> The judgment layers (brand-tensions, design-ux, content-conversion) are scored
> `null` (not assessed by the automated baseline) until populated by the
> impeccable/tensions sources — the scorecard shows not-assessed rather than
> faking a score.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

The platform autofix engine (AEM-EDS, v1 — **aggressive**). For every open finding
whose `check` has a registered EDS fixer, it edits the EDS **project** files and
logs the change on `finding.autofix`, staging the finding `in-progress`:

- **deterministic** — `eds-fix-h1` (promote/demote so exactly one `<h1>`),
  sitemap (re-assemble).
- **content-draft** (applied under the aggressive policy, logged for review) —
  `eds-metadata-title` / `eds-metadata-description` (draft from `<h1>`/first
  paragraph), `eds-alt-draft` (alt from filename), `eds-disambiguate-title`.
- **manual** (autofix prepares guidance/payload, a human applies) — `eds-jsonld`
  (use `marketing:schema` for the payload), `eds-canonical`, `eds-landmark-main`.

Use `--dry-run` first to preview edits. After applying, **re-deploy** the edited
pages (`deploy`), then re-run **verify** + **optimize** — the staged findings flip
to `fixed`, closing the loop. `design-pass` findings are surfaced, not auto-fixed.

### Phase H — Report

Read `rollout.json.lastRun` + `optimize/scorecard.json` (or re-run `inventory.mjs`)
and print the counts:

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

Surface anything still `pending`/`stale`/`failed` as the explicit "what's
missing" list. `content-pending` pages are listed separately — they are not
failures; their block code is live and they advance to `pending` automatically
when `migrate` emits their individual HTML and `inventory` is re-run. Re-run
from Phase B/C to pick up exactly the pages that changed.

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

A **self-contained, no-external-JS** dashboard rendered in the **project's design
identity** — brand tokens (bg / fg / accent / heading + body fonts / radius) are
read from the `:root` block of a migrated page (the canonical token interface,
`token-contract.md`).

Its centerpiece is a **page tree** of every identified page, nested by URL path,
each node colour-coded by the **most-advanced lifecycle stage** it has reached:

```
identified → prototyped → deployed → optimised
```

The stage spans all three sources: `stardust/state.json` (agnostic
`extracted/directed` → identified, `prototyped/approved/migrated` → prototyped),
rollout coverage (`deployed`/`verified` → deployed), and optimize (`optimised` =
verified **and** no open findings for the page). The legend **counts are
cumulative** — a page counts toward every stage up to the one it reached, so
`identified` equals the total page count, `prototyped` includes everything
prototyped-or-beyond, and so on. **Template archetypes** — the page that defines a
template for its siblings (`templates.json[].representativeSlug`) — are badged
`T`. A page with open findings shows a red count.

Also: a **templates** table (archetype + member count + a per-stage lifecycle
bar) and the quality scorecard. `dashboard/data.json` is the inspectable snapshot.
Regenerate it at every iteration boundary. (`state.json` is read-only and
optional — without it the tree starts at the `migrated` stage.)

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`/`type`), `blocks` (`modules`), `title` |
| `stardust/state.json` | stardust core | *(archetypes-only mode)* full page roster + `type` assignments for pages not yet individually migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

| Path | Purpose |
|---|---|
| `stardust/rollout/coverage/pages.json` | per-page delivery ledger (schema: `schemas/rollout-pages.schema.json`) |
| `stardust/rollout/coverage/templates.json` | template grouping + roll-ups (schema: `schemas/rollout-templates.schema.json`) |
| `stardust/rollout/coverage/blocks.json` | the block dedup ledger + EDS mapping (schema: `schemas/rollout-blocks.schema.json`) |
| `stardust/rollout/plan.json` | dedup-driven delivery order + per-page convert/reuse briefs |
| `stardust/rollout/optimize/findings.json` | multi-source quality findings ledger (schema: `schemas/rollout-findings.schema.json`) |
| `stardust/rollout/optimize/scorecard.json` | quality scorecard + history (schema: `schemas/rollout-scorecard.schema.json`) |
| `stardust/rollout/rollout.json` | config + `lastRun` summary (schema: `schemas/rollout-config.schema.json`) |
| `stardust/rollout/site/{sitemap.xml,robots.txt,manifest.json}` | site-level assembly artifacts |
| `stardust/rollout/dashboard/{index.html,data.json}` | self-contained progress dashboard + snapshot |
| edits to the **EDS project** (`content/**`, `styles/`) | applied by `autofix-aem` (the only files rollout writes outside `stardust/rollout/`) |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes under `stardust/rollout/` and — only via `autofix-aem` — to the
**EDS project** it is delivering to. It never modifies the agnostic core,
`state.json`, or `migrated/` — those are read-only inputs.

## Dependencies (audit sources — referenced, not vendored)

optimize orchestrates existing audit skills by invocation; they must be installed:

- **impeccable** (`critique`, `audit`) — already a stardust dependency.
- **marketing skills** (`coreyhaines31/marketingskills`) — `seo-audit`, `schema`,
  `ai-seo`, `site-architecture`. Optional; surface a note if absent.
- **stardust tensions** — emitted in-repo by `extract` (`brand-review.html`).

Normalize each one's output into the ledger via `findings.mjs record`. See
`reference/audit-sources.md`.

## What rollout does NOT do

- **No upstream redesign.** `design-pass` findings are surfaced, not fixed here —
  they belong to `migrate`/`prototype`. autofix only touches platform-fixable
  findings in the EDS project.
- **No new transport.** Delivery is `deploy`'s DA Source API path, unchanged.
- **No redesign of the agnostic core.** `extract`/`direct`/`prototype`/`migrate`
  and `deploy` are untouched; rollout is the across-pages delivery layer on top.
- **No full pre-migration requirement.** Rollout does not require every page to
  be individually migrated before it runs. Archetypes-only mode is a first-class
  path: block code is fully deployed from the archetype pages; the remaining
  pages advance from `content-pending` to `deployed` as `migrate` emits their
  HTML and `inventory` is re-run — no rollout restart needed.

## Scripts

- `scripts/inventory.mjs` — migrated tree → page + template coverage (idempotent;
  stale-aware). `--state <path>` enables archetypes-only mode: supplements the
  migrated tree with the full page roster from `state.json`, seeding non-migrated
  pages as `content-pending` with template and blocks inferred from the archetype.
- `scripts/blocks.mjs` — distinct-block dedup ledger (`blocks.json`).
- `scripts/plan.mjs` — dedup-driven delivery order + per-page convert/reuse briefs.
- `scripts/update-coverage.mjs` — deterministic delivery state-writer for pages
  (`<slug> --status …`) and blocks (`--block <id> --status …`); re-derives all
  roll-ups.
- `scripts/assemble.mjs` — site-level sitemap / robots / fragments manifest.
- `scripts/verify.mjs` — full-site structural verification (HTTP or offline `--root`).
- `scripts/optimize.mjs` — `rollout:baseline` detectors + the multi-source gate:
  scorecard, fixability routing, detect → fix → verify loop; exits non-zero on open P1.
- `scripts/findings.mjs` — record/resolve findings from the external audit sources
  into the shared ledger.
- `scripts/autofix-aem.mjs` — the AEM autofix engine (edits the EDS project, logs
  to `finding.autofix`, stages findings for re-deploy).
- `scripts/dashboard.mjs` — design-identity dashboard: lifecycle-coloured page
  tree + templates + scorecard, `data.json` snapshot (reads `state.json` for the
  agnostic stages).
- `scripts/lib.mjs` — shared IO + roll-up + page-loading + autofix-registry helpers.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `reference/audit-sources.md` — the audit-source → layer → fixability → autofix map.
- `reference/checks.md` — the `rollout:baseline` check catalog.
- `skills/deploy/SKILL.md` — the single-page conversion methodology rollout drives.
- `skills/deploy/da-deploy-protocol.md` — the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
