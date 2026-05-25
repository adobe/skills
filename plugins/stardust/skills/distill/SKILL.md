---
name: distill
description: Analyze a set of design samples (HTML mockups + website URLs) and produce a structured style guide that anchors the rest of the stardust redesign pipeline. Use when the user supplies reference designs ("design samples", "mockups", "inspiration sites", "style references") and wants to extract a consistent visual language — type system, color palette, spacing, motion, and reusable component patterns — before redesigning a target site. Triggers on phrases like "distill these samples", "extract a style guide from these examples", "use these as design references", or "analyze these mockups". Outputs a `trait-matrix.json` (structured per-sample + cross-sample design tokens) and a `SAMPLES.md` narrative brief that `stardust:direct` reads under Mode B (anchor-reference precedence) when picking a redesign direction.
license: Apache-2.0
---

# stardust:distill

Read a directory of user-provided design samples — static HTML files
the user has placed under `samples/static/`, plus a `samples/live/urls.json`
manifest of live URLs to fetch — and produce two artifacts that anchor
the rest of the stardust pipeline:

1. `samples/trait-matrix.json` — structured per-sample + cross-sample
   trait data (type system, color, spacing, motion, component
   patterns, voice, assets).
2. `samples/SAMPLES.md` — a narrative vocabulary brief, the file
   `stardust:direct` reads under Mode B as the resolved anchor set.

This skill is **descriptive and pre-extract**. It does not crawl an
origin (that is extract's job). It does not invent design opinions
(that is direct's job). It produces the brief the user hands to direct
as Mode B anchor references when they want stardust to follow a
specific visual language — captured from samples — instead of rolling
the divergence seed cold.

Distill is optional. Users who do not have samples skip straight to
extract. Distill becomes load-bearing when the user has been
instructed by a brand team, a designer, or an art director to honor
specific reference material that is *not* the existing site (the
common case: a refresh whose visual direction has been pre-set by
design leadership and arrives as a folder of HTML + screenshots).

## Inputs

- `<samples-dir>` — optional positional. Defaults to `samples/`.
- `--from-static` — distill only static samples; skip live fetching.
  Use when no live URLs are listed or when the user wants to defer
  the live pass.
- `--from-live` — distill only live samples; skip static parsing.
  Use when the static pass has already run and only live snapshots
  need refreshing.
- `--cap <N>` — cap live URLs to fetch (default 8). Matches extract's
  small-sample philosophy: 8 reference URLs is enough to triangulate
  a visual language without burning budget on near-duplicates.
- `--refresh` — re-fetch and re-parse every sample even if cached
  snapshots exist under `samples/live/snapshots/`. Default behaviour
  is to reuse cached snapshots and only fetch URLs that are missing.

## Setup

Run the master skill's setup procedure first
(`skills/stardust/SKILL.md` § Setup): impeccable dep check, context
loader, state read.

Additional checks for this sub-command:

1. **Playwright availability** — same dep check as extract. The live
   pass needs a real browser. Detect Playwright in this order: a
   Playwright MCP server, then `npx playwright`. If neither is
   available and `--from-static` was not passed, stop and tell the
   user how to install Playwright.
2. **Samples directory structure** — verify the input dir exists and
   contains at least one of: `static/<sample>/`, `live/urls.json`.
   If neither, stop and explain the expected layout:
   ```
   samples/
     static/
       <sample-1>/
         index.html         (or any .html file)
         assets/            (optional; reused if present)
       <sample-2>/
         ...
     live/
       urls.json            (array of { url, slug?, role? } objects)
   ```
3. **State precedence** — if `stardust/state.json` already records a
   `samples.distilledAt` timestamp and `--refresh` was not passed,
   ask whether the user wants to re-distill (overwriting) or skip.
   Distill is idempotent; re-running it overwrites the prior brief
   and trait matrix.

## Procedure

### Phase 1 — Inventory the static samples

For each subdirectory of `samples/static/`:

1. Identify the entry HTML file (`index.html` if present, otherwise
   the largest `.html` file by size).
2. Read the file and its referenced stylesheets (inline `<style>` +
   linked `<link rel="stylesheet">` resolved relative to the sample
   dir, both `samples/static/<sample>/...` and any sibling
   `assets/` directory).
3. If a screenshot or PDF lives in the sample dir, note its path —
   reviewers may want to compare against the parsed traits.
4. Record an entry in the in-memory inventory:
   `{ slug, kind: "static", entryHtml, stylesheets[], screenshot?,
   role? }`. The role (if any) is inferred from the directory name
   (`bizpro-hub-prototype` → `business`; `plan-page` →
   `pricing`; etc.) — store the inference, surface to user for
   correction.

### Phase 2 — Fetch the live samples

If `live/urls.json` exists and `--from-static` was not passed:

1. Read the manifest. Each entry: `{ url, slug?, role? }`. Auto-
   generate `slug` from the URL hostname + path if missing.
2. For each URL (capped per `--cap`):
   - Check cache: if `live/snapshots/<slug>.html` + `.png` exist and
     `--refresh` was not passed, skip the fetch and use the cached
     pair.
   - Otherwise, render with Playwright following `extract`'s
     `playwright-recipe.md`: viewport 1440 × 900 @ 2× DPR, wait
     mode `medium`, reduced motion, scroll-to-bottom pass, capture
     the full DOM + a full-page screenshot.
   - Save:
     - `live/snapshots/<slug>.html` (rendered DOM)
     - `live/snapshots/<slug>.png` (full-page screenshot)
     - `live/snapshots/<slug>.log` (one-line provenance:
       `{ url, fetchedAt, waitMs, status }`)
3. Record an entry in the inventory:
   `{ slug, kind: "live", url, snapshotHtml, snapshotPng,
   snapshotLog, role? }`.

### Phase 3 — Per-sample trait extraction

For each entry in the inventory, parse the HTML + computed styles
(use a headless browser pass with `getComputedStyle()` on representative
elements — same technique as extract's per-section style summary).
Extract per-sample:

- **Type system** — every named CSS variable matching
  `--*font-*`, `--*type-*`, plus computed style on every heading,
  body paragraph, button, eyebrow, link. Aggregate into
  `{ headingFamily, bodyFamily, labelFamily, weights[], scale: {
  title-1, title-2, ..., body-lg, body-sm, eyebrow, label },
  rules[] }`. Detect modular scale per `extract/reference/brand-surface.md`
  § Modular-scale audit.
- **Color** — every named CSS variable matching `--*color-*`,
  `--*bg-*`, `--*surface-*`, `--*text-*`, plus computed background-
  color and color on representative elements. Aggregate into
  `{ palette: { neutrals[], brand: {}, surfaces: {} },
  reservations: [{ color, reservedFor[] }], rules[] }`. The
  `reservedFor` list is inferred from class names + CSS selectors
  (e.g., `.brand-mnemonic` ⇒ `reservedFor: ["brand-mnemonic"]`).
- **Spacing** — every named CSS variable matching `--*space-*`,
  `--*spacing-*`, `--*pad-*`, `--*gap-*`. Detect density tier
  (compact / balanced / packed) by clustering section padding
  values per `intent-dimensions.md` § 4.
- **Radius / shadow / motion tokens** — every named CSS variable
  matching `--*radius-*`, `--*shadow-*`, `--*ease-*`, `--*duration-*`,
  `--*motion-*`.
- **Motion stack** — detect loaded libraries via `<script src=>`
  inspection: GSAP, ScrollTrigger, Lenis, Locomotive, Three.js,
  Splide, Swiper. Pin versions where readable from the URL. Detect
  CSS-only motion patterns by scanning for `animation-timeline:`,
  `@keyframes`, `transition:`. Record:
  ```
  {
    libraries: [{ name, version?, role }],
    cssOnlyPatterns: ["animation-timeline: view(block)", ...],
    choreographies: [{ name, surface, mechanism, capturedFrom }]
  }
  ```
- **Component patterns** — detect repeating DOM signatures: card
  grid, banner, navigation anatomy, hero composition. Per
  `extract/reference/brand-surface.md` § System components. For
  each pattern, record `{ kind, shape, instanceCount, examples[] }`
  — the examples include enough markup snippet for direct to
  understand the captured shape.
- **Voice samples** — the hero headline, first body paragraph, three
  representative CTAs, three navigation labels, the footer line.
  Same fields as extract's voice block; the difference is voice is
  per-sample here (not aggregated cross-sample, since samples may
  represent different registers).
- **Asset inventory** — fonts (`@font-face` declarations + their
  `src` URLs), images (with intrinsic dimensions), inline SVGs.
  Per-sample; cached locally if accessible.

Save the per-sample data into the trait matrix's `samples[]` array.

### Phase 4 — Cross-sample aggregation

Walk the per-sample data and produce the `sharedTokens` block. A
token is "shared" if at least `ceil(N/2)` samples carry the same
value (after near-duplicate clustering for colors). Otherwise it
goes into `divergentTraits` with a per-sample breakdown.

Aggregate:

- `sharedTokens.type` — type families, weights, scale that recur.
- `sharedTokens.color` — neutrals + brand + surface tokens that
  recur; reservations are union'd (one sample's reservation is
  enough to honor).
- `sharedTokens.spacing` — section padding and grid that recur.
- `sharedTokens.radius / shadow / easing / duration` — modal values.
- `sharedTokens.motionStack` — libraries loaded by ≥1 sample (motion
  is opt-in, not majority-rule).
- `divergentTraits` — anything that didn't reach the majority
  threshold. Direct reads this to know which traits to **amplify**
  in the B/C/... variants (the "captured trait amplified" role).

### Phase 5 — Author SAMPLES.md (narrative brief)

`SAMPLES.md` is the load-bearing artifact direct reads under Mode B.
Format per `reference/samples-brief-format.md`:

- **Provenance header** (HTML comment as first line) — same shape as
  every other stardust artifact provenance block: `writtenBy`,
  `writtenAt`, `readArtifacts`, `samples`, `stardustRole`.
- **Opening paragraph** — one paragraph framing the sample set as a
  reference family. Names the shared design language, the per-sample
  registers, and the consumer of this brief (direct, Phase 2 Mode B).
- **§ 1 Type system** — table of the shared scale; rules block;
  fluid clamp() formulas if detected.
- **§ 2 Color** — palette as a swatched table; reservations list;
  brand-faithful inversion candidates (per `direct/reference/direction-format.md`
  § Brand-faithful inversions).
- **§ 3 Spacing + grid + density tier**.
- **§ 4 Motion stack + choreographies** — library list with versions;
  named choreographies (hero scroll-grow, garage-door, etc.) with
  the mechanism + sample they were captured from.
- **§ 5 Component patterns** — cards, banners, navigation, hero
  composition; one shape brief per pattern.
- **§ 6 Voice per register** — sample-by-sample voice block (not
  aggregated); direct uses the per-sample voice to match register
  in B/C variants.
- **§ 7 Asset inventory** — fonts (with license flags), photography
  vs illustration ratio, signature motifs.
- **§ 8 Divergent traits** — the list direct uses to pick which
  trait to amplify in B/C variants.

Author directly — distillation does not need impeccable's authoring
ceremony. SAMPLES.md is consumed by `direct` as factual input, not
as design opinion.

### Phase 6 — Update state and report

After all phases succeed:

1. Update `stardust/state.json` (add a `samples` block if absent):
   ```json
   "samples": {
     "distilledAt": "<ISO-8601>",
     "samplesDir": "samples/",
     "brief": "samples/SAMPLES.md",
     "traitMatrix": "samples/trait-matrix.json",
     "inventory": [
       { "slug": "bizpro-hub", "kind": "static", "role": "business" },
       { "slug": "sr-homepage", "kind": "live", "url": "...", "role": "consumer-creative" },
       ...
     ]
   }
   ```
2. Print a one-screen summary:
   ```
   Distilled 3 samples (2 static, 1 live)

   samples/
     SAMPLES.md             (8 sections, 4 motion choreographies named)
     trait-matrix.json      (12 shared tokens, 4 divergent traits)
     live/snapshots/        (1 file)

   Per-sample evidence:
     slug          kind     role                 typeFam               motion-libs
     bizpro-hub    static   business             adobe-clean-display   Lenis 1.x, GSAP 3
     plan-page     static   pricing              adobe-clean-display   Lenis 1.x
     sr-homepage   live     consumer-creative    adobe-clean-display   Lenis 1.x, GSAP 3

   Shared tokens: type (12), color (8), spacing (10), motion (2 libs)
   Divergent traits (amplification candidates):
     - scroll-driven choreography (bizpro-hub strongest)
     - photography-led tile vocabulary (sr-homepage strongest)
     - pricing-tier card density (plan-page strongest)

   Next: $stardust direct "<phrase referencing SAMPLES.md>" --variants 3
   ```

## When distill runs vs when it does not

Distill is **optional**. Three common scenarios:

1. **No samples, just a refresh.** User runs `$stardust extract` →
   `$stardust direct` directly. Mode A (brand-faithful) handles the
   common case — palette and type are pinned to the captured site,
   variants explore expressive / density / motion axes within the
   captured surface. Distill is not invoked.
2. **Samples present + brand-faithful refresh.** User runs distill
   first, then extract, then `direct "<phrase referencing SAMPLES.md>"`.
   Mode B's anchor-reference precedence (per `direct/SKILL.md`
   § Mode B) reads SAMPLES.md as the resolved anchor set; Mode A's
   palette + type inheritance still applies because the captured
   brand wins on those axes. Distillation contributes the *non-brand*
   axes: motion stack, component shapes, density tier, choreography
   names.
3. **Rebrand from a sample set.** User runs distill + `direct
   --rebrand "<phrase>"`. Distillation supplies the entire palette
   + type + motion language; extract's captured surface is only
   used for IA + content. This is the rarest case but the one
   distill was originally written for.

## Inputs the user prepares (out of scope for this skill)

Distill consumes a directory the user assembles by hand. Common
sources for samples:

- A static HTML mock from a designer (open in browser, save full
  page).
- A live URL provided by the brand team — list these in
  `samples/live/urls.json`; distill fetches them.
- A printed PDF / Figma export converted to HTML (best-effort).

Distill does not curate samples for the user; it does not invent
sample sources; it does not fetch arbitrary URLs the user didn't
list. If the samples are wrong, the brief will be wrong; this is
intentional — distill is a faithful descriptor, not a curator.

## Provenance

Every artifact distill writes carries a provenance block with at
minimum: `writtenBy: stardust:distill`, `writtenAt: <ISO-8601>`,
`readArtifacts: [...]` (every sample file consumed),
`consumedBy: "stardust:direct — Mode B anchor resolution"`.

## References

- [`reference/samples-brief-format.md`](reference/samples-brief-format.md) — the narrative-brief format the SAMPLES.md output follows.
- [`reference/trait-matrix-schema.md`](reference/trait-matrix-schema.md) — the per-sample and cross-sample schema the trait-matrix.json output follows.
