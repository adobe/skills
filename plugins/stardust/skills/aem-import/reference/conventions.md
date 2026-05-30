# DA authoring vocabulary + EDS pipeline quirks + per-block CSS patterns

The catalogue of patterns and workarounds discovered while taking the Wheeler
CVA + service prototypes from stardust output to pixel-faithful authorable
EDS pages. Each item is a known-once-known finding — discovering it required
hitting the wall first. Bake into the skill so subsequent projects don't.

The patterns are grouped by what they fix:

- [§1 DA HTML pipeline transforms](#1-da-html-pipeline-transforms) — what DA
  preserves vs strips during content-process time
- [§2 EDS decorate-function guards](#2-eds-decorate-function-guards) — how
  `decorateButton`, `decorateIcons`, `cards.js`, `columns.js` compose in
  surprising ways
- [§3 Authoring shape conventions](#3-authoring-shape-conventions) — how to
  express prototype patterns through standard EDS block-table authoring
- [§4 Per-block CSS patterns](#4-per-block-css-patterns) — the theme CSS
  rules that translate generic blocks to brand-specific renders
- [§5 Image + asset pipeline](#5-image-asset-pipeline) — code-bus deploy +
  DA media bus timing
- [§6 Section substrate transitions](#6-section-substrate-transitions) — how
  to author warm-stone, dark, etc. via section-metadata

---

## §1 DA HTML pipeline transforms

When DA receives content via the admin.da.live source endpoint, it parses
the HTML and stores a normalized form. Some elements survive verbatim,
others get transformed, others get stripped.

### Survives intact

- `<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>`, `<li>`
- `<a>`, `<strong>`, `<em>`, `<u>`, `<code>`, `<del>`, `<mark>`
- `<picture>` with nested `<img>` (in some cell contexts — see §1.3)
- Custom classes on **top-level block divs** (`<div class="hero service">`)
- `<br>` inside `<p>`
- `<table>` (DA's block-table form)

### Stripped or transformed

- **`<small>` → stripped** (text content survives, tag does not). Use
  `<code>` instead for placeholder-eyebrow-style monospace markers.
- **`<picture>` → unwrapped in card image cells, becomes `<p><img>`** —
  the `<img>` ends up wrapped in a `<p>`, which makes `cards.js`'s
  `:scope > picture` query miss (it walks descendants too, so it still
  matches via `querySelector('picture')`, but only AFTER DA's media-bus
  reprocessing rebuilds the `<picture>` element from the stored `<img>`).
  The re-built `<picture>` has DA-generated srcsets.
- **`<img src="https://external">` → DA tries to fetch the URL and store
  in its media bus** as `./media_<hash>.<ext>`. If the fetch fails (URL
  not yet propagated on the EDS code-bus, network timeout, 404),
  DA stores `<img src="about:error">` and the image renders broken.
  See §5.
- **Custom classes on inner block cells → stripped.** A
  `<div class="placeholder-img">` inside a block cell loses its class.
  Cell-level differentiation must come from EITHER block-level variants
  (added on the outermost block div) OR cell structure (presence of
  picture, presence of specific text).

### Practical implications

- **Use `<code>` for placeholder eyebrows**, not `<small>`. The pattern:
  ```html
  <p><code>PLACEHOLDER · tier-summary</code><br><em>e.g. Example text.</em></p>
  ```
  Pair with CSS:
  ```css
  .cards.tiers .cards-card-body p:has(code) {
    border: 2px dashed var(--color-cat-yellow);
    background: rgba(255,255,255,0.5);
    padding: var(--sp-sm) var(--sp-md);
    border-radius: var(--r-primary);
    flex: 1;
  }
  .cards.tiers .cards-card-body p:has(code) code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
    display: block;
    margin-bottom: 4px;
  }
  .cards.tiers .cards-card-body p:has(code) em {
    font-style: italic !important;
    color: var(--color-body) !important;
    font-weight: normal !important;
    display: block;
  }
  ```
  The `!important` on the em styling is required when the theme has a
  competing `.text.block > div > div > p:not(:first-child) em { color:
  yellow }` rule for non-placeholder em accents (specificity ties; later
  rule + !important wins).

- **Differentiate cards/columns variants at the block level**, not the
  cell level. `<div class="cards photos seven">` ✓ —
  `<div class="cards"><div class="photo-card">...</div></div>` ✗
  (the inner classes get stripped).

---

## §2 EDS decorate-function guards

EDS's standard decorate pipeline applies specific behaviors to specific
patterns. Several have guards that look fine alone but compose in
surprising ways.

### `decorateButton` skips `<a>` containing `<img>`

The guard:
```js
if (!a.querySelector('img')) {
  // apply .button class
}
```

`decorateIcons` runs first and appends `<img src="/icons/<name>.svg">`
inside `.icon` spans. If a `.icon` span is INSIDE an `<a>`, the `<a>`
now has a nested `<img>`. `decorateButton` then skips it — no
`.button.primary` / `.button.secondary` class applied. The anchor
renders as a plain link instead of a pill.

**Workaround:** style icon-containing anchors via direct selectors,
not via `.button.<variant>`:
```css
/* CTA bar: <em><a> with phone icon → yellow pill */
.cta-bar.block p em > a {
  display: inline-flex; align-items: center; gap: var(--sp-sm);
  background: transparent; color: var(--color-cat-yellow);
  border: 1px solid var(--color-cat-yellow);
  border-radius: var(--r-pill); padding: 14px 28px;
  font-family: var(--font-display); font-weight: 700;
  font-size: 0.875rem; letter-spacing: 0.08em; text-transform: uppercase;
}
```

This bypasses decorateButton entirely.

### `decorateIcons` always appends `<img>` (and breaks icomoon font icons)

For each `<span class="icon icon-X">`, EDS appends
`<img src="${codeBasePath}/icons/X.svg">` as a child. If the SVG
file exists, the icon renders. If not, broken-image character shows.

If your theme also uses an icomoon font with `::before` content for
icons, you get DOUBLED rendering (icomoon glyph + img). To suppress:

```css
.icon > img {
  width: 1em; height: 1em;
  vertical-align: -0.15em;
  display: inline-block;
}
.icon:has(> img)::before { content: none !important; }
```

**Two-track icon strategy:**
- Chrome icons (in fragments, loaded via `loadHeader`/`loadFooter`)
  bypass `decorateIcons` entirely — they keep the icomoon font glyph
  via `::before` content. No SVG needed.
- Main-content icons need a corresponding `/icons/<name>.svg` file.
  Use `fill="currentColor"` so the SVG inherits the parent text color.

For wheelercat, the only main-content icon used is `icon-phone`.
The skill should ship a small library of common SVG icons (phone,
search, menu, etc.) and copy them at init.

### `cards.js` classifies image cells only when `<picture>` is descendant

The boilerplate cards.js:
```js
if (div.children.length === 1 && div.querySelector('picture')) div.className = 'cards-card-image';
else div.className = 'cards-card-body';
```

Works if the cell contains `<picture>` anywhere inside (querySelector
walks descendants). After DA's transform, `<picture>` may be wrapped
in a `<p>` (`<div><p><picture>...</picture></p></div>`) — children
count is 1 (the `<p>`), picture is still descendant — class applied. ✓

But if DA strips the `<picture>` wrapper entirely (raw `<img>`), the
guard fails and the cell gets `cards-card-body` class. ✗

**Workaround:** always author with `<picture><img></picture>` (not
raw `<img>`). DA's pipeline re-wraps `<img>` in `<picture>` during
media-bus processing IF it can fetch the source — but to be safe,
author with `<picture>` explicitly.

### `cards.js` runs full decorate even on theme-styled cards

When my theme styles `.cards.photos > ul > li { aspect-ratio: 3/4 }`,
the cards.js standard decoration STILL runs (wraps cells in `ul/li`,
adds `cards-card-image` / `cards-card-body` classes). My CSS works
WITH cards.js's output, not against it.

If a theme needs to OVERRIDE cards.js decoration entirely, it would
need to provide a custom `blocks/cards/cards.js`. Don't unless
necessary — composing with the standard decoration is cleaner.

### `columns.js` adds `columns-N-cols` class + `columns-img-col` per image cell

The decoration adds:
- `.columns.columns-N-cols` (block-level, N = column count of first row)
- `.columns-img-col` on cells that contain ONLY a `<picture>`

For image-text alternation, alternate row direction via CSS:
```css
.columns.alternate > div:nth-child(odd) > div:first-child { order: 2; }
.columns.alternate > div:nth-child(odd) > div:last-child { order: 1; }
```

This reverses ODD rows. For single-row image-left intent, use
`<div class="columns alternate">` (single row = row 1 = odd = reversed).
For single-row image-right intent, use `<div class="columns">` (no
alternate, default order applies).

---

## §3 Authoring shape conventions

### Hero split-lockup (two-line H1 with mid-line color accent)

Prototype pattern:
```html
<h1>MAXIMIZE EQUIPMENT PERFORMANCE WITH A</h1>
<h1>CAT® CUSTOMER VALUE AGREEMENT</h1>  <!-- yellow accent -->
```

CSS:
```css
.hero.block h1 { color: var(--color-text-on-dark); margin: 0; line-height: 0.95; }
.hero.block h1 + h1 { color: var(--color-cat-yellow); margin-bottom: var(--sp-lg); }
```

Two consecutive `<h1>` elements. CSS colors the second yellow. Reads
visually as one split-lockup headline. Avoids DA-author having to mark
mid-line spans (which can't easily survive the pipeline).

### Hero supporting line with inline accents

Use `<em>` inside the supporting `<p>` for accent spans:
```html
<p><em>HASSLE-FREE MAINTENANCE,</em> PARTS DELIVERED TO YOUR DOOR, <em>NO SURPRISE COSTS.</em></p>
```

CSS:
```css
.hero.block .supporting em {
  color: var(--color-cat-yellow);
  font-style: normal;  /* override default italic */
}
```

### Primary CTA in hero

```html
<p><strong><a href="#Form">Request Information</a></strong></p>
```

`decorateButton` matches `<p><strong><a>` pattern (p has 1 child = strong,
strong has 1 child = a) and adds `.button.primary` class. No `<picture>` /
icon inside the `<a>` (would break decorateButton).

### Multiple buttons in same row

Each button in its OWN `<p>`. CSS makes them inline:
```html
<p><strong><a href="...">Primary</a></strong></p>
<p><em><a href="...">Secondary</a></em></p>
```

CSS:
```css
.columns.block p.button-wrapper { display: inline-block; margin: 0 var(--sp-md) 0 0; }
```

Combining both buttons in one paragraph (`<p><strong><a>A</a></strong> <em><a>B</a></em></p>`) BREAKS decorateButton — both anchors stay plain.

### PLACEHOLDER signature

For sections with unsourced content that should render visually as
"this is a placeholder" (dashed-yellow box + monospace eyebrow +
italic example):

```html
<p><code>PLACEHOLDER · <type></code><br><em>e.g. example placeholder text.</em></p>
```

See §1 for the CSS pair. The `<code>` is the marker that survives DA;
the `<br>` keeps eyebrow + example on two lines; the `<em>` is the
italic-example signal.

### Breadcrumb

```html
<div class="breadcrumb">
  <div>
    <div>
      <p><a href="/">Home</a><em>›</em><a href="/service/">Service</a><em>›</em>Customer Value Agreements</p>
    </div>
  </div>
</div>
```

The `<em>` wraps the `›` separator. CSS:
```css
.breadcrumb.block p em {
  color: var(--color-cat-yellow);
  font-style: normal;
  font-weight: 700;
  padding: 0 var(--sp-xs);
}
```

The current page (last segment) is plain text, not a link.

---

## §4 Per-block CSS patterns

### Generic block selector vocabulary

The vocabulary that EDS pages use (after standard decoration):

| Block class | Variant classes | DOM after decoration |
|---|---|---|
| `.hero` | `.service`, etc. | `<div class="hero block">` with cells as direct children |
| `.text` | `.centered` | `<div class="text-wrapper"><div class="text block"><div><div>...content...</div></div></div></div>` |
| `.cards` | `.tiers`, `.rail`, `.photos`, `.photos.seven`, `.photos.three`, `.photos.two` | `<div class="cards block"><ul><li><div class="cards-card-image\|body">...</div></li>...</ul></div>` |
| `.columns` | `.alternate` | `<div class="columns columns-N-cols block"><div>row<div>cell</div>...</div>...</div>` |
| `.cta-bar` | `.stacked` | `<div class="cta-bar block">...content...</div>` (no special decoration) |
| `.breadcrumb` | — | `<div class="breadcrumb block">...content...</div>` |

### Section substrate transitions

Substrate via section-metadata in DA:
```html
<div class="section-metadata">
  <div><div>style</div><div>warm-stone</div></div>
</div>
```

CSS:
```css
main .section.warm-stone { background: var(--color-warm-stone); padding: var(--sp-section) 0; }
main .section.dark { background: var(--color-surface-dark); color: var(--color-text-on-dark); padding: var(--sp-section) 0; }
main .section.dark a { color: var(--color-text-on-dark); }

main .section:not(:has(.block)) { display: none; }  /* hide empty metadata-only sections */
```

### Block stubs

For every generic block class the theme uses without per-block JS:
```js
/* blocks/<name>/<name>.js */
export default function decorate() { /* no-op; styling is theme-owned */ }
```
```css
/* blocks/<name>/<name>.css — empty */
```

This silences EDS's per-block resource 404s in the console.

### Hero text container width (CRITICAL — pure CSS bug fix)

The prototype's hero typically has padding on an OUTER container and
max-width on an INNER container, giving content the full max-width.
EDS hero has both on the same element. Direct `max-width: 1100px`
gives only `1100 - padding` for content. Fix:

```css
.hero.block > div > div:first-child {
  --hero-pad-l: clamp(var(--sp-lg), 5vw, 96px);
  --hero-pad-r: var(--sp-lg);
  padding: calc(var(--sp-section) * 1.25) var(--hero-pad-r) calc(var(--sp-section) * 1.25) var(--hero-pad-l);
  max-width: calc(<proto-inner-width> + var(--hero-pad-l) + var(--hero-pad-r));
}
```

Translated: max-width includes padding so content gets the full
prototype max-width.

---

## §5 Image + asset pipeline

### DA media bus image-fetch race

When DA receives content with `<img src="https://eds-codebus-url/image.jpg">`,
it fetches the URL at content-process time and stores in its media bus.

**Problem:** if the EDS code-bus hasn't yet propagated the new image
(git push happened seconds ago), DA's fetch returns 404 and stores
`<img src="about:error">`. The image renders broken.

**Workaround:**
1. Push code (assets) to git first
2. Wait for code-bus deploy (typically 5–8s)
3. PUT DA content (so DA fetches images from the now-propagated URLs)
4. Trigger preview

If a previous DA push got `about:error`, re-PUT the same content
after code-bus deploy completes — DA re-runs media-bus processing
on the re-PUT.

### Per-theme asset paths

The convention:
```
<eds-project>/assets/<theme>/
  media/      ← images
  fonts/      ← woff2 etc.
  logo.png    ← brand logo
```

Sibling themes can share `/assets/<other-theme>/fonts/` and
`/assets/<other-theme>/logo.png` to avoid duplication. The theme
CSS just references the path:

```css
@font-face {
  font-family: "Oswald";
  src: url("/assets/wheelercat-home/fonts/<file>.woff2") format("woff2");  /* shared */
}
```

---

## §6 Section substrate transitions

DA section-metadata pattern:
```html
<div>                         <!-- top-level section wrapper -->
  <!-- blocks for this section -->
  <div class="section-metadata">
    <div><div>style</div><div>warm-stone</div></div>
  </div>
</div>
```

EDS's `decorateSections` reads the metadata and applies each
space-separated `style` value as a class on the parent `.section`
div. Multiple styles combine (e.g., `style: dark hero`).

Each top-level `<div>` inside `<main>` becomes one section. Multiple
sections enable substrate transitions — each section can have its
own metadata.

Hide the metadata leftover (which becomes an empty section after
EDS lifts the page metadata to `<head>`):
```css
main .section:not(:has(.block)) { display: none; }
```

---

## Cross-reference

These patterns are realized in the wheelercat reference theme at
`github.com/paolomoz/uplift-wheelercat-eds`:

- `styles/wheelercat-cva-blocks.css` — full per-theme stylesheet
  with all the patterns above
- `fragments/wheelercat-cva-blocks/{header,footer}.html` — chrome
- `scripts/scripts.js`, `blocks/header/header.js`, `blocks/footer/footer.js`
  — engine patch (see `engine-patch.md`)
- DA content at `/customer-value-agreements-blocks-test.html` and
  `/service-blocks-test.html` — two authored pages exercising the
  full pattern catalogue
