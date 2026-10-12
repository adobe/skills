# Deploy — Steps 3–6: foundation, fonts, buttons, chrome

Part of `../SKILL.md` (the deploy card), which says when to read it. Read by section.

### 3. Foundation

Rebrand `styles/styles.css` — replace the boilerplate's DEMO layer (roboto tokens, demo type scale, demo button colors) while **preserving its STRUCTURAL layer verbatim**: the `body { display: none }` / `body.appear { display: block }` gate (the runtime adds `appear` — removing the gate is not a fix for a blank harness render, loading the real `scripts.js` is), the `header { height: var(--nav-height) }` + `header .header { visibility: hidden }` → `[data-block-status="loaded"]` chrome reservation, and the `main > .section` scaffold. What you author:

- Lift `:root` tokens verbatim from the prototype's `<style>` (colors, fonts, type scale, weights, tracking, layout, motion easing).
- Document reset (box-sizing, margin reset, scroll-behavior, body font + bg, ::selection, img defaults, button reset). **The reset MUST include a global `*, *::before, *::after { box-sizing: border-box }` — the boilerplate ships none (#106).** Any %-width + padding grid ported from a bootstrap-era source silently wraps every column under content-box (a real page: 3-col cards rendered 2+1, 2-col bands stacked, the footer wrapped — +1731px doc height, ALL text gates green; only a pixel probe or eyeball catches it). If you skip the global reset for some reason, treat any block CSS combining `width: N%` with `padding` as a defect. **The `img` reset MUST be `img { display: block; max-width: 100%; height: auto; }` (#36).** EDS's media pipeline emits `<img>` with `width`/`height` attributes; without `height: auto` a width constraint stretches the image vertically (a landscape 1920×1258 rendered 677×1258). The bug is invisible on the prototype (raw `<img>`, no attrs) — it only appears post-pipeline.
- The section scaffold: keep the boilerplate's `main > .section` padding/margin rules, retuned to the prototype's rhythm. Undecorated-content hiding is the RUNTIME's job (`data-section-status` + the body gate) — do not add `display: none` rules for sections or `main > div`.
- **Page templates that cap `main > .section > div` need ONE full-bleed escape, defined at template level.** A template rule such as `.inner main > .section > div { max-width: 1158px }` out-specifies every block's own full-bleed wrapper rule (`main .X-container > div { max-width: none }`), squeezing heroes, dark bands and card grids into a capped column with white gutters — it reads as a block bug, and it shipped THREE times on different pages before the template rule was found (recorded). Define the escape once, at the template's specificity (`.inner main > .section > div:where(.hero-wrapper, .band-wrapper, …)`, or a `.full-bleed` section style), route every full-bleed block through it, and assert it: `qa-gate.mjs --full-bleed hero,band` warns when a listed block's section wrapper computes narrower than the viewport.
- **The section scaffold honours the captured cap at its tier (#124).** DESIGN.json `extensions.breakpoints` (cap-probe) carries `containerMaxWidth`, `probeWidth` and `caps[]` by kind: a `shell`/`content` cap becomes `main { max-width: var(--max-width); margin: 0 auto }`; a `module` cap stays on the boilerplate's `main > .section > div { max-width: var(--max-width) }` with the escape above for the sections `modules[]` lists as full-bleed. Declaring the token and never applying it is the recorded failure (both pixel gates green — 1440 is narrower than the cap); `qa-gate.mjs --design DESIGN.json` asserts the cap at `probeWidth`, on the harness and on the published origin alike.
- **Section style values for default-content sections (D1).** Each `style` value used by a default-content section gets its rule here — a SMALL closed set (`main .section.dark { … }`, `.tinted`, …), typography/ground only. On current sites the pipeline renders these classes server-side (section-metadata `style` → classes on the section div; other keys → `data-*`; the metadata block itself is removed from served HTML — sites with rendering version ≥ 2 / created after 2026-05). Blocks still paint their own sections; this vocabulary exists ONLY so prose sections don't need blocks.
- **One `style` value per section — multi-value `style` is unreliable (#120).** `style: a, b` (comma- or space-separated) delivered only the FIRST class on a real stack. When a section needs a second styling axis, anchor it to content instead: `main .section.a:has(img[alt^="…"])` — content-anchored `:has()` selectors survive the metadata pipeline; second style tokens may not.
- **Empty styled sections must respect the section-status hiding (#121).** A `style`-carrying section that is otherwise empty needs `display: block !important` to defeat the boilerplate's `:empty { display: none }` — but an unscoped override ALSO defeats the runtime's PRE-LOAD hiding (`data-section-status` + inline `display:none`, see the scaffold rule above), so the section paints before the rest of the page and produces a massive layout shift (measured 0.75 CLS). Always scope the override: `main .section.x[data-section-status='loaded'] { display: block !important }`.
- **Section styles that paint several wrappers as ONE surface must contain child margins.** A "white card on a dark ground" section whose `default-content-wrapper` and block wrapper are both white rendered a 29px dark stripe between them: the heading's bottom margin COLLAPSED through its unpadded wrapper and pushed the next wrapper down onto the section ground (recorded) — every wrapper's own computed margin reads 0, so the gap looks inexplicable. Give such wrappers `display: flow-root` (or ≥1px vertical padding); diagnose by inspecting the FIRST/LAST child's margins of each wrapper, not the wrappers' own.
- A global button system (see next section). This is the one place per-block CSS does NOT own its paint — buttons are site-wide and convention-driven.
- **Experience Workspace edit-mode foundation (EW3/EW6/EW10 — Step 8 § contract).** Three snippets ship in `styles.css`; all are scoped on `.prosemirror-editor`, which exists ONLY inside the da.live inline editor, so they cost nothing on published pages:
  - **(a) Edit-mode CTA repaint.** `decorateButtons()` put `.button.primary/.secondary` on authored anchors BEFORE `decorate()`; the editor re-renders the CTA paragraph from its authored `<strong>`/`<em>` marks with NO classes, so the button look collapses the moment an author clicks. Repaint it from the marks with the project's own button declarations (`strong` = primary paint, `em` = secondary paint):
    ```css
    /* Experience Workspace edit mode: repaint CTAs from their authored marks */
    .prosemirror-editor p > :is(strong, em) > a:any-link,
    .prosemirror-editor p > a:any-link:has(> :is(strong, em):only-child) { /* the project's a.button declarations */ }
    .prosemirror-editor p > a:any-link > :is(strong, em) { font-weight: inherit; font-style: inherit; }
    .prosemirror-editor p > strong > a:any-link,
    .prosemirror-editor p > a:any-link:has(> strong:only-child) { /* a.button.primary paint */ }
    .prosemirror-editor p > em > a:any-link,
    .prosemirror-editor p > a:any-link:has(> em:only-child) { /* a.button.secondary paint */ }
    ```
    On-media/on-dark variants of this repaint go **LAST in the file** (`main :is(.on-media, .banner, .hero .gradient) .prosemirror-editor p > em > a:any-link { color: #fff }`) — nothing may follow them.
  - **(b) Card-as-link inner anchor.** A CTA paragraph moved into a card `<a>` (EW6) re-renders its inner link while editing; it must read like the card text: `a .prosemirror-editor a:any-link { color: inherit; text-decoration: none; }`.
  - **(c) Styled-text-link utilities exist as WRAPPER variants at EQUAL specificity.** Any utility a block applies to an authored link or list (`.affordance`, `.eyebrow`, `.meta`, `.link-download`) dies in edit mode (the editor drops classes on authored elements), so each also exists as a wrapper-descendant variant written with `:where()` so the cascade does not move: `.affordance, .affordance-wrap :where(a) { … }`, `.affordance::after, .affordance-wrap :where(a)::after { … }`. A plain `.affordance-wrap a` out-ranks `a:any-link` and silently flips the link colour (navy → teal on a real site); `:where()` keeps it at `.affordance`'s specificity.
  - **(EW10) Section prose rules follow the same selector rules.** The editor inserts TWO wrapper divs above an authored element (`div.prosemirror-editor > div.ProseMirror > <tag>`), so section styles on default content written as `main .section.x .default-content-wrapper > p:first-child` or `p:has(picture) + p` stop matching while editing. Use descendant selectors and no positional pseudo-classes on prose elements (`main .section.x .default-content-wrapper p`).
- **Reserve the header's real height — or the late chrome load shifts the first section → CLS (#81).** The `header` block loads in `loadLazy`, AFTER first paint. In the common layout where the header sits in flow ABOVE the first section (full-bleed hero *below* the nav), the hero would render at `y=0`, then jump DOWN by the header's height when the nav lands — a large layout shift the browser attributes to the hero block (a real page measured **CLS 0.143, ~0.13 of it the hero**; metric-matched fonts do NOT fix it because the cause is the header box appearing, not a font swap). The boilerplate reserves this natively — `header { height: var(--nav-height) }` plus `header .header { visibility: hidden }` until `[data-block-status="loaded"]` — so the job is to make the reservation MATCH your chrome: set `--nav-height` (responsive, per breakpoint) to the prototype header's real rendered height, and give the bare `<header>` the chrome's own `background` so any reserve-vs-actual delta is invisible:
  ```css
  :root { --nav-height: 98px; }                                       /* desktop nav+banner height */
  header { background: var(--brand-ground); }
  @media (width <= 767px) { :root { --nav-height: 102px; } }
  @media (width <= 480px) { :root { --nav-height: 120px; } }          /* banner wraps to 2 lines */
  ```
  Make the header's height **deterministic** so the reserved value actually matches: keep the reservation breakpoints in sync with the header block's (both on the `DESIGN.json` `extensions.breakpoints.target` steps when that list is set — one `--nav-height` per step), and avoid nav-link *wrap zones* (e.g. extend the burger/hamburger breakpoint so the inline links can't wrap to a second row at awkward widths). A multi-row chrome (utility bar + nav) is taller than the stock 64px — measure it, don't keep the default. Reserve slightly OVER the natural height (a few px) so you never under-reserve and shift. **The footer needs NO reservation** — it's below the fold, so its late load shifts nothing above it. Verify with a CLS probe (Playwright `PerformanceObserver({type:'layout-shift'})`) that **delays the woff2/nav fetches** to reproduce the slow-network swap PSI measures — run it **against the DEPLOYED preview URL only (#101)**: local assets load instantly, so a harness run hides the shift and false-passes.
- **The reservation collapses block-internal `<header>` elements (#107).** The stock `header { height: var(--nav-height) }` + visibility rules match EVERY `<header>` on the page, not just the chrome host — a block whose `decorate()` emits a semantic `<header>` (natural when porting prototype DOM verbatim) gets it clamped to nav height and hidden, and every such block breaks at once while all text gates stay green. Do not emit `<header>` in block DOM — use a `<div class="…-head">`. (Scoping the stock selector to `body > header` would fix it at the root but edits the boilerplate's structural layer — if you are already adding the `border-box` reset above, scope the reservation in the same pass; otherwise the warning is the fix.)
- **Overlay chrome — the #81 case with NO reservation (#108).** When the prototype's header is transparent and floats OVER the hero (hero content starts at `y=0` behind it), reserving `--nav-height` would push the hero DOWN below where the source renders it. Set `--nav-height: 0` and position the header absolutely (`header { position: absolute; top: 0; left: 0; right: 0; }` with the block styling its own ground) — nothing is in flow, so the late chrome load shifts nothing (measured CLS 0.0004 with this pattern on a real page).
- **The hero must eager-load its LCP image AND reserve its media slot (#100).** The metadata block leaves the page's FIRST section empty, so the runtime's `loadSection(main.querySelector('.section'), waitForFirstImage)` eager-izes NOTHING — the hero's pipeline-emitted `<img loading="lazy">` stays lazy. And a hero image styled `width: auto` (contain-in-a-max-height layouts) has a **zero-height box until it loads**, so the hero grows by the image's full height when it lands, shifting every section below (a real page measured CLS 0.134 attributed to the section under the hero). Both halves in the hero block: `decorate()` sets `loading="eager"` + `fetchpriority="high"` on its first `<img>`, and the CSS reserves the media slot (`min-height` on the figure per breakpoint, or an explicit `aspect-ratio`). **Run the CLS probe ONLY against the DEPLOYED preview URL (#101)** — harness images are local and instant, so the harness measures ~0 while the live page shifts (this exact false-pass shipped once); a local CLS number carries no information either way.

That's it. No motion primitives. No utility classes beyond the button system. Section `style` values stay the small closed set above — never a parallel styling system for block-owned sections (see anti-pattern 2).

`scripts/scripts.js` stays stock except the project-owned hooks: `buildAutoBlocks()` gains the site's D1 auto-blocks (embed/video URLs); `decorateMain()`/`loadEager` are never restructured. No reveal-on-scroll. No marquee init. No header scroll-state. Per-block animation is owned by per-block CSS.

**Token-completeness gate — every `var(--x)` a block references MUST be defined in `:root` (#91).**
Lifting a section's CSS into a block routinely drags in a token the block author never added to the
foundation (`var(--navy-700)` in a gradient, `var(--accent-2)` in a hover). A referenced-but-undefined
custom property **silently invalidates the WHOLE declaration** — `background: linear-gradient(var(--navy) 0%, var(--navy-700) 100%)`
with `--navy-700` undefined drops the entire background and the element falls back (a navy card renders
light), with no error and no lint flag. Gate it mechanically after the foundation and before deploy:
```bash
comm -23 <(grep -rhoE 'var\(--[a-z0-9-]+\)' blocks/**/*.css | sed 's/var(//;s/)//' | sort -u) \
        <(grep -oE '\--[a-z0-9-]+' styles/styles.css | sort -u)   # MUST be empty
```
Any line printed is a token a block uses that `:root` doesn't define — add it to the foundation `:root`.

**Favicon — ship the site's icon (the ONE permitted `head.html` addition).**
Extract captures the source site's favicon at
`stardust/current/assets/favicon.<ext>`; the deployed EDS site must serve it:

1. Copy it to the repo root as `favicon.<ext>`, preserving the format. A
   `favicon.ico` is served automatically at `/favicon.ico` — nothing else
   needed.
2. When the format is NOT `.ico` (svg/png), add exactly ONE line to
   `head.html`: `<link rel="icon" href="/favicon.<ext>">`. This favicon link
   is the only `head.html` edit this skill ever makes — the font ban (Step 4,
   anti-pattern #10) stands untouched.
3. Sandboxed/app runs (the `_eds/` bundle contract): write the file to
   `_eds/code/favicon.<ext>` instead — the host publisher pushes it with the
   code tree and injects the `head.html` link deterministically.
4. Verify at the published origin as part of the atomic contract:
   `node stardust/scripts/qa/qa.mjs --base <origin> --checks metadata --max-pages 1`
   must report neither `favicon-broken` nor `favicon-default` — a 200 alone
   proves nothing, the boilerplate's own icon answers it; a repo-root file
   that never made the code push ships that default silently.

If extract captured no favicon, **WARN LOUDLY and record it in the deploy
log — never invent one, never skip silently.** A missing
`stardust/current/assets/favicon.<ext>` usually means a bounded extract
(`--single`/`--pages`) ran before crawl.mjs captured favicons in all modes —
one crawl of the entry page (or a manual fetch of `link[rel~="icon"]` /
`/favicon.ico`) recovers it; otherwise the deployed site ships the default
icon, which reads as broken to the client.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Four principles, applied in this order on every project:

**0. Ship an `@font-face` for EVERY named family — not just the body face (#65).** Prototypes name a display face AND a body face (`--display: "Hebden Incised", …; --body: "Lekton", …`). If you self-host only the body font, every heading/numeral/title whose stack names the un-shipped display family silently falls back to `Times New Roman`/`Arial` (generic serif/sans) — **invisible to size/color checks** (the glyphs differ but the metrics match; only the `FONT MISMATCH` probe flag #66 or an eyeball catches it). Distinct from #11/#22 (wrong weight) and #30 (opsz): here the family is NAMED but NEVER SHIPPED. For each quoted family in `--display`/`--body`/any heading stack, self-host a matching `@font-face` (download + commit the woff2 under `fonts/`, reference root-relative — never the prototype's brand-CDN origin, #44). **Checklist:** grep every quoted family in `styles.css`'s font stacks against the `@font-face { font-family }` names declared — any unmatched name is a silent fallback.

Then four principles, applied in this order on every project:

**1. Leave `head.html` untouched. No font lines, period.**
No Google Fonts `<link>`. No CDN `<link rel="stylesheet">` for type. No `<style>` blocks declaring `@font-face`. **No `<link rel="preload" as="font">`** either — even self-hosted preloads belong out of `head.html`. **Brand `@font-face` declarations live in `styles/fonts.css`** (the file `loadFonts()` loads — eagerly on desktop and repeat views via the `fonts-loaded` session flag, always in `loadLazy`); **the metric-matched `-fallback` faces live in `styles/styles.css`** (they must be available at first paint). The fallback split (principle 3) eliminates the CLS that preloading is normally meant to prevent.

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

**4. Match the fallback family to the brand font's classification.**
Use the SAME class of typeface for the fallback so visual rhythm is preserved during the load:
- Sans-serif brand → `<brand>-fallback` sources `local("Arial")`; stack ends `sans-serif`.
- Serif brand → `<brand>-fallback` sources `local("Times New Roman")`; stack ends `serif`.
- Monospace brand → `<brand>-fallback` sources `local("Courier New")`; stack ends `monospace`. (Note: skipping monospace metric-matching is acceptable when the mono font is only used in small eyebrows/labels — CLS impact is negligible. Document the choice in the conversion log.)

Never substitute classifications (don't match a serif brand to Arial; don't match a sans brand to Times). Even with metric overrides, character widths and rhythm differ enough that the visible shift is jarring.

**Classification includes WIDTH — a condensed/narrow display face needs a condensed fallback, never plain Arial (#80).** "Sans→Arial" is only right for a *normal-width* sans. A narrow/condensed display face (PP Formula Narrow, Bebas Neue, Oswald, Barlow/Archivo Condensed, Anton) falling back to plain Arial is a width-class mismatch: Arial runs **~15–20% wider** with different letterforms, so headings lose the condensed character and wrap differently — a silent divergence the eye catches even when sizes/weights/tracking match exactly (a a banking-app prototype pass shipped PP Formula→Arial; the width probe showed Arial 975 vs PP Formula 839 for the same H1 string). When the condensed brand face is self-hosted (principle 2, now the default) this only bites if the webfont is blocked, but the fallback must STILL preserve width: put a condensed system/free face ahead of `arial` in the stack — `"<Brand>", "Arial Narrow", arial, sans-serif` (system `Arial Narrow` is present on macOS/Windows but NOT Android/Linux, so for guaranteed coverage self-host a free OFL condensed analog — Oswald / Barlow Semi Condensed / Archivo Narrow). Same logic for an *extended/wide* brand face. Quick check during foundation: for every `--*-font-family` token whose first face is condensed, confirm the final non-`sans-serif` fallback is also condensed.

**Self-host the prototype's INTENDED fallback, not its accidental system render — and verify with a width probe, never `document.fonts.check` (#77).** Prototypes routinely load **zero `@font-face`** and name a proprietary brand font first (`--display: "Bellfort", "Bebas Neue", system-ui`). On any machine missing the brand font the prototype silently renders **system-ui** — so its on-screen display face is an *accident of the viewing machine*, not the design intent. Do NOT match that accident (don't set EDS `--display` to system-ui because "that's what the proto shows"). The prototype's OWN stack documents the intent: self-host the first **redistributable** fallback (OFL/Apache — e.g. Bebas Neue) so EDS ships the condensed display face the design wants; keep proprietary families documented in the conversion log. **Verify what actually rendered with a width probe** — `document.fonts.check('24px "X"')` returns **true for any family name the page references**, installed or not, so it produces false "fonts match" reads. Instead measure: a span at `font-family:"X",monospace` whose width equals a known-absent name's width means X fell back (absent); a distinct width means X is really rendering. (A beermaker pass set `--display` to Bebas Neue via a `fonts.check` false-positive — the width probe later showed the proto actually renders system-ui, but Bebas Neue was still correct as the documented intended fallback.)

**Multiple display families (#12).** A brand may use several families — e.g. Barlow (body) + Barlow Condensed + Barlow Semi Condensed (display). All of them load late via `fonts.css`, so each family whose swap matters needs its own metric-matched `-fallback`; a stack without one falls back with the wrong metrics and shifts. Define each as a `:root` token (`--font-cond`, `--font-semi`) and reference it per-block on the elements that use it. Fully metric-matching every display family is optional polish — for display text used sparingly (eyebrows, big condensed headings) the CLS impact is small; **document the trade-off** in the conversion log rather than over-engineering it. **But when a display family is used in an ABOVE-THE-FOLD heading (the hero `<h1>`, an LCP title), metric-match it too** — compute its `size-adjust`/`ascent-override`/`descent-override` from the woff2 (the same fonttools recipe as #11) and put its dedicated fallback SECOND in that family's stack: `--hero: "Lilita One", "lilita-one-fallback", …`. The fallback family MUST have its own name — do NOT reuse the body face's `-fallback` (#11), since that carries the *body* font's metrics, not the display font's. (Note: in practice the dominant first-section CLS is usually the late header box, #81, not the display-font swap — fix the header reservation first, then metric-match above-fold display faces to zero the remainder.)

**Match the prototype's effective weight (#22).** A single-weight display font (e.g. **Anton**, ships only 400) often appears *bolder* in the prototype than its one weight: a bare `<h1>`/`<h2>` inherits the browser-default heading weight (700), and the browser **faux-bolds** the 400-only face. If your foundation sets `h1,h2,h3 { font-weight: 400 }`, headings render visibly lighter than the prototype. Set the weight the prototype actually shows (often 700) so the faux-bold matches — don't assume "one weight in the file ⇒ `font-weight: 400`".

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

The boilerplate's `decorateButtons()` (in `scripts/scripts.js`) applies button classes when authors wrap a link in inline emphasis (D6). It runs in `decorateMain()`, BEFORE any block's `decorate()` — so by the time block JS sees a cell, its anchors already carry the button classes. Block JS **MOVES the CTA's paragraph** — `actions.append(a.closest('p') || a)` — never clones it: the index the workspace's inline editor keys on sits on the `<p>`, not the `<a>` (EW3), and a `cloneNode`/childNodes copy leaves the authored paragraph behind, dead. The `.button.*` classes die while editing; the foundation's edit-mode repaint (Step 3 (a)) covers that.

**Author markup → auto-applied class (current `adobe/aem-boilerplate` main — confirm per target in `runtime-contract.json`, older clones differ):**

| Author markup | Class applied | Visual |
|---|---|---|
| `<strong><a>` | `a.button.primary`, parent `p.button-wrapper` | brand fill |
| `<em><a>` | `a.button.secondary`, parent `p.button-wrapper` | transparent + outline (color-aware) |
| `<em><strong><a>` | `a.button.accent`, parent `p.button-wrapper` | high-impact CTA — sparingly |
| bare `<a>` alone in a `<p>` | nothing (current main requires emphasis) | plain link |

Two decode caveats: the decorator only matches `p a[href]` — a CTA must be paragraph-wrapped and alone in its paragraph (the ENCODE side already does this); and it REPLACES the emphasis tag with the classed anchor, so block JS must never assume a surviving `<strong>`/`<em>` wrapper — detect CTAs by `a.button` first, emphasis-wrapped `<a>` as the fallback for un-decorated shapes.

**Restyle the boilerplate's button rules in `styles/styles.css`** (keep its selectors, replace the demo paint with the brand system):

```css
a.button:any-link, button.button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 26px;
  font-size: 12px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid transparent;
  transition: background 0.25s var(--ease-out), color 0.25s var(--ease-out), border-color 0.25s var(--ease-out);
}

a.button.primary { background: var(--color-wavelength); color: var(--color-ink-rich); border-color: var(--color-wavelength); }
a.button.primary:hover { background: var(--color-canvas); border-color: var(--color-canvas); }

a.button.secondary { background: transparent; color: currentcolor; border-color: rgb(255 255 255 / 40%); }
a.button.secondary:hover { border-color: currentcolor; background: rgb(255 255 255 / 5%); }

/* On light surfaces, secondary uses dark-tinted outline. List the dark sections explicitly. */
main .section:not(.dark, .closing, .hero, .team) a.button.secondary { border-color: var(--color-rule-strong); color: var(--color-ink-rich); }
main .section:not(.dark, .closing, .hero, .team) a.button.secondary:hover { border-color: var(--color-ink-rich); }

/* Trailing arrow on primary/accent. */
a.button.primary::after, a.button.accent::after { content: "→"; font-weight: 600; transition: transform 0.3s var(--ease-out); }
a.button.primary:hover::after, a.button.accent:hover::after { transform: translateX(4px); }

p.button-wrapper { display: inline-flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 0; }
```

(Adjacent CTAs land in separate `p.button-wrapper`s — one per authored paragraph — so group spacing rides the wrappers' shared flex row inside the block's `.actions` container, not a single group element.)

**Surface-aware variants: scope to the BLOCK class, not just the section (#41).** When a button/link/text treatment differs on dark vs light surfaces, the prototype's dark-surface cue (e.g. `.hero`, `.cta-dark`) becomes a **block class** after conversion — a `<div class="hero block">` nested inside the `<div class="section">`. So an override written as `main .section.hero a.button.secondary` never matches (the `.hero` is one level below `.section`), and the on-dark CTA silently renders dark-on-dark. Scope on-dark overrides to BOTH: `main .section.dark a.button.secondary, main .hero a.button.secondary { … }`. QA any block on a dark background for secondary/ghost-CTA contrast (light outline + light text) — the button "exists" in metrics, so only contrast/eyeball catches this.

**Block JS pattern — MOVE the CTA paragraphs (EW3):**

```js
// Get the cell that holds the CTAs
const ctaCell = rows[N]?.firstElementChild;
if (ctaCell && ctaCell.querySelector('a')) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  // the workspace's editor index is on the <p>, so move the paragraph, not the anchor;
  // capture the list BEFORE moving (append() ends a live sibling walk — EW1)
  [...ctaCell.querySelectorAll('a')].forEach((a) => actions.append(a.closest('p') || a));
  container.append(actions);
}
```

Never `cloneNode(true)` the anchor or copy `childNodes` — the clone renders identically and is dead in Experience Workspace (the authored `<p>` carrying `data-prose-index` was discarded). When the block itself needs a variant class on the CTA (#25 multi-variant systems), put it on the `.actions` wrapper and style `.actions.ghost a`, not on the authored anchor.

DO NOT manufacture anchors with `cta.className = 'btn-loud'` or inject custom SVG arrows. The global `::after` arrow + the convention's class system handle 95% of cases.

**Block CSS pattern — only override what's actually different:**

The `closing` block's CTA is slightly larger than the global default. That's a legitimate override:

```css
.closing .actions a.button.primary { padding: 22px 32px; font-size: 13px; }
```

Three lines. Targets the global class, not a custom one. This is the entire "blocks slightly augment defaults" pattern.

**When NOT to use the convention:**

Some links are NOT buttons. Examples:
- A wavelength-underlined text link in a section footer ("How we work →"). It's a styled text link, not a chip.
- Whole-card anchors on tile grids (`<a class="tile">…</a>`). The whole tile is the click target.
- Channel values in a closing CTA (`<a href="tel:…">801-363-0101</a>`). It's a value, not a CTA.
- `mailto:` / `tel:` links inside prose.

For these: the author leaves the `<a>` as a plain anchor in content (no `<strong>` / `<em>` wrap), and the owning block styles it with per-block CSS. The convention is for buttons; if it's not a button, don't apply it.

**Multi-variant button systems (#25).** The strong/em convention only names three slots (primary / secondary / accent — and D6 says needing more usually means a design-system decision was wrongly delegated to authors, so first try to consolidate). When a prototype genuinely has **more** context-specific variants — e.g. an airport prototype's `.btn--accent` (yellow), `.btn--primary` (blue), `.btn--ghost` (outline), `.btn--onblue` (white-on-blue) — author emphasis can't express them. Don't force it: **lift the prototype's full button-variant system into `styles/styles.css`** (keeping the prototype's own class names), author the CTAs as plain `<a>` in content, and have each block apply the right variant class to the cloned anchor (the block knows its section's variant — the choice stays with the design system, not the author). This is the same "if it doesn't fit, style it" escape hatch, applied at the button-system level rather than per-link.

### 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Chrome is the canonical fragment use case (D12): **content** lives in two authored DA documents — `content/nav.html` and `content/footer.html` — and **presentation** lives in the per-site `blocks/header` and `blocks/footer` CSS/JS. The stock blocks fetch the documents (`loadFragment('/nav')` / `loadFragment('/footer')`, path overridable per page via `nav`/`footer` metadata); you replace their demo CSS/JS with the prototype's chrome. Nav links become authorable; block JS runs, so interactive chrome is REAL JS, not CSS hacks.

**The nav/footer documents (ENCODE side).** Same body-fragment format as any content page (Step 9), deployed and published through the same chain — they must be on the publish roster or the chrome 404s. Content is default-content only, structured by sections:
- `content/nav.html`: section 1 = brand (logo link), section 2 = the nav link list (`<ul>`), section 3 = tools/CTAs (the stock header block reads exactly these three sections into `.nav-brand` / `.nav-sections` / `.nav-tools` — keep that contract so the hamburger logic keeps working).
- **Nav DECODE: the pipeline wraps each list item's trigger link in a `<p>` on live (#98).** The authored/harness shape is `<li><a>…<ul>`, the delivered shape is `<li><p><a></p><ul>` — a `:scope > a` trigger lookup and any `.nav-links > li > a` CSS silently miss on live while the harness passes (the #79 class, hitting chrome). Normalize in `decorate()`: match `:scope > a, :scope > p > a` and unwrap the `<p>`. Verify the desktop nav's STYLED render on the deployed preview, not just the harness.
- `content/footer.html`: one section per footer band (link columns as lists, legal line, social links). The footer block renders them in order.
- Images (logo) follow the standard editorial-image rule: upload to DA `/media`, author a `content.da.live` `<img>` — the pipeline emits `<picture>`. Internal links root-relative; external fully-qualified (D4).

**The header/footer blocks (DECODE side) — template-slotted (#95), pixel parity by construction.** Replace the demo CSS of `blocks/header/header.css` with the prototype's chrome CSS (scoped under `header .nav-*` / `footer .footer`), and adapt `header.js`'s `decorate()` to build the prototype's chrome DOM verbatim, slotting the authored content by role — logo into the brand slot, each authored `<li>` link into the nav-link template, tools/CTAs into their slot. **Behaviour comes from the header contract** (`stardust/chrome/header-contract.json`, `../../diff/SKILL.md` § The header contract): each control, the action that opens it (hover, click, Enter), what its panel shows, its close paths, focus, scroll lock and motion, at desktop and mobile. The stock machinery (`toggleMenu`, `aria-expanded`, Escape and focus-out close, `isDesktop`) is the accessibility floor to extend, never the target: runs that kept it shipped one-level click dropdowns for hover mega menus. A mega-menu panel is authored content: nested lists in `/nav`, or one nav fragment per top-level item (`/nav/<item>`, loaded on first open, published with the nav) once a panel holds more than a few dozen links. Search, cart, account and locale reproduce their UI (overlay, typeahead, drawer, empty state); data a backend serves is a dynamics row the site owner decides.
- **Lift the chrome element's OWN box styles (#31)** — `margin`, `padding`, `border` set on the prototype's `<header>`/`<footer>` element itself — onto `header`/`footer` (the host elements sit OUTSIDE `<main>`), not just the inner content styles. The gap between the last section and the footer comes entirely from the footer's own top margin (e.g. `footer { margin-top: 72px }`). Easy to miss: the inner content looks right while the footer sits flush against the last block.
- **Root-class hook (#26):** the block renders inside `header .header` / `footer .footer`. If the prototype's chrome styling is keyed to a different root class (e.g. `.utilnav` / `.site-footer`), have `decorate()` emit a `<div class="<that-class>">` wrapper so the lifted CSS matches unchanged.
- **Multi-row chrome (utility bar + nav):** author the utility bar as an extra section in `/nav`; the header block slots it above the nav row. Update `--nav-height` (#81) to the combined height.
- **Never pair a fixed `height` with vertical `padding` on a chrome row.** Under the global `border-box` reset (#106) `height: 40px; padding-top: 12px` shrinks the content box to 28px and mis-centers every utility-row item by 6px — one declaration, a whole-chrome offset (recorded). Chrome rows size from content (`min-height` when a floor is needed); before deploy, grep the chrome CSS for `height:` co-occurring with `padding` on flex rows.
- **Hover dropdowns need a contiguous hover surface.** A sub-list placed below the trigger `<li>` with an offset (`top: calc(100% + Npx)`) closes when the pointer crosses the gap (recorded: 5/5 desktop dropdowns unreachable behind green crops). Span the `<li>` over the nav row with the sub-list at `top: 100%`, or (replica) bridge the gap with an invisible `::before` on the sub-list, off in the mobile query; qa's `dropdown-unreachable` walks the pointer path.

**What still can't run (#20, #102):** authored content never carries `<script>` (D15), and EDS's delivered CSP (`script-src 'nonce-…' 'strict-dynamic'`) means inline `on*` handlers in ANY markup never fire. Forms in chrome (a newsletter signup in the footer) are wired in BLOCK JS: render the `<form>` from the block, attach a real `submit` listener in `decorate()`. Scroll-state chrome (sticky shadow, shrink-on-scroll) is wired in the header block's JS. **Block dependencies must not compile WebAssembly (#102):** the CSP has no `wasm-unsafe-eval`, so WASM-based players (dotlottie, wasm codecs/parsers) silently fall back on every REAL environment while working locally — for Lottie use `lottie-web`'s pure-JS `svg` renderer via a pinned-CDN module `import()` (strict-dynamic trusts module imports). Step 10: check the deployed page's browser console for CSP violations — a graceful fallback hides this class from every layout gate.

**Per-page chrome variants:** set `nav: /nav-minimal` (or `footer: /footer-legal`) in the page's metadata block to point that page at an alternate authored document — this replaces the old `header: off` switch (there is no stock off switch; a chrome-less page points at a minimal nav doc you author). Multilingual sites route the same way: `/fr/nav`, `/fr/footer`.
