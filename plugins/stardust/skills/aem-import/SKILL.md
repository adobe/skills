---
name: aem-import
description: "Convert a stardust prototype into an authorable AEM Edge Delivery Services page — generates a per-theme stylesheet that targets generic EDS blocks (hero / text / cards / columns / cta-bar), authors DA-block-table content matching the prototype's information architecture, copies image assets, and (one-time) patches the EDS project's overlay engine to support blocks-mode pages alongside any existing overlay-mode pages. Two modes — `blocks` (default; generic EDS blocks + brand theme CSS, ~95% pixel parity, full authorability) and `overlay` (page-level overlay template with slot markers, ~100% pixel parity, slot-based authoring). Use when the user has an approved stardust prototype and wants it live on aem.page authored through DA (admin.da.live), not as a static migrate output."
license: Apache-2.0
---

# stardust:aem-import

Take an approved stardust prototype (a self-contained static HTML file
at `stardust/prototypes/<slug>-proposed.html`) and produce the artifacts
needed to render it pixel-faithfully as an authorable AEM Edge Delivery
Services page:

- **per-theme stylesheet** at `styles/<theme>.css` in the EDS project,
  with the prototype's per-section CSS translated to target generic
  EDS block classes (`.hero`, `.text`, `.text.centered`, `.cards`,
  `.cards.<variant>`, `.columns`, `.columns.alternate`, `.cta-bar`,
  `.cta-bar.stacked`, `.breadcrumb`)
- **chrome fragments** at `fragments/<theme>/{header,footer}.html`
  (copied/derived from the prototype's chrome regions)
- **per-block stubs** at `blocks/<name>/<name>.{js,css}` for any
  generic block the prototype uses that has no per-block behavior
  (silences EDS's 404s on the per-block resource fetch)
- **SVG icon files** at `/icons/<name>.svg` for any icomoon glyph
  the prototype uses inside main content (chrome icons stay on the
  icomoon font; main-content icons need SVGs because EDS's
  `decorateIcons` always injects an `<img>` and we let it show)
- **DA content** (block-tables-shaped HTML) authored at
  `<slug>.html` in the DA source, with section-metadata blocks
  carrying substrate transitions (warm-stone, dark) and a page-
  metadata block carrying `template=<theme>` so the overlay engine
  activates the theme on render
- **engine patch** (one-time, per EDS project) extending
  `scripts/scripts.js` + `blocks/header/header.js` +
  `blocks/footer/footer.js` to tolerate missing
  `templates/<theme>.html` (blocks-mode) and resolve chrome
  fragments from `main.dataset.theme`. Idempotent — skip when
  the patch markers are already present.

`aem-import` is the **EDS-import phase** for stardust pipelines that
need the output to land in admin.da.live (not as a static deployable
under `stardust/migrated/`, which is `stardust:migrate`'s job). It
runs after `stardust:prototype` approval and before any production
deploy.

## When to use

The user has:

1. At least one approved prototype at
   `stardust/prototypes/<slug>-proposed.html` (and its companion
   `<slug>-shape.md` brief)
2. An existing EDS project repo (AEM boilerplate-based) with `blocks/`,
   `styles/`, `scripts/`, `head.html`, plus existing chrome blocks
   (`header`, `footer`, `fragment`)
3. A DA workspace at `admin.da.live/<org>/<repo>/` with a DA_TOKEN in
   an `.env` (or environment) so the skill can PUT content via the
   admin API
4. A goal to render the prototype faithfully under the EDS preview URL
   while keeping content authorable in DA

If the user has prototypes but no EDS scaffolding, stop and recommend
`aem-edge-delivery-services:create-site` (sister skill) first. If
they have EDS but no prototypes, this skill doesn't apply — they
want `stardust:prototype` or `stardust:uplift`.

## Inputs

- `<slug>` — required positional. The prototype to import. The skill
  reads `stardust/prototypes/<slug>-proposed.html` and (if present)
  `stardust/prototypes/<slug>-shape.md`.
- `--eds-project <path>` — required (or set via env
  `STARDUST_EDS_PROJECT`). Absolute path to the EDS project root.
- `--theme <name>` — optional. The per-page theme name (default:
  `<slug>` kebab-cased). Used for `styles/<theme>.css`,
  `fragments/<theme>/`, and the `template=<theme>` page metadata.
- `--mode <blocks|overlay>` — optional. Default `blocks`.
  - `blocks`: author with generic EDS blocks (`hero`, `text`,
    `cards`, `columns`, etc.) + per-theme CSS. Pixel parity ~95%
    (see `reference/blocks-mode.md` for the trade-off ceiling).
    Authorable in DA without code changes per page.
  - `overlay`: page-level overlay template at
    `templates/<theme>.html` with `[data-slot]` markers; DA cells
    fill the slots. Pixel parity ~100%. Less authoring flexibility
    (slot-shaped). See `reference/overlay-mode.md`.
- `--da-token-file <path>` — optional. Default reads
  `<eds-project>/.env` for `DA_TOKEN=...`. Required for the skill
  to PUT DA content via admin.da.live.
- `--dry-run` — optional. Generate all files locally but skip the
  git push, DA PUT, and preview trigger. Useful when iterating.
- `--skip-engine-patch` — optional. Skip the one-time scripts.js +
  header.js + footer.js modification (assume it's already applied).

## Setup

1. Run the master skill's setup
   (`../stardust/SKILL.md` § Setup): impeccable dep check, context
   loader, state read.
2. Resolve `--eds-project`. Verify it has the expected structure:
   `blocks/header/`, `blocks/footer/`, `scripts/scripts.js`,
   `styles/styles.css`, `head.html`. Abort with a clear message if
   any are missing — recommend `aem-edge-delivery-services:create-site`.
3. Resolve the DA token. If `.env` doesn't have it, prompt the user
   for the token + write it to `.env` for future runs (or accept
   a `--da-token` flag for one-off runs).
4. Read `stardust/prototypes/<slug>-proposed.html` and parse:
   - The `<style>` block (becomes the basis of `<theme>.css`)
   - The `<head>` provenance block (for `_provenance` lineage in
     output artifacts)
   - The `<header>` / chrome regions (utility strip, main nav, dept
     row, breadcrumb if present) — becomes `fragments/<theme>/header.html`
   - The `<main>` `<section>`s (each becomes one or more DA blocks)
   - The `<footer>` — becomes `fragments/<theme>/footer.html`
5. Read `stardust/prototypes/<slug>-shape.md` if present. Use its
   voice classification table to mark which copy is captured-verbatim
   vs placeholder, its inheritance chain to know which canon is
   already in the theme, its anti-template pass to confirm component
   choices.
6. **Validate provenance.** Refuse to proceed if the prototype lacks a
   `_provenance.renderedBy` field or an `<head>` provenance block.
   The skill won't operate on hand-authored HTML that didn't come
   through `stardust:prototype` — without provenance, the source
   content classification and unsourced-content list are unknown.

## Procedure

The skill has six phases. Phases 1–3 generate artifacts. Phases 4–5
deploy them. Phase 6 verifies.

### Phase 1 — Map prototype sections to EDS blocks

Walk `<main>` in the prototype and identify each `<section>`'s
intended EDS block + variant. The mapping uses the captured
provenance + shape brief + a default vocabulary:

| Prototype section pattern | Default EDS block | Variant |
|---|---|---|
| Hero with photo background + headline + supporting + CTA | `hero` | `service` if the CTA is a yellow-on-dark pill, otherwise default |
| Plain text band, centered or left-aligned, single column | `text` | `centered` if `.section { text-align: center }` is observed |
| Card grid with image background per card | `cards` | `photos.<N>` (N = column count) |
| Card grid with no image, just label + h3 + summary + CTA | `cards` | `tiers` (when premium-elevated card present) or `rail` (when on dark substrate) |
| Image + content row, single row | `columns` | bare (image-right by default), or `alternate` (single-row reverse) |
| Image-content alternation, multiple rows | `columns` | `alternate` (rows alternate odd-reversed) |
| Dark band with H2 + 1-2 CTAs (no body) | `cta-bar` | bare (split layout) |
| Dark band with H2 + body paragraph + CTA | `cta-bar` | `stacked` |
| Breadcrumb trail | `breadcrumb` | n/a |

Surface the mapping to the user before generation:

```
[aem-import] mapped 8 sections to 8 blocks:
  hero            → <div class="hero service">
  intro band      → <div class="text centered">
  equipment grid  → <div class="cards photos seven">
  shop grid       → <div class="cards photos three">
  prev maint grid → <div class="cards photos two">
  field service   → <div class="columns alternate"> (image-left via odd-row reverse)
  self-service    → <div class="columns">           (image-right default)
  cat card cta    → <div class="cta-bar stacked">

Confirm or correct?
```

The user may correct mappings before Phase 2. Lock answers in
`stardust/aem-import-log.md` (or similar) for traceability.

### Phase 2 — Generate the per-theme stylesheet

Emit `styles/<theme>.css` using the **cascade-layer scaffold**
documented in `reference/theme-css-template.md`. The scaffold is not
optional — its layer ordering is what eliminates the
specificity / source-order traps catalogued in `conventions.md` §7.
Variants in `@layer variant` automatically win against base + substrate
regardless of selector specificity, so the generator can write naïve
per-variant selectors without specificity-bump tricks.

Declare the layer order first:

```css
@layer tokens, fonts, reset, chrome, base, layout, substrate, variant, responsive;
```

Then emit content layer by layer:

1. **`@layer tokens`** — translate the prototype's `:root` block.
   Rewrite asset paths from `../current/assets/...` to
   `/assets/<theme>/...`. If a sibling theme exists, prefer its
   shared fonts/logo to avoid duplication.

2. **`@layer fonts`** — `@font-face` declarations from the prototype.

3. **`@layer reset`** — the standard reset (template constant — same
   across themes).

4. **`@layer chrome`** — translate the prototype's chrome CSS
   (utility-strip, site-header, mega-nav, site-footer).

5. **`@layer base`** — generic block defaults. These are mostly
   **template constants** (`.hero.block`, `.text.block`,
   `.cards.block`, `.columns.block`, `.cta-bar.block`), emitted the
   same way for every theme. Include the EDS-pipeline defensive
   defaults from `conventions.md` §2 + §4:
   - Hero `min-height` matches the prototype (no default)
   - Hero text cell `max-width: calc(<proto-content-width> + padding-l + padding-r)`
   - `a.button .icon { font-size: 0.9em }` + `.icon > img { width: 1em; height: 1em }`
   - `.icon:has(> img)::before { content: none !important }`
   - `em > a` direct styling for icon-containing CTAs
   - `p:has(code)` placeholder pattern

6. **`@layer layout`** — inter-block spacing + section defaults
   (template constant). REQUIRED — without these the trailing CTAs
   collide into preceding blocks (`conventions.md` §7 Trap 3):
   ```css
   .cards-wrapper + .text-wrapper,
   .columns-wrapper + .text-wrapper,
   .cards-wrapper + .cards-wrapper,
   .columns-wrapper + .cards-wrapper { margin-top: var(--sp-xxl); }
   ```
   Plus `main .section:not(:has(.block)) { display: none }` and the
   substrate base padding.

7. **`@layer substrate`** — per-substrate overrides on base blocks
   (`.section.warm-stone`, `.section.dark`). Emit one block per
   substrate the page uses.

8. **`@layer variant`** — per-variant rules. Translate the
   prototype's per-section CSS, rewriting selectors to target EDS
   block class + variant (e.g., `.plan-picker → .cards.tiers`,
   `.finance → .cards.finance`). **NO specificity tricks needed** —
   the layer ordering ensures variants win.

   Variant rules must explicitly set properties that the base
   doesn't generalize cleanly:
   - **`flex-direction` + `justify-content`** when overriding the
     base `.cards.block > ul > li` layout. `align-items: flex-end`
     does NOT align to the bottom of a column-direction parent.
     See `conventions.md` §7 Trap 4.
   - **`object-fit: contain`** for variants holding wide-aspect
     images (logos, banners). See `conventions.md` §7 Trap 5.
   - **mask-image recolor** for any icon that must render in a
     brand color (not the default black). The generator should walk
     the icons referenced in the variant's DA content and emit
     one `.<context> .icon-<name> { mask-image: url(...) }` rule
     per icon. See `conventions.md` §2 (`decorateIcons`).

9. **`@layer responsive`** — media queries. Normal cascade applies
   inside.

If the EDS project already has another theme's CSS (e.g., a sibling
home theme), **prefer pointing at its shared assets** (fonts especially)
to avoid duplication. Surface the deduplication in the log.

**On regeneration of a pre-scaffold theme:** wrap existing content
in `@layer base { ... }` / `@layer substrate { ... }` blocks. No
selector rewrites needed — the cascade behavior shifts automatically.

### Phase 3 — Generate the DA content + chrome fragments + assets

For each section in the prototype's `<main>`:

1. Emit a DA-block-table-shaped `<div class="<block> <variant>">`.
2. Lift the section's content into the block's cells per the
   conventions in `reference/conventions.md` § DA authoring
   vocabulary:
   - Hero: cell 1 = text (eyebrow `<p>`, two `<h1>`s for split-
     lockup, supporting `<p>` with `<em>` for accents, single button
     in `<p><strong><a>`), cell 2 = `<picture><img>`
   - Cards: one row per card; image cell first (containing
     `<picture><img>`) OR no image cell for placeholders; body cell
     with eyebrow `<p>`, `<h3>`, body, CTA in `<p><strong><a>`
   - Columns: one row per side-by-side pair; image cell + content
     cell (order per `--alternate` variant)
   - CTA bar: single cell with `<h2>`, body `<p>`, each CTA in its
     own `<p><strong><a>` (separate paragraphs — see § quirks)
   - Text + placeholder: `<p><code>PLACEHOLDER · <type></code><br><em>e.g. ...</em></p>`
3. Add a section-metadata block at the end of each substrate-
   transitioned section: `<div class="section-metadata"><div><div>style</div><div>warm-stone</div></div></div>`.
4. Add a metadata block at the end of `<main>` with:
   - `title` (from prototype `<title>`)
   - `description` (from prototype meta description)
   - `template` (the `<theme>` name)

Copy the prototype's chrome to fragments:
- Anything before `<main>` in the prototype's `<body>` (utility
  strip, main header, dept row, breadcrumb if it's outside `<main>`)
  → `fragments/<theme>/header.html`
- The prototype's `<footer>` → `fragments/<theme>/footer.html`

Copy assets:
- `stardust/current/assets/media/*` referenced by the prototype's
  CSS or HTML → `<eds-project>/assets/<theme>/media/`
- Fonts: reuse from the sibling theme's `/assets/<other-theme>/fonts/`
  if present; otherwise copy to `<eds-project>/assets/<theme>/fonts/`
- Logo: same as fonts (reuse or copy)
- SVG icons: any `<span class="icon icon-X">` in main content
  needs `/icons/<X>.svg`. Generate from icomoon font glyphs if the
  X codepoint is known, or stub a generic SVG and flag for manual
  authoring

Stub blocks for any generic block class used without per-block
behavior:
- `blocks/<name>/<name>.js` exports a no-op `decorate`
- `blocks/<name>/<name>.css` is an empty comment-only file

### Phase 4 — One-time engine patch (idempotent)

Check `<eds-project>/scripts/scripts.js` for the marker comment
`// blocks-mode tolerance` or the presence of
`main.dataset.theme = templateName` in the overlay function. If
absent, apply the patch documented in `reference/engine-patch.md`:

1. `scripts.js applyTemplateOverlay()`: always set
   `main.dataset.theme = templateName` and `loadCSS(...)` before
   the template HTML fetch. If the HTML fetch 404s, log
   `[overlay] no template HTML for "<theme>" — blocks mode (CSS +
   chrome only)` and return false so standard `loadSections()`
   runs on authored content.
2. `blocks/header/header.js` + `blocks/footer/footer.js`: read
   `main.dataset.theme` first (with `dataset.overlay` as fallback
   for backward compat with overlay-mode pages).
3. **`blocks/<name>/<name>.css` files: wrap non-empty bodies in
   `@layer base { ... }`.** Required for the cascade-layer scaffold
   in `reference/theme-css-template.md` to win against block
   defaults. Without this, unlayered rules in `blocks/cards/cards.css`
   (and similar) silently beat every `@layer variant` rule in the
   theme — because the CSS spec says unlayered rules beat any
   layered rule. Idempotent — detects existing `@layer base {` and
   skips. Empty stubs (e.g., `text.css`) are left alone.

The patch is backward-compatible — existing overlay-mode pages
continue to work because their HTML fetch succeeds and the
existing dataset.overlay still gets set.

If `--skip-engine-patch` is passed, skip this phase.

### Phase 5 — Deploy (git push code, DA PUT content, preview trigger)

1. `cd <eds-project> && git add … && git commit -m "stardust:aem-import: add <theme> theme + <slug>-blocks-test page" && git push origin main`
   (specific file paths, not `git add .`).
2. `curl -X PUT` the DA content via admin.da.live source endpoint.
3. `curl -X POST` to admin.hlx.page/preview to trigger the preview
   build.
4. **Wait** for the EDS code-bus to deploy the new assets (typically
   5–8 seconds). DA tries to fetch image URLs at content-process
   time; if the code-bus hasn't propagated, images get stored as
   `about:error` and need a re-push. The skill handles this by
   re-PUTing the DA content after the code-bus deploy completes.
5. Report the preview URL.

If `--dry-run`, skip steps 1–4. Emit a `stardust/aem-import-out/<slug>/`
folder with all generated files for inspection.

### Phase 6 — Verify pixel parity

Run a Playwright comparison harness against the preview URL and the
prototype:

1. Screenshot both at 1440x900 viewport with deviceScaleFactor 2,
   fullPage.
2. Compute page-height delta. Refuse to succeed if delta > 5%
   (something structural is off).
3. Surface remaining diffs against the catalogue in
   `reference/known-diffs.md`:
   - Image aspect crops via DA media bus (acceptable)
   - Motion absent (acceptable when motion isn't ported)
   - Small typographic wrapping diffs (often acceptable)
   - Anything else → flag for manual review
4. Open both URLs in the user's default browser for visual review.

For the prototype side of the comparison, the skill should NOT use
file:// URLs — Playwright's headless renderer doesn't reliably load
CSS `background-image` from file://. Instead, serve the prototype
via a transient local HTTP server (e.g., `python3 -m http.server`)
and Playwright against the http URL. See `reference/verification.md`
for the harness.

## Modes

### `--mode=blocks` (default)

What it produces — see "Phase 2 + 3" above. Authors write standard
EDS block tables in DA; the theme CSS does all the styling work. The
theme is reusable across many pages of the same brand.

Pixel parity ceiling: **~95%**. The remaining 5% comes from:
- DA's image pipeline (different srcsets / formats / aspects than
  the prototype)
- Motion not ported (Lenis smooth scroll, scroll-reveal absent)
- A handful of prototype patterns that don't map cleanly to DA's
  authoring shape (mid-line color accents in a single `<h1>`,
  custom placeholder visuals tied to specific aspects, icons inside
  buttons collision with `decorateButton`)

Author experience: **best**. Each block is a standard EDS block.
Authors can add/edit content in DA without touching code.

Use when: production deployment, multi-page sites, when authorability
matters more than the last 5% of pixels.

See `reference/blocks-mode.md` for the full conventions catalogue.

### `--mode=overlay`

What it produces — a `templates/<theme>.html` file containing the
prototype's `<main>` with `[data-slot="<name>"]` markers on every
authorable element (per the shape brief's voice classification).
The DA content carries block tables whose cells fill the slots by
name. The overlay engine fetches the template, walks `[data-slot]`
markers, and substitutes cell values.

Pixel parity ceiling: **~100%**. The template HTML is the prototype's
HTML almost verbatim — only authorable strings are slot-bound.

Author experience: **constrained**. Authors fill named slots in a
fixed visual template. They can't restructure the page from DA. If
the template's structure needs to change, the code changes (not
just the content).

Use when: presales pitches, brand-critical pages where pixel
parity is the win-condition, single-page-per-archetype scenarios.

See `reference/overlay-mode.md` for the template authoring spec.

### Hybrid (per-page choice)

A project can mix modes. Different pages in the same EDS project
can use different themes — some overlay, some blocks. The chrome
fragments are shared via `dataset.theme`. The engine patch handles
both.

Recommended pattern: **overlay for the hero pages / lead pitch
artifact, blocks for the long tail**. Pitch with overlay's pixel
parity, deploy production with blocks' authorability.

## What this skill does NOT do

- Does not port motion (Lenis, scroll-reveal, marquees). If motion
  matters, manually port the prototype's `<script>` to a per-theme
  JS file (e.g., `scripts/<theme>-motion.js`) loaded conditionally.
  Motion isn't part of EDS's standard pipeline; it lives in
  per-theme code.
- Does not create the EDS project. Use
  `aem-edge-delivery-services:create-site` for that.
- Does not author content beyond the prototype. If the prototype has
  PLACEHOLDER sections, those stay PLACEHOLDER in DA (with the
  dashed-yellow visual signature). The content team replaces them
  before production deploy.
- Does not modify `stardust:migrate`'s output. `migrate` produces
  static deployable HTML at `stardust/migrated/`; `aem-import`
  produces authorable DA content in admin.da.live. They are
  parallel terminal phases for different deployment targets, not
  sequential.

## Outputs

Per page (assuming `--theme=<theme>`):

```
<eds-project>/
  styles/
    <theme>.css                              ← block-flavor per-theme CSS
  fragments/
    <theme>/
      header.html                            ← lifted from prototype chrome
      footer.html                            ← lifted from prototype footer
  assets/
    <theme>/
      media/                                 ← copied images
      fonts/                                 ← copied or shared from sibling theme
      logo.png                               ← shared
  icons/
    <icon-name>.svg                          ← per icon used in main content
  blocks/
    <generic-name>/                          ← stub for any block w/o behavior
      <generic-name>.js
      <generic-name>.css
  scripts/
    scripts.js                               ← patched (idempotent) for blocks-mode tolerance
  blocks/header/header.js                    ← patched to read dataset.theme
  blocks/footer/footer.js                    ← patched to read dataset.theme

(DA, pushed via admin.da.live)
  /paolomoz/<repo>/<slug>.html               ← authored DA block tables

stardust/
  aem-import-log.md                          ← per-page log: mapping decisions, asset list, verification result
```

## Related skill

For **site-wide** migration (N templates × thousands of pages), use
[`stardust:aem-import-site`](../aem-import-site/SKILL.md) — it
orchestrates per-template invocations of THIS skill, asking the user
per template whether to import an existing prototype, author a new one
first, build directly as EDS, or skip. Use that orchestrator when
you're migrating > 50 pages.

## Reference

- `reference/theme-css-template.md` — the cascade-layer scaffold every
  per-theme stylesheet uses. **Read this before authoring the Phase 2
  CSS output.** Defines the 9-layer ordering that eliminates the
  variant-inheritance traps catalogued in `conventions.md` §7.
- `reference/conventions.md` — DA authoring vocabulary, EDS pipeline
  quirks, per-block CSS patterns. **Read this before writing any
  theme.** §1–§6 cover authoring shape; §7 catalogues the per-variant
  inheritance traps that the cascade-layer scaffold eliminates.
- `reference/blocks-mode.md` — detailed walk-through of blocks mode.
- `reference/overlay-mode.md` — detailed walk-through of overlay
  mode + template authoring spec.
- `reference/engine-patch.md` — the one-time scripts.js +
  header.js + footer.js modifications. Shows exact diff.
- `reference/verification.md` — Playwright pixel-parity harness +
  known limitations (file:// vs http://, motion absent, etc).
- `reference/known-diffs.md` — catalogued acceptable diffs that
  the verification harness should warn-not-fail on.
- `reference/wheelercat-reference-implementation.md` — pointer to
  the live reference at `github.com/paolomoz/uplift-wheelercat-eds`
  with two authored DA test pages. Use as a worked example when
  scaffolding a new project.
