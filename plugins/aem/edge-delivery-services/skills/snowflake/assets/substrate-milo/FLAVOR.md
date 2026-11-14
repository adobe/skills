# Milo flavor — `substrate-milo`

The snowflake skill core is substrate-neutral; this file holds **all** the
Milo-specific generation deltas so the shared phase docs carry only a gated
pointer here. Applies when `.snowflake/config.json` `substrateFlavor` is `milo`
(auto-detected when the target repo boots milolibs — see `phases/0-prereq.md`).
Milo owns the runtime and chrome; this flavor only adds project-local blocks Milo
auto-loads. The files it installs are listed in `MANIFEST.json`; the `--pa-*`
scroll-animation vocabulary is in [animation-sidecars.md](./animation-sidecars.md).

Each section below is referenced by a pointer from the matching phase:

- [#capture](#capture) — Phase 1 (`phases/1-capture.md`): chrome metadata
- [#generate-page](#generate-page) — Phase 3 page-level (overlay) deltas
- [#generate-block](#generate-block) — Phase 3 block-level (editable `forge-*`) deltas
- [#wire](#wire) — Phase 4 wire deltas

---

<a id="capture"></a>

## §capture — Phase 1: capture the chrome metadata (not the chrome DOM)

If `.snowflake/config.json` `substrateFlavor` is `milo`, the deployed page
does **not** ship a captured header/footer — Milo renders the live
`global-navigation` + footer from page metadata. Capture that metadata from
the source's `<head>` into `state.json.chromeMeta` so Generate can re-emit it
onto the DA page. These are the keys that drive Milo's chrome:

```bash
# From the saved source HTML <head>
for name in foundation gnav-source footer-source unav universal-nav \
            gnav-promo-source skin mobile-gnav-v2; do
  val=$(grep -oE "<meta[[:space:]]+name=\"$name\"[[:space:]]+content=\"[^\"]*\"" \
        "$INPUT/index.html" | sed -E 's/.*content="([^"]*)".*/\1/' | head -1)
  [ -n "$val" ] && echo "$name = $val"
done
```

Write whichever are present into `state.json.chromeMeta` (object of
name→content). Do **not** save the rendered `feds-*` gnav DOM — a static
snapshot of a JS-driven nav renders as a broken, fully-expanded blob (this is
the exact bug the Milo flavor exists to fix). For the EDS flavor, ignore this
step and capture chrome as before.

---

<a id="generate-page"></a>

## §generate-page — Phase 3 page-level (overlay) deltas

When `.snowflake/config.json` `substrateFlavor` is `milo`, the page is hosted
by Milo (which owns the chrome) and the bespoke body is drawn by the
`blocks/snowflake` overlay block. Apply these deltas to the page-level steps
below; everything else (template build, slot markers, per-template CSS,
animations, asset rewriting, self-checks) is unchanged:

- **Skip 3.3 (header fragment) and 3.4 (footer fragment) entirely.** Do not
  emit `fragments/<template>/*`. Milo renders the live gnav/footer from
  metadata. (Capturing them is the bug the Milo flavor fixes.)
- **3.1 head links — KEEP all body/block stylesheets.** This is load-bearing.
  The overlay block injects the captured, **pre-decorated** DOM and Milo does
  **not** re-decorate it, so per-block CSS will NOT auto-load. `foundation: c2`
  only pulls the C2 **base** `styles.css`, not each block's stylesheet. Lift
  **every** source `<link rel="stylesheet">` into the template's top level
  (the overlay block lifts them into `<head>` at runtime) **EXCEPT**
  `global-navigation*.css` and any footer-chrome CSS — Milo's own gnav/footer
  blocks load those. Concretely, keep e.g. `router-marquee.css`,
  `rich-content.css`, `base-card.css`, `elastic-carousel.css`,
  `carousel-c2.css`, `visually-hidden.css`, `section-metadata.css`,
  `modal.css`, `merch.css`, `video.css`, typekit, lenis. **Dropping these is
  what makes the overlaid body render as unstyled, stacked content** — only the
  two chrome stylesheets come out.
- **3.1b interactive content — prototype interaction contract.** The overlay
  injects *frozen, pre-decorated* DOM, so any widget whose motion came from JS
  (carousel/slider, auto-rotating marquee, tabs, accordion) renders but does not
  move. The `snowflake` block ships a tiny dependency-free activator that revives
  them **only** when they use the contract below. So when the source body has such
  a widget AND the captured markup actually holds every state (all carousel
  slides, all tab panels — true for URL/HTML captures, which serialize the full
  rendered DOM), rewrite that widget to the contract, keeping each slide/panel's
  inner content and block CSS classes 1:1 (you only swap the outer wrapper):
  - carousel: `<div class="proto-carousel" data-proto-autoplay="5000"><div class="proto-carousel-track"><div class="proto-slide">…</div>…</div></div>` (drop `data-proto-autoplay` for manual-only; arrows + dots are auto-generated)
  - marquee: `<div class="proto-marquee" data-proto-interval="5000"><div class="proto-marquee-slide">…</div>…</div>` (optional `<button class="proto-marquee-nav-item">` per slide)
  - tabs: `<div class="proto-tabs"><div class="proto-tablist"><button class="proto-tab">…</button>…</div><div class="proto-tabpanel">…</div>…</div>` (equal counts; mark the open tab `aria-selected="true"`)
  - accordion: `<div class="proto-accordion"><div class="proto-acc-item"><button class="proto-acc-trigger" aria-expanded="false">…</button><div class="proto-acc-panel">…</div></div>…</div>`

  **Capture-mode limit:** a Figma-sourced prototype converges to a *single static
  reference image*, so only the visible slide exists — there is nothing to cycle.
  Do **not** fabricate slides; leave single-frame widgets as static markup. The
  contract (and the activator) are for captures that retained the off-screen
  states.
- **3.8 DA doc** — emit a **Milo page** instead of EDS block tables: empty
  `<header>`/`<footer>`, one `snowflake` block carrying the template name (+
  optional slot overrides), and a `metadata` block that re-emits
  `state.json.chromeMeta` (`foundation`, `gnav-source`, `footer-source`,
  `unav`, `universal-nav`, …) plus `template` and `title`:

  ```html
  <body>
    <header></header>
    <main>
      <div>
        <div class="snowflake">
          <div><div>template</div><div><templateName></div></div>
          <!-- optional authorable overrides, 3 cells each:
          <div><div><section-class></div><div><slot-name></div><div><value></div></div>
          -->
        </div>
      </div>
      <div>
        <div class="metadata">
          <div><div>template</div><div><templateName></div></div>
          <div><div>title</div><div><pageTitle></div></div>
          <div><div>foundation</div><div>c2</div></div>
          <div><div>gnav-source</div><div><from chromeMeta></div></div>
          <div><div>footer-source</div><div><from chromeMeta></div></div>
          <div><div>unav</div><div><from chromeMeta></div></div>
          <div><div>universal-nav</div><div><from chromeMeta></div></div>
        </div>
      </div>
    </main>
    <footer></footer>
  </body>
  ```

  The `template` metadata is still required (the overlay block also resolves
  it from `<meta name="template">`). With no slot-override rows the template's
  default content renders 1:1; add 3-cell rows only for content you want
  authorable in DA.

---

<a id="generate-block"></a>

## §generate-block — Phase 3 block-level (editable `forge-*`) deltas

When `.snowflake/config.json` `substrateFlavor` is `milo`, the page is hosted by
Milo, which **owns the runtime** (`head.html`, `scripts/scripts.js`,
`styles/styles.css`) and renders the live gnav/footer from page metadata. Milo
also runs the **standard EDS decoration pipeline** (`decorateSections` →
`decorateBlocks`), and — verified in `milo/libs/utils/utils.js` (`loadBlock` /
`getBlockData`) — it **loads any block** from `${codeRoot}/blocks/<name>/<name>.{js,css}`
with **no allow-list**: an unknown block like `forge-hero` is treated as a valid
project block and auto-decorated. So block-level conversion works natively on Milo
— each section becomes a real, editable block table whose decorator rebuilds the
DOM — **without touching Milo's runtime**. This yields editable blocks AND the live
chrome at the same time.

Apply these deltas to the B.* steps below. The decorator pattern (B.5), content
model design, and DA block-table format are **unchanged** — those are what make the
output faithful (the decorator re-adds the classes/wrappers DA strips on store) and
editable (positional block tables). Only the global/chrome plumbing changes:

- **B.1 (global styles) — do NOT write or replace `styles/styles.css`.** Milo owns
  it; replacing it rips out the runtime that loads the live gnav/footer. Make each
  block **self-contained**: put the `:root` design tokens it uses **and** the
  shared-component rules it needs (`.eyebrow`, `.btn` variants, `.editorial`, …)
  **inside that block's own** `blocks/<name>/<name>.css`, scoped under the block
  class. Custom properties cascade globally regardless of which file declares them,
  and Milo awaits a block's CSS before revealing the section, so there is no
  FOUC/order risk and nothing global is required. (If per-block token duplication is
  undesirable, the only acceptable alternative is to **append** — never replace —
  the tokens + shared components to the project's own `styles/styles.css` under a
  page/section scoping selector; branch-scoped and additive. Default to the
  self-contained per-block approach.)
- **B.2 (head.html fonts) — SKIP.** Do not edit Milo's `head.html`. Load fonts from
  within block CSS (`@font-face`, or reproduce the source's webfont stylesheet URL
  per block that needs it).
- **B.4 (header/footer fragments + blocks) — SKIP entirely.** Do **not** create
  `blocks/header`, `blocks/footer`, or `fragments/<brand>/*`, and do **not** capture
  the source's rendered nav/footer DOM. Milo renders the live gnav/footer from page
  metadata; a static capture of the JS-driven nav is the nav-regression bug the Milo
  flavor exists to avoid.
- **B.5 (content blocks) — prefix every block name `forge-`** (`forge-<kebab(section)>`,
  e.g. `forge-hero`, `forge-compare-plans`). This guarantees the name never collides
  with a real Milo block id and that Milo's C1/C2 validation treats it as a plain
  project block (neither C1 nor C2, so never marked invalid). Everything else about
  B.5 is unchanged — `decorate(block)` reads the authored rows and **rebuilds the
  source DOM** (re-add `.lede`, `.btn`, wrapper divs via `createElement`), and the
  per-block CSS targets those rebuilt classes.
  - **Full-bleed is the #1 cause of "not 1:1" on Milo.** Milo wraps each block in a
    `<name>-wrapper` inside a `.section`, both carrying Milo's default content
    `max-width` and padding. For any full-bleed/edge-to-edge section, override them
    in the block CSS: `.section .forge-<name>-wrapper { max-width: unset; padding: 0; }`
    (inspect the actual wrapper class Milo emits and match it), plus any
    `main > .section { margin: 0; }` the design needs. Scope the block's rules with
    enough specificity to win against Milo's base `main`/`.section`/typography styles.
  - **Set `box-sizing: border-box` on any element that combines `width` with its own
    `padding` or `border`** — full-width buttons/inputs/cards/CTAs are the common case
    (`.fpc-btn { width: 100%; padding: 0 24px; box-sizing: border-box; }`). Without it,
    a `width: 100%` element adds its horizontal padding *on top of* the 100%, so it
    overflows its container (the button bleeds past the card edge). Milo does not apply
    a global `* { box-sizing: border-box }` that reaches scoped block CSS, so declare it
    per block — simplest is one reset at the top of the block CSS:
    `.forge-<name> *, .forge-<name> *::before, .forge-<name> *::after { box-sizing: border-box; }`.
  - **Generator placeholder UIs are 1:1 content — reproduce verbatim, do NOT drop
    them.** A visible generator placeholder (Stardust `data-placeholder="true"` with
    `placeholder-eyebrow`/`placeholder-shape`, rendering text like "PLACEHOLDER · price /
    e.g. US$0/mo" or "PLACEHOLDER · image") is **static source content**, not a
    dynamic/commerce slot. Carry it into the block's content model / decorator output
    exactly as the preview shows it. Do NOT decide it is "commerce-injected" or
    "filled in at runtime" and replace it with an em-dash, an empty node, or your own
    pricing — even when the text literally says "PLACEHOLDER" or you know the real page
    wires live pricing. The preview is the 1:1 target. (See
    `knowledge/block-level-conversion.md` §"Generator placeholder UIs".)
- **B.5b (animation sidecars) — emit scroll animations as `animation` blocks, NOT
  bundled JS.** The Milo substrate ships a vendored `blocks/animation` runtime (+
  `tools/page-animator/controls.js`) — installed in Phase 0 — that reads a sibling
  `<div class="animation {target}">` block of `--pa-*`/`range-*`/`timing-*` KV rows,
  finds the target block **by class name** (so it animates `forge-*` blocks), and
  drives a CSS scroll-driven animation (`animation-timeline: view()`). Emitting motion
  this way (instead of an opaque `scripts/<page>-animations.js` blob) makes every
  animation **adjustable** in the page-animator panel/sidekick and durable in DA. For
  each animated section, add — as a sibling of the `forge-<name>` block, inside the
  same section `<div>` — an `animation` block:

  ```html
  <div class="animation forge-hero">
    <div><div>--pa-opacity-from</div><div>0</div></div>
    <div><div>--pa-translate-y</div><div>24</div></div>
    <div><div>range-start</div><div>entry 0%</div></div>
    <div><div>range-end</div><div>entry 60%</div></div>
  </div>
  ```

  Rules:
  - **Target by class:** the second class names the block (`animation forge-hero`);
    append an index for the Nth match (`animation forge-card 2`). No class = animate the
    whole section.
  - **Values are bare numbers** (the runtime's `parseProps` does `parseFloat`): write
    `24`, not `24px`. Only emit keys you change; defaults fill the rest. The full
    vocabulary + defaults are in `./animation-sidecars.md`.
  - **Policy — driven by `decisions.json.animations` (`default` | `preserve` | `off`,
    default `default`):**
    - `default`: a conservative, tasteful reveal on each major section — a gentle
      fade-up (`--pa-opacity-from: 0`, `--pa-translate-y: ~24`, range `entry 0%` →
      `entry 60%`), lightly **staggered** across sibling sections by nudging
      `range-start` later (e.g. `entry 0%`, `entry 10%`, `entry 20%`). Do NOT animate
      tiny atoms — animate the section/primary block. Because `animation-timeline:
      view()` is scroll-position-driven, an above-the-fold hero is already past its
      entry range at scroll 0 and renders settled (no jank/LCP cost) — emit it anyway
      for consistency; it just won't visibly move.
    - `preserve`: re-express the **source** section's scroll motion as adjustable
      `--pa-*` reveals. The source's own animation JS (Lenis/GSAP/`data-anim`/IO) is
      **stripped during block conversion** — so capture the *intent* as sidecar data,
      never re-inline the JS:
      - enter/reveal (IntersectionObserver, `data-anim`, fade-up) → `--pa-opacity-from`
        + `--pa-translate-y` on an `entry` range.
      - scale-in / blur-in → `--pa-scale` / `--pa-blur`.
      - parallax / translate-on-scroll → **approximate** as a `--pa-translate-y` reveal.
        Ryan's panel/runtime is an entry-based *reveal* model (props animate from an
        offset to settled), not a continuous-parallax model, so true parallax cannot
        round-trip — an approximate reveal is the correct, panel-adjustable substitute.
      - **Do NOT inline Lenis/GSAP or any scroll-listener JS into block code** (block
        JS stays decorator-only). **Smooth-scroll is already free**: Milo auto-inits
        Lenis on every `foundation: c2` page (`milo/libs/utils/utils.js`), so the
        deployed page has the smooth feel without any vendored scroll engine.
      - Where a section had no source motion, fall back to the `default` reveal.
      - True pin/scrub timelines (GSAP ScrollTrigger): skip and log — don't fake them.
    - `off`: emit no `animation` blocks.
  - **Reduced motion:** the design tokens already include a reduced-motion guard via the
    runtime; do not duplicate it per block.
  - **Fidelity:** reveals animate to the real end-state, so the per-section 1:1
    screenshot still matches — adding `default` motion does not break the 1:1 gate.
- **B.6 (scripts.js `buildHeroBlock`) — SKIP.** Never touch Milo's `scripts.js`.
  Milo has no hero auto-block, so there is nothing to guard against.
- **B.8 (DA-source body) — keep the standard positional block tables** (one
  `<div class="forge-…">` per section), but the DA doc is a **Milo page**: empty
  `<header>`/`<footer>`, and a `metadata` block that re-emits
  `state.json.chromeMeta` (`foundation`, `gnav-source`, `footer-source`, `unav`,
  `universal-nav`, …) plus `title`. **Do NOT emit a `template` metadata key** (that
  is the overlay path; on a block-level page it would make Milo try to load a
  non-existent template). No slot-keyed rows — these are real positional tables.
  Example:

  ```html
  <body>
    <header></header>
    <main>
      <div>
        <div class="forge-hero">
          <div><div><picture>…</picture></div></div>
          <div><div><h1>Heading</h1></div></div>
          <div><div>Description</div></div>
          <div><div><p><strong><a href="/cta">CTA</a></strong></p></div></div>
        </div>
        <div class="animation forge-hero">          <!-- B.5b sidecar (optional per section) -->
          <div><div>--pa-opacity-from</div><div>0</div></div>
          <div><div>--pa-translate-y</div><div>24</div></div>
          <div><div>range-start</div><div>entry 0%</div></div>
          <div><div>range-end</div><div>entry 60%</div></div>
        </div>
      </div>
      <!-- … one section div per forge- block (+ optional animation sidecar) … -->
      <div>
        <div class="metadata">
          <div><div>title</div><div><pageTitle></div></div>
          <div><div>foundation</div><div>c2</div></div>
          <div><div>gnav-source</div><div><from chromeMeta></div></div>
          <div><div>footer-source</div><div><from chromeMeta></div></div>
          <div><div>unav</div><div><from chromeMeta></div></div>
          <div><div>universal-nav</div><div><from chromeMeta></div></div>
        </div>
      </div>
    </main>
    <footer></footer>
  </body>
  ```

- **B.7 (drafts test page) / B.9 (self-checks) — keep**, with two caveats: (1) the
  local `aem up` preview will NOT show the live Milo chrome (only the production
  `.aem.page` preview does), so verify chrome on `.aem.page`; (2) treat a
  **per-section visual diff** (screenshot the source section vs the rendered block)
  as a **hard 1:1 gate** before declaring Generate complete — full-bleed/width
  regressions are the expected failure mode and must be fixed in the block CSS.
- **Output layout (Milo):** the only artifacts are `blocks/forge-*/{js,css}`, the
  vendored `assets/`, the `drafts/` test page, and `output/da/<page-slug>.html`. Do
  **not** emit `styles/`, `head.html`, `fragments/`, or `blocks/{header,footer}`.

---

<a id="wire"></a>

## §wire — Phase 4 wire deltas

The Milo flavor has two wire paths depending on `conversionLevel`. In **both**,
Milo's `head.html`/`scripts.js`/`styles.css` stay untouched and Milo loads the
gnav/footer from the page metadata emitted in Generate. Pick the matching path,
do it, then skip to the lint step — the EDS steps below do not apply to Milo.

### Milo + page-level (overlay)

Copy **only** the body artifacts — there are no header/footer fragments:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"
cp "${PROJ}/output/templates/${TEMPLATE_NAME}.html" "templates/${TEMPLATE_NAME}.html"
cp "${PROJ}/output/styles/${TEMPLATE_NAME}.css"     "styles/${TEMPLATE_NAME}.css"
[ -f "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" ] && \
  cp "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" "scripts/${TEMPLATE_NAME}-animations.js"
# vendored libs/assets: same as the EDS path (globs below), minus the fragments/ copies.
```

Do NOT `mkdir fragments/<template>` or copy header/footer fragments. The
`blocks/snowflake` overlay block (installed in Phase 0) loads
`templates/<template>.html` + `styles/<template>.css` at runtime.

### Milo + block-level (editable `forge-*` blocks)

Copy **only** the per-section block code + assets. There are NO templates,
NO `styles/`, NO `head.html`, NO `fragments/`, and NO `blocks/{header,footer}` —
Milo runs the standard decoration pipeline and auto-loads each `forge-*` block
from the repo root, and renders the live gnav/footer from the metadata block:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"

# 1) Copy each forge-* block (js + css) to the repo's blocks/ dir
for dir in "${PROJ}/output/blocks/"forge-*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  mkdir -p "blocks/${name}"
  cp "${dir}/${name}.js"  "blocks/${name}/${name}.js"
  cp "${dir}/${name}.css" "blocks/${name}/${name}.css"
done

# 2) Vendored assets (if asset strategy is "vendor") — already under assets/

# 3) Build the local-test drafts file from the DA doc (full HTML document)
node "<SKILL_DIR>/scripts/transform-da-to-eds.mjs" \
  "${PROJ}/output/da/${PAGE_SLUG}.html" \
  "drafts/${PAGE_SLUG}.html"
```

The DA-source body (`output/da/${PAGE_SLUG}.html`) is uploaded to DA in Phase 4's
upload step (or by the host); it carries the `forge-*` block tables + the chrome
`metadata` block and NO `template` key. At runtime Milo decorates each `forge-*`
block (rebuilding its DOM) and draws the live gnav/footer from the metadata.
