# Block-Level Conversion — Architecture and Patterns

Reference for Phases 3–5 when `conversionLevel` is `block-level` or
`hybrid`. Read `block-level-feasibility.md` first (covers the
decision criteria); this document covers the implementation.

## How it differs from page-level

| Aspect | Page-level (overlay) | Block-level |
|--------|---------------------|-------------|
| Main content | One template with `[data-slot]` markers | N independent EDS blocks, each with own JS + CSS |
| Header/footer | Static fragments fetched by block decorators | Same — static fragments fetched by block decorators |
| DA content | Slot-keyed rows (`name \| value`) | Standard EDS block tables (positional rows) |
| CSS | One file: `styles/<template>.css` | Global tokens in `styles/styles.css` + per-block CSS in `blocks/<name>/<name>.css` |
| Runtime engine | Overlay engine in `scripts/overlay-engine.js` reads slots, fetches template, merges at runtime | Standard EDS decoration: `decorateSections` → `decorateBlocks` → each block's `decorate()` runs |
| Substrate | Overlay substrate required (slot writer, template loader) | Standard EDS boilerplate — no substrate needed |

## Output layout

Block-level produces a different file tree than page-level:

```
# Global foundation
styles/styles.css                     ← design tokens, base typography, shared components
styles/fonts.css                      ← empty or @font-face (fonts via head.html CDN link)
head.html                             ← font preconnects + stylesheet link (appended)

# Header/footer (static fragments)
fragments/<brand>/header.html         ← promo strip + site header markup
fragments/<brand>/footer.html         ← footer markup
blocks/header/header.js               ← fragment loader (replaces boilerplate nav decorator)
blocks/header/header.css              ← header + promo strip styles
blocks/footer/footer.js               ← fragment loader (replaces boilerplate footer decorator)
blocks/footer/footer.css              ← footer styles

# Content blocks (one pair per section)
blocks/<block-name>/<block-name>.js   ← decorator: reads rows, builds source DOM
blocks/<block-name>/<block-name>.css  ← section-scoped styles from source

# Assets (vendored)
assets/                               ← images, logo, etc. from source

# Test page
drafts/<page-slug>.html               ← full HTML page with DA-format block tables

# DA content (for upload)
output/da/<page-slug>.html            ← DA body fragment with block tables
```

## Global styles extraction

Split the source's inline `<style>` into two buckets:

### 1. Global → `styles/styles.css`

Extract and merge with the EDS boilerplate skeleton:

- **`:root` custom properties** — all design tokens (colors, fonts,
  spacing, radii, breakpoints). Keep the source's naming.
- **Reset rules** (`*`, `html`, `body`) — merge with EDS's
  `body { display: none }` / `body.appear { display: block }` lifecycle.
- **Base typography** (`h1`–`h4`, `p`, `a`, `button`) — replace
  boilerplate Roboto defaults with the source's font stack.
- **Shared components** used across multiple sections:
  - `.eyebrow` — uppercase label with bottom border
  - `.btn` variants (`.btn-primary-on-bay`, `.btn-secondary`, etc.)
  - `.editorial` — serif display type
  - `.label`, `.catalog` — type utility classes
- **EDS section overrides** — full-bleed sections need:
  ```css
  main > .section { margin: 0; padding: 0; }
  main > .section > div { max-width: none; margin: 0; padding: 0; }
  ```
- **EDS header/footer lifecycle** — keep the boilerplate visibility
  rules but set `header { height: auto; }` (source headers vary).
- **Responsive breakpoint rules** for `:root` token overrides.
- **Reduced motion** media query.

### 2. Per-section → `blocks/<name>/<name>.css`

For each content section, extract all CSS rules that are scoped to
that section's class name. Include:

- The section's own layout/background/padding rules
- All descendant rules (`.section-name .child { ... }`)
- Media queries scoped to the section
- A wrapper override to allow full-bleed:
  ```css
  .<name>-container .<name>-wrapper {
    max-width: unset;
    padding: 0;
  }
  ```
  EDS wraps each block in `<name>-wrapper` inside `<name>-container`
  (the section). Both have default max-width/padding from the
  boilerplate that must be overridden for full-bleed sections.

### CSS selector rewriting

The source uses element-level selectors like `section.hero { ... }`.
In EDS the block element is `div.hero.block`. Class selectors work
regardless of element type, so `.hero { ... }` targets both. But
if the source has tag-qualified selectors like `section.hero`, drop
the tag prefix — use `.hero` instead.

## Block decorator pattern

Each block JS exports a default `decorate(block)` function. The
pattern:

```js
export default function decorate(block) {
  // 1. Read authored rows from the block table
  const rows = [...block.children];
  const img = rows[0]?.querySelector('img');
  const eyebrow = rows[1]?.textContent.trim();
  const heading = rows[2]?.querySelector('h1, h2, h3');
  // ... etc per content model

  // 2. Clear the block
  block.textContent = '';

  // 3. Build the source DOM structure
  const container = document.createElement('div');
  container.className = 'container';
  // ... build nested elements matching source HTML

  // 4. Append to block
  block.append(container);
}
```

### Key principles

- **Read rows positionally.** Each `block.children[i]` is a row
  (a `<div>` containing cell `<div>`s). Single-column blocks have
  one cell per row; multi-column blocks have multiple cells.
- **Clear before rebuilding.** `block.textContent = ''` removes
  the DA-format table rows before injecting the source DOM.
- **Build the source DOM exactly.** Use `createElement` + class
  names that match the source CSS. The block CSS targets these classes.
- **Handle EDS button decoration.** By the time `decorate()` runs,
  `decorateButtons()` has already processed `<strong><a>` → 
  `.button.primary` and `<em><a>` → `.button.secondary`. The
  decorator should check for both the raw format (strong/em) and
  the decorated format (.button classes) when reading CTA links.
- **Use CSS custom properties for dynamic values.** When the source
  uses inline styles (e.g., `background-image: url(...)`), prefer
  setting a CSS custom property via JS and referencing it in CSS.
  This allows media queries to override the value:
  ```js
  block.style.setProperty('--hero-bg', `url('${src}')`);
  ```
  ```css
  .hero { background-image: linear-gradient(...), var(--hero-bg); }
  @media (width <= 720px) {
    .hero { background-image: linear-gradient(...), var(--hero-bg); }
  }
  ```

### Multi-column content models

Some blocks have rows with multiple cells (e.g., a card grid where
each row is one card with image | title | catalog-line). The
decorator reads cells from each row:

```js
const cells = [...row.children]; // cells[0], cells[1], cells[2]
```

A common pattern for blocks with a header + repeating items:
- Row 0: header cells (eyebrow | heading)
- Rows 1–N: item cells (image | title | subtitle)

## Header/footer fragment pattern

Header and footer decorators are simple fragment loaders:

```js
export default async function decorate(block) {
  const resp = await fetch('/fragments/<brand>/header.html');
  if (!resp.ok) return;
  block.innerHTML = await resp.text();
}
```

The fragment HTML files contain the source's header/footer markup
with asset paths rewritten to root-relative `/assets/...`. The CSS
for header/footer goes in the block CSS files
(`blocks/header/header.css`, `blocks/footer/footer.css`).

### What goes in header vs footer fragments

- **Header fragment**: everything from `<body>` start to the first
  content section — promo strips, announcement banners, navigation,
  search bar, etc.
- **Footer fragment**: everything from after the last content section
  to `</body>` minus `<script>` tags — footer columns, legal text,
  social links, etc.

## Content model design

For each section, design a DA block table that is natural to author.
Guidelines:

### Row ordering

Follow the visual order of the section, top to bottom:
1. Background image (if applicable) — first row
2. Eyebrow / label text
3. Heading
4. Subhead / description
5. CTA links
6. Supporting image (if applicable) — last row

### CTA links in DA

Authors format CTAs using the standard EDS convention:
- `<strong><a href="...">Label</a></strong>` → primary button
- `<em><a href="...">Label</a></em>` → secondary button

Each CTA in its own `<p>` within the cell, so `decorateButtons()`
can process them. The block decorator reads the result (either the
raw strong/em or the .button.primary/.button.secondary form).

### Multi-item blocks (cards, grids)

Use multi-column rows. Row 0 is the header; rows 1–N are items:

```
| Shop Categories |
| Shop | Shop all Frescopa products. |
| <picture> | [Coffee Machines](/machines) | MACHINES |
| <picture> | [Bagged Coffee](/coffee) | COFFEE · WHOLE BEAN |
```

The title cell can contain a link — the decorator extracts the href
to make the whole card clickable.

### Structural elements generated by the decorator

Some elements are structural (not authored):
- Search forms (input + button) — the decorator generates these
- Container/wrapper divs — structural scaffolding
- Gradient overlays — CSS-driven, not content

These live in the decorator, not in the DA content. The author
controls the text/images; the decorator controls the structure.

## Fonts setup

- **`head.html`**: append Google Fonts (or other CDN) preconnects
  and stylesheet link. Placed after the existing CSP meta but before
  `aem.js`.
- **`styles/fonts.css`**: empty with a comment. The boilerplate's
  `loadFonts()` loads this file; leaving it empty prevents the
  default Roboto from leaking into the page.

If the source self-hosts fonts, vendor the font files to `/fonts/`
and add `@font-face` rules to `styles/fonts.css` instead.

## scripts.js modifications

Block-level conversion uses the standard EDS decoration pipeline.
Minimal changes to `scripts/scripts.js`:

- **`buildHeroBlock`**: add an early return if `.hero` already
  exists as an authored block — prevents the auto-blocker from
  duplicating it:
  ```js
  function buildHeroBlock(main) {
    if (main.querySelector('.hero')) return;
    // ... rest of existing logic
  }
  ```
- No overlay engine needed — remove or skip any overlay-related code
  if the substrate was previously installed.

## Drafts test page

The local test page at `drafts/<page-slug>.html` must be a **full
HTML document** because `aem up --html-folder drafts` serves files
as-is without injecting `head.html`. Include:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page Title</title>
  <!-- Font preconnects + stylesheet (same as head.html additions) -->
  <script src="/scripts/aem.js" type="module"></script>
  <script src="/scripts/scripts.js" type="module"></script>
  <link rel="stylesheet" href="/styles/styles.css">
</head>
<body>
  <header></header>
  <main>
    <div>
      <div class="hero">
        <!-- DA-format rows -->
      </div>
    </div>
    <div>
      <div class="next-block">
        <!-- DA-format rows -->
      </div>
    </div>
    <!-- ... more sections ... -->
  </main>
  <footer></footer>
</body>
</html>
```

Each section is a `<div>` inside `<main>` containing one block div
in canonical DA format (`<div class="block-name">` with row/cell
children). The browser-side `scripts.js` handles decoration:
`decorateSections` → `decorateBlocks` → block JS loads and runs.

## Hybrid conversion

When `conversionLevel` is `hybrid`, some sections are block-level
and some are page-level. The failing sections (from the feasibility
assessment) become **static fragments** — similar to header/footer
but for mid-page content.

For each failing section:
1. Extract its markup as a fragment file
   (`fragments/<brand>/<section-name>.html`)
2. Create a minimal block decorator that fetches and injects it
3. The section's CSS goes in the block CSS file as usual
4. No DA authoring for that section — it's static

Passing sections follow the standard block-level pattern above.

## Self-checks (block-level)

After generating all artifacts:

```bash
# 1) Each block has both .js and .css
for dir in blocks/*/; do
  name=$(basename "$dir")
  [ -f "$dir/$name.js" ] && [ -f "$dir/$name.css" ] || echo "MISSING: $dir"
done

# 2) No relative "assets/" in block CSS
grep -rn '"assets/' blocks/*//*.css && echo "FAIL" || echo "OK"

# 3) Lint passes
npm run lint

# 4) Dev server renders without console errors
# (manual or via Playwright — take viewport screenshot per section)

# 5) Visual comparison with source
# (screenshot source page, screenshot EDS page, compare per section)
```
