# direct multi-variant fork — roles, forks, and contracts

Consumed by `stardust:direct` Phase 2.6 when the user requests
N > 1 variants, and by `--add-variant` for role resolution
(`reference/add-variant.md`).

When the user requests N variants (phrase contains *"3 variants"*,
*"4 directions"*, or equivalent), variant slots are
**role-differentiated**, not seed-differentiated. Each slot serves a
distinct decision the customer is making — variants exist to
de-risk a brand decision, not to fan out into N rebrand
explorations.

## Branch on `ia-fidelity` first

The variant role contract is **`ia-fidelity`-aware**. Read the tier
stamped in Phase 1 (per `reference/intent-dimensions.md` § 9 and the
IA-fidelity tuning step above), and branch:

**Under `ia-fidelity: verbatim` — surface-tuning forks (A1/A2/A3).**

Variant slots are A1 / A2 / A3 (or A1…An for N > 3), all
surface-tuning forks of A's role. Each must differ from the others by
**≥ 2 surface changes** drawn from:

- type-weight choice (e.g. 400 vs 600 vs 800 display)
- type-scale ratio (e.g. 1.2 vs 1.333 vs 1.5)
- density tier (within the multi-audience floor in § 4)
- motion energy (still vs gentle vs animated)
- color-temperature move within the captured palette (warm-leaning
  vs cool-leaning vs neutral-balanced)
- spacing rhythm (compact vs even vs generous within the floor)

**Forbidden differentiation axes** under verbatim:

- section sequence
- section presence / absence
- IA priority
- layout strategy of a major section

A1 / A2 / A3 names indicate "different tunings of the same role,"
not different roles. When the user asks for *"3 variants"* while
`ia-fidelity` is verbatim, the fork produces A1 / A2 / A3
automatically; for N=1, just A.

The improvements list (Phase 2.5) still anchors variant A's role —
A1/A2/A3 all apply every item from `<slug>-improvements.md`. They
differ only in surface treatment of the same applied fixes.

The convergence detector in `prototype/SKILL.md` Discipline 10
becomes its inverse under verbatim: structural deltas
(section-sequence / presence / IA priority / layout strategy) are
**forbidden**, surface-only deltas are **required**.

**Under `ia-fidelity: reimagined` — A + B + C role-differentiated.**

Variant slots are A + B + C (or A + B + C + D…) per the variant role
contract below. The contract is unchanged from the prior behavior:
faithful + improvements / one captured trait amplified / different
captured trait amplified.

The remainder of this Phase 2.6 (variant role contract, variant
differentiation contract, C-cliff failure mode) applies as written
under `reimagined`. Under `verbatim`, only the surface-fork rules
above apply; the variant role contract below does not.

## Variant role contract

| Slot | Role | Brief |
|---|---|---|
| **A** | **Faithful + improvements** — *"this is what your site should be tomorrow."* | Same IA. Same section sequence. Same composition strategy. Apply every item from `<slug>-improvements.md` exactly — no extras, no embellishment, no creative reach. The brand team should react *"yes, that's us, with the obvious fixes."* This is the variant a risk-averse stakeholder green-lights. |
| **B** | **One captured trait amplified** — *"what if we leaned into X?"* | Pick one specific trait already in the captured brand surface — a motif underused in current execution, a photographic treatment the site doesn't fully exploit, an IA priority the current site underplays, a tonal register that survives in copy but not in layout. Justify in one sentence in the variant's shape brief: *"This variant amplifies <captured trait> in service of <brand personality move from PRODUCT.md>."* |
| **C+** | **Different captured trait amplified** — *"what if we leaned into Y?"* | Different from B by definition. Different captured trait. Different brand-personality move. Forbidden definitions: *"B but more"*, *"bolder fonts"*, *"more empty space"*, *"more brutalist"*, *"more editorial"*. Each subsequent variant must be a defensible standalone proposition. |

Variants beyond C (D, E, …) follow the C+ contract — each amplifies
a distinct captured trait, declared in the shape brief.

## Surface forks of role-differentiated variants (B1/B2/B3, C1/C2/C3…)

Under `ia-fidelity: reimagined`, a variant's role (A, B, C, …) may
spawn **surface forks** — tunings of the *same role* across the
same surface axes that A1/A2/A3 use under verbatim. The pattern:

- `B` is "scroll cinema amplified" (the role).
- `B1`, `B2`, `B3` are surface tunings of B that all amplify scroll
  cinema, but vary along type-weight, type-scale, density,
  motion-energy, color-temperature, or spacing-rhythm.

This composes the verbatim-mode surface-fork machinery with the
reimagined-mode role differentiation: the **role contract** binds
the captured trait being amplified; the **surface-fork delta**
governs how that trait reads in chrome.

Surface forks of role-differentiated variants are **opt-in, not
default**. The default fork under reimagined is still A + B + C.
Surface forks appear in two ways:

1. **Explicit user request**: *"design 5 variant directions for B"*
   — the user asks for surface tunings of an existing role-
   differentiated variant. Render B1 / B2 / B3 / B4 / B5, each
   amplifying B's captured trait but with distinct surface tunings.
2. **Via `--add-variant <name>` with a parent declared**: e.g.,
   `--add-variant B3` after B exists. The parent inferred from the
   slot name's letter prefix (`B3` → parent `B`). See `reference/add-variant.md`
   § Per-field inheritance rules for the inheritance chain.

Surface forks of role-differentiated variants follow the **same
≥ 2 surface-changes contract** as A1/A2/A3 — the per-pair
differentiation is surface-only (type-weight / type-scale / density
/ motion-energy / color-temperature / spacing-rhythm), with the
**captured trait being amplified held constant** across the fork.
Structural differentiation (section sequence / presence / IA
priority / layout strategy) is forbidden between B and its surface
forks B1/B2/B3 — the role IS the captured trait, and changing
structure changes the role.

The variant-convergence detector in `prototype/SKILL.md`
Discipline 10 reads the variant's parent slot: when comparing
B vs B3 (parent–child surface fork), it applies the verbatim-style
inverse rule (surface deltas required, structural deltas
forbidden); when comparing B vs C (sibling role-differentiated
variants), it applies the reimagined-style rule (structural deltas
required).

The cap on motion-energy and other amplified surface axes is the
parent role's cap — a B3 that amplifies motion-energy beyond B's
ceiling must declare a **cap override** in its DESIGN.json
extensions with a one-sentence rationale (e.g. *"B3 raises B's
motion choreography count from ≤ 3 to ≤ 5 to accommodate the loud-
register tuning of scroll cinema"*). The override must cite a
captured-source basis or it refuses; cap overrides without a
captured-source rationale produce surface drift instead of trait
amplification.

## Variant differentiation contract

Each pair of variants must differ by **≥ 2 substantive changes**
drawn from this set:

- section sequence (which sections appear in which order),
- section presence / absence (a section in one variant, not in another),
- layout strategy of a major section (e.g. hero is split-half vs.
  full-bleed-photo vs. type-led),
- IA priority (which audience leads the home — donor vs. recipient
  vs. volunteer for nonprofits; product vs. story for commerce).

Variants that fail the ≥ 2 changes test are rendered as the same
variant under different chrome — *"variants are barely different"*
is the published failure mode and is grounds for refusing render.
See § Failure mode below — when only 1–2 captured traits are
distinct enough to amplify, the agent surfaces this and proposes
1 or 2 variants rather than producing 3 weak ones.

## The C-cliff failure mode

When defining variant C+, the following definitions are
**render-refusal conditions**:

- *"Everything from B but more"* (B+more is not a direction).
- *"120pt+ display fonts"* (size-as-personality is not a captured
  trait).
- *"96px+ section padding everywhere"* (padding-as-personality is
  not a captured trait — and conflicts with the density floor in
  `intent-dimensions.md` § 4 anyway).
- *"Extreme airy"* / *"extreme dense"* / *"extreme [axis]"* — slider
  positions pushed past the prior variant are not directions.
- Editorial-register vocabulary (*atelier*, *the studio*,
  *mise-en-place*, *the journal*) when the brand register is
  product / commerce / direct-services. See
  `divergence-toolkit.md` § 1 → *Voice-rule moves* →
  `Editorial-register vocabulary applied to non-editorial brands`.

C+ must answer *"what if we leaned into Y?"* with a specific Y
from the captured surface, not a slider position pushed past B.

The fix for a C that reads as *"unprofessional"* rather than *"a
third proposition"* is not to soften C — it is to define C against
a captured trait instead of against B.

## Per-variant motion placement

**Per-variant placement (when N > 1 variants).** For
multi-variant runs, the `motion` block goes into the
variant-specific `DESIGN-<id>.json` files (see § Multi-variant
DESIGN files below), not into the site-level `DESIGN.json`.
Variants that should render static omit the block entirely;
variants that should engage cinematic motion declare a
`register`. This is what lets one variant (typically C) be
cinematic while siblings stay static — `prototype` Phase 2.4
reads `DESIGN-<id>.json.extensions.motion.register` per
variant and fires only where present.

## Multi-variant DESIGN files


When the user requested N variants (Phase 2.6 active), Phase 4
writes per-variant design files at the project root instead of a
single pair:

```
PRODUCT.md                  ← shared across variants (strategy doesn't change)
DESIGN-A.md / DESIGN-A.json ← variant A (faithful + improvements)
DESIGN-B.md / DESIGN-B.json ← variant B (one captured trait amplified)
DESIGN-C.md / DESIGN-C.json ← variant C (different captured trait amplified)
```

`PRODUCT.md` is shared because audience, register, and content
strategy are per-brand, not per-variant. Each variant's DESIGN
files inherit the shared `extensions.iaPriorities[]` audit from the
above step — variants cannot opt out of IA-priority preservation
within Mode A.

When the resolved mode is rebrand (`--rebrand` or rebrand-trigger
phrase), the multi-variant fork still writes per-variant DESIGN
files but PRODUCT.md may also vary — rebrand permits the strategy
to shift, not just the visual treatment.

## Failure mode: insufficient brand signal for N variants

When the captured brand surface has fewer than 3 distinct moves to
amplify (e.g., monochrome palette, single type face, no
distinctive motifs, or `signal-thin` per § Setup step 6), refuse
to render N ≥ 3 variants under Mode A. Surface honestly:
*"the captured surface has 2 distinct traits to amplify; producing
3 variants would force one to invent moves not present in the
brand."* Propose 1 or 2 variants and let the user choose, or
recommend extract with a wider crawl. Better one strong variant
than three weak ones.
