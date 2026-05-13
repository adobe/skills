<!-- stardust:provenance
  writtenBy:        stardust:prototype/shape (fixture)
  writtenAt:        2026-05-13T15:00:00Z
  page:             beers
  variant:          C
  variantRole:      different captured trait amplified
  parentVariant:    A
  againstDirection: stardust/direction.md (Active 2026-05-12T20:15:00Z)
  consumedBy:       Discipline 10 validator (fixture — should REFUSE)
  stardustVersion:  0.5.0
-->
---
slug: beers
url: https://wasatchback.com/beers
register: brand
surprise: high
dominantDimension: composition/catalog-grid
---

# Page shape: beers (variant C) — composition-delta-trivial fixture

Worked example of a shape brief whose `compositionDelta` declares
only **token-level deltas**. This fixture **fails** Discipline 10
under `ia-fidelity: reimagined` and triggers an ideation restart.

## Sections (in render order)

1. **eyebrow-banner** (site-wide chrome)
2. **header** (site-wide chrome)
3. **catalog-grid** — 6 product entries in a 3-up grid
4. **footer** (site-wide chrome)

## CompositionDelta — pairwise token-only deltas

```yaml
_provenance.compositionDelta_vs_A:
  - "color: A uses teal accent #1c8a7a; C uses warmer teal #1a8870"
  - "font-weight: A uses 600 on headlines; C uses 700"
  - "spacing-rhythm: A uses 32px section gap; C uses 40px"

_provenance.compositionDelta_vs_B:
  - "color: B uses orange accent #e8b830; C uses warmer teal #1a8870"
  - "motion-energy: B has 240ms hover; C has 320ms hover"
```

## Why this fails Discipline 10

All deltas in both pairs are **surface-only** (token-level):
color hex tweaks, font-weight bumps, spacing changes, motion-
energy adjustments. None of them are structural (composition,
sequence, presence, layout-strategy, page-rhythm, type-scale,
ia-priority).

The validator classifies each delta's leading token:

| Delta | Classification |
|---|---|
| `color: A uses teal accent ...` | surface (color) |
| `font-weight: A uses 600 ...` | surface (font-weight) |
| `spacing-rhythm: A uses 32px ...` | surface (spacing-rhythm) |
| `color: B uses orange ...` | surface (color) |
| `motion-energy: B has 240ms ...` | surface (motion-energy) |

Under `ia-fidelity: reimagined`, the validator requires
**≥ 2 structural deltas per pair**. This fixture has 0
structural deltas on pair (A, C) and 0 on pair (B, C).

The validator refuses with:

> Discipline 10 failure: variant C declares trivial compositionDelta —
> token-level only against both siblings. Variant convergence detected
> (per `notes/variant-convergence.md`); the variant is a token reskin
> of variant A. Restart ideation:
> - amplify a different captured trait than B (currently both
>   variants amplify the same composition)
> - declare structural moves (substrate / section / layout / IA
>   priority / page-rhythm / type-scale) against the captured cliché
> - re-author the brief with `compositionDelta` blocks carrying
>   ≥ 2 structural deltas per pair

## How this fixture is used

The Discipline 10 validator's test suite runs this fixture
expecting **refusal**:

```javascript
const result = validateDiscipline10(briefs);
assert.equal(result.status, "refused");
assert.match(result.reason, /trivial compositionDelta/);
```

The good fixture (`composition-delta-good.md`) is the **accept**
case in the same suite.

## Note for verbatim mode

Under `ia-fidelity: verbatim`, this fixture's surface-only deltas
would PASS Discipline 10's inverse contract (A1/A2/A3 must
differ on surface axes only). The validator inverts:

- `reimagined` → structural ≥ 2, surface-only fails
- `verbatim` → surface ≥ 2, structural fails

This file is named `composition-delta-trivial.md` because the
deltas are trivial *for the reimagined contract* — they are also
the canonical good form for the verbatim contract. The
`verbatim` test fixture would re-use the same delta block,
re-stamped as `A2` / `A3` against `A1`.
