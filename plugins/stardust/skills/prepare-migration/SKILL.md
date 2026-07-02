---
name: prepare-migration
description: Orchestrate the migrate-prep cascade — extract --prep → direct --prep → prototype --prep → assets prep — with confirmation gates between phases. Builds the data structure migrate consumes.
license: Apache-2.0
---

# stardust:prepare-migration

Orchestrate the migrate-prep cascade. When the user commits to
migrating an existing site, this skill runs the upstream phases
(`extract`, `direct`, `prototype`) in their `--prep` modes,
sequenced with confirmation gates so the user can confirm or refine
the inferred catalog at each step.

`prepare-migration` is a **thin orchestrator** — it does not
duplicate logic from the underlying skills; it invokes them and
brokers the per-phase summaries. The substantive work lives in:

- `skills/extract/SKILL.md` § Prep mode
- `skills/direct/SKILL.md` § Prep mode
- `skills/prototype/SKILL.md` § Prep mode +
  `reference/canon-extraction.md`

When prep is complete, the user runs `$stardust migrate`
separately. The two-step boundary (`prepare-migration` then
`migrate`) is intentional: it makes "I'm committing to migrate
this site" a conscious gesture and keeps idempotency obvious.

## Inputs

- `--from <phase>` — optional. Resume the cascade from a specific
  phase. Values: `extract | direct | prototype | assets |
  dynamic-blocks`. Default starts from the earliest incomplete phase.
- `--skip-confirm` — optional. Skip the per-phase confirmation
  gates. Useful for re-runs where the catalog is already settled.
  Default is to gate at every phase boundary. Hands-off mode
  (`skills/stardust/SKILL.md` § Hands-off mode, i.e.
  `state.json.handsOff: true`) implies `--skip-confirm`.
- `--canon-from <slug>` — optional. Forward to
  `prototype --prep --canon-from <slug>` when that phase runs.
  Override the default canon-author (which is `home`).
- `--refine-module <module-id>` — optional. Re-enter Phase 2's
  module-catalog step for one module — the target of `migrate`'s
  "bespoke slot crossing promotion threshold" hint. Promotes the
  recurring bespoke slot into that module's slot schema
  (`DESIGN.json.extensions.modules[]`), surfaces the change for
  confirmation, then stops; it does not re-run the full cascade.
  Affected pages are stale-flagged content-aware per
  `skills/stardust/reference/state-machine.md`.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md`
   § Setup) — impeccable dep check, context loader, state read.
2. Verify `stardust/state.json` exists with at least one extracted
   page. If not, recommend `$stardust extract <url>` and stop.
3. Verify `stardust/direction.md` exists with an active direction.
   If not, recommend `$stardust direct` and stop.
4. Determine which phases are already complete by inspecting
   project state:
   - **extract**: every page has a non-null `type` in `state.json`
     and `current/pages/<slug>.json` carries a `slots` block.
   - **direct**: `DESIGN.json.extensions.modules[]` entries all
     have `status: confirmed`; `colorReservations` and `metadata`
     blocks present.
   - **prototype**: every page-type has at least one approved
     archetype; `stardust/canon/` populated;
     `DESIGN.json.extensions.canon` populated.
   - **assets**: favicon variants in
     `stardust/migrated/assets/`; fonts downloaded.
   - **dynamic-blocks**: `stardust/dynamic-blocks-map.md` and
     `helix-query.yaml` present — only required when the inventory
     contains listing blocks (Phase 4.5 records "none" otherwise).

   Resume from the earliest incomplete phase unless `--from`
   overrides.

## Procedure

The cascade runs five phases sequentially. Each phase invokes its
underlying skill via the Skill tool, surfaces the phase's prep
summary, then waits for user confirmation (unless `--skip-confirm`
or hands-off mode) before advancing.

### Phase 1 — extract --prep

Invoke:

```
Skill {
  skill: "stardust:extract",
  args: "--prep"
}
```

The underlying skill runs the standard extract procedure with the
five `--prep` overlays (lift cap, page typing, module candidates,
typed slots, prep summary).

On completion, surface the summary verbatim and gate:

```
Confirm and continue? (yes / refine "<phrase>")
```

User options:

- **`yes`** — advance to Phase 2.
- **`refine "<phrase>"`** — re-invoke `extract --prep` with the
  refinement (e.g., "type news/* slugs as listing not article",
  "exclude /search and /404 from inventory"). Re-surface summary;
  loop.

#### Provenance guard (between Phase 1 and Phase 2)

Before invoking `direct --prep`, validate every page in the
inventory via `validateProvenance(page)` per
`skills/stardust/reference/state-machine.md` § Provenance
validation. Abort the cascade with the helper's error if any
page lacks live-render evidence. This is the cascade-level
defense against the failure mode where `extract --prep` (or its
delegated sub-agent) silently synthesized one or more page
records — extract's own write-time refusal is the primary guard,
but the cascade adds a second check between phases so the
synthesis bug recurring under a different rationale cannot
quietly contaminate the rest of the run.

The same guard runs implicitly inside Phase 2, 3, and 4 (each
underlying skill's setup calls `validateProvenance()` per its
own SKILL.md) — but surfacing it here as an explicit cascade
step makes the abort happen *before* the user sees the Phase 2
prep summary, which would otherwise look like a successful run.

Surface in the cascade output:

```
Provenance OK on 127 pages.
```

When the check fails:

```
Provenance check failed on 20 of 127 pages — see error above.
Cascade aborted between Phase 1 and Phase 2.
   → Re-run extract for the affected slugs:
       $stardust extract --refresh <slug-1>
       $stardust extract --refresh <slug-2>
       ...
```

### Phase 2 — direct --prep

Invoke:

```
Skill {
  skill: "stardust:direct",
  args: "--prep"
}
```

The underlying skill runs five `--prep` overlays (type catalog
confirmation, module catalog finalization, color reservations,
direction re-evaluation, brand metadata defaults).

Surface the summary and gate. User options match Phase 1
(`yes` / `refine "<phrase>"`).

### Phase 3 — prototype --prep

Invoke:

```
Skill {
  skill: "stardust:prototype",
  args: "--prep" + (canonFromSlug ? " --canon-from " + canonFromSlug : "")
}
```

The underlying skill fills page-type gaps (one approved archetype
per type) and writes canon back per
`skills/prototype/reference/canon-extraction.md`. First approval
establishes canon; subsequent approvals extend it (with conflicts
logged as deviations by default).

This phase typically takes the longest — each archetype goes
through the full prototype loop (shape brief, craft, open in
browser, iterate, approve). Stream progress to the user as each
archetype lands.

Surface the summary and gate.

### Phase 4 — assets prep

Generate or download asset variants needed for the migrated site.
This phase has no underlying SKILL — it runs as a small image-
processing + download routine.

1. **Favicon variants.** From the canonical favicon at
   `stardust/current/assets/favicon.<ext>`, generate:
   - `stardust/migrated/assets/favicon-512.png`
   - `stardust/migrated/assets/apple-touch-icon.png` (180×180)
   - `stardust/migrated/assets/icon-192.png`,
     `icon-512.png` (manifest sizes)

2. **Font downloads.** Scan `stardust/canon/canon.css` (and
   `stardust/canon/header.html` / `footer.html`) for `@font-face`
   rules with external URLs. For each:
   - Download the file to
     `stardust/migrated/assets/fonts/<basename-with-hash>.<ext>`.
   - Rewrite the `@font-face` `url(...)` reference in canon files
     to the local path.
   - Skip if already downloaded (sha-compared).
   - Log a warning if download fails (font keeps external URL;
     migrate logs a `metadata-override` warning per page).

3. **Brand-asset audit.** Verify the logo, favicon, and any
   media files referenced by canon module renderings are
   present in `stardust/current/assets/`. Surface missing assets
   to the user.

Surface summary and gate:

```
assets prep complete
====================

Favicon variants:    favicon-512.png, apple-touch-icon.png, icon-192.png, icon-512.png
Font downloads:      4 files (HarmoniaSans 4 weights)
Brand assets:        all present
```

### Phase 4.5 — Dynamic-blocks pre-import gate

Runs after assets prep and **before any bulk import downstream**
(`migrate` at scale, `rollout` Phase C). The ordering is the point:
what a dynamic listing block can show is bounded by what each page
emits, and retrofitting metadata across thousands of already-live
pages is a second migration. Mechanics live in
`skills/rollout/reference/dynamic-listings.md`; this phase runs them
at prep time so the contract exists before the first bulk import
(`rollout` Phase B2 then verifies it rather than redoing it).

1. **Map every block that LISTS other pages** (directories,
   news/event feeds, "related" rails) — these must read an EDS
   query-index, not static cards.
2. **Classify each field a listing needs by tier:**
   - **Tier 1 — page-intrinsic DOM** (`h1`, `og:image`, authored
     links): the index extracts them via CSS selectors — zero
     content change.
   - **Tier 2 — page metadata** (dates, locations, categories): must
     be emitted as `<meta>` via each page's metadata block **at
     author time**; retrofitting across live pages is the expensive
     path.
   - **Tier 3 — relationships** (many-to-many): need an explicit
     join field + the related items must themselves be indexed
     pages. Those blocks **stay static until modeled** — record the
     decision in the map, don't fake it.
3. **Write `stardust/dynamic-blocks-map.md`** — dynamic vs static per
   listing block, the index each reads, and the metadata contract per
   content type (the concrete `<meta name="…">` fields).
4. **Author `helix-query.yaml`** (scoped indexes: include globs,
   `target`, properties) from the same contract, so selectors and
   emitted meta names line up.

When the inventory has no listing blocks, record "none" in the map
and pass the gate. Surface summary and final gate:

```
dynamic-blocks prep complete
============================

Listing blocks:      3 dynamic (news-feed, events, related-treatments) · 1 static (Tier-3: specialists rail)
Metadata contract:   news → PublishDate, Category · event → EventDate, Location
Indexes authored:    helix-query.yaml (2 scoped indexes)

Migrate-readiness: confirmed
   → Run `$stardust migrate` to apply canon to every page in inventory.
```

### Final report

```
prepare-migration complete
==========================

Phase 1 (extract --prep):      127 pages, 7 types, 8 module candidates
Phase 2 (direct --prep):       types & modules confirmed; metadata set
Phase 3 (prototype --prep):    6 archetypes approved; canon written
Phase 4 (assets prep):         favicon variants + fonts + brand assets ready
Phase 4.5 (dynamic blocks):    3 dynamic listings mapped; metadata contract + indexes authored

Next: $stardust migrate
```

## Outputs

`prepare-migration` writes nothing directly — every artifact is
written by the underlying skill or by the Phase 4 / 4.5 routines.
After the cascade runs, the project state has:

| Artifact                                                | Phase that wrote it             |
|---------------------------------------------------------|---------------------------------|
| `state.json.pages[].type`                               | extract --prep                  |
| `current/pages/<slug>.json` § slots                     | extract --prep                  |
| `DESIGN.json.extensions.modules[]` (`status: confirmed`)| extract --prep + direct --prep  |
| `DESIGN.json.extensions.colorReservations[]`            | direct --prep                   |
| `DESIGN.json.extensions.metadata`                       | direct --prep                   |
| `stardust/canon/` (header, footer, css, modules/)       | prototype --prep                |
| `DESIGN.json.extensions.canon`                          | prototype --prep                |
| `stardust/migrated/assets/favicon-*`                    | assets prep                     |
| `stardust/migrated/assets/fonts/`                       | assets prep                     |
| `stardust/dynamic-blocks-map.md` (metadata contract)    | dynamic-blocks prep (Phase 4.5) |
| `helix-query.yaml` (scoped indexes, EDS project root)   | dynamic-blocks prep (Phase 4.5) |
| `stardust/state.json` (per-page status updates)         | each underlying phase           |

## Failure modes

- **No state.json or no extracted pages.** Recommend
  `$stardust extract <url>` and stop.
- **No active direction.** Recommend `$stardust direct` and stop.
- **User refuses a phase.** Stop the cascade cleanly. State is
  left in a consistent intermediate (the underlying skill's writes
  have landed); the user can resume with
  `$stardust prepare-migration --from <phase>`.
- **Underlying skill fails.** Surface the failure verbatim; do not
  advance. User fixes and re-runs.
- **Phase 3 canon conflict during a non-canon-author approval.**
  Conflicts log as deviations by default per
  `reference/canon-extraction.md`. If the user wants to override
  per-conflict (promote to canon / reject and re-iterate / log as
  deviation), surface during the phase's confirmation gate rather
  than at runtime. A future `--strict-canon` flag could refuse
  approvals that conflict; not in v0.2.
- **Phase 4 asset download failure.** Continue the run; log the
  failure in the assets-prep summary. Migrate later surfaces a
  warning per affected page.

## Concurrency

Per `skills/stardust/reference/state-machine.md` § Concurrency:
`state.json` writes merge by slug, so the cascade's per-page writes
coexist with other parallel lanes. But two concurrent
`prepare-migration` runs on the same project race on the same
top-level artifacts (canon, module catalog) — that remains
last-write-wins with a warning, and is likely to corrupt canon.
Don't run two cascades at once; do not engineer a lock around it.

## Idempotency

Re-running `prepare-migration` after partial completion resumes
from the earliest incomplete phase (or the explicit `--from`
phase). Each underlying skill is itself idempotent — already-
typed pages are not re-typed, already-confirmed modules are not
re-proposed, already-approved archetypes are not re-prototyped,
already-generated favicon variants are not re-generated, and an
existing `dynamic-blocks-map.md` is refined rather than rewritten.

Re-running after full completion is a no-op unless inputs
changed (extract found new pages, direction was edited, the
canon-author prototype was re-iterated, etc.).

## References

- `skills/extract/SKILL.md` § Prep mode
- `skills/direct/SKILL.md` § Prep mode
- `skills/prototype/SKILL.md` § Prep mode
- `skills/prototype/reference/canon-extraction.md` — the
  five-step extraction procedure prototype --prep performs on
  approval
- `skills/rollout/reference/dynamic-listings.md` — metadata
  contract + query-index mechanics Phase 4.5 runs at prep time
- `skills/migrate/SKILL.md` — the consumer of every data
  structure this cascade prepares
- `notes/migrate-template-canon-refactor.md` — design plan and
  rationale
- `skills/stardust/reference/state-machine.md` — page typing,
  stale-flagging cascade
- `skills/stardust/reference/artifact-map.md` — file structure,
  DESIGN.json.extensions shape
