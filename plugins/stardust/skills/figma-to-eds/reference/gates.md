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
- **Consumption** (`scripts/token-literals.mjs`): lists every literal
  in `blocks/**/*.css` whose value equals a token — the
  hardcoded-hex-that-happens-to-match defect, which renders identically
  today and drifts when the token changes. Colors, durations and whole
  shadow/easing values by default; px lengths are opt-in (`--lengths`)
  because a spacing scale covering every multiple of 4 turns most px
  matches into coincidence. A justified literal carries
  `/* token-literal-ok: <reason> */` on its line (e.g. a shadow token
  restated inside `filter: drop-shadow()`, where the token's
  `box-shadow` syntax cannot be used).

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
- Text raster is a rendering choice, not only noise: Chromium's
  default subpixel antialiasing draws text heavier than Figma's
  renderer. Applying `-webkit-font-smoothing: antialiased` globally
  measured 25 gates better / 0 worse on the reference run — declare it
  as a normalization in `donor-tokens.json`, never per gate.
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

Hand-written fixtures also miss what the authoring pipeline does to
markup. Content authored in DA and served from the preview origin
differs from a fixture's ideal HTML; on one fully green run, re-gating
the footer on the preview origin found it 16px short, from two such
differences:
- `:icon:` references are delivered as `span.icon`, and `decorateIcon`
  (aem.js) puts the SVG inside it — the boilerplate's 24px `.icon` box
  then sizes a logo the fixture rendered as a bare `<img>`;
- the DA editor wraps a cell's image in a `<p>`, which brings its own
  margins and height into layouts written for a bare `<picture>`.

Write fixtures in the delivered shape (icon spans, `<p>`-wrapped
images), not the ideal one.

So the last gate round runs on the **preview origin** (`*.aem.page`)
against DA-authored documents, not on the local fixture: re-run the
geometry and pixel gates with `page` pointed at the preview URL, or at
least load every gated block there and compare it with the fixture
render. A block passes only when both agree.

### Accessibility vs a kit mandate

A kit can mandate something that conflicts with accessibility on real
pages — e.g. a heading *style* prescribed for sub-headings that, on a
real page, would skip an outline level. Do not resolve it silently in
either direction: a well-meant fix that changes the mandated rendering
fails the gates (as it should), and leaving it unrecorded ships the
problem. Record it as a `conflict` row with both sides, and take it to
the design owner (e.g. bless the semantically correct element with the
mandated style).

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
| class | `mandated` (node id present) / `unmandated` (defect — fix or escalate) / `out-of-kit` (no Figma counterpart exists; resolution recorded) / `conflict` (two contracts disagree, e.g. byte-exact authored content vs a kit glyph, or a11y vs a kit mandate — escalated with both sides) / `pre-existing` (present on the live site too; not a reskin delta) |

The register's pass condition: zero `unmandated` rows. This is what
makes "the new site differs from production" auditable — every
difference has a design-system citation or it's a bug.

### Divergence viewer

The register is the record; `scripts/divergence-viewer.mjs` is how a
stakeholder reads it. Per page it captures live and new at one width,
pixel-diffs them, clusters the differences into numbered regions, and
joins each region with an authored attribution (`annotations.json`,
one entry per register row: box, class, title, detail, Figma node). It
writes a self-contained `viewer.html`: both screenshots side by side
with region overlays, plus a card per region with its class and a link
to the mandating Figma node.

Regions are found mechanically; attributions are authored. A region
without one renders as `unreviewed`, and the script exits 1 while any
region is `unreviewed` or `unmandated` — the viewer cannot make an
unexplained difference look explained. Build one per archetype; the
set is the evidence that a page differs from production only where
the kit says so.
