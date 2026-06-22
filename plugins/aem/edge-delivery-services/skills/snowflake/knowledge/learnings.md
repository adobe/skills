# Learnings — Cross-Run Findings

Append entries as `## YYYY-MM-DD — short title` at the top. The date
indicates when the entry was written, not when the underlying rule
applies. When an entry stabilizes (it has held across multiple
inputs), promote it to `architecture.md` or `eds-da-mechanics.md`
as a verified fact, and link back here.

Categories to look for as the list grows:
- **Conversion patterns** that worked across different inputs
- **EDS gotchas** discovered while wiring the overlay
- **DA gotchas** discovered while pushing content
- **LLM prompting patterns** that produced good block segmentation
- **DOM equality failures** — what slipped past the converter and why
- **Things that looked simple but weren't**

---

## 2026-05-29 — Link slots with inline decorative elements (SVGs, icons) must use the span-wrapper pattern

**Surfaced on:** photoshop-features (run 010) — 7 CTA links with SVG chevrons.

When an `<a>` element contains both authorable text AND decorative
non-authorable content (inline SVG icons, glyph spans, pseudo-element
triggers), do NOT put `data-slot` on the `<a>`. The link writer replaces
`innerHTML`, destroying the decorative content.

**Pattern to detect during Analyze (Phase 2):**

Any `<a>` that is a slot candidate AND contains:
- `<svg>` child elements
- `<img>` child elements (decorative icons, not the primary content)
- Text nodes mixed with non-text siblings

**Fix:** Wrap only the text portion in `<span data-slot="...">`, leaving
the decorative elements as siblings inside the `<a>`. The `href` stays
static in the template (not authorable). If `href` authoring is also
needed, use a separate attribute-level mechanism (not currently supported
by the slot writer).

**Scope:** This applies to ALL slot writer types that replace innerHTML,
not just links. Any element where `writeSlot()` would overwrite children
that include decorative template chrome is at risk. The link case is the
most common because CTAs frequently pair text with arrow/chevron icons.

**The general rule:** Before placing `data-slot` on ANY element, inspect
its children. If the element contains non-authorable siblings of the
authorable text (SVGs, decorative images, icon fonts), wrap only the
authorable portion and leave the rest as template chrome.

---

## 2026-05-20 — AEM boilerplate's default `styles/fonts.css` contaminates overlay pages

**Surfaced on:** ups-gb refresh (run 017) — visible font rendering divergence.

The AEM EDS boilerplate ships `styles/fonts.css` with Roboto and Roboto-Condensed
`@font-face` rules. The substrate's `scripts.js` `loadFonts()` loads this file
on every page, including overlay pages. The boilerplate's font declarations
were leaking into overlay rendering for any source that mentions Roboto in
its font-family fallback chain.

### Why this bites

A source page like UPS UK declares:

```css
body { font-family: "Roboto, Tahoma, Helvetica, Arial, sans-serif"; }
```

…but does NOT load a Roboto webfont. The source intends system Tahoma fallback.
The converted overlay page on EDS:
- Loads the boilerplate's `styles/fonts.css` via `scripts.js loadFonts()`
- That CSS declares `@font-face { font-family: roboto; src: url('../fonts/roboto-bold.woff2'); }`
- The `font-family: Roboto, Tahoma, ...` declaration now finds a real Roboto
- Browser renders Roboto instead of system Tahoma

Visual outcome: font weights, x-heights, kerning, letter shapes all subtly differ
from the source. The page LOOKS converted but doesn't feel 1:1.

### Substrate-level fix (shipped in v1.0.5)

The substrate now ships its own empty `styles/fonts.css` and the install
manifest replaces the boilerplate's version. Overlay pages render with the
source's declared fallback chain — no boilerplate-injected webfonts.

If a per-template needs a webfont (the source page DID load Roboto via
`<link>` or `@font-face`), declare it in that template's
`/styles/<template>.css`. The page CSS extraction in Phase 3 already
preserves source-side `@font-face` declarations.

### Phase 4 (Wire) self-check

After wiring, compare the source page's `document.fonts` set against the
converted page's `document.fonts` set (both via `playwright-cli run-code`).
If the converted page has additional loaded fonts that the source doesn't,
investigate — usually a sign of leaked boilerplate fonts or a webfont the
template CSS injected that wasn't in the source.

### Existing branches

Pre-1.0.5 branches that were converted with the boilerplate's Roboto still
ship the leaky fonts.css. They'll be fixed automatically on next refresh
(substrate install at v1.0.5+ overwrites the file with the empty version).
For an immediate fix without refresh, empty out `styles/fonts.css` at the
branch level and push.

---

## 2026-05-20 — inline content elements belong INSIDE the slot, not as static template siblings

**Surfaced on:** polestar refresh (run 010) — `<sup>¹</sup>` footnote marker.

Source page has an inline element mid-sentence in a heading:

```html
<h2 class="incentive__head">Not the status quo. Tesla owners receive $14,000.<sup>¹</sup></h2>
```

**The trap:** A sub-agent looked at this and reasoned "the sup is structural,
the text is content — give the author a slot for just the text and keep the
sup as static template chrome." Result:

```html
<!-- WRONG: sup outside the slot -->
<h2 class="incentive__head">
  <span data-slot="head">Not the status quo. Tesla owners receive $14,000.</span>
  <sup>¹</sup>
</h2>
```

DA cell: `Not the status quo. Tesla owners receive $14,000.` (no sup).

This breaks two things:

1. **`.md` representation is incomplete.** Authors see the headline text
   without the footnote marker. If they remove the footnote later, the
   orphan sup is invisible to them — they can't clean it up.
2. **Round-trip fidelity is lost.** The source HTML has the sup as inline
   content; the converted page splits it across template chrome and slot
   content. Anyone reading the DA-stored content can't reconstruct the
   intended rendering.

### The rule

**Mid-sentence inline elements are CONTENT, not chrome.** Put them inside
the slot value. Use a single `data-slot` on the heading/paragraph element
itself, not a sub-`<span>`:

```html
<!-- RIGHT: data-slot on the heading, sup inside -->
<h2 class="incentive__head" data-slot="head">Not the status quo. Tesla owners receive $14,000.<sup>¹</sup></h2>
```

DA cell: `Not the status quo. Tesla owners receive $14,000.<sup>¹</sup>` —
visible and editable in the DA editor.

### Which elements does this apply to

The EDS pipeline preserves the same semantic-inline set listed in the
2026-05-20 `<span class="...">` entry below: `<sup>`, `<sub>`, `<strong>`,
`<em>`, `<del>`, `<ins>`, `<mark>`, `<code>`, `<kbd>`, anchors, images.
All of these belong inside the slot when they appear mid-sentence.

### When IS it OK to keep an inline element as template chrome?

Rare, but possible:
- The element is a **purely structural placeholder** (e.g. an SVG icon, a
  decorative dingbat) that's tied to the template's visual design and
  shouldn't be authored.
- The element wraps the slot rather than sitting beside it (e.g. a `<sup>`
  decorating the *whole* slot's content, not a fragment mid-sentence —
  unusual).

For everything mid-sentence, default to "inside the slot."

### Phase 3 (Generate) self-check

When constructing slot markers, scan the source heading/paragraph being
slotted. If it contains any inline elements from the preserved list AND
those elements sit between text runs (not wrapping the whole element),
put `data-slot` on the heading/paragraph itself and include the inline
elements in the slot value. Do NOT introduce a `<span data-slot>` that
excludes them.

---

## 2026-05-20 — EDS pipeline strips `<span class="...">` from DA cell content

**Surfaced on:** glossier refresh (run 008) — sale prices.

The EDS post-pipeline drops `<span class="...">` wrappers — the tag
disappears and the class is lost, text content survives bare in the
parent. See `da-content` §3.9 for the full preserve/rewrite/strip
behavior across all inline tags.

### Why this bites

Generator pages frequently use `<span class="foo">` purely as styling hooks:

```html
<p class="product-card__price">
  <del>CHF 20.90</del>
  <span class="product-card__price-now">CHF 14.63</span>
</p>
```

```css
.product-card__price-now { color: var(--color-sale-orange); }
```

After DA round-trip, the live page renders as:

```html
<p class="product-card__price">
  <del>CHF 20.90</del>
  CHF 14.63                <!-- span and its class are gone -->
</p>
```

…and the CSS rule has nothing to match → sale price shows in default color.

### How to handle in Generate phase

When source CSS targets a `<span class="...">` for styling and the span isn't
load-bearing semantically, choose ONE of:

1. **CSS-only fix using structural selectors** (preferred — no markup change):
   Use `:has()`, sibling combinators, or `:nth-child()` to target the position
   instead of the class. Example for the price pattern:

   ```css
   /* whole <p> orange when it contains a <del>; del rule overrides back grey */
   .product-card__price:has(del) { color: var(--color-sale-orange); }
   .product-card__price del { color: var(--color-fg-muted); }
   ```

2. **Swap `<span>` for a semantic element** that survives the pipeline.
   Per `da-content` §3.9 the safest targets are tags in the
   preserve list (`<strong>`, `<em>`, `<u>`, `<del>`, `<code>`,
   `<sub>`, `<sup>`). Rewrite-target tags (`<b>`, `<i>`, `<s>`,
   `<mark>`, `<kbd>`) work too but their wrapper tag changes on the
   way out — page CSS must target the rewritten tag, not the source
   one. Update the page CSS to target the element instead of the class:

   ```html
   <p><del>CHF 20.90</del> <strong>CHF 14.63</strong></p>
   ```

   ```css
   .product-card__price strong {
     color: var(--color-sale-orange);
     font-weight: inherit;  /* override default <strong> bold */
   }
   ```

### How to detect in Phase 2 (Analyze)

When mapping CSS selectors to slot opportunities, flag any rule that targets
`.<class>` on a `<span>` and emit a decisions.json note. Then choose the
strategy above during Phase 3 (Generate).

### Counter-pattern: spans with `data-slot`

A `<span data-slot="...">` does survive — the substrate's writeSlot writes
text into it before DA serialization ever happens. The pipeline only strips
spans from the FINAL DA-stored content. Spans that are template-only
(populated at runtime by the overlay engine) are unaffected.

### Anti-pattern: literal arrow flattening

Don't flatten `<del>X</del> <span>Y</span>` to `X → Y` plain text in DA. The
arrow is a presentation artifact of the strikethrough rendering, not part of
the content. Storing `→` literally:
- Loses the strikethrough (no `<del>`)
- Loses the color styling (no class hook)
- Adds noise that DA authors will see and may "correct"

Keep `<del>` in the DA cell. Handle the sale-price color via CSS (option 1
above) or semantic-element swap (option 2). Branch fix: see
glossier-a `styles/glossier.css` `.product-card__price:has(del)` rule.

---

## 2026-05-19 — substrate `footer > .footer { visibility: hidden }` leaks into fragment inner divs

The substrate lifecycle CSS uses `footer > .footer { visibility: hidden }` to hide
the EDS footer block wrapper until JS decoration completes. The selector is
`footer > .footer` — a direct-child combinator.

**The leak:** When a footer FRAGMENT uses `<footer>` as its root element (a
common pattern — the source page's `<footer>` tag is preserved verbatim in the
fragment), the DOM structure becomes:

```html
<footer>                          <!-- EDS landmark -->
  <div class="footer block">      <!-- EDS wrapper, matched by footer > .footer -->
    <footer>                      <!-- fragment root, also a <footer> element -->
      <div class="footer">        <!-- inner nav div, matched by footer > .footer ! -->
```

The inner `<div class="footer">` is a direct child of the fragment's `<footer>`
element. That `<footer>` element is itself a `<footer>` tag. So `footer > .footer`
ALSO matches the inner nav div, making it `visibility: hidden` permanently (it
has no `data-block-status` attribute to trigger the override rule).

**Visual symptom:** Footer navigation columns are invisible. The legal text / copyright
row (if not a `.footer` element) is visible. Structurally the DOM is complete.

**Fix in page CSS:** Add `visibility: visible` to the scoped inner-nav rule:
```css
footer[data-section="footer"] > .footer {
  visibility: visible; /* counteract substrate footer > .footer { visibility: hidden } */
  ...
}
```

**Substrate fix (recommended):** Change the substrate rule from
`footer > .footer { visibility: hidden }` to
`footer > .footer.block { visibility: hidden }`.
The `.block` qualifier limits it to EDS block wrappers only, which is the intent.

Observed: polestar-a (footer nav entirely invisible without this fix).

---

## 2026-05-19 — `writeSlot()` heading-in-heading nesting creates empty DOM elements

When a DA cell value contains a heading element (`<h2>text</h2>`) and the
template slot target is also a heading (`<h2 data-slot="title">`), calling
`el.innerHTML = value` causes the browser's HTML parser to auto-close the
outer `<h2>` before opening the inner one. Result: an empty `<h2>` in the
rendered DOM, followed by the authored heading outside the template hierarchy.

**Visual symptom:** Empty `<h2>` elements appear in the DOM with no content.
Accessibility tree is polluted. Layout may shift.

**Fix in `writeSlot()`:** Detect when target is a heading element and value
contains a same-tag heading; unwrap inner heading content:
```js
if (/^H[1-6]$/.test(el.tagName)) {
  const tmp = document.createElement('div');
  tmp.innerHTML = value;
  const inner = tmp.querySelector(el.tagName.toLowerCase());
  el.innerHTML = inner ? inner.innerHTML : value;
  return;
}
```

Observed: lovesac-a (4 empty headings in DOM from slot values that contained
`<h2>` elements as wrappers around the authored text).

---

## 2026-05-19 — Inner CSS class repeated as section first-class collides with layout rules (5 occurrences)

The CSS class collision pattern from heathrow run-001 (`phases`/`phased-expansion`)
recurred 4 more times in the batch run. Pattern:

1. Source has `<section class="ugc-grid section">` (Glossier)
2. CSS has `.ugc-grid { display: grid; grid-template-columns: repeat(3,1fr) }`
3. Grid applies to outer section → inner div gets 1-column width → content collapses

Affected pages and their collision classes:
| Page | Collision class | Fix |
|---|---|---|
| heathrow | `phases` | → `phased-expansion` |
| glossier | `ugc-grid` | → `ugc` |
| aman | `audience-grid` | → `section` (removed first-class) |
| lovesac | `lifestyle-grid` | → removed from section |

**The rule MUST be enforced during the Analyze phase:** For every candidate
section first-class, grep the page CSS for that class name. If it appears as a
CSS selector with layout properties (display, grid, flex, width, height,
visibility), it CANNOT be the section first-class. Choose a different
discriminator.

This is now the **most common single source of post-conversion layout bugs**.
It should be added to the Generate phase self-check (step 3.9) as:

```bash
# 6) No section first-class appears as a CSS selector with layout properties
for cls in $(grep -oE 'class="[^"]+' output/templates/<tpl>.html \
  | grep '<section' | awk '{print $1}'); do
  grep -q "\.${cls}[[:space:]]*{" output/styles/<tpl>.css \
    && echo "COLLISION: $cls appears in CSS — rename section first-class"
done
```

---

## 2026-05-19 — Page CSS `section, header, footer { padding }` leaks into EDS landmark `<header>`/`<footer>`

**Bug:** A common pattern in source pages is to set section padding with a
generic selector like:

```css
section, header, footer { padding: var(--section-padding) var(--spacing-lg); }
```

In the SOURCE page this is fine — the source's own `<header>`/`<footer>` use
specific class overrides (`.promo-strip`, `.site-header`) with class-level
padding that wins on specificity. But in the converted EDS page, the EDS
landmark `<header>` and `<footer>` elements have NO such overriding class —
they're just bare `<header>` / `<footer>` wrapping the fetched fragment. The
generic rule fires on them with full force, adding (typically) 128px+ of
vertical padding the source never had. The hero ends up pushed down ~200px.

**Symptom:** Hero / first-visible content sits much lower than in source.
First-fold CTAs may end up below the viewport.

**Substrate fix** (in `styles/styles.css`):

```css
body > header,
body > footer {
  padding: 0;
  margin: 0;
}
```

Specificity `(0,0,2)` for `body > header` wins over plain `header (0,0,1)`,
no `!important` needed. Only resets the EDS landmark wrappers — inner
fragment elements (`.promo-strip`, `.site-header`, `.site-footer`) keep
their own padding from page CSS unchanged.

Observed: frescopa-a refresh (hero pushed down 199px; CTAs below the fold).

---

## 2026-05-19 — `writeSlot` heading-in-heading nesting creates empty DOM elements [PROMOTED to substrate v1.0.3]

When a DA cell value contains a heading element (`<h2>text</h2>`) and the
template slot target is also a heading (`<h2 data-slot="title">`), calling
`el.innerHTML = value` causes the browser's HTML parser to auto-close the
outer `<h2>` before opening the inner one. Result: an empty `<h2>` in the
rendered DOM, followed by the authored heading outside the template hierarchy.

Originally fixed at the branch level for lovesac-a (run 016). The fix lived
on the branch only — the substrate kept producing the bug on fresh runs.
Surfaced again on frescopa-a refresh (substrate v1.0.2 installed; empty h1
in hero). Now promoted to substrate v1.0.3 — `writeSlot` adds a heading
branch that unwraps the inner heading's `innerHTML` before assigning.

```js
if (/^H[1-6]$/.test(tagName)) {
  const tmp = document.createElement('div');
  tmp.innerHTML = value;
  const inner = tmp.querySelector(tagName.toLowerCase());
  el.innerHTML = inner ? inner.innerHTML : value;
  return;
}
```

**Lesson learned:** branch-level patches don't survive `snowflake refresh`
(which resets the branch to vanilla main). If a fix is generic enough to
recur, promote to the substrate immediately — don't leave it on a single
branch. Refreshes are the canary that surfaces missed promotions.

---

## 2026-05-19 — `writeSlot` dispatch: background-image check must come before the `<a>` (link) check

**Bug:** When a slot target is `<a data-slot="X" style="background-image:url(...)">`, the
`writeSlot()` function dispatches on `tagName === 'A'` (link branch) before reaching the
background-image branch. The link handler copies `href + innerHTML` from the DA cell, which
is an `<img>` element. This replaces the entire inner tile structure (label, CTA, etc.)
with just `<img>`, silently wiping all nested `[data-slot]` children.

**Symptom:** Section appears empty or loses inner content. Activity labels, card captions,
tile CTAs all gone despite being present in the template and DA cells.

**Fix** (substrate `writeSlot`):
```js
// Guard the <a> branch so background-image tiles fall through
if (tagName === 'A' && !(el.style && el.style.backgroundImage)) {
  ...link handler...
  return;
}
// background-image branch now catches <a> tiles correctly
if (el.style && el.style.backgroundImage) { ... }
```

Observed: patagonia-a (activity tile grid — 6 tiles with `<a data-slot="tile-N.bg">`).

---

## 2026-05-19 — DA block class must exactly match template section's first class (including vendor prefix)

The overlay engine's `readBlockSlots` keys slots by `block.className.split(/\s+/)[0]` from
the DA post-pipeline HTML. `applySlotsToTemplate` matches by
`section.className.split(/\s+/)[0]` from the template. If the source uses prefixed
class names (e.g. Lemonade's `ds-hero`, `ds-valueprops`), the DA block div's class must
carry that same prefix — not a stripped form like `hero`.

**Concrete failure:** DA block `<div class="hero">` + template `<section class="ds-hero">` →
no match → slots silently not applied, template defaults displayed for all slots in that section.

**Fix:** Derive DA block class names from the template section's actual first class, not
from the block's semantic label or the `data-section` attribute.

## 2026-05-19 — DA Media Bus rejects SVGs over ~40KB during preview POST (409)

The DA pipeline validates SVG sizes when converting DA HTML to Markdown at `POST preview`
time. SVGs over ~40KB cause a 409 `AEM_BACKEND_FETCH_FAILED` with "Images N have failed
validation". This is enforced even for publicly-reachable images.

**Asymmetry:** Template/fragment HTML fetches SVGs via the browser directly — no size cap.
DA cell `<img>` SVG references go through Media Bus html2md conversion — 40KB cap applies.

**Lemonade example sizes that failed:** home-left (45KB), home-right (76KB), press logos
(251KB), bundle card illustrations (81–158KB), pizza diagram (176KB).

**Fix:** Omit over-limit SVG image slots from the DA doc. The template default values
display those images at runtime (browser fetches SVG directly from CDN, no cap). Only
include DA image slots for SVGs under 40KB and for any PNG/WEBP/AVIF images.

**Pre-flight check to add:** During Analyze phase, for each image slot candidate, HEAD the
URL and note content-length. Flag any SVG ≥ 40KB as "template-default-only" in decisions.json.

## 2026-05-19 — Don't put `data-slot` on a container that has nested `data-slot` children

The slot writer for every element type (`<a>`, `<picture>`, default
text) writes to the target's `innerHTML` (or replaces the element
entirely). When the target has nested `[data-slot]` children, those
markers and their content are destroyed before they can be processed.

Common failure: a card wraps icon + title + body in an
`<a class="card-link" data-slot="card-N.link">`, AND the inner
`<h3>`/`<p>`/`<img>` also carry `data-slot`. The link writer runs
first, sets `innerHTML` to the DA cell value (e.g.
`<a href="#">Learn more</a>`), and obliterates the inner slot markers.
The card renders as a bare label with no content.

**The rule.** For any element pattern where a container wraps multiple
authorable children: slot the children individually, leave the
container static. Conversely, if you want the whole block to be
authorable as one chunk, don't slot its children. Never both.

**Edge cases.** An `<a data-slot="cta">Learn more <img></a>` (text
plus decorative icon, no nested `data-slot`) is fine — the icon is
lost on edit but that's acceptable for buttons. The trigger is
**nested `[data-slot]`**, not "any inner content".

**Substrate implications.** The engine COULD detect this and warn
(or skip the outer slot when inner data-slots exist). For now,
this is a methodology-level rule applied during the Generate phase.

## 2026-05-19 — Cross-origin `@font-face` requires CORS headers on the font host

Browsers strictly enforce CORS on `@font-face url(…)` requests,
unlike `<img>`, `<script src>`, `<source src>`, or CSS
`url(image.jpg)` references, which all work cross-origin without
explicit headers.

When a source page self-hosts fonts on a different origin from the
served EDS page, every font URL produces:

> Access to font at '…' from origin '…' has been blocked by CORS
> policy: No 'Access-Control-Allow-Origin' header…

Fonts then fall back to system-ui. For mainstream typefaces
(Adobe Clean, Inter), the visual difference is subtle but noticeable.

**Mitigation paths.**
- Configure source host CORS to send `Access-Control-Allow-Origin: *`
  (or matching) on font responses.
- Migrate fonts to the EDS repo's `/fonts/` directory (counts as
  asset migration — out of methodology scope).
- Replace `@font-face` with a font CDN that does send CORS headers
  (Adobe Fonts kit, Google Fonts).

## 2026-05-19 — Media Bus needs ABSOLUTE URLs in DA cells (root-relative produces `about:error`)

EDS Media Bus, which optimises `<img>` URLs in DA-source HTML, only
handles **absolute URLs**. Root-relative paths
(`/assets/section-2/card-image-1.png`) are resolved against the DA
content host (`content.da.live`) where those paths don't exist — the
pipeline serves them as `<img src="about:error">` and the browser
surfaces a console `ERR_UNKNOWN_URL_SCHEME` error.

Cards using a background-image slot writer end up with
`style="background-image: url('about:error')"` and render as black
tiles.

**Fix.** Use absolute URLs in DA cells. After re-upload, Media Bus
correctly fetches and optimises:
`./media_<sha>.png?width=750&format=webply&optimize=medium`.

**The asymmetry that's easy to miss.**
- Template/fragment HTML refs to `/assets/...` — the BROWSER
  resolves these against the rendered page host, which is the
  code-bus host. Code-bus serves `/assets/`. Works fine.
- DA cell `<img src=...>` refs — the EDS PIPELINE (Media Bus)
  resolves these. Media Bus resolves against the DA content host.
  Doesn't work unless the URL is absolute to a publicly reachable
  image source.

**Generic rule for DA cells with images.** Always use absolute URLs.
Common shapes that work:
- Vendored same-branch: `https://<branch>--<repo>--<owner>.aem.page/assets/...`
- Public source (github.io, etc.): `https://<source-host>/assets/...`
- DA media: `https://content.da.live/<org>/<repo>/media_<sha>...`

## 2026-05-19 — Vendoring `/assets/` in the repo is a viable option for locally-hosted source pages

When the source URL is private/local-only, the cleanest alternative
to "skip production" is to copy the source's asset tree (or just the
referenced subset) into `/assets/` at the repo root. Code-bus serves
them at the same paths the source used, so:

- Template and fragment HTML keep relative paths working (browser
  resolves against the rendered page host = code-bus).
- CSS `url(…)` refs (e.g. `@font-face`) keep working same-origin.
- Same-origin means no CORS issues for fonts.
- DA cell image refs still need to be absolute URLs (see the
  Media-Bus learning above).

**Trade-offs.**
- Binary assets in git — discouraged by EDS guidance for production
  sites because they bloat the repo and slow code-bus pulls.
  Acceptable for one-off bespoke prototypes.
- DA media migration would be the cleaner long-term path but
  requires upload tooling not currently in scope.

**Steps that work.**
1. `cp -R <source-assets-dir> ./assets/`
2. Remove `.DS_Store`s and unreferenced files.
3. Rename any directory with spaces in the name (AEM CLI 404s on
   URL-encoded `%20`).
4. `sed` pass to rewrite source-host URLs to root-relative
   `/assets/...` in template/fragments/CSS/DA-output files.
5. For the DA doc specifically, also rewrite to ABSOLUTE branch
   URLs (Media Bus requires absolute).

## 2026-05-19 — AEM CLI dev server 404s on URL-encoded `%20` (spaces in paths)

When a source asset directory has spaces in its name, browsers
URL-encode them (e.g. `Adobe%20Clean%20Display`). The AEM CLI's
static-file middleware returns 404 for the encoded form even though
the file exists at the decoded path on disk.

**Fix.** Rename directories to remove spaces before committing.
Replace with PascalCase (`AdobeCleanDisplay`) or kebab-case
(`adobe-clean-display`), and update CSS `url(…)` refs to match.

## 2026-05-19 — Locally-hosted source pages: production round-trip needs an asset story

When the source URL is on a private host (`localhost`, `127.0.0.1`,
intranet IP), the production preview host cannot reach those assets.
Initial conversions that rewrite asset paths to absolute private
URLs will work locally but break on production.

**Three forward paths** when the source URL is local-only:

1. **Skip production round-trip.** Document the gap, complete local
   verification only. Lowest effort; least value.
2. **Vendor assets in the repo at `/assets/`.** Same paths work
   locally and on production via code-bus. Caveat: binary assets in
   git. Acceptable for one-off bespoke prototypes. DA cell image
   refs still need absolute URLs (see Media Bus learning above).
3. **Asset migration to DA `/media/`.** Cleaner long-term. Needs a
   tool to walk asset references, upload via DA admin API to
   `/media/`, rewrite paths in DA cells. Out of methodology scope.
4. **Publish the source publicly.** GitHub Pages, Netlify drop, even
   an `ngrok http 8080` for a one-off — anything that gives the
   production preview host a reachable URL.

**Don't default to path #1 without asking.** Vendoring is often
~30 minutes of mechanical work and gives a fully working production
deploy. Surface the choice instead of silently scoping production
out.

## 2026-05-19 — Hero (or any logical section) may be a `<div>`, not `<section>` — rewrite to `<section>`

The overlay engine's `applySlotsToTemplate` does
`templateMain.querySelectorAll('section[class]')` — so a `<div>`-shaped
hero would never match a block name from the DA doc.

**Generic rule.** In the Generate phase, when a logical section in
the source uses any tag OTHER than `<section>` (most common: hero
divs, nav wrappers, footer-like callouts), rewrite the outermost
element to `<section class="originalClassListHere">`. Keep the inner
DOM intact. The CSS continues to work because the original classes
carry through.

This complements the existing methodology rule about synthesizing
`<main>` when the source doesn't have one.

## 2026-05-19 — For scroll-animated pages, fullPage screenshots are misleading; capture per-section instead

Source pages that use `position: sticky` hero with parallax plus
IntersectionObserver-driven `.anim-enter` fades break full-page
screenshots. A `fullPage: true` capture renders the page at its
top-of-scroll state — sticky positioning leaves visual gaps, and
`.anim-enter` elements stay at `opacity: 0` because they were never
scrolled into view to trigger their observers.

**What works.** For each section, call
`element.scrollIntoView({ block: 'start' })` followed by a 400–800ms
settle, then take a viewport screenshot.

**Rule of thumb.** If the source page uses `position: sticky`,
scroll-driven JS, `IntersectionObserver`, or any of the well-known
scroll-animation patterns, default to per-section viewport
screenshots in the Round-trip phase.

---

## 2026-05-18 — Source HTML may not have a `<main>` wrapper

The overlay engine queries `doc.body.querySelector('main')` to extract
the template's main content — if the parser returns null, the engine
bails with `console.warn('[overlay] template "X" has no <main>')`.

Some source pages omit `<main>` entirely, with top-level sections as
direct children of `<body>`, sandwiched between `<header>` and
`<footer>`. This is valid HTML5.

**Generic rule.** The Generate phase must wrap the body-level
sections in a synthesized `<main>` when the source doesn't already
have one. The `<main>` is not authored content; it's a contract
boundary between the overlay engine and the template.

## 2026-05-18 — Sections can share a first-class — disambiguate via `data-section`

The overlay engine matches DA block tables to template sections by
the template `<section>` element's first class
(`section.className.split(' ')[0]`). When the input contains multiple
`<section class="section" ...>` blocks (or any other shared first
class), they all collide on `section.section` selectors and the
engine can't tell them apart.

**Generic rule.** The Generate phase must ensure each template
`<section>`'s **first class** is unique within the template. When
the source's first class isn't unique, derive a unique first-class
from `data-section` (Stardust's stable discriminator) and reorder
so it's first in the class list. The original classes stay in the
list — CSS rules depending on them still apply.

Example:
```diff
- <section class="section" data-section="activity-tile-grid">
+ <section class="activity-tile-grid section" data-section="activity-tile-grid">
```

Pattern observed across Stardust 0.2.0 outputs: when a generator
emits semantically distinct sections that happen to share a utility
class (`section`, `card`, `tile`, etc.), use the `data-section` (or
equivalent per-instance label) as the canonical unique identifier.

## 2026-05-19 — DA admin PUT replaces the entire doc — clobbers author edits

The DA admin source API has no merge semantics.
`PUT /source/<org>/<repo>/<path>.html` **replaces the document
wholesale**. If the user has made content edits in the DA editor
since the last upload, a PUT of your local copy silently discards
their edits.

**Generic rule for any "edit local file → upload to DA" workflow.**
- Before PUTting, GET the current DA source and diff against your
  last-uploaded version to surface author edits.
- If there are edits, either merge them into the local copy or flag
  them to the user before proceeding.
- A naive PUT after a session of DA editing **will lose work**.

A safer pattern for incremental updates: fetch the DA source first,
modify in place (e.g., insert new slot rows but keep author-edited
slot values), then PUT.

## 2026-05-19 — Background-image slot writer (5th writeSlot case)

Static pages often use CSS-driven photos rather than `<img>` tags
— hero backdrops, tile/card "media" divs with
`style="background-image:url(…)"`. None are authorable through a
slot writer that only knows `<img>`/`<picture>`/`<a>`.

**Substrate addition** in `scripts/overlay-engine.js writeSlot()`: when the
target element has a truthy `el.style.backgroundImage`, treat it as
a background-image slot. The DA cell carries an `<img>`; the engine
extracts the `src` and writes
`el.style.backgroundImage = \`url('\${src}')\``, preserving any other
inline styles. ~8 lines.

Template authoring: add `data-slot` to the existing background-
image-bearing element. No DOM restructuring required.

DA authoring: an `<img src="…" alt="…">` in the cell. Authors get
DA's standard image picker.

**Bonus:** the EDS pipeline's Media Bus auto-rewrites `<img>` URLs
in DA cells to optimised references (e.g.
`./media_<sha>.jpg?width=750&format=jpg&optimize=medium`). The
engine writes that URL into background-image — so the overlay-
rendered page gets responsive, optimised images even when the source
markup is CSS-driven.

## 2026-05-19 — When `data-section` is absent, derive first-class from a label or eyebrow

Not every source has `data-section` attributes — hand-crafted pages
and non-Stardust generators won't. When multiple sections still share
a first class, derive a slug from the section's **visible label**
(the `<p class="label">` or similar eyebrow typically present at the
top of every section in static-page designs):
- `<p class="label label--accent">About this consultation</p>`
  → `about-consultation` becomes the first class
- `<p class="label label--accent">A phased expansion</p>`
  → `phased-expansion` becomes the first class

**Discriminator hierarchy** (in order):
1. `data-section` attribute (Stardust convention).
2. `id` attribute on the section element.
3. Slug from the most prominent eyebrow/label inside the section.
4. Last resort: positional `section-N`.

## 2026-05-19 — Source pages with relative asset paths need URL rewriting

Some sources use **absolute CDN URLs** for their images
(`https://investor.example.com/…`, `https://cdn.shopify.com/…`).
These work unchanged in the overlay because absolute URLs resolve
identically from any host.

Other sources use **relative paths** (`assets/photos/hero.jpg`,
`assets/logos/logo.png`). These resolve against the serving host. On
the overlay-served URL (`localhost:3000/drafts/<page>.html` or
`<branch>--<repo>--<owner>.aem.page/<da-root>/<page>`), they 404
because the assets don't exist at the corresponding paths on the
serving host.

**Generic rule for the Generate phase.** Scan the source for relative
asset references (matches like `="assets/`, `url('assets/`, etc., or
any non-`http(s)`/non-`data:` URL in src/href/url() positions).
Rewrite to absolute URLs pointing back to the source's host.

Asset migration is **explicitly out of scope** — link back to the
source's CDN/host for images, fonts, etc. If a future iteration wants
self-hosted assets, the DA `/media/<site-slug>/` pattern is the
path. For now, "rewrite to source-absolute" keeps things simple.

## 2026-05-18 — Boilerplate lifecycle CSS uses descendant selectors that catch fragment internals

The boilerplate `styles/styles.css` ships a visibility-lifecycle rule
for the empty header/footer placeholders:

```css
/* before */
header .header,
footer .footer { visibility: hidden; }

header .header[data-block-status="loaded"],
footer .footer[data-block-status="loaded"] { visibility: visible; }
```

The intent: hide the EDS block wrapper (the `<div class="header block">`
that's the direct child of `<header>`) until JS decoration flips
`data-block-status` to `"loaded"`.

The bug: `header .header` is a DESCENDANT selector. It matches **any**
`.header` inside a `<header>`. If the fetched fragment contains its
own `<header class="header">` (same class name), the descendant rule
matches and hides it. The override rule needs `data-block-status` on
the matched element, which the fragment-internal header doesn't
have → permanently hidden.

**Substrate fix** (in `styles/styles.css`): tighten to direct-child:

```css
/* after */
header > .header,
footer > .footer { visibility: hidden; }

header > .header[data-block-status="loaded"],
footer > .footer[data-block-status="loaded"] { visibility: visible; }
```

`header > .header` only matches the immediate `.header` child of
`<header>` — the EDS block wrapper. Fragment-internal
`<header class="header">` or `<footer class="footer">` are nested
deeper and escape.

**Generic rule.** When adding cascading CSS to the boilerplate
substrate that targets standard HTML element classes (`.header`,
`.footer`, `.nav`, etc.), prefer direct-child selectors. Fragment
markup is opaque to the substrate; you don't know what class names
authors will use inside.

## 2026-05-18 — Boilerplate block CSS leaks into overlay-fetched fragments

EDS auto-loads `/blocks/<blockname>/<blockname>.css` for every
decorated block. The aem-boilerplate's `blocks/header/header.css`
(272 lines) and `blocks/footer/footer.css` define element-level
rules scoped to the BOILERPLATE's DA-authored nav markup:

```css
/* from boilerplate blocks/header/header.css */
header nav { display: grid; ... margin: auto; ... }
header .nav-wrapper { ... position: fixed; ... }
```

In the overlay model, `blocks/header/header.js` fetches a static
`/fragments/<template>/header.html` containing the source page's
real nav markup. The boilerplate's element-level selectors match the
fragment's `<nav>` elements too and cascade destructively (e.g.
`display: grid` killing flex-row layouts, `margin: auto` competing
with `margin-left: auto` on utility items).

**Fix.** Empty `blocks/header/header.css` and
`blocks/footer/footer.css` with a comment explaining why. Don't
keep them as dead-but-loaded files. For overlay-controlled pages,
ALL header/footer styling comes from `/styles/<template>.css` —
the source's inline `<style>` extracted faithfully.

**Generic rule.** When the overlay model takes over a block's
behaviour by replacing its JS (as for header/footer), the matching
boilerplate CSS becomes a hazard, not an asset. Empty it. If
another block ever gets the same treatment, do the same.

## 2026-05-18 — Template head-level `<link>` resources must be lifted into document.head

If the source `<head>` has `<link>` elements (Google Fonts
preconnects, external stylesheets, preload hints) that the mechanical
CSS extraction misses, fonts and other resources named in the
extracted inline `<style>` won't resolve. The browser falls back to
system-ui, which is visually similar to many design fonts but
distinctly not the same.

**Substrate fix.** `scripts/overlay-engine.js` `applyTemplateOverlay` lifts
any top-level `<link>` elements from the template file into
`document.head` (deduping by href+rel). Templates self-describe
their head-level resource needs.

**Conversion-phase rule.** When extracting head resources, capture
all `<link>` elements — not just stylesheets, also preconnects and
any preload hints. Put them at the top of the template file, above
`<main>`. They get picked up automatically.

This gap is easy to miss when the source's fonts happen to be
system-installed on the developer's machine (e.g. Adobe Clean for
users with Adobe apps installed). It only surfaces when a font
nobody has locally needs to load.

## 2026-05-18 — Templates without an animation engine cost ~150 KB of wasted CDN load

If `delayed.js` always loads GSAP + ScrollTrigger + Lenis before
checking whether the page's template actually has an animation
engine, plain-HTML templates pay ~150 KB of motion libs downloaded
for nothing, plus a 404 on the missing engine script.

**Fix in `scripts/delayed.js`.** HEAD-probe
`/scripts/<template>-animations.js` before loading CDN deps. If the
probe 404s, skip everything silently.

Residual: the HEAD probe's own 404 still logs as a network error in
the browser console (cosmetic — page renders fine). A future polish
could use a `<meta name="has-animations">` flag in the DA metadata
block instead of file-presence probing.

## 2026-05-18 — Promoting learnings to knowledge files works

When the Generate-phase subagent prompt is just "read
methodology.md + learnings.md + project docs, then produce template
+ DA doc per the rules in those docs" — without re-inlining specific
lessons from prior runs — the subagent can still apply those rules
correctly on first pass.

This validates the "promote learnings to knowledge/, then a future
agent reads them and doesn't re-make the mistake" model. Knowledge
files act as durable, machine-readable memory for the substrate.

## 2026-05-18 — Generator placeholder conventions vary across versions

| Generator | Placeholder marker |
|---|---|
| Stardust 0.3.0 | `<element data-placeholder="true">` attr + nested `placeholder-eyebrow` / `placeholder-shape` spans |
| Stardust 0.2.0 | `<span class="placeholder-tag">` inline marker inside the containing element |

The Generate phase needs to detect which convention is in the input
and tell the slot extractor what to skip. Both produce the same
"static template content, not a slot" outcome — but the marker
differs.

**Generic rule.** The Analyze phase should document the input's
placeholder convention in `notes.md`; the Generate subagent reads
that and applies the right skip pattern. Don't hardcode either
convention into methodology — sniff and pass.

## 2026-05-18 — Metadata block must sit inside `<main>`, not `<footer>`

Empirically, a `<footer><table>...</table></footer>` in DA source is
ignored by the pipeline — zero `<meta>` tags emitted in the rendered
head beyond EDS-injected viewport / twitter:* defaults. The overlay
engine then bails (no `<meta name="template">` → standard EDS
decoration falls through → one 404 per block trying to load
`/blocks/<name>/<name>.{css,js}`).

Snowflake emits metadata as `<div class="metadata">` inside `<main>`.
Block format itself is covered by `da-content` §5.

## 2026-05-18 — DA stores HTML literally; tables survive intact

Two things worth confirming about the DA admin source API:

1. **`PUT https://admin.da.live/source/{org}/{repo}/{path}.html` with
   `multipart/form-data` (field `data`)** returns 200 plus a JSON
   payload with the four canonical URLs (editUrl, contentUrl,
   previewUrl, liveUrl). The `Content-Type` for the field is sniffed
   from the data; passing `type=text/html` on the form part works.

2. **What you PUT is what DA stores.** Uploading a table-format doc
   with `<table>` + `<th>` + `<tr><td>slot</td><td>value</td></tr>`
   rows preserves the table shape byte-for-byte on GET. DA does not
   normalize tables → divs server-side. The table → div conversion
   happens only at pipeline render time (post-publish). The DA editor
   presents the table view of source for authoring.

This contradicts the (implicit) assumption that "DA's editor
canonicalizes everything to divs on save." If a doc has been through
DA's prose editor (open + edit + save), it can come back in
div-format with `<p>` wrappers around cell contents — but that's an
editor-roundtrip artifact, not DA's storage behavior. Direct PUT
preserves source exactly.

## 2026-05-18 — Two competing block-content models in DA

Both models work in DA and produce valid post-pipeline EDS markup.
The choice has author-UX and engine-design implications.

| Aspect | **Slot-keyed** | **Positional** |
|---|---|---|
| Row shape | `slot-name \| value` (2 cells) | `value` only (1 cell) |
| Block id | `<th>Hero</th>` header row | `<div class="hero">` class |
| Author UX | Sees slot names — clearer for partial edits | Sees just values — terser, EDS-native |
| Engine needs | Custom slot-resolution (overlay) | Standard EDS block decorators |
| Add/remove rows | Slots keyed by name; safe to add | Position-coupled; reordering changes meaning |
| Schema clarity | Slot names self-document fields | Schema is implicit in block JS |

- **Slot-keyed** is friendlier for authors editing AI-generated
  content because the slot names anchor what each cell is for
  ("title", "cta-primary", "card-3.tagline"). Authors don't need
  to remember "the 4th row is the CTA."
- **Positional** is closer to native EDS conventions and means a
  generic EDS deploy could render the page with stock block
  decorators if one is shipped per template.

The overlay engine + template `[data-slot]` markers lock in the
slot-keyed model. Positional is worth revisiting in a future
iteration to compare editor UX side-by-side.

## 2026-05-18 — DA admin and content-bus gotchas

Two specific gotchas worth flagging:

1. **`aem content push` ≠ published.** Drafts stage in DA's source
   endpoints. To make a page reachable at `aem.page`, you must
   `POST admin.hlx.page/preview/{owner}/{repo}/{branch}/{path}`.
   For `aem.live`, `POST admin.hlx.page/live/...`. Either step
   without the other looks like a successful push but produces a
   404 at the public URL.

2. **SVG cap is 40 KB.** Tight enough that complex illustrations
   often exceed it. AI generators that emit SVG-heavy hero or
   decoration markup may push you into rejection. Sniff SVG sizes
   during the Analyze phase.

For image migration, prefer `/media/<site-slug>/<filename>` so
assets don't collide across projects. Same DA path → same Media Bus
content-addressed name across branches.

## 2026-05-14 — EDS dev server (`aem up`) serves drafts content verbatim

`aem up --html-folder drafts` does **not** run the EDS pipeline on
files served from the drafts folder. The DA-format `<table>` blocks
stay as tables, the `<head>` is not injected from `head.html`,
metadata-table → `<meta>` conversion doesn't happen.

Drafts is for *raw post-pipeline content*, not DA-shape content.

**Implication.** Every conversion needs a DA-to-post-pipeline
transformer step before drafts becomes usable locally. The
production `.aem.page` pipeline does run on DA-uploaded content
correctly — DA → pipeline is the normal flow. The local drafts
shortcut just bypasses it.

## 2026-05-14 — Overlay engine must skip standard EDS decoration on main

EDS's `decorateSections` queries `main > div`. Overlay templates use
`main > section.<blockname>` (and `main > div.<wrapper>` for
pin-spacer cases). Half of a template's main children are
`<section>` elements that EDS would ignore; the other half are
`<div>` wrappers that EDS would mistake for sections and re-wrap.

Either way, running standard EDS decoration on overlay-controlled
main produces broken DOM.

**Solution.** The overlay sets `main.dataset.overlay = templateName`.
`loadEager` skips `decorateMain` / `loadSection` when the marker is
present. `loadLazy` similarly skips `loadSections` on overlay main
(header/footer fragment loading is unchanged).

## 2026-05-14 — Body-hidden-until-`appear` gives a free no-flicker overlay window

EDS's `styles/styles.css` has `body { display: none }` and
`body.appear { display: block }`. The `appear` class is added at
the end of `loadEager`. This is the EDS pattern for "no CLS, no
flash of unstyled content" — but it doubles as an overlay window.

Sequence:
1. Page HTML arrives → body hidden by CSS.
2. `scripts.js` `loadEager` runs.
3. Overlay engine reads slots, fetches template, fills slots,
   replaces main innerHTML. (Body still hidden.)
4. `body.appear` added → body shown for the first time.

Result: user sees the overlay-merged DOM, never the intermediate
EDS-shape DOM. Zero flicker.

## 2026-05-14 — Inline HTML in slot values works via innerHTML

Some slots contain inline HTML
(`<span class="accent">everywhere</span>` inside a hero title,
`<a href>` content in CTAs). The writer function in
`applySlotsToTemplate` dispatches by tag:
- `IMG` → copy `src`, `alt`
- `PICTURE` → replace element with new picture
- `A` → copy `href`, set innerHTML to anchor's innerHTML
- default → set `innerHTML` (preserves inline HTML)

Using `innerHTML` for the default handler is the key. `textContent`
would emit `&lt;span class="accent"&gt;...` literally and break the
typography accent.

## 2026-05-14 — EDS `toClassName` makes block names case-tolerant

`toClassName("Closing Cta")` → `closing-cta`. So is
`toClassName("Closing CTA")`. The block-table-to-class mapping is
normalized: only alphanumerics survive, hyphens between words, all
lowercase.

**Conversion implication.** Match block tables to template sections
by class slug (lowercased, hyphenated). Title-case of the
block-table label is human-readable cosmetic; whatever the converter
chooses is fine as long as the slug round-trips.

## 2026-05-14 — Generators emit "deliberate placeholder" UIs we must preserve

Stardust marks not-yet-authored slots with
`<element data-placeholder="true">` containing a `placeholder-eyebrow`
span and a `placeholder-shape` span. The result is a visible
"PLACEHOLDER · image" UI that the designer intends to stay visible
until real content arrives.

These elements look like slots but **should not become slots**.
They're visible static template content with future intent. The
converter marks them `data-slot-skip="placeholder"` and leaves the
markup alone. The rendered DOM stays identical to the original;
authors get a clear flag that those positions are reserved.

Different generators will have different placeholder conventions (or
none). The rule generalises: **anything explicitly tagged as
placeholder / template-state in the source is not authorable
content — preserve as-is.**

## 2026-05-14 — Fragment load lifecycle: nested `<header>` is fine

EDS adds `header-wrapper` / `footer-wrapper` classes and wraps the
header/footer block content. A header fragment that includes its
own `<header>` element produces nested landmarks in the rendered
DOM:

```html
<header class="header-wrapper">
  <div class="header block">
    <section class="announcement-banner">...</section>
    <header class="gnav">...</header>
    ...
  </div>
</header>
```

HTML5 allows nested `<header>` (the inner one is sectional content
inside an enclosing landmark). CSS class selectors target the inner
classes directly so the nesting is invisible.

**Constraint surfaced.** If a future source's CSS uses
`body > header` or `body > .announcement-banner` (direct-child
selectors targeting the bare body), the EDS wrappers will break
those. Check generator CSS for direct-child selectors during the
Analyze phase.

## 2026-05-14 — Header is broader than `<header>`; footer broader than `<footer>`

AI-generated pages often have global UI elements that don't sit
inside the `<header>` or `<footer>` semantic landmarks:
- Above main: announcement banners, mega-nav dropdown panels
  (siblings of `<header>` but functionally coupled)
- Below main: floating sticky CTAs, modal backdrops, modals

The fragment-extraction rule that works:
- Everything from `<body>` start to `<main>` start → header fragment
- Everything from `</main>` end to `<footer>` end → footer fragment
- Template = `<main>` content only

The fragment-load code injects fragments into EDS's `<header>` and
`<footer>` elements. CSS class selectors keep working.

## 2026-05-14 — Sequential CDN script chain is fragile

A `.reduce(..., Promise.resolve())` chain that loads GSAP →
ScrollTrigger → Lenis sequentially with a single `.catch` aborts the
rest of the chain (and any engine script that depends on them) if a
single CDN miss occurs.

**Fix.** Use `Promise.allSettled` so each CDN is loaded
independently. The engine script can defensively check for `gsap`,
`Lenis`, `ScrollTrigger` and degrade gracefully if any are missing.
Reduced-motion guards in `animations.js` that wrap each timeline
already let missing libs no-op rather than crash.
