# Pixel-parity verification harness

After `stardust:aem-import` Phase 5 (deploy), Phase 6 (verify) runs
Playwright comparisons between the EDS preview URL and the source
prototype. This document captures the harness, known limitations,
and how to interpret results.

## Harness shape

For each `(eds_url, proto_path)` pair:

1. Launch Playwright at viewport 1440x900, deviceScaleFactor 2.
2. Disable Lenis on the prototype (the smooth-scroll runtime
   intercepts `window.scrollTo` and makes scroll-position-based
   captures unreliable).
3. Pre-warm lazy-loads via auto-scroll-down then scroll-back-to-top.
4. Full-page screenshot of both.
5. Compute page-height delta. Refuse to declare success if delta > 5%.
6. Compute per-section bounding-box deltas (using consistent CSS
   selectors). Flag any section with > 10% height/width diff for
   manual review.
7. Pixel-diff comparison (e.g., pixelmatch) on aligned regions. Flag
   regions with > 1% non-matching pixels.
8. Open both URLs in the user's default browser for visual review.

## Critical limitation: prototype's CSS `background-image` doesn't render in Playwright

When the prototype uses `<div class="photo-card__bg">` styled with
`background-image: url(...)` in CSS (rather than `<img>` elements),
Playwright's headless rendering reliably FAILS to load those
background images. The cards take their layout space (aspect-ratio
preserved) but render as empty boxes in the screenshot.

This is true for both `headless: true` and `headless: false` (in our
tests). It's true for `file://` URLs (suspected CORS or local-file
loading quirk) AND for `http://` URLs served from a local HTTP server
in our tests. The exact cause is unclear; possibly a Playwright
configuration / timing issue with CSS background-image fetch timing.

**Implication for the verification harness:** if the prototype uses
CSS background-images extensively (most stardust prototypes do —
hero, photo cards), the prototype side of the comparison will be
incomplete in Playwright captures. The harness should:

1. **Always open both URLs in the user's default browser at the end**.
   The user's visual gut-check is the final authority.
2. **Compare DOM structures + computed styles**, not pixels, where
   bg-images are involved. A DOM diff + computed-style spot-check is
   robust to the bg-image rendering issue.
3. **Pixel-diff only on aligned non-image regions** (text, buttons,
   layout structure). Skip pixel-diff on photo-card grids and
   hero background.
4. **Flag the limitation** in the verification log so the user knows
   what was and wasn't pixel-compared.

## Known acceptable diffs (warn, don't fail)

The verification harness should warn-but-not-fail on:

- **Image aspects/crops differ by < 5%** — DA's media bus optimizes
  images differently than the prototype's raw images. Different
  srcsets, different format negotiation, different aspect-ratio
  cropping. Acceptable for production.
- **Motion-only diffs** — animation states, scroll-reveal opacities,
  marquee positions. Acceptable when motion isn't ported.
- **Wrapping diffs of < 1 line** in text blocks — small font/spacing
  delta between EDS pipeline and prototype CSS. Acceptable.
- **Image-text gap padding differs by < 10px** — section padding
  conventions differ. Acceptable.

The catalogue lives in `known-diffs.md`. The harness should compare
each flagged diff against the catalogue before failing.

## Page-height delta interpretation

| Delta | Interpretation | Action |
|---|---|---|
| 0–2% | Pixel-parity practical | Pass |
| 2–5% | Acceptable variation | Pass with note |
| 5–10% | Structural issue | Warn, investigate per-section |
| > 10% | Real structural difference | Fail, re-investigate mapping |

For the Wheeler reference engagement: CVA test EDS 5398 vs proto
5405 (0.1%). Service test EDS 5440 vs proto 5592 (2.7%). Both pass
the 5% threshold.

## Per-section bounding-box delta

For each `<section>` in both pages, compute:
- top y-coordinate (where section starts)
- height
- width (should be identical at 1440px viewport)

Flag any section with > 50px height diff or > 30px y-position drift
relative to the cumulative offset.

Common causes:
- Hero `min-height` mismatch (fixable in theme CSS)
- Text container `max-width` mismatch (fixable)
- Card grid card sizes (aspect-ratio mismatches)
- Padding/margin between sections (fixable)

## Verification log

Per page, the harness should emit:

```
stardust/aem-import-log/<slug>-verification.md

# Verification: <slug> (eds vs proto)

- EDS URL: https://main--<repo>--<owner>.aem.page/<slug>
- Proto: stardust/prototypes/<slug>-proposed.html
- Page heights: eds=<eds_h>px, proto=<proto_h>px (delta <pct>%)

## Per-section deltas
[table]

## Diffs flagged (against known-diffs.md)
[list]

## Diffs unflagged (NEW; need triage)
[list]

## Manual verification
[checklist of what to verify visually in browser]
```

The log gets committed to the project so subsequent runs have a
baseline.

## Re-running verification

`stardust:aem-import --slug <slug> --verify-only` re-runs Phase 6
without regenerating artifacts. Useful after a manual fix or after
a code-bus deploy to catch newly-resolved diffs.
