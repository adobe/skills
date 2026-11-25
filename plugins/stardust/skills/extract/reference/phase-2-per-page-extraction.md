# stardust:extract: phase 2, per-page extraction

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 2 — Per-page extraction

For each page in the cap-respecting list, render with Playwright
following `reference/playwright-recipe.md`. Captures run
**concurrently** per § Concurrency. The recipe is
mandatory per page — in particular, do not skip the wait, scroll, or
capture-list steps:

- Viewport 1440 × 900 @ 2× DPR
- Wait per the configured wait mode (default `medium`; see § Wait
  modes in `reference/playwright-recipe.md`)
- Disable animations via `prefers-reduced-motion: reduce`
- After the wait resolves, scroll to bottom in 4 viewport-height
  steps with 300 ms pauses, then return to top — this is required
  to trigger lazy-load and IntersectionObserver-driven content
- Record `waitMs` and `waitMode` in the per-page `_provenance`

Capture per page (full schema in `reference/current-state-schema.md`):

- Page metadata (title, meta description, OG tags, theme-color)
- Semantic structure: heading outline, landmark roles, sections
- **Hero headline + lede (resolved)** — `heroHeadline` / `heroLede`
  picked by font-size × hero-region with a junk/hidden-state filter and
  a clean meta-description fallback (per `reference/playwright-recipe.md`
  § Capture list 5-bis). Required for JS-rendered sites whose
  document-order headings surface modal / promo / count junk
  instead of the real tagline.
- Content: visible text per section (full innerText, **no
  truncation** per `reference/playwright-recipe.md` § Capture
  list 7), structured paragraphs (`body[]`), lists, FAQ Q/A
  pairs, and review/testimonial quotes per
  § Capture list 7-bis. Without these structured fields,
  every body region under a heading falls back to placeholder
  signature at migrate time.
- CTA labels and href targets, link inventory (internal vs external)
- Per-section computed style summary: dominant colors, font families
  in use, spacing rhythm, border-radius, shadows
- Media inventory: img with `currentSrc`/`srcset` captured **with
  query strings intact** plus a `resolves` flag (HEAD/GET with browser
  UA + Referer), intrinsic dimensions, inline SVG count, video/iframe
  presence, `cssBackgrounds[]` (including pseudo-element `::before`/
  `::after` walks per § Capture list 11) so `background-image`
  heroes and motifs do not silently disappear and 404ing CDN
  images are flagged before migrate ships `about:error`.
- Font files captured via network-intercept (per § Capture list
  16): every `woff2`/`woff`/`ttf`/`otf` response saved under
  `assets/fonts/` and recorded in `_brand-extraction.json#type.files[]`
  with licensing flag.
- Icon-font detection (per § Capture list 17): when the page
  uses `[class^="icon-"]` with non-default `::before`
  font-family + codepoint, capture the family, save the file,
  and record the `iconClass → codepoint` table in
  `_brand-extraction.json#iconFont`.
- Interactive elements: forms (with field types), buttons, modals
  detected by ARIA roles
- Full-page screenshot to `assets/screenshots/<slug>.png` —
  script-captured by the bundled crawler after the wait/scroll
  settle (viewport-only fallback on extremely tall pages; mode in
  `_signals.screenshotMode`, relative path in the page JSON
  `screenshot` field)

- **Dynamic surface (only with `--dynamics`)** — per-page reach
  signals: endpoints, third-party script hosts, forms, modal triggers,
  player ids, hydration hints, in the page JSON `dynamic` section and
  `_crawl-log.json#dynamicSurface` (schema in
  `reference/current-state-schema.md § Dynamic`). Evidence only; the
  stardust `dynamics` sub-skill probes archetypes in depth and decides.

Save to `stardust/current/pages/<slug>.json` with `_provenance` as the
first key. **The bundled crawler also saves the settled rendered DOM
verbatim as `stardust/current/pages/<slug>.html`** (`page.content()`
after the wait/scroll settle; path in the record's `renderedHtml`
field). Capture once, parse offline: every downstream importer or
sibling generator iterates its extraction against this artifact —
free, reproducible, and provenance — instead of re-running live
probes per selector guess (recorded: 4+ live round-trips per page
family before the switch). Live probes stay for what the static DOM
cannot answer: geometry and computed styles. Save referenced media to `stardust/current/assets/media/`
preserving basename plus a short content hash.
