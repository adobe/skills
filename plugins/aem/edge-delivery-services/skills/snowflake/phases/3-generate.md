# Phase 3 — Generate

Goal: produce the deployable artifacts and the DA-source body
fragment, written to the project's `output/` folder. The artifacts
differ by conversion level.

## Branch by conversion level

Read `decisions.json.conversionLevel`:

- **`page-level`** → follow the page-level path below (overlay
  template + slot markers). This is the original snowflake path.
- **`block-level`** → follow the block-level path below (per-section
  EDS blocks). See
  [../knowledge/block-level-conversion.md](../knowledge/block-level-conversion.md)
  for the architecture and patterns.
- **`hybrid`** → block-level for passing sections, static fragments
  for failing sections. Follow block-level path with fragment
  fallbacks per `decisions.json.feasibility.sections[].level`.

## Knowledge to load

Before writing anything, load (using the override-then-bundled
resolution from `SKILL.md`):

**Always:**
- `methodology.md` §3 (Generate) — the authoritative rules
- `learnings.md` — at minimum the entries for "container vs.
  children", "Media Bus absolute URLs", "`<br>` stripping",
  "non-`<section>` blocks must be rewritten", plus whatever else
  applies to the patterns in `decisions.json`

**Page-level additionally:**
- `architecture.md` §"Slot semantics" — all five slot writer cases
  the engine supports

**Block-level additionally:**
- `block-level-conversion.md` — output layout, decorator pattern,
  CSS extraction, content model design, drafts test page format
- `animation-sidecars.md` — (Milo flavor, step B.5b) the `--pa-*` /
  `range-*` / `timing-*` vocabulary for `animation` sidecar blocks

Resolution at each lookup: check `.snowflake/knowledge/<file>.md`
first (project override), then `<SKILL_DIR>/knowledge/<file>.md`
(bundled). Project overrides win on conflict.

---

# Page-level path

Follow this section when `conversionLevel` is `page-level`.

## Milo flavor deltas (read FIRST if `substrateFlavor` is `milo`)

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

## Output layout (page-level)

Under `<projectsDir>/<NNN>-<slug>/output/`:

```
templates/<template>.html              ← <main> with [data-slot] markers
fragments/<template>/header.html       ← full header DOM
fragments/<template>/footer.html       ← full footer DOM
styles/<template>.css                  ← extracted inline <style>
scripts/<template>-animations.js       ← extracted inline <script> (if any)
da/<page-slug>.html                    ← DA-source body fragment
```

Plus any vendored external libs (`scripts/<template>-<libname>.js`,
`styles/<template>-<libname>.css`) and any vendored static assets
(`assets/...`) per the asset strategy in `decisions.json`.

## Step-by-step

Work through the steps below in order. At each, check decisions.json
for any project-specific overrides.

### 3.1 — Extract head-level `<link>` resources

From `decisions.json["headLinks"]`, emit each as a top-level
`<link>` at the very top of the template HTML file, ABOVE the
synthesized `<main>`. The substrate engine lifts these into
`document.head` at runtime.

Do NOT include a `<link>` for `/styles/<template>.css` here — the
substrate loads that dynamically when the overlay applies.

### 3.2 — Build the template's `<main>`

Walk the source body sections in document order. For each section
in `decisions.json["sections"]`:

1. If `originalTag !== "section"` and `rewriteToSection === true`,
   change the outermost element to `<section>` while preserving the
   complete class list and all inner DOM.
2. If the source's body lacks a `<main>` wrapper (almost always
   true for static AI-generated pages), synthesize one around the
   collected sections.
3. For each `slots[i]`:
   - Find the element matching `selector` inside the section.
   - Add `data-slot="<name>"` to it. Keep the default content (acts
     as fallback when DA cell is empty).
   - **Mid-sentence inline elements are CONTENT, not chrome.** If the
     element contains inline tags from the preserved set (`<sup>`,
     `<sub>`, `<strong>`, `<em>`, `<del>`, `<ins>`, `<mark>`, `<code>`,
     `<kbd>`, anchors, images) that sit BETWEEN text runs, leave them
     inside the element and slot the WHOLE element. Do NOT wrap the
     text in a sub-`<span data-slot>` that excludes the inline tags —
     the DA cell would then be missing them and the `.md`
     representation would be incomplete (authors can't see/edit the
     marker). See `<SKILL_DIR>/knowledge/learnings.md` entry
     "2026-05-20 — inline content elements belong INSIDE the slot".
   - For `background-image` slots, the element keeps its inline
     `style="background-image:url(...)"` AS-IS. The substrate writer
     replaces the URL at runtime.
   - For `link` slots, only apply if the `<a>` has NO nested
     `[data-slot]` descendants. Container-vs-children rule.
   - **Span-wrapper slots**: when `decisions.json` marks a slot with
     `"mixedContent": true`, do NOT place `data-slot` on the element
     itself (its `innerHTML` replacement would destroy decorative
     children like SVGs and icons). Instead, wrap only the authorable
     text portion in `<span data-slot="name">text</span>`, leaving
     decorative siblings (SVGs, icon images) outside the wrapper as
     static template chrome. In the DA doc, emit the value as plain
     text (not a link). See learnings entry "link slots with inline
     decorative elements".
4. Skip elements listed in `decisions.json["strip"]` — they don't
   appear in the template.
5. Mark placeholder elements with `data-slot-skip="placeholder"`
   (never authorable; substrate ignores them).

### 3.3 — Header fragment

Extract everything from `<body>` start up to (but not including) the
first content section. Wrap as the body of `fragments/<template>/header.html`.
Apply asset path rewrites (3.7 below). Header has NO `[data-slot]`
markers — it's static repository content.

### 3.4 — Footer fragment

Extract everything from the last content section end to `</body>`,
MINUS `<script>` tags and any stripped dev-tool markup. Save as
`fragments/<template>/footer.html`. Apply asset path rewrites. No
`[data-slot]` markers.

### 3.5 — Page CSS

Concatenate the source's inline `<style>` blocks (line ranges in
`decisions.json["inlineStyleLines"]`) into a single file at
`styles/<template>.css`. **Strip the `<style>` and `</style>`
wrapper lines — emit only the inner content.** Apply asset path
rewrites to any `url(...)` references inside.

If `decisions.json["externalLibs"][i].strategy === "vendor"` and the
lib includes a CSS file: copy it to
`styles/<template>-<libname>.css` verbatim.

### 3.6 — Page animations JS

Concatenate the source's inline `<script>` blocks (line ranges in
`decisions.json["inlineScriptLines"]`) into
`scripts/<template>-animations.js`. The substrate loads this via
HEAD probe; if it 404s the page still works.

For vendored external libs that need an initialization hook (e.g.
Lenis), inject a small loader prelude that:
1. Creates a `<script>` element pointing at the vendored lib path
2. Sets `onload` to a function that runs the rest of the script

```js
(function () {
  const s = document.createElement('script');
  s.src = `${window.hlx.codeBasePath}/scripts/<template>-<libname>.js`;
  s.onload = main;
  document.head.appendChild(s);
  function main() {
    // original inline script body goes here, including library init
  }
})();
```

For any inline `onclick="someFunc()"` references in the template,
expose `someFunc` on `window` from inside `main()`.

### 3.7 — Asset path rewriting

Per `decisions.json["assetStrategy"]`:

- **`"absolute"`** (public source host): rewrite every relative
  `assets/...` reference to `${assetBase}assets/...` (absolute URL
  pointing at the source host).

- **`"vendor"`** (local-only source host, or user-requested vendor):
  - Copy the referenced asset files from source into the target
    repo's `assets/` directory (preserving subfolder structure).
    Use `curl` if source is HTTP, `cp -R` if filesystem path is
    available.
  - Remove `.DS_Store`s and any unreferenced files in the copied
    tree.
  - Rename any directory containing spaces (AEM CLI 404s on
    URL-encoded `%20`).
  - In template, fragments, and CSS: rewrite source URLs to
    root-relative `/assets/...`.
  - **In the DA doc (next step): rewrite to ABSOLUTE branch URLs**
    (`https://<branch>--<repo>--<owner>.aem.page/assets/...`). Media
    Bus only resolves absolute URLs. The branch name comes from
    decisions.json or is asked of the user.

The asymmetry is critical and worth a sanity check: search the
output for any `src="assets/"` (missing leading slash, non-absolute,
not vendored-absolute) — should find none.

### 3.8 — DA-source body fragment

Write `output/da/<page-slug>.html` in the canonical `<div class="…">`
block form (see `da-content` §3.2). Read `da-content` §3, §3.9,
§5, and §9 before writing this file — block format, cell content
normalization, page metadata, and image URL rules all live there.

Structure:

```html
<body>
  <header></header>
  <main>
    <div>
      <div class="<first-class-of-section-1>">
        <div><div><slot-name></div><div><slot-value></div></div>
        ... one row per slot, paired divs ...
      </div>
    </div>
    ... one outer-div per section ...
    <div>
      <div class="metadata">
        <div><div>template</div><div><templateName></div></div>
        <div><div>title</div><div><pageTitle></div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
```

Snowflake-specific reminders (universal rules are in `da-content`):

- Metadata block MUST sit inside `<main>` — placement in `<footer>`
  breaks the overlay engine (no `<meta name="template">` → engine
  bails → standard EDS decoration 404s on every block).
- Never write `<span class="…">` into cells — class is lost on
  normalization, breaking any CSS hook the source page relied on.
- For vendored assets, DA cells use the absolute branch URL form:
  `https://<branch>--<repo>--<owner>.aem.page/assets/...` (DA cells
  don't accept root-relative paths even though template/fragment
  HTML does).

### 3.9 — Self-checks before declaring Generate done

Run these checks. If any fail, fix the affected artifact and re-run
the check.

```bash
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"

# 1) Template has <main> and all sections have unique first-classes
node -e '
  const fs = require("fs");
  const { JSDOM } = require("jsdom");
  // ... or use regex-based check if jsdom not available
'

# 2) No relative "assets/" refs in template/fragments/CSS
grep -REn "=\"assets/" "$PROJ/output/templates" "$PROJ/output/fragments" "$PROJ/output/styles" && echo "FAIL: relative assets/" || echo "OK"

# 3) No nested [data-slot] inside another [data-slot]
# (would need a DOM parse — skip for now if jsdom not available;
#  document this gap in the future-validator roadmap)

# 4) DA doc has no <span class> (stripped) and no <table> (Snowflake
#    uses div form). See da-content §3.9 for full normalization.
grep -cE "<table|<span class" "$PROJ/output/da/"*.html
# expected: 0 (per file)

# 4a) WARN: <br> is position-dependent (da-content §3.9).
grep -nE "<br>" "$PROJ/output/da/"*.html && echo "WARN: <br> found — verify position" || echo "OK"

# 5) DA cell <img> URLs are absolute
grep -oE "<img[^>]*src=\"[^\"]+\"" "$PROJ/output/da/"*.html \
  | grep -vE "src=\"https?://" && echo "FAIL: non-absolute DA img" || echo "OK"

# 6) No section first-class collides with a CSS layout rule
#    This is the most common post-conversion layout bug — inner CSS class
#    used as section first-class picks up grid/flex rules meant for inner div.
grep -oE 'class="[^"]*"' "$PROJ/output/templates/"*.html \
  | grep -oE '^[a-z][a-z0-9-]+' \
  | sort -u \
  | while IFS= read -r cls; do
      if grep -qE "\.${cls}[[:space:]]*\{" "$PROJ/output/styles/"*.css 2>/dev/null; then
        echo "WARN: section first-class '$cls' appears as CSS selector — verify no layout collision"
      fi
    done || echo "OK: no first-class CSS collisions detected"

# 7) No slot whose element contains non-authorable children
#    (SVGs, decorative images that writeSlot innerHTML would destroy).
#    DOM-based check — more reliable than regex for nested structures.
node -e '
  const fs = require("fs");
  const html = fs.readFileSync(process.argv[1], "utf8");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const bad = [];
  doc.querySelectorAll("[data-slot]").forEach((el) => {
    const deco = el.querySelectorAll("svg, img[aria-hidden], img[role=presentation]");
    if (deco.length) bad.push(el.getAttribute("data-slot") + " contains <" + deco[0].tagName.toLowerCase() + ">");
  });
  if (bad.length) { bad.forEach((b) => console.error("WARN: " + b + " — use span-wrapper")); process.exit(1); }
' "$PROJ/output/templates/${TEMPLATE_NAME}.html" \
  && echo "OK: no mixed-content slots" \
  || echo "FAIL: slots with decorative children found — see learnings: span-wrapper pattern"
```

## Update state and finish (page-level)

Set `state.phase = "generate"`, `state.phaseStatus = "complete"`,
`state.generateCompletedAt = "<timestamp>"`. Record:
- `state.conversionLevel = "page-level"`
- `state.slotCount` — total number of `[data-slot]` markers across
  the template
- `state.sectionCount` — number of sections in `<main>`

Continue to Phase 4 (Wire).

---

# Block-level path

Follow this section when `conversionLevel` is `block-level` or
`hybrid`. The full architecture is in
[../knowledge/block-level-conversion.md](../knowledge/block-level-conversion.md);
this section is the step-by-step execution.

## Milo flavor deltas (read FIRST if `substrateFlavor` is `milo`)

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
    vocabulary + defaults are in `knowledge/animation-sidecars.md`.
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
    - `preserve`: only where the **source** had motion (Match path). Map enter/reveal/
      translate/scale/blur to `--pa-*`. Leave true cinematics (Lenis/GSAP scrub,
      pinning) as the existing bundled `scripts/<page>-animations.js` — they don't
      reduce to the `--pa-*` model.
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

## Output layout (block-level)

Artifacts are written directly to the EDS repo (not to a project
`output/` subfolder) because block-level produces standard EDS files
at standard paths:

```
styles/styles.css                     ← global tokens + shared components
styles/fonts.css                      ← empty (fonts via head.html)
head.html                             ← font preconnects (appended)
fragments/<brand>/header.html         ← static header fragment
fragments/<brand>/footer.html         ← static footer fragment
blocks/header/header.{js,css}         ← fragment loader + header styles
blocks/footer/footer.{js,css}         ← fragment loader + footer styles
blocks/<name>/<name>.{js,css}         ← one pair per content section
assets/                               ← vendored images/logo
drafts/<page-slug>.html               ← local test page
output/da/<page-slug>.html            ← DA body fragment (for upload)
```

## Step-by-step (block-level)

### B.1 — Extract global styles

Split the source's inline `<style>` block. See
`block-level-conversion.md` §"Global styles extraction" for the
two-bucket split (global vs per-section).

Write `styles/styles.css` with:
1. EDS boilerplate skeleton (`body { display: none }`, header/footer
   visibility, `.appear`)
2. Source `:root` design tokens
3. Source base typography (replace boilerplate Roboto defaults)
4. Shared components (`.eyebrow`, `.btn` variants, `.editorial`, etc.)
5. EDS section overrides for full-bleed
6. Responsive breakpoints for `:root` token changes
7. Reduced motion media query

Write `styles/fonts.css` as empty (fonts loaded via CDN).

### B.2 — Set up fonts in head.html

Append font preconnects and the CDN stylesheet link to `head.html`,
placed after the viewport meta but before the `aem.js` script tag.

### B.3 — Vendor assets

Per `decisions.json["assetStrategy"]` (usually `vendor` for
local-only sources):
1. Copy referenced images and logo to `assets/`
2. Remove `.DS_Store`s, rename dirs with spaces
3. All template/fragment/CSS refs use root-relative `/assets/...`
4. DA cell image refs use absolute branch URLs

### B.4 — Create header/footer fragments

Extract header and footer markup from the source. Write to
`fragments/<brand>/header.html` and `footer.html`. Rewrite asset
paths to root-relative.

Write `blocks/header/header.js` and `blocks/footer/footer.js` as
simple fragment loaders (see `block-level-conversion.md`
§"Header/footer fragment pattern").

Write `blocks/header/header.css` and `blocks/footer/footer.css`
with the header/footer CSS rules extracted from the source.

### B.5 — Create content blocks

Each block is fully independent — its own JS, CSS, and content model
with no shared state or cross-block dependencies. **Blocks can be
generated in parallel.** If the host environment supports dispatching
independent work units concurrently (subagents, worker threads, scoops,
etc.), use that capability here — it is safe and significantly faster
for pages with many sections. Sequential generation is equally correct
if parallelism is not available.

For each content section in `decisions.json.feasibility.sections[]`
where `level === "block"`:

1. **Design the content model** — map the section's authorable
   content to DA block table rows. See
   `block-level-conversion.md` §"Content model design".

2. **Write the block JS** — `blocks/<name>/<name>.js` with a
   `decorate(block)` function that reads authored rows and builds
   the source DOM structure. Follow the decorator pattern in
   `block-level-conversion.md`.

3. **Write the block CSS** — `blocks/<name>/<name>.css` with the
   section-scoped CSS rules from the source. Include the
   `<name>-container` / `<name>-wrapper` override for full-bleed.

For hybrid conversions, sections where `level === "fragment"` get
a static fragment + minimal loader instead (see
`block-level-conversion.md` §"Hybrid conversion").

### B.6 — Modify scripts.js

Add the early return to `buildHeroBlock` if `.hero` exists as an
authored block. See `block-level-conversion.md` §"scripts.js
modifications".

### B.7 — Build the drafts test page

Write `drafts/<page-slug>.html` as a full HTML document with all
blocks in DA canonical div-class format. See
`block-level-conversion.md` §"Drafts test page".

### B.8 — Build the DA-source body fragment

Write `output/da/<page-slug>.html` in the canonical DA body
fragment format (`da-content` §1, §3.2). Structure:

```html
<body>
  <header></header>
  <main>
    <div>
      <div class="hero">
        <div><div><picture>...</picture></div></div>
        <div><div>Eyebrow text</div></div>
        <div><div><h1>Heading</h1></div></div>
        <div><div>Description text</div></div>
        <div><div>
          <p><strong><a href="/cta">CTA Label</a></strong></p>
        </div></div>
      </div>
    </div>
    <!-- ... one section div per block ... -->
    <div>
      <div class="metadata">
        <div><div>title</div><div>Page Title</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
```

No `template` metadata key — block-level pages don't use the
overlay engine. No slot-keyed rows — standard EDS positional
block tables.

DA cell image URLs must be absolute (same rule as page-level).

### B.9 — Self-checks (block-level)

```bash
# 1) Each block has both .js and .css
for dir in blocks/*/; do
  name=$(basename "$dir")
  [ -f "$dir/$name.js" ] && [ -f "$dir/$name.css" ] \
    || echo "MISSING: $dir"
done

# 2) No relative "assets/" in block CSS or fragments
grep -rn '"assets/' blocks/ fragments/ && echo "FAIL" || echo "OK"

# 3) Lint passes
npm run lint

# 4) DA cell <img> URLs are absolute
grep -oE '<img[^>]*src="[^"]+"' output/da/*.html \
  | grep -vE 'src="https?://' \
  && echo "FAIL: non-absolute DA img" || echo "OK"
```

Then start the dev server and verify:
```bash
npx -y @adobe/aem-cli up --html-folder drafts --no-open
# Open http://localhost:3000/drafts/<page-slug> in a browser
# Check: zero console errors, all blocks render, visual match
```

## Update state and finish (block-level)

Set `state.phase = "generate"`, `state.phaseStatus = "complete"`,
`state.generateCompletedAt = "<timestamp>"`. Record:
- `state.conversionLevel = "block-level"` (or `"hybrid"`)
- `state.blockCount` — number of content blocks created
- `state.fragmentCount` — number of static fragments (header +
  footer + any hybrid fallbacks)

Continue to Phase 4 (Wire).
