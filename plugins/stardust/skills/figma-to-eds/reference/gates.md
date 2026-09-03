# Gates — design fidelity against Figma

Three gates, run in order, artifacts under `stardust/figma-to-eds/gates/`.
The design gate target is **Figma**; any pre-existing live site is
explicitly NOT a gate surface (its role is the divergence register).

## 1. Token probe (`gates/token-probe.json`)

For each token in `donor-tokens.json`: render a probe page (or the
real blocks) headlessly, read computed styles, assert **byte
equality** after the declared normalization ledger (e.g. hex→rgb()
serialization by the browser is a declared normalization with an
executable converter; `130%` line-height captured → computed unitless
is declared, not discovered). A failed probe is a defect in the
stylesheet, never a reason to loosen the ledger mid-run.

Two probe classes:

- **Existence + value**: the custom property is defined on `:root`
  with the exact value.
- **Consumption**: sampled block elements resolve to token values —
  catches the hardcoded-hex-that-happens-to-match defect when the
  token later changes.

## 2. Component gate matrix (`gates/components/<module-slug>/`)

One gate frame proves one cell. A module passes gate 2 only when its
**gate matrix** passes: one row per variant × breakpoint the kit
documents (the variant axes captured during enumeration ARE the matrix
definition). Two complementary instruments cover the matrix:

- **Geometry gate** (`scripts/geometry-gate.mjs`) — every variant,
  including transparent frames where pixel diffing is impossible.
  Figma metadata gives exact x/y/w/h per node; the gate renders each
  case at its design viewport and asserts rendered boxes against kit
  geometry. Rules learned in validation:
  - Kit-absolute coordinates BELOW a text block embed the kit
    renderer's line count, which the browser may not reproduce
    (cross-engine metrics drop/add a wrap line at narrow widths).
    Assert the inter-element **gap** instead (`gapFrom`) — the gap is
    the kit invariant; the absolute top is not.
  - Text-block heights get a declared line-box tolerance
    (browser fractional line boxes vs Figma's floored ones); text-run
    widths (e.g. a button label) get a declared text-metric tolerance.
    Pure geometry (paddings, columns, offsets, fixed heights) stays ±1.
- **Pixel diff** (`scripts/component-diff.mjs`) — the default variant
  plus every opaque themed usage board (dark/facet/tinted). Frames
  whose canvas is transparent render as a baked checkerboard through
  the MCP and can NEVER be pixel-gated — re-pin to an opaque usage
  instance (record the re-pin) or rely on the geometry gate.

### Reproducibility and sweeps

Every pixel verdict records its full invocation (page, selector,
design width, crop, thresholds) — a gate that can't be blindly re-run
is not a gate. `scripts/run-all-gates.mjs` re-runs every module's
geometry spec and every recorded pixel gate and prints a summary
table; run it before and after ANY shared-layer change (styles.css,
token regeneration, atom promotion) and diff the summaries. Gate
fixtures must hide chrome that races into screenshots (e.g. consent
banners: `<style>.consent-banner{display:none}</style>`).

### Threshold discipline (validated classes)

Declared per gate, cause named, never loosened to pass:
- ~3% — light-ground text modules (AA + cross-engine wrap + line-box).
- ~3.5% — inverted (light-on-dark) text: heavier AA, same profile.
- ~4% — grounds using baked raster artwork (JPEG noise adds a band).
- Above that only with quantified evidence (e.g. per-segment
  diagnostics or ink-adjacency percentages stored next to the verdict)
  proving zero unattributed regions. Text-dense narrow frames at
  export scale may be pixel-ungateable — store the diagnostics,
  exclude, and cover with geometry (never silently).

### Real-content check

Gate fixtures use kit specimen content and can miss authored-content
shapes. After a block gates green, render real migrated pages through
it (the divergence-register pass doubles as this) — single-cell rows,
legacy markup shapes, and bare-`<strong>` patterns have all produced
real fixes that fixtures never would.

### Pixel diff mechanics

Per mapped module:

1. Export the gate frame from Figma (`get_screenshot` on the frame id
   pinned in `mapping.md`).
2. Render the EDS block with equivalent placeholder content at the
   frame's width; screenshot.
3. Pixel-diff. Store `figma.png`, `eds.png`, `diff.png`, and a
   verdict row (pass / fail / pass-with-tolerances).

Tolerances are **declared per gate, in writing**: font rasterization
and anti-aliasing differ between Figma's renderer and the browser, so
a small residual is expected — but each tolerance names what it
excuses (e.g. "text raster noise ≤N% in text bounding boxes").
Geometry (spacing, sizes, radii, alignment) gets no tolerance: those
are token-derived and must be exact.

Content in gate renders is placeholder-but-shaped: same element
kinds, realistic lengths. The gate tests the surface, not the copy —
copy is the upstream content gate's job.

## 3. Divergence attribution (`gates/divergence-register.md`)

Only when an existing live site predates the reskin. For each visual
delta between the live site and the new build, one register row:

| field | rule |
|---|---|
| where | page/block + viewport |
| delta | one sentence, observable |
| mandate | the Figma node id that requires the new appearance |
| class | `mandated` (node id present) / `unmandated` (defect — fix or escalate) / `out-of-kit` (no Figma counterpart exists; resolution recorded) |

The register's pass condition: zero `unmandated` rows. This is what
makes "the new site differs from production" auditable — every
difference has a design-system citation or it's a bug.
