# Learnings ledger — `stardust/learnings.md`

A per-run ledger of hard-won failures and the skill changes they
imply. It lives at `stardust/learnings.md` in the project a run
operates on, and formalizes the fold-back loop that previously lived
in an external master prompt's NOTES section: a run surfaces a
failure → the ledger records it with the exact skill + section that
should change → the pending entry is harvested into a skill diff.

## Who writes, who reads

- **`rollout`'s report phase (Phase H)** writes/refreshes the ledger
  at the end of every delivery run.
- **Any stardust skill may append** when it hits a failure class its
  SKILL.md didn't anticipate.
- **Plugin maintainers harvest**
  `pending` entries into skill diffs; landing the diff flips the
  entry's status to `folded`.

## Entry shape

One entry per learning, four fields:

```markdown
### <short failure title>
- failure class: <e.g. silent-render, path-safety, index-empty, capture-gap>
- evidence: <what happened, where — page/URL/ledger row/probe flag>
- proposed change: <skill file + section to change, and how>
- status: pending | folded
```

## Example entry

### Grid blocks stacked single-column sitewide
- failure class: silent-render (CSS scoped to a class the runtime never adds)
- evidence: every cards/grid section rendered stacked on desktop; `.cards.block .grid` never matched — the AuthorKit runtime adds no `.block` class
- proposed change: `skills/deploy/SKILL.md` § Runtime-detection probe — assert `blockWrapperClass` from `stardust/runtime-contract.json` before generating any block CSS
- status: folded

### Generated block text uneditable in Experience Workspace
- failure class: silent-render (authored elements rebuilt from `textContent`/`innerHTML`, so the canvas's `data-prose-index` is lost; every fidelity gate green)
- evidence: rwe.com 2026-09-03, `da.live/canvas` — 841/1452 authored texts editable over a 29-page sample; 20 stardust blocks 395/970; template-slotted blocks 0 %. Mechanism verified in da.live `editor-utils.js` + da-nx `quick-edit.js`: only elements still carrying their index after `decorate()` become editors; `cloneNode` keeps it (clone-based blocks worked), value-slotting does not. Wrapper selectors written `.x a` instead of `.x :where(a)` flipped link colour (specificity trap); the editor inserts two wrapper divs, so `>`/`:first-child` paths break while editing.
- proposed change: `skills/deploy/SKILL.md` § 8 — named contract EW1–EW10 (move, wrapper-descendant selectors, CTA `<p>`, strip clones, declared exemptions), node-slotting in § 2b, edit-mode foundation in § 3, `block-roundtrip --ew` + `ew-editability-probe.mjs` gate; brief carries the contract (deploy IMPROVEMENTS #123)
- status: folded

## Rules

- **Entries are never deleted.** `folded` entries stay as the audit
  trail of what the run taught and where it landed.
- **One failure class per entry.** A run with three distinct failures
  writes three entries, even if one incident surfaced all three.
- **`proposed change` names a real file + section.** A learning too
  vague to locate a diff is not yet a learning — keep it in
  `stardust/journal.md` until it is.
- **`evidence` is concrete.** A slug, a URL, a ledger row, a probe
  flag — something a maintainer can re-check before folding.
