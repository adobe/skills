# Approval fold-back (Part III)

The procedure `stardust:prototype` Phase 5 runs when the user
approves a non-A variant. Reads the approved file's structural
moves, diffs against the active direction, and proposes folding
the moves into the direction so subsequent prototype runs consume
the new state.

Triggered automatically as a step in Phase 5 (per
`SKILL.md` § Phase 5 — Approval). User-facing.

---

## When fold-back runs

| `ia-fidelity` | Approved variant | Fold-back fires |
|---|---|---|
| `reimagined` | A | No (variant A is the floor; no structural moves to fold) |
| `reimagined` | B / C / C+ | **Yes** |
| `verbatim` | A1 / A2 / A3 | No (surface forks; structural moves are forbidden by Discipline 10's mode-aware contract) |

The no-op cases short-circuit before any diff is computed. Surface
in the approval report:

> Fold-back: no-op (variant A; nothing structural to fold).
> Fold-back: no-op (ia-fidelity: verbatim; A1/A2/A3 are surface forks).

---

## Procedure

When fold-back fires:

1. **Read the approved file's structural moves.** From
   `<slug>-<variant>-proposed.html` `_provenance` block:
   - `compositionDelta_vs_A[]` — pair-wise deltas vs variant A
   - `compositionDelta_vs_B[]` — when approving C+ vs sibling B
   - `capturedTraitAmplified` — the trait the variant amplified
   - `dominantDimension` — the variant's distinct dimension
   - `surpriseTier` and `surpriseMoves[]` — the moves applied

2. **Diff against the active direction.** Read
   `stardust/direction.md` § Active and
   `DESIGN.json.extensions.iaPriorities[]`. Compute:
   - **IA-priority diffs** — does the variant change the
     preserved-priority order or composition vs the direction's
     stamped `iaPriorities[]`?
   - **Section-sequence diffs** — does the variant add / remove /
     reorder major sections vs the brief variant A rendered?
   - **Layout-strategy diffs** — does the variant change a major
     section's layout strategy vs the direction's anticipated
     deployment?
   - **Substrate / surprise-move diffs** — does the variant
     deploy a substrate-promotion or document-shape that the
     direction does not anticipate site-wide?

3. **Build the proposal.** If the diff is empty (the variant's
   structural moves are already in the direction), surface as a
   no-op and skip. Otherwise compose a one-screen proposal:

   ```
   Fold-back proposal: /beers variant C approved

   Structural moves NOT yet in active direction:
     · substrate-keyed-zine document-shape (6 per-SKU substrates)
     · filter-chip-row dropped (substrate sequence carries navigation)
     · catalog-entry-as-environment (each block = its own visual surface)

   Captured trait amplified:
     label-color-as-design (Lambrate per-SKU wallpaper photography)

   Dominant dimension:
     ground-family/label-substrate-zine

   Three options:
     (a) fold site-wide [default] — apply to direction.md + iaPriorities;
         stale-flag conflicting pages (the-brewery, taprooms)
     (b) fold page-local — annotate /beers only; direction stays
         unchanged; no stale flags elsewhere
     (c) don't fold — approval stands; document rationale in provenance

   Pick (a / b / c):
   ```

4. **Apply the user's choice.**

### Option (a) — fold site-wide

The default. The moves promote to the direction:

1. Append a `## Active addendum — <ts> (Phase 5 approval
   fold-back; site-wide)` section under the current `# Active
   direction` block in `direction.md` (per
   `direct/reference/direction-format.md` § Re-direct procedure
   — addenda use the same shape as refinements).

   Body of the addendum includes:
   - **Scope:** site-wide.
   - **Kind:** approval-fold-back.
   - **Source:** user approval of `<slug>` variant `<variant>`.
   - **What changed.** The structural moves now part of the
     direction, with each move's captured-trait amplification
     citation.
   - **iaPriorities changes.** Any `iaPriorities[]` entries
     added / removed / re-ordered.
   - **Files updated under this addendum.** The list of files
     the fold-back touches.

2. **Update `DESIGN.json.extensions.iaPriorities[]`** when the
   variant moved a priority. New entries gain
   `mutability: "movable"` (consistent with `ia-fidelity:
   reimagined`).

3. **Stale-flag conflicting pages.** Read every page in
   `prototyped` / `approved` / `migrated` status and compute the
   delta per the content-aware stale rule
   (`stardust/reference/state-machine.md` § Stale flagging).
   Pages whose deployment consumes a changed item gain
   `stale: true` with
   `staleReason: "direction folded at <ts> from <slug> approval;
   affected: <comma-separated list>"`.

   The approved page itself does NOT go stale — the fold-back
   captures *its own* moves.

4. **Annotate the approved file's `_provenance.foldBackDecision`.**
   Record `{ choice: "site-wide", at: <ts>, scope: "direction +
   iaPriorities", staleFlagged: [<page slugs>] }`.

### Option (b) — fold page-local

The page-local choice when the moves are captured-source-cited
per-page and don't generalize site-wide. Common cases:

- Substrate-keyed document-shape on a catalog page when only one
  page in the IA has per-content-type distinct color values.
- Photography-led inversion on an about / story page that doesn't
  apply to product / catalog / data surfaces.
- Tabular document-card on a locator page when other pages aren't
  data-led.

Procedure:

1. Append a `## Active addendum — <ts> (Phase 5 approval
   fold-back; page-local)` section under the current `# Active
   direction` block in `direction.md`.

   Body includes:
   - **Scope:** page-local — `<slug>` only.
   - **Kind:** approval-fold-back.
   - **Source:** user approval of `<slug>` variant `<variant>`.
   - **What changed** — the structural moves, scoped to `<slug>`.
   - **Why page-local, not site-wide** — the captured-source
     citation that scopes the moves to this page (per-SKU
     substrates that generalize only to catalog pages, etc.).
   - **What does NOT change** — direction Mode A pin, site-wide
     iaPriorities, DESIGN.md, DESIGN.json (all unchanged).
   - **Files updated under this addendum.**

2. **Do NOT update `DESIGN.json.extensions.iaPriorities[]`.**
   Site-wide direction is unchanged.

3. **Do NOT stale-flag other pages.** Their deployments are
   unaffected by a page-local fold.

4. **Annotate the approved file's `_provenance.foldBackDecision`.**
   Record `{ choice: "page-local", at: <ts>, scope: "<slug>",
   rationale: <reason captured from user>, rejectedOptions:
   ["site-wide", "don't-fold"] }`.

### Option (c) — don't fold

Approval stands. The variant's structural moves stay in the
approved file's `_provenance` block but are not promoted anywhere.
Useful when:

- The variant was approved despite a structural move the user
  considers experimental rather than directional.
- The user wants to approve the page but defer the direction
  question to a follow-up session.

Procedure:

1. Skip the direction addendum.
2. **Annotate the approved file's `_provenance.foldBackDecision`.**
   Record `{ choice: "none", at: <ts>, rationale: <reason
   captured from user> }`.

---

## Flags

- `--auto-fold` — skip the user gate; apply option (a) site-wide
  fold automatically. For fully-scripted runs (e.g., a batch
  approval cascade where the user pre-decided to fold everything).
- `--no-fold` — opt out entirely; skip the proposal AND skip
  recording `foldBackDecision`. Approval stands; the file's
  structural moves stay only in the file's own provenance. The
  spec equivalent of *"approve without proposing."*

The two flags are mutually exclusive; passing both refuses with:
*"`--auto-fold` and `--no-fold` are mutually exclusive."*

---

## Worked example — wasatch /beers variant C

The page-local fold-back captured by the wasatch dry-run on
2026-05-13. The user approved variant C of `/beers` after the
Discipline 9 gate cycle cleared. The fold-back surfaced the three
options; the user selected `page-local` because the
substrate-keyed-zine pattern generalizes only to catalog pages
with ≥ 3 per-content-type distinct color values — `/beers` is the
only such page in the 4-page IA.

Direction addendum written to `stardust/direction.md`:

```markdown
## Active addendum — 2026-05-13T19:45:00Z (Phase 5 approval fold-back; page-local)

**Scope:** page-local — `/beers` only.
**Kind:** approval-fold-back (Part III of the merged prototype spec).
**Source:** user approval of `/beers` variant C after Discipline 9 gate
cycle cleared (P0=0; P1 contrast findings fixed in-session: substrate
darkened from `#1c8a7a` to `#177566`, pour-link recolored from yellow
to white).

### What changed

`/beers` is now `approved` with **substrate-keyed zine document-shape**
as its captured-trait amplification:
- 6 per-section substrates, each cited to the per-SKU label color
- Photo-as-full-bleed-label-art-foreground (replaces variant A's 35%
  photo column)
- Filter-chip-row dropped (substrate sequence carries navigation)
- Each catalog entry is its own visual environment
- `surpriseTier: high`; `dominantDimension: ground-family/label-substrate-zine`

### Why page-local, not site-wide

The substrate-keyed-zine pattern is captured-source-cited per-SKU.
It generalizes only to catalog pages with ≥ 3 per-content-type
distinct color values; `/beers` is the only such page in the
current 4-page IA. Forcing the pattern site-wide would:
- Override `/the-brewery`'s people-led inversion amplification
- Override `/taprooms`'s document-card-tabular amplification
- Stale-flag two pages whose existing C variants are direction-
  authorized for their own captured traits

Friction #2 (substrate-keyed document-shape exception to
Discipline 4's ≤2-transition cap) documents this as the exception,
not the rule. The exception travels with the captured trait, not
as a site-wide IA priority.

### What does NOT change

- `direction.md` Mode A pin: still active site-wide.
- `iaPriorities[]`: unchanged.
- `DESIGN.md` / `DESIGN.json`: unchanged.
- `/the-brewery` and `/taprooms` prototypes: NOT stale-flagged.
```

And the approved file's `_provenance.foldBackDecision`:

```yaml
_provenance.foldBackDecision:
  choice: page-local
  at: 2026-05-13T19:45:00Z
  scope: /beers
  rationale: "substrate-keyed-zine pattern is per-SKU-cited; generalizes
    only to catalog pages with ≥3 per-content-type distinct color values"
  rejectedOptions:
    - site-wide: "would stale-flag /the-brewery + /taprooms whose own
        C variants amplify different captured traits"
    - "don't-fold": "page-local annotation preferred so subsequent
        re-prototype reads the explicit scope, not silently discovers it"
```

This worked example IS the canonical page-local fold output —
new fold-back invocations should mirror its addendum shape.

---

## Stale-flagging interaction

Site-wide folds trigger the same content-aware stale-flagging rule
`direct --re-direct` uses, documented in
`stardust/reference/state-machine.md` § Stale flagging:

1. Compute the delta between pre-fold and post-fold direction.
2. For each page in `prototyped` / `approved` / `migrated`, read
   its `<slug>-shape.md` to see which tokens / components / voice
   rules / iaPriorities the deployment consumes.
3. If any consumed item appears in the delta, flag stale.

The approved page that triggered the fold does NOT go stale (its
moves ARE the fold). Page-local folds skip stale-flagging entirely
(no other page is affected by construction).

---

## Idempotency

Re-running fold-back on an already-folded approval is a no-op:

- Site-wide fold — the addendum is already in `direction.md`; the
  diff against the active direction is empty; surface "fold-back
  already applied at <ts>; no-op" and skip.
- Page-local fold — the page's `_provenance.foldBackDecision` is
  already populated; surface the same no-op.

Manual edits to `direction.md` after a fold are honored. If the
user removes the fold addendum and re-approves the page, the fold
proposal fires again; the user can re-decide.
