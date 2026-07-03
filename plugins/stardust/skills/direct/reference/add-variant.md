# Add-variant mode (`--add-variant <name>`)

Read and executed by `direct` when — and only when — the
`--add-variant <name>` flag is passed. Default runs never read this
file.

When the user has already approved (or rendered) variant A and
asks for B / C / etc. as alternatives, `--re-direct` is too
heavy: it replaces the active direction, re-runs Phase 1
reasoning, and stale-flags every approved or migrated page
against the prior direction. The user is **not** changing
direction — they are extending it with additional variant
expressions of the same direction. `--add-variant <name>` is the
incremental-extension flow.

The flow surfaced on the 2026-05-04 ups.com session: variant A
shipped, the user later asked for B and C as the directional
alternatives that had been surfaced in the initial menu but not
committed to. Without an additive flag, the agent had to author
B and C as page-shape briefs + proposed HTML only (skipping
`DESIGN-B.{md,json}` / `DESIGN-C.{md,json}`), embedding their
system-level deviations inline in per-variant CSS. Migrate then
had no machine-readable source to re-derive B / C from.

## Procedure

When `--add-variant <name>` is passed:

1. **Setup** runs as normal (impeccable dep check, state read,
   brand-extraction read, brand-signal classification).
   Validation step 5 (provenance) is **skipped** — add-variant
   does not consume per-page extracted JSON; it consumes the
   already-resolved direction. The brand-signal stamp stays
   useful for the inheritance rules below.
2. **Skip Phase 1 (Reasoning).** The user's intent is *"add
   another variant against the existing direction,"* not "resolve
   a fresh direction." If the existing `direction.md` Active
   section is missing, refuse — there is no direction to extend.
3. **Skip Phase 2 (Mode detection + divergence).** Mode is
   inherited from the existing direction (typically Mode A
   given the brand-faithful default). The seed, font deck,
   palette, and ground family are all inherited as-is.
4. **Run Phase 2.5 (Improvements list)** **only if** the
   existing direction is Mode A and a variant-A improvements
   list does not yet exist for the slug being prototyped later.
   The improvements list is shared across all Mode A variants
   per `direct/SKILL.md` § Phase 2.5; if it already exists, the
   add-variant pass reads it as input and does not regenerate.
5. **Run Phase 2.6 (Multi-variant fork)** only enough to
   resolve the **new variant's** role per the variant role
   contract (faithful + improvements / one captured trait
   amplified / different captured trait amplified). Surface the
   role choice to the user before proceeding. Do not re-run the
   role contract for variants that already exist — their roles
   are stamped in `direction.md`.
6. **Run Phase 4 against the new variant only.** Derive the
   variant's system-level deviations (font-weight changes,
   surface-color additions, motif amplifications, etc.) and
   write:
   - `DESIGN-<name>.md` — Stitch frontmatter + 6 canonical
     sections, **inheriting** every token that doesn't change
     for this variant.
   - `DESIGN-<name>.json` — sidecar with extensions
     (`divergence`, `componentStyle`, `voice`, `iaPriorities`).
   When variant A has been written as the unsuffixed
   `DESIGN.{md,json}` (single-variant flow), upgrade A's files
   to the suffixed form (`DESIGN-A.{md,json}`) and **leave the
   unsuffixed files in place as backward-compatible aliases
   pointing at A** — `migrate` and `prototype` continue to
   resolve the unsuffixed form to A.
7. **Append a section to `direction.md`** under the existing
   Active section, titled `## Variant <name>`, recording: the
   variant's role (faithful / amplified-trait), the captured
   trait being amplified (when applicable), the system-level
   deviations from variant A, the IA-priority audit (must
   match A's audit — variants cannot opt out of preservation
   under Mode A), and a one-line thesis.
8. **Skip Phase 5 update of state.json's `direction.*` block**.
   The active direction has not changed; the direction file's
   resolvedAt / phrase / directionFile fields stay untouched.
   Pages already in `prototyped` / `approved` / `migrated`
   states are **not** stale-flagged — adding a variant is
   additive, not a re-direction. State.json gains a
   `direction.variants[].<name>` entry (per
   `state-machine.md`'s multi-variant additions) recording the
   new variant's id and DESIGN files.

## Variant parentage and inheritance chain

`--add-variant <name>` infers a **parent** from the slot name:

- Slot name is a single letter (`A`, `B`, `C`, ...): parent is the
  *active direction* (the resolved direction in `direction.md`).
  The variant inherits from the active direction's resolved seed.
- Slot name is a letter + digits (`A1`, `A2`, `B3`, `C2`...):
  parent is the variant whose id is the letter prefix (`A1` → `A`,
  `B3` → `B`). The variant is a **surface fork** of its parent
  per SKILL.md § Surface forks of role-differentiated variants. The
  parent must already exist; if not, refuse and recommend adding
  the parent first (`--add-variant B` before `--add-variant B3`).

Inheritance chains under reimagined mode:

- `A → active-direction` — A inherits from the resolved direction.
- `B → active-direction` — B inherits from the resolved direction;
  its captured trait is declared in its shape brief.
- `B3 → B → active-direction` — B3 inherits from B (parent surface
  fork); B's captured trait + role propagate, B3 declares its
  surface tuning.

Record the chain in `direction.md`'s per-variant section as
`Inheritance chain: <child> → <parent> → <root>`. Stardust
`state.json` records the parent in
`direction.variants[].parentVariant` (per
`stardust/reference/state-machine.md` § Variants block).

## Per-field inheritance rules

When writing `DESIGN-<name>.{md,json}`, fields fall into three
categories:

| inherit-as-is | inherit-then-extend | variant-local |
|---|---|---|
| `colors` (palette) — Mode A pin | `componentStyle` — base treatment from A; variant adds variant-local component overrides keyed by `data-variant="<name>"` | `narrative.northStar` — per-variant thesis |
| `typography` family / scale — Mode A pin | `extensions.divergence.brand_faithful_inversions[]` — A's list is the floor; variant may add inversions that follow from its amplified trait | `narrative.overview`, `narrative.keyCharacteristics` — written against the variant's role |
| `rounded`, `spacing` — site-wide tokens | `extensions.iaPriorities[]` — same audit as A; cannot opt out under Mode A | `voice.examples.do/dont` — variant may amplify a captured voice register A didn't lean on |
| `extensions.colorMeta`, `typographyMeta`, `breakpoints` | `narrative.rules[]` — A's house standards inherit; variant adds its own | `extensions.divergence.seed.anchors[]` — variant may add a captured trait as the anchor for its amplified-trait role |
| `extensions.systemComponentRoles` (abstract roles) | | The variant-id stamp in `_provenance` |

Variants **cannot**:

- Introduce a font outside the captured surface (Mode A pin).
- Introduce a color outside the captured palette (Mode A pin).
- Shift the register from PRODUCT.md (per-brand strategy is
  variant-invariant under Mode A).
- Skip the IA-priority audit (variants are visual expressions,
  not strategic re-shapings).

**Surface-fork-specific rules (when parent is a letter-prefix
variant like B → B3):**

- The captured trait being amplified is **inherited from the parent
  variant**. The surface fork cannot change which trait is amplified
  (changing it changes the role, which is a sibling variant, not a
  surface fork).
- The role narrative (B's "scroll cinema amplified" thesis) is
  inherited; the surface fork's narrative extends it with its
  per-axis tuning ("B3 amplifies the same captured trait in a loud
  register: weight 700 body H3s, perfect-fifth type scale, packed
  density").
- The parent's caps (motion-energy ≤ N, color-temperature within
  range, etc.) inherit. Cap overrides are permitted but must be
  declared in the surface fork's DESIGN.json `extensions.capOverrides[]`
  with a one-sentence rationale citing a captured-source basis.
- Structural fields (IA priority order, section sequence, layout
  strategy of major sections) inherit verbatim from the parent —
  changing them produces a sibling variant, not a surface fork.

When the user's add-variant request would violate one of the
forbidden rules, refuse with the same SKILL.md § Failure modes (c)
hard rule conflict pattern: name the conflict, propose targeted
alternatives (rebrand mode via `--rebrand`, or a Mode A
expression that fits within the pins).

## Add-variant summary

```
direct --add-variant B complete
==============================

Variant role:         one captured trait amplified — editorial confidence
Captured trait:       caption-band typography + named-driver portraits
Inheritance:          palette, typography, rounded, spacing inherited from A
Variant-local:        narrative.northStar, voice DOs (eyebrow voice expanded),
                      componentStyle.heroOverlay (variant override)
IA-priority audit:    matches A — commercial-conversion + crisis-affordance preserved

Wrote:
  DESIGN-B.md, DESIGN-B.json (alongside DESIGN-A.{md,json})
  stardust/direction.md  (appended ## Variant B section)

State:
  pages unchanged (no stale flags — add-variant is additive)
  direction.variants[]:  A + B

Next: $stardust prototype <slug> --variant B
```

## Failure modes specific to add-variant

- **No active direction.** Refuse — there is nothing to extend.
  Recommend `$stardust direct` first.
- **Variant `<name>` already exists.** Refuse — pass `--re-direct`
  and re-resolve the variant explicitly if a refresh is wanted,
  or pick a different name (variants are case-sensitive; B and b
  are distinct entries but discouraged for clarity).
- **Mode A constraint violation.** Per § Per-field inheritance
  rules above; surface the conflict and propose targeted
  alternatives.
- **Existing direction is rebrand mode.** Add-variant is allowed,
  but the inheritance rules relax — rebrand permits a different
  PRODUCT.md per variant. Surface the relaxed contract to the
  user before writing.
