# Step 4 — Self-host fonts and minimize CLS (full text)

Full text of deploy Step 4. Read:
- § 0 — first: every named family ships an `@font-face` (#65);
- § 1 and § 2 — before fetching any font: `head.html` stays untouched; self-host every face, licensing alert (#80), axes (#30), non-variable fonts (#11);
- § 3 — when writing `styles/fonts.css` and the `-fallback` faces: the deferred-load + metric-override chain (#40);
- § 4 — when choosing the fallback: classification incl. width (#80);
- § Further font traps — when a face still looks wrong: intended fallback + width probe (#77), multiple display families (#12), effective weight (#22).

## 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Four principles, applied in this order on every project:

## 0. Every named family ships an `@font-face` (#65)

**0. Ship an `@font-face` for EVERY named family — not just the body face (#65).** Prototypes name a display face AND a body face (`--display: "Hebden Incised", …; --body: "Lekton", …`). If you self-host only the body font, every heading/numeral/title whose stack names the un-shipped display family silently falls back to `Times New Roman`/`Arial` (generic serif/sans) — **invisible to size/color checks** (the glyphs differ but the metrics match; only the `FONT MISMATCH` probe flag #66 or an eyeball catches it). Distinct from #11/#22 (wrong weight) and #30 (opsz): here the family is NAMED but NEVER SHIPPED. For each quoted family in `--display`/`--body`/any heading stack, self-host a matching `@font-face` (download + commit the woff2 under `fonts/`, reference root-relative — never the prototype's brand-CDN origin, #44). **Checklist:** grep every quoted family in `styles.css`'s font stacks against the `@font-face { font-family }` names declared — any unmatched name is a silent fallback.

Then four principles, applied in this order on every project:

## 1. `head.html` untouched

**1. Leave `head.html` untouched. No font lines, period.**
No Google Fonts `<link>`. No CDN `<link rel="stylesheet">` for type. No `<style>` blocks declaring `@font-face`. **No `<link rel="preload" as="font">`** either — even self-hosted preloads belong out of `head.html`. **Brand `@font-face` declarations live in `styles/fonts.css`** (the file `loadFonts()` loads — eagerly on desktop and repeat views via the `fonts-loaded` session flag, always in `loadLazy`); **the metric-matched `-fallback` faces live in `styles/styles.css`** (they must be available at first paint). The fallback split (principle 3) eliminates the CLS that preloading is normally meant to prevent.

## 2. Self-host every brand face — licensing alert, axes, non-variable fonts

**2. Self-host EVERY brand face — including proprietary ones — and emit a licensing alert (#80).**
Inspect the prototype to identify each font family and its license:
- SIL OFL 1.1 (Inter, JetBrains Mono, Fraunces, Roboto, Open Sans, IBM Plex, Source Sans, etc.) → self-host. License permits redistribution, including embedding on the served domain.
- Apache 2.0 (some Google Fonts) → self-host.
- **Proprietary commercial (Pangram Pangram, Adobe Fonts / Typekit, Monotype, foundry-direct) → self-host anyway for fidelity, BUT raise a LICENSING ALERT (#80).** The DEFAULT is brand-faithful: a converted/presales page that silently degrades the brand display face to Arial reads as broken to the client (this is exactly what a stakeholder notices first). So lift the prototype's actual webfonts — if the prototype ships `.otf`/`.ttf` (claude-design/stardust prototypes usually do, under `assets/fonts/`), convert them to latin `woff2` with `fontTools` (`f.flavor='woff2'; f.save(...)`, ~30–60 KB each) and declare them in `styles/fonts.css` exactly like an OFL face. Because they're proprietary you MUST surface the licensing obligation in THREE places so it can't ship unnoticed:
  1. a banner comment at the top of `styles/styles.css` (`⚠️ FONT LICENSING REQUIRED BEFORE GOING LIVE` + foundry per family + "do not publish to `aem.live` until the webfont/embedding license is confirmed");
  2. a `fonts/LICENSING.md` file (table: file → family → foundry → status, plus the remove-and-fall-back instructions);
  3. the conversion log, AND your hand-off message to the user.
  Document the **remove path**: if licensing can't be confirmed, delete the `.woff2` + their `@font-face` rules and the stacks fall back to the metric-matched system fallback (principle 3/4). This is the inverse of the old "keep CDN / accept Arial" guidance — prefer fidelity + a loud alert over a silent generic fallback. (Only keep a CDN load when the prototype itself loads from an Adobe/Typekit CDN AND you cannot obtain the font files — then document the CDN coupling + CLS cost.)

For OFL fonts, fetch latin-subset variable woff2 files. The fastest reliable source is jsDelivr's `@fontsource-variable/<name>` packages:

```bash
mkdir -p fonts
curl -sSL -o fonts/<name>-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-normal.woff2"
# italic, if used:
curl -sSL -o fonts/<name>-italic-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-italic.woff2"
```

Latin-only variable woff2 is typically 30–60 KB per file, weights 100–900 included.

**Match the axes the prototype loads — incl. optical size (#30).** Check the prototype's Google Fonts `<link>` URL. If it requests an **`opsz`** (optical-size) axis — e.g. `Source+Serif+4:opsz,wght@8..60,400;…` — the default `@fontsource-variable/<name>` file (`<name>-latin-wght-normal.woff2`) is **wght-only** (one fixed optical master) and headings will render subtly off (heavier/different letterforms at large sizes). Fetch the **opsz** file instead (carries both `wght` + `opsz`, ~2× the bytes); `font-optical-sizing: auto` (the CSS default) then tracks the size:
```bash
curl -sSL -o fonts/<name>-opsz.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-opsz-normal.woff2"
```
More generally: self-host the variant whose axes match what the prototype loaded (wght-only vs opsz; italic if used).

**Non-variable fonts (#11).** Many Google fonts ship only as named static weights — no variable axis (e.g. **Barlow**, Barlow Condensed, Anton). For these, `@fontsource-variable/<name>` does NOT exist; use the **static** `@fontsource/<name>` package and fetch each weight you actually use:
```bash
curl -sSL -o fonts/<name>-700.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource/<name>@latest/files/<name>-latin-700-normal.woff2"
```
Static `@fontsource` packages also do **not** publish a "Fallback" `@font-face`, so you must **compute** the metric-override values yourself (principle 3) from the woff2 with fonttools:
```python
from fontTools.ttLib import TTFont
f = TTFont("fonts/<name>-400.woff2"); upm=f['head'].unitsPerEm; hhea=f['hhea']; os2=f['OS/2']
arial = dict(upm=2048, xavg=904)  # Arial reference (use Times metrics for a serif brand)
size_adjust = (os2.xAvgCharWidth/upm) / (arial['xavg']/arial['upm'])
adj = upm*size_adjust
print(f"size-adjust:{size_adjust*100:.2f}% ascent-override:{hhea.ascent/adj*100:.2f}% "
      f"descent-override:{abs(hhea.descent)/adj*100:.2f}% line-gap-override:{hhea.lineGap/adj*100:.2f}%")
```
Apply those to the `<brand>-fallback` `@font-face` (sourcing `local("Arial")` / `local("Times New Roman")`) exactly as in principle 3.

## 3. Deferred `fonts.css` + metric-matched `-fallback` face

**3. Deferred `fonts.css` with a metric-matched `-fallback` `@font-face` — the stock boilerplate mechanism, aimed at your brand.**
The brand font must NOT render at first paint — and under vanilla EDS it can't: the brand `@font-face` lives in `styles/fonts.css`, which `loadFonts()` loads after first paint (immediately on desktop/repeat views, in `loadLazy` otherwise). Until it lands, the stack's SECOND family renders — so make that second family a metric-matched local face, declared in `styles/styles.css` following the boilerplate's own `roboto-fallback` convention:

```css
/* styles/fonts.css — loaded by loadFonts(), NOT parsed at first paint */
@font-face {
  font-family: "<Brand>";
  src: url("../fonts/<brand>-variable.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
```

```css
/* styles/styles.css — available at first paint. A local system face
   re-declared with the BRAND font's metrics, named <brand>-fallback
   (the stock convention — see roboto-fallback in the boilerplate). */
@font-face {
  font-family: "<brand>-fallback";
  src: local("Arial");           /* local("Times New Roman") for a serif brand */
  size-adjust: <X>%;
  ascent-override: <Y>%;
  descent-override: <Z>%;
  line-gap-override: 0%;
}

:root {
  --body-font-family: "<Brand>", "<brand>-fallback", sans-serif;
}

body { font-family: var(--body-font-family); }
```

Every font stack that names the brand face MUST name its `-fallback` face second — the fallback does nothing from `:root` alone; it works per-stack.

**Keep the `body { display: none }` / `body.appear` gate — it belongs to the runtime, not the foundation (#40).** `loadEager()` adds `appear` right after `decorateMain()`, so on any real page (and any harness that loads the real `scripts/scripts.js`) the gate is satisfied before first paint. A blank OFF-pipeline render means the runtime never booted — the harness didn't load `scripts.js`, or it threw — fix the harness, never remove the gate. (The `qa-gate` runtime-booted check + the deployed computed-style guard are the backstops for a blank render.)

The metric-override values come from the `@fontsource-variable/<name>` package's published calibration — fetch their CSS:

```bash
curl -s "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/index.css" \
  | grep -A 6 "Fallback"
```

Each fontsource package publishes a `<Name> Fallback` `@font-face` with `size-adjust`, `ascent-override`, and `descent-override` values. Lift those three numbers verbatim into the `<brand>-fallback` face (whose `src` is `local("Arial")` / `local("Times New Roman")` / `local("Courier New")` per classification).

The CLS chain that results:
- **Initial paint**: `fonts.css` hasn't loaded, so `"<Brand>"` is an unknown family and the stack falls through to `"<brand>-fallback"` — the metric-adjusted local system face. Line box already matches the brand font's metrics.
- **`loadFonts()` lands `fonts.css`**: the brand woff2 starts fetching; the fallback keeps rendering with matching metrics. **Zero shift.**
- **Brand font loads**: swaps in (`font-display: swap`). **Zero shift** because metrics already match.

## 4. Fallback classification (width included)

**4. Match the fallback family to the brand font's classification.**
Use the SAME class of typeface for the fallback so visual rhythm is preserved during the load:
- Sans-serif brand → `<brand>-fallback` sources `local("Arial")`; stack ends `sans-serif`.
- Serif brand → `<brand>-fallback` sources `local("Times New Roman")`; stack ends `serif`.
- Monospace brand → `<brand>-fallback` sources `local("Courier New")`; stack ends `monospace`. (Note: skipping monospace metric-matching is acceptable when the mono font is only used in small eyebrows/labels — CLS impact is negligible. Document the choice in the conversion log.)

Never substitute classifications (don't match a serif brand to Arial; don't match a sans brand to Times). Even with metric overrides, character widths and rhythm differ enough that the visible shift is jarring.

**Classification includes WIDTH — a condensed/narrow display face needs a condensed fallback, never plain Arial (#80).** "Sans→Arial" is only right for a *normal-width* sans. A narrow/condensed display face (PP Formula Narrow, Bebas Neue, Oswald, Barlow/Archivo Condensed, Anton) falling back to plain Arial is a width-class mismatch: Arial runs **~15–20% wider** with different letterforms, so headings lose the condensed character and wrap differently — a silent divergence the eye catches even when sizes/weights/tracking match exactly (a a banking-app prototype pass shipped PP Formula→Arial; the width probe showed Arial 975 vs PP Formula 839 for the same H1 string). When the condensed brand face is self-hosted (principle 2, now the default) this only bites if the webfont is blocked, but the fallback must STILL preserve width: put a condensed system/free face ahead of `arial` in the stack — `"<Brand>", "Arial Narrow", arial, sans-serif` (system `Arial Narrow` is present on macOS/Windows but NOT Android/Linux, so for guaranteed coverage self-host a free OFL condensed analog — Oswald / Barlow Semi Condensed / Archivo Narrow). Same logic for an *extended/wide* brand face. Quick check during foundation: for every `--*-font-family` token whose first face is condensed, confirm the final non-`sans-serif` fallback is also condensed.

## Further font traps (#77, #12, #22)

**Self-host the prototype's INTENDED fallback, not its accidental system render — and verify with a width probe, never `document.fonts.check` (#77).** Prototypes routinely load **zero `@font-face`** and name a proprietary brand font first (`--display: "Bellfort", "Bebas Neue", system-ui`). On any machine missing the brand font the prototype silently renders **system-ui** — so its on-screen display face is an *accident of the viewing machine*, not the design intent. Do NOT match that accident (don't set EDS `--display` to system-ui because "that's what the proto shows"). The prototype's OWN stack documents the intent: self-host the first **redistributable** fallback (OFL/Apache — e.g. Bebas Neue) so EDS ships the condensed display face the design wants; keep proprietary families documented in the conversion log. **Verify what actually rendered with a width probe** — `document.fonts.check('24px "X"')` returns **true for any family name the page references**, installed or not, so it produces false "fonts match" reads. Instead measure: a span at `font-family:"X",monospace` whose width equals a known-absent name's width means X fell back (absent); a distinct width means X is really rendering. (A beermaker pass set `--display` to Bebas Neue via a `fonts.check` false-positive — the width probe later showed the proto actually renders system-ui, but Bebas Neue was still correct as the documented intended fallback.)

**Multiple display families (#12).** A brand may use several families — e.g. Barlow (body) + Barlow Condensed + Barlow Semi Condensed (display). All of them load late via `fonts.css`, so each family whose swap matters needs its own metric-matched `-fallback`; a stack without one falls back with the wrong metrics and shifts. Define each as a `:root` token (`--font-cond`, `--font-semi`) and reference it per-block on the elements that use it. Fully metric-matching every display family is optional polish — for display text used sparingly (eyebrows, big condensed headings) the CLS impact is small; **document the trade-off** in the conversion log rather than over-engineering it. **But when a display family is used in an ABOVE-THE-FOLD heading (the hero `<h1>`, an LCP title), metric-match it too** — compute its `size-adjust`/`ascent-override`/`descent-override` from the woff2 (the same fonttools recipe as #11) and put its dedicated fallback SECOND in that family's stack: `--hero: "Lilita One", "lilita-one-fallback", …`. The fallback family MUST have its own name — do NOT reuse the body face's `-fallback` (#11), since that carries the *body* font's metrics, not the display font's. (Note: in practice the dominant first-section CLS is usually the late header box, #81, not the display-font swap — fix the header reservation first, then metric-match above-fold display faces to zero the remainder.)

**Match the prototype's effective weight (#22).** A single-weight display font (e.g. **Anton**, ships only 400) often appears *bolder* in the prototype than its one weight: a bare `<h1>`/`<h2>` inherits the browser-default heading weight (700), and the browser **faux-bolds** the 400-only face. If your foundation sets `h1,h2,h3 { font-weight: 400 }`, headings render visibly lighter than the prototype. Set the weight the prototype actually shows (often 700) so the faux-bold matches — don't assume "one weight in the file ⇒ `font-weight: 400`".
