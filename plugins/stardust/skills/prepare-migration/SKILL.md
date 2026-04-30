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
  phase. Values: `extract | direct | prototype | assets`. Default
  starts from the earliest incomplete phase.
- `--skip-confirm` — optional. Skip the per-phase confirmation
  gates. Useful for re-runs where the catalog is already settled.
  Default is to gate at every phase boundary.
- `--canon-from <slug>` — optional. Forward to
  `prototype --prep --canon-from <slug>` when that phase runs.
  Override the default canon-author (which is `home`).

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

   Resume from the earliest incomplete phase unless `--from`
   overrides.

## Procedure

The cascade runs four phases sequentially. Each phase invokes its
underlying skill via the Skill tool, surfaces the phase's prep
summary, then waits for user confirmation (unless `--skip-confirm`)
before advancing.

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
through the full prototype loop (shape brief, craft, viewer,
iterate, approve). Stream progress to the user as each archetype
lands.

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

Surface summary and final gate:

```
assets prep complete
====================

Favicon variants:    favicon-512.png, apple-touch-icon.png, icon-192.png, icon-512.png
Font downloads:      4 files (HarmoniaSans 4 weights)
Brand assets:        all present

Migrate-readiness: confirmed
   → Run `$stardust migrate` to apply canon to every page in inventory.
```

### Final report

```
prepare-migration complete
==========================

Phase 1 (extract --prep):    127 pages, 7 types, 8 module candidates
Phase 2 (direct --prep):     types & modules confirmed; metadata set
Phase 3 (prototype --prep):  6 archetypes approved; canon written
Phase 4 (assets prep):       favicon variants + fonts + brand assets ready

Next: $stardust migrate
```

## Outputs

`prepare-migration` writes nothing directly — every artifact is
written by the underlying skill or by Phase 4's image/download
routine. After the cascade runs, the project state has:

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

Per `skills/stardust/reference/state-machine.md`: stardust does
not lock. Two concurrent `prepare-migration` runs on the same
project are last-write-wins and likely to corrupt canon. Document
this in the user report; do not engineer around it.

## Idempotency

Re-running `prepare-migration` after partial completion resumes
from the earliest incomplete phase (or the explicit `--from`
phase). Each underlying skill is itself idempotent — already-
typed pages are not re-typed, already-confirmed modules are not
re-proposed, already-approved archetypes are not re-prototyped,
already-generated favicon variants are not re-generated.

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
- `skills/migrate/SKILL.md` — the consumer of every data
  structure this cascade prepares
- `notes/migrate-template-canon-refactor.md` — design plan and
  rationale
- `skills/stardust/reference/state-machine.md` — page typing,
  stale-flagging cascade
- `skills/stardust/reference/artifact-map.md` — file structure,
  DESIGN.json.extensions shape
