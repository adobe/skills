<!-- stardust:provenance
  writtenBy:        stardust:prototype/shape (fixture)
  writtenAt:        2026-05-13T15:00:00Z
  page:             beers
  variant:          C
  variantRole:      different captured trait amplified
  parentVariant:    A
  againstDirection: stardust/direction.md (Active 2026-05-12T20:15:00Z)
  consumedBy:       Discipline 10 validator (fixture)
  readArtifacts:
    - stardust/current/pages/shop.json
    - DESIGN.md, DESIGN.json
    - stardust/direction.md
  stardustVersion:  0.5.0
-->
---
slug: beers
url: https://wasatchback.com/beers
register: brand
surprise: high
dominantDimension: ground-family/label-substrate-zine
---

# Page shape: beers (variant C) — composition-delta-good fixture

Worked example of a shape brief whose `compositionDelta` blocks
declare **≥ 2 structural changes per pair** against both siblings.
This fixture passes Discipline 10 (variant-convergence detector)
under `ia-fidelity: reimagined`.

## Sections (in render order)

1. **eyebrow-banner** (site-wide chrome)
2. **header** (site-wide chrome)
3. **page-hero** — direction-authorized type-led intro
4. **catalog-color-block × 6** — per-SKU color-keyed zine spreads
5. **catalog-closer-on-black** — return to brand-black anchor
6. **footer** (site-wide chrome)

## CompositionDelta — pairwise structural deltas

```yaml
_provenance.compositionDelta_vs_A:
  - "substrate-strategy: A is single black across all; C uses 6 distinct per-section substrates (one per beer's label color)"
  - "section-presence: C drops filter-chip-row (substrate sequence IS the navigation cue); also drops SEASONAL divider"
  - "photo-treatment: A photo at 35% column with hairline thumbnail; C photo full-bleed-within-section as label-art-foreground"
  - "section-order: A hero → filter → list → closer; C hero → 6 color blocks → closer-on-black (return to ground)"
  - "section-completeness: A entries are content blocks on shared ground; C entries are their own visual environments (each block IS its own zine spread)"

_provenance.compositionDelta_vs_B:
  - "substrate: B is uniform black; C is per-block per-substrate"
  - "photo-role: B is small 180px framed thumbnail; C is full-bleed within section column"
  - "page-rhythm: B is typographic parade (names at clamp(5rem, 12vw, 8rem)); C is zine color-spread (names at clamp(3.5rem, 8vw, 6rem); the substrate carries impact, not size)"
  - "type-scale on name: B bigger (clamp 5-8rem); C smaller (clamp 3.5-6rem) — different captured-trait amplification (photography wallpaper-color vs names-as-design)"
```

## Why this passes Discipline 10

Pair `(A, C)` has 5 structural deltas — substrate-strategy,
section-presence, photo-treatment, section-order, section-
completeness. The minimum is 2.

Pair `(B, C)` has 4 structural deltas — substrate, photo-role,
page-rhythm, type-scale. The minimum is 2.

All deltas are **structural** (composition, sequence, presence,
layout-strategy, page-rhythm) rather than **token-level**
(*"variant uses a different teal"*, *"variant uses font weight
600 vs 400"*). Token-only deltas would fail the validator with
*"trivial compositionDelta — token-level only; ideation restart
required."*

Each variant has a **distinct `dominantDimension`**:

- A: `composition/catalog-grid` (template-shaped, faithful)
- B: `typography/name-as-display` (vernacular-naming amplified)
- C: `ground-family/label-substrate-zine` (label-color-as-design
  amplified)

The three dimensions are non-overlapping; no variant re-uses
another's dimension.

## How Discipline 10 reads this

The validator runs pairwise on the brief set
`{A-shape.md, B-shape.md, C-shape.md}`. For each pair, it:

1. Reads `_provenance.compositionDelta_vs_<sibling>[]`.
2. Filters deltas to **structural** changes (regex-classifies
   each delta's leading token: `substrate*`, `section-*`,
   `photo-*`, `layout*`, `ia-priority*`, `page-rhythm*`,
   `type-scale*` count as structural; pure `color`, `font-weight`,
   `font-family`, `motion-energy`, `spacing-rhythm` count as
   surface-only).
3. Requires `≥ 2` structural deltas under
   `ia-fidelity: reimagined`; rejects when the count drops below.

This fixture's vs-A pair has 5 structural deltas; vs-B has 4.
Both clear the floor.
