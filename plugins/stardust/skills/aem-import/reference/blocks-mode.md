# Blocks mode

Default mode of `stardust:aem-import`. The page is authored in DA as
standard EDS block tables (`hero`, `text`, `cards`, `columns`, etc.)
with per-block variants for visual differentiation. A per-theme
stylesheet at `styles/<theme>.css` styles the generic blocks to match
the prototype's visual treatment.

## When it wins

- **Authorability.** Each block is a standard EDS block. Authors edit
  content in DA tables without touching code. New page = new content,
  same theme.
- **Theme reuse.** One `styles/<theme>.css` covers every page in the
  same brand. Adding a new wheelercat-brand page = ~20 lines of new
  CSS variants at most (often zero — if all components are already in
  the theme).
- **Production migration.** Long-tail content pages with similar
  structures benefit most. Pixel parity at ~95% is a small
  trade-off for full authorability.

## When it loses

- **Pixel-exact pitch artifacts.** When the customer review condition
  is "every wrap exactly matches," the 5% ceiling shows. Use overlay
  mode instead.
- **Per-page bespoke visuals.** If every page has a unique structure,
  the theme CSS doesn't reuse — each page becomes its own ~hundred
  lines of CSS. Overlay mode is shorter per page in this case.
- **Custom mid-page typography effects** (mid-line color accents in
  one element, custom placeholder visuals tied to specific aspect
  ratios). See `conventions.md` for the workarounds; some don't
  translate cleanly to standard EDS authoring shapes.

## Block vocabulary

Default block types the skill maps prototype sections to. Each can
take variant classes for visual differentiation. See
`conventions.md` § Per-block CSS patterns for the per-block CSS
templates.

| Block | Variants in the reference theme | Use for |
|---|---|---|
| `hero` | (default), `service` | First-paint hero with photo bg + headline + CTA |
| `text` | (default), `centered` | Plain prose section: eyebrow + h2 + body |
| `cards` | `tiers` (pricing-style with elevated flagship), `rail` (5-up small cards on dark), `photos.seven`, `photos.three`, `photos.two` (photo-card grids with N columns) | Card grids of various flavors |
| `columns` | (default — image-right), `alternate` (single-row image-left OR multi-row alternation) | Image-text pairs and image-text alternation |
| `cta-bar` | (default — split layout, h2 + buttons), `stacked` (h2 + body + buttons vertical) | Dark CTA bands |
| `breadcrumb` | — | Home › Section › Current Page chrome |

## Adding new variants

When a new prototype introduces a component pattern that isn't in the
theme yet:

1. **Define the variant class.** Prefer composing classes
   (`.cards.testimonials`) over inventing new top-level blocks. The
   variant adds ~30 lines of CSS targeting the standard EDS block
   structure.
2. **Author the DA content with the variant.** The block class becomes
   `<div class="cards testimonials">`. DA preserves space-separated
   variants on the top-level block div.
3. **Document the variant** in the theme's CSS file with a comment.

If the new pattern needs custom decoration JavaScript (e.g., a
carousel with state), it's no longer "generic block + theme CSS" —
it's a full custom block at `blocks/<name>/<name>.{js,css}`. Use
`stardust-to-snowflake` instead, or hand-author the block.

## Pixel-parity ceiling discussion

The block-flavor approach has a real ~95-98% ceiling per page. The
missing percentage comes from:

- **DA's image pipeline (~2%)** — different srcsets / formats /
  aspect ratios than the prototype's raw images. Acceptable for
  production; flagged for pitches.
- **Absence of motion (~1%)** — Lenis smooth scroll, scroll-reveal,
  marquees aren't ported. Explicit choice. Can be added with per-theme
  motion JS but isn't standard.
- **Specific prototype patterns that don't map (~2-3%)** —
  - Mid-line color accent in a single `<h1>` (requires two `<h1>`s)
  - Custom placeholder visuals tied to specific aspect ratios
    (column image-cells without pictures render as small dashed-yellow
    boxes, not full-aspect placeholder photos)
  - Icons inside buttons (decorateButton collision; works via
    `em > a` direct selectors but loses the standard `.button.X` class
    semantics)

This ceiling is per-page; it doesn't compound across pages.

## Cross-mode comparison

| | blocks | overlay |
|---|---|---|
| Pixel parity ceiling | ~95% | ~100% |
| Author experience | Standard EDS blocks, full DA authoring | Slot-shaped, less restructure |
| Per-page code | One DA file + (sometimes) one new CSS variant | One template HTML + one DA file |
| Theme reuse | High (one CSS covers many pages) | Lower (template per page archetype) |
| New page in same brand | Author DA, possibly add 1 variant | Author template + slot map + DA |

The two modes can coexist in the same EDS project — see SKILL.md §
Hybrid for the pattern of mixing per-page.
