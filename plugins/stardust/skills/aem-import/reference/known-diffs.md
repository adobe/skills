# Known acceptable diffs

The verification harness in Phase 6 compares the EDS preview against
the source prototype. This catalogue lists diffs that recur across
projects and should warn-but-not-fail (already known, not actionable
at the per-page level).

## Image pipeline diffs

### DA media bus image processing

DA's media bus optimizes images differently than the prototype's raw
images:
- Generates srcset with multiple sizes (`?width=2000&format=webply`)
- Converts to webp where appropriate
- Applies its own aspect-ratio cropping logic based on intrinsic
  dimensions

The rendered `<img>` may have slightly different dimensions or crop
boundaries than the prototype.

**Acceptable when:** the image is recognizably the same (subject,
composition, framing) within ±5% bounding-box delta.

**Investigate when:** the image is missing or appears as the
broken-image character — that's `about:error` from a failed media-bus
fetch (see `conventions.md` §5).

### Hero photo: cell-positioned img vs CSS background-image

Prototype heroes use `background-image` on the `.hero` element. EDS
heroes get a `<picture><img>` cell positioned absolutely behind text.
The image is the same; positioning + crop may differ slightly.

**Acceptable when:** subject is fully visible and not awkwardly cropped.

## Motion diffs

### Lenis smooth-scroll absent

Prototypes that ship with Lenis (`lenis.min.js` + canonical motion
runtime) won't have smooth scrolling on the EDS render unless motion
is explicitly ported (out of scope for `aem-import`).

**Acceptable when:** the user is fine with native browser scroll.

**Investigate when:** scroll-snap, scroll-driven animations, or
section transitions are critical to the design intent. In that case,
port the prototype's motion module to `scripts/<theme>-motion.js`
loaded conditionally for this template.

### Scroll-reveal opacities

Prototypes with `data-anim` reveal-on-scroll won't fire on the EDS
render. Elements stay opacity:1 from initial paint.

**Acceptable** — usually a minor delight nudge.

### Hero load-only fade-in

Prototype hero may have a 800ms fade-in animation on initial load.
EDS render starts visible.

**Acceptable.**

## Typography diffs

### Wrapping of < 1 line

Small differences in spacing/leading can cause text to wrap
differently by one line. E.g., a headline that wraps to 3 lines in
prototype may wrap to 4 lines in EDS (or vice versa).

**Acceptable when:** the content is fully readable and the layout
isn't broken.

**Investigate when:** the wrap is bad (orphan word on a line, etc.)
or it cascades to push other content out of frame.

### Image-text gap padding (±10px)

Section padding conventions differ slightly between the prototype's
`.image-text-band` spacing and EDS's `.columns.alternate` spacing.

**Acceptable.**

## Layout diffs

### Sticky header

Prototype has `position: sticky` on the header. EDS chrome may or may
not (depending on the project's chrome fragments). The visual
difference is only apparent at scroll positions other than 0.

**Acceptable.**

### Page height delta < 5%

Total page heights typically differ by 0-3%. Anything within 5% is
fine.

## Authored content diffs

### Placeholder rendering style

When the prototype shows `[data-placeholder="true"]` boxes (dashed
yellow + monospace eyebrow + italic example), the EDS render uses
the `<code>` + `<br>` + `<em>` pattern to express the same. The
final visual is similar but not pixel-identical (font metrics differ
between monospace fonts).

**Acceptable.**

### Self-service image cell as text-placeholder

When a `.columns` block has no image (image cell is text or empty),
the prototype may render a full-aspect placeholder box; the EDS
render shows a smaller inline-block placeholder.

**Acceptable as a known limitation** — to match the full-aspect
placeholder, generate a placeholder SVG and reference it as a
proper `<picture>`.

## What ISN'T in the catalogue

Anything not listed here should be flagged as a NEW diff for triage.
The verification harness should:
1. Compare each observed diff against this catalogue
2. Warn on matches (logged but doesn't fail verification)
3. Fail on non-matches with a clear "investigate" prompt

If a new diff is judged acceptable, append it here so subsequent runs
don't re-flag it.

## Per-project additions

Projects may have additional acceptable diffs specific to their
brand or pipeline. Append in a `## Project-specific (<brand>)`
section at the bottom of this file.
