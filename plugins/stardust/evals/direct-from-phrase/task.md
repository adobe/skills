# Eval: direct from a freeform phrase

## Setup

A project with `stardust/extract` already complete:

- `stardust/state.json` lists 5 pages, all status `extracted`.
- `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist
  (descriptive snapshot of the existing site).
- `stardust/current/_brand-extraction.json` exists with palette,
  type, motifs, voice samples.
- No project-root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json` yet.
- No `stardust/direction.md` yet.
- Impeccable installed.

## User prompt

"$stardust direct make it more expressive for a young audience"

## Expected behavior

The `stardust:direct` skill is invoked. It:

1. Runs the master setup (impeccable dep, context loader, state read).
2. **Restates** the phrase in stardust's dimensional vocabulary
   (per `intent-dimensions.md`): identifies that the phrase moves
   the **expressive axis** toward `committed` or `drenched`,
   distinctiveness toward `distinctive`, tone toward `playful`, and
   captures `audience: young` as underspecified.
3. Identifies the **gap**: "young" is too coarse (Gen Z college vs
   millennial professional vs digital-native parent are all
   "young").
4. Asks **at most two** clarifying questions, each with concrete
   options + an "other" escape hatch. The first sharpens "young";
   the second is optional (cultural reference set or skip).
5. After the user answers, **shows the plan** before running any
   command:
   - Restated direction in one sentence.
   - Assumptions defaulted in.
   - Impeccable command sequence with one-line reasoning per command.
   - Pages affected.
6. Resolves the divergence-toolkit inputs (4-dim seed, font deck,
   palette via picker if direction implies a swap).
7. **Authors `PRODUCT.md` directly** at the project root using
   impeccable's `teach.md` as the format spec — does NOT invoke
   `$impeccable teach`.
8. **Authors `DESIGN.md` and `DESIGN.json` directly** at the project
   root using impeccable's `document.md` as the format spec — does
   NOT invoke `$impeccable document`. The DESIGN.json includes
   `extensions.divergence` with the seed, font deck, palette source,
   and anti-toolbox audit.
9. Writes `stardust/direction.md` per
   `skills/direct/reference/direction-format.md`: provenance,
   YAML frontmatter, `# Active direction` section with phrase,
   restatement, movements, gaps and answers, divergence inputs,
   command sequence, user confirmation, pages in scope.
10. Updates `stardust/state.json`: 5 pages move from `extracted` to
    `directed`; `direction.resolvedAt` and `direction.phrase` set.
11. Prints a summary report and recommends `$stardust prototype`.
