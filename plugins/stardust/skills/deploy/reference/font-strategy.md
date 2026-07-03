# Font strategy & CLS — deep dive

Companion to SKILL.md § Step 3 (#81 header reservation) and § Step 4 (fonts). The rules are
inline in SKILL.md as one-liners; this file carries the recipes, the metric math, the
licensing-alert mechanics, and the failure narratives. Apply every recipe that matches your
project.

## #65 — Ship an `@font-face` for EVERY named family

Prototypes name a display face AND a body face (`--display: "Hebden Incised", …;
--body: "Lekton", …`). If you self-host only the body font, every heading/numeral/title whose
stack names the un-shipped display family silently falls back to `Times New Roman`/`Arial`
(generic serif/sans) — **invisible to size/color checks** (the glyphs differ but the metrics
match; only the `FONT MISMATCH` probe flag #66 or an eyeball catches it). Distinct from
#11/#22 (wrong weight) and #30 (opsz): here the family is NAMED but NEVER SHIPPED. For each
quoted family in `--display`/`--body`/any heading stack, self-host a matching `@font-face`
(download + commit the woff2 under `styles/fonts/`, reference root-relative — never the
prototype's brand-CDN origin, #44). **Checklist:** grep every quoted family in `styles.css`'s
font stacks against the `@font-face { font-family }` names declared — any unmatched name is a
silent fallback.

## Principle 2 mechanics — self-hosting sources and licensing (#80)

License triage:
- SIL OFL 1.1 (Inter, JetBrains Mono, Fraunces, Roboto, Open Sans, IBM Plex, Source Sans,
  etc.) → self-host. License permits redistribution, including embedding on the served domain.
- Apache 2.0 (some Google Fonts) → self-host.
- **Proprietary commercial (Pangram Pangram, Adobe Fonts / Typekit, Monotype, foundry-direct)
  → self-host anyway for fidelity, BUT raise a LICENSING ALERT (#80).** The DEFAULT is
  brand-faithful: a converted/presales page that silently degrades the brand display face to
  Arial reads as broken to the client (this is exactly what a stakeholder notices first). Lift
  the prototype's actual webfonts — if the prototype ships `.otf`/`.ttf` (claude-design/
  stardust prototypes usually do, under `assets/fonts/`), convert them to latin `woff2` with
  `fontTools` (`f.flavor='woff2'; f.save(...)`, ~30–60 KB each) and declare them in
  `styles/styles.css` exactly like an OFL face.

**The licensing alert must appear in THREE places** so it can't ship unnoticed:
1. a banner comment at the top of `styles/styles.css` (`⚠️ FONT LICENSING REQUIRED BEFORE
   GOING LIVE` + foundry per family + "do not publish to `aem.live` until the
   webfont/embedding license is confirmed");
2. a `styles/fonts/LICENSING.md` file (table: file → family → foundry → status, plus the
   remove-and-fall-back instructions);
3. the conversion log, AND your hand-off message to the user.

Document the **remove path**: if licensing can't be confirmed, delete the `.woff2` + their
`@font-face` rules and the stacks fall back to the metric-matched system fallback. This is
the inverse of the old "keep CDN / accept Arial" guidance — prefer fidelity + a loud alert
over a silent generic fallback. (Only keep a CDN load when the prototype itself loads from an
Adobe/Typekit CDN AND you cannot obtain the font files — then document the CDN coupling + CLS
cost.)

### Fetching OFL fonts (fontsource via jsDelivr)

Latin-only variable woff2 is typically 30–60 KB per file, weights 100–900 included:

```bash
mkdir -p styles/fonts
curl -sSL -o styles/fonts/<name>-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-normal.woff2"
# italic, if used:
curl -sSL -o styles/fonts/<name>-italic-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-italic.woff2"
```

### #30 — Match the axes the prototype loads, incl. optical size

Check the prototype's Google Fonts `<link>` URL. If it requests an **`opsz`** (optical-size)
axis — e.g. `Source+Serif+4:opsz,wght@8..60,400;…` — the default `@fontsource-variable/<name>`
file (`<name>-latin-wght-normal.woff2`) is **wght-only** (one fixed optical master) and
headings will render subtly off (heavier/different letterforms at large sizes). Fetch the
**opsz** file instead (carries both `wght` + `opsz`, ~2× the bytes); `font-optical-sizing:
auto` (the CSS default) then tracks the size:

```bash
curl -sSL -o styles/fonts/<name>-opsz.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-opsz-normal.woff2"
```

More generally: self-host the variant whose axes match what the prototype loaded (wght-only
vs opsz; italic if used).

### #11 — Non-variable fonts (static weights)

Many Google fonts ship only as named static weights — no variable axis (e.g. **Barlow**,
Barlow Condensed, Anton). For these, `@fontsource-variable/<name>` does NOT exist; use the
**static** `@fontsource/<name>` package and fetch each weight you actually use:

```bash
curl -sSL -o styles/fonts/<name>-700.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource/<name>@latest/files/<name>-latin-700-normal.woff2"
```

Static `@fontsource` packages also do **not** publish a "Fallback" `@font-face`, so you must
**compute** the metric-override values yourself from the woff2 with fonttools:

```python
from fontTools.ttLib import TTFont
f = TTFont("styles/fonts/<name>-400.woff2"); upm=f['head'].unitsPerEm; hhea=f['hhea']; os2=f['OS/2']
arial = dict(upm=2048, xavg=904)  # Arial reference (use Times metrics for a serif brand)
size_adjust = (os2.xAvgCharWidth/upm) / (arial['xavg']/arial['upm'])
adj = upm*size_adjust
print(f"size-adjust:{size_adjust*100:.2f}% ascent-override:{hhea.ascent/adj*100:.2f}% "
      f"descent-override:{abs(hhea.descent)/adj*100:.2f}% line-gap-override:{hhea.lineGap/adj*100:.2f}%")
```

Apply those to the system-font override `@font-face` (renamed `"Arial"` / `"Times New Roman"`)
exactly as in SKILL.md's body.session recipe.

## Principle 3 mechanics — metric calibration and the CLS chain

The metric-override values for variable fonts come from the `@fontsource-variable/<name>`
package's published calibration — fetch their CSS:

```bash
curl -s "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/index.css" \
  | grep -A 6 "Fallback"
```

Each fontsource package publishes a `<Name> Fallback` `@font-face` with `size-adjust`,
`ascent-override`, and `descent-override` values. Lift those three numbers verbatim and apply
them to a local-system `@font-face` renamed to the system font (`"Arial"`,
`"Times New Roman"`, `"Courier New"`).

The CLS chain that results:
- **Initial paint**: `body { font-family: arial, sans-serif; }` — renders the metric-adjusted
  local Arial because the override `@font-face` named `"Arial"` wins over the OS Arial. Line
  box already matches the brand font's metrics.
- **Session activates**: `body.session` switches to `var(--font-body)`. Brand woff2 is still
  loading; Arial renders in its place with matching metrics. **Zero shift.**
- **Brand font loads**: swaps in. **Zero shift** because metrics already match.

## Principle 4 mechanics — fallback classification

Use the SAME class of typeface for the fallback so visual rhythm is preserved during load:
- Sans-serif brand → fallback `arial, sans-serif`. Override `@font-face "Arial"` with
  `local("Arial")`.
- Serif brand → fallback `times, "Times New Roman", serif`. Override `@font-face
  "Times New Roman"` with `local("Times New Roman")`.
- Monospace brand → fallback `"Courier New", courier, monospace`. Override `@font-face
  "Courier New"` with `local("Courier New")`. (Skipping monospace metric-matching is
  acceptable when the mono font is only used in small eyebrows/labels — CLS impact is
  negligible. Document the choice in the conversion log.)

Never substitute classifications (don't match a serif brand to Arial; don't match a sans
brand to Times). Even with metric overrides, character widths and rhythm differ enough that
the visible shift is jarring.

### #80 — Classification includes WIDTH (condensed fallbacks)

"Sans→Arial" is only right for a *normal-width* sans. A narrow/condensed display face
(PP Formula Narrow, Bebas Neue, Oswald, Barlow/Archivo Condensed, Anton) falling back to
plain Arial is a width-class mismatch: Arial runs **~15–20% wider** with different
letterforms, so headings lose the condensed character and wrap differently — a silent
divergence the eye catches even when sizes/weights/tracking match exactly (a CardValet pass
shipped PP Formula→Arial; the width probe showed Arial 975 vs PP Formula 839 for the same H1
string). When the condensed brand face is self-hosted (the default) this only bites if the
webfont is blocked, but the fallback must STILL preserve width: put a condensed system/free
face ahead of `arial` in the stack — `"<Brand>", "Arial Narrow", arial, sans-serif` (system
`Arial Narrow` is present on macOS/Windows but NOT Android/Linux, so for guaranteed coverage
self-host a free OFL condensed analog — Oswald / Barlow Semi Condensed / Archivo Narrow).
Same logic for an *extended/wide* brand face. Quick check during foundation: for every
`--*-font-family` token whose first face is condensed, confirm the final non-`sans-serif`
fallback is also condensed.

### #77 — Self-host the INTENDED fallback; verify with a width probe

Prototypes routinely load **zero `@font-face`** and name a proprietary brand font first
(`--display: "Bellfort", "Bebas Neue", system-ui`). On any machine missing the brand font the
prototype silently renders **system-ui** — so its on-screen display face is an *accident of
the viewing machine*, not the design intent. Do NOT match that accident (don't set EDS
`--display` to system-ui because "that's what the proto shows"). The prototype's OWN stack
documents the intent: self-host the first **redistributable** fallback (OFL/Apache — e.g.
Bebas Neue) so EDS ships the condensed display face the design wants; keep proprietary
families documented in the conversion log.

**Verify what actually rendered with a width probe** — `document.fonts.check('24px "X"')`
returns **true for any family name the page references**, installed or not, so it produces
false "fonts match" reads. Instead measure: a span at `font-family:"X",monospace` whose width
equals a known-absent name's width means X fell back (absent); a distinct width means X is
really rendering. (A beermaker pass set `--display` to Bebas Neue via a `fonts.check`
false-positive — the width probe later showed the proto actually renders system-ui, but Bebas
Neue was still correct as the documented intended fallback.)

### #12 — Multiple display families

A brand may use several families — e.g. Barlow (body) + Barlow Condensed + Barlow Semi
Condensed (display). The `body.session` pattern only gates the **body** family; display
families referenced directly by class (headings, eyebrows) load with `font-display: swap` and
aren't fully CLS-eliminated. Define each as a `:root` token (`--font-cond`, `--font-semi`)
and reference it per-block on the elements that use it. Fully metric-matching every display
family is optional polish — for display text used sparingly (eyebrows, big condensed
headings) the CLS impact is small; **document the trade-off** in the conversion log rather
than over-engineering it.

**But when a display family is used in an ABOVE-THE-FOLD heading (the hero `<h1>`, an LCP
title), metric-match it too** — compute its `size-adjust`/`ascent-override`/`descent-override`
from the woff2 (the same fonttools recipe as #11) and put a dedicated fallback `@font-face`
SECOND in that family's stack: `--hero: "Lilita One", "Lilita One Fallback", …`. The fallback
family MUST have its own name — do NOT reuse the renamed `"Arial"` face the body match
already defines (#11), since that carries the *body* font's metrics, not the display font's.
(In practice the dominant first-section CLS is usually the late header box, #81, not the
display-font swap — fix the header reservation first, then metric-match above-fold display
faces to zero the remainder.)

### #22 — Match the prototype's effective weight

A single-weight display font (e.g. **Anton**, ships only 400) often appears *bolder* in the
prototype than its one weight: a bare `<h1>`/`<h2>` inherits the browser-default heading
weight (700), and the browser **faux-bolds** the 400-only face. If your foundation sets
`h1,h2,h3 { font-weight: 400 }`, headings render visibly lighter than the prototype. Set the
weight the prototype actually shows (often 700) so the faux-bold matches — don't assume "one
weight in the file ⇒ `font-weight: 400`".

## #81 — Reserve the static header's height (the dominant first-section CLS)

`postlcp.js` injects `fragments/header.html` AFTER first paint (it's a deferred fetch). In
the common layout where the header sits in flow ABOVE the first section (full-bleed hero
*below* the nav), the hero therefore renders at `y=0`, then jumps DOWN by the header's height
the instant the fragment lands — a large layout shift the browser attributes to the hero
block (a real page measured **CLS 0.143, ~0.13 of it the hero**; metric-matched fonts do NOT
fix it because the cause is the header box appearing, not a font swap).

Reserve the header's rendered height on the **bare `<header>` element** in
`styles/styles.css` (it applies before the fragment loads — `decorateHeader()` sets the class
early, but styling the bare element covers the pre-class sliver too), with responsive
`min-height` matching the fragment per breakpoint and the chrome's own `background` so any
reserve-vs-actual delta is invisible:

```css
header { min-height: 98px; background: var(--brand-ground); }   /* desktop nav+banner height */
@media (width <= 767px) { header { min-height: 102px; } }
@media (width <= 480px) { header { min-height: 120px; } }       /* banner wraps to 2 lines */
```

Make the header's height **deterministic** so the reserved value actually matches: keep the
reservation breakpoints in sync with the fragment's, and avoid nav-link *wrap zones* (e.g.
extend the burger/hamburger breakpoint so the inline links can't wrap to a second row at
awkward widths). Reserve slightly OVER the natural height (a few px) so you never
under-reserve and shift — on a dark/uniform ground the small gap is invisible; a
`header:empty` page (`header: off`) removes the element so the reservation is moot. **The
footer needs NO reservation** — it's below the fold, so its late injection shifts nothing
above it.

Verify with a CLS probe (Playwright `PerformanceObserver({type:'layout-shift'})`) that
**delays the woff2/fragment fetches** to reproduce the slow-network swap PSI measures — a
fast localhost load hides the shift. Target < 0.1.
