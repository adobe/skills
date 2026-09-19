# Step 3 — Foundation (full text)

Full text of deploy Step 3. Read:
- § 3. Foundation — before touching `styles/styles.css`: the structural layer to preserve, tokens, reset (#106, #36), section scaffold, style values (#120, #121);
- § Experience Workspace edit-mode foundation — with Step 8, for the three `.prosemirror-editor` snippets (EW3/EW6/EW10);
- § Header reservation and hero CLS — before the first deployed CLS probe (#81, #107, #108, #100);
- § Token-completeness gate — after the foundation and before deploy (#91);
- § Favicon — once per site, the one permitted `head.html` addition.
- § Section rhythm — a pointer: inter-module spacing that varies per band lives in `reference/section-rhythm.md`.

## 3. Foundation

Rebrand `styles/styles.css` — replace the boilerplate's DEMO layer (roboto tokens, demo type scale, demo button colors) while **preserving its STRUCTURAL layer verbatim**: the `body { display: none }` / `body.appear { display: block }` gate (the runtime adds `appear` — removing the gate is not a fix for a blank harness render, loading the real `scripts.js` is), the `header { height: var(--nav-height) }` + `header .header { visibility: hidden }` → `[data-block-status="loaded"]` chrome reservation, and the `main > .section` scaffold. What you author:

- Lift `:root` tokens verbatim from the prototype's `<style>` (colors, fonts, type scale, weights, tracking, layout, motion easing).
- Document reset (box-sizing, margin reset, scroll-behavior, body font + bg, ::selection, img defaults, button reset). **The reset MUST include a global `*, *::before, *::after { box-sizing: border-box }` — the boilerplate ships none (#106).** Any %-width + padding grid ported from a bootstrap-era source silently wraps every column under content-box (a real page: 3-col cards rendered 2+1, 2-col bands stacked, the footer wrapped — +1731px doc height, ALL text gates green; only a pixel probe or eyeball catches it). If you skip the global reset for some reason, treat any block CSS combining `width: N%` with `padding` as a defect. **The `img` reset MUST be `img { display: block; max-width: 100%; height: auto; }` (#36).** EDS's media pipeline emits `<img>` with `width`/`height` attributes; without `height: auto` a width constraint stretches the image vertically (a landscape 1920×1258 rendered 677×1258). The bug is invisible on the prototype (raw `<img>`, no attrs) — it only appears post-pipeline.
- **Resets and section rules never carry an ID selector, and every `:has()` section rule carries a body/template scope.** An ID in a reset (`header nav#nav a:any-link`) out-ranks every header link rule; an unscoped `main .section:has(> .callout-wrapper)` written for one template hijacks another template's articles. Chrome and block DOM emit no `id`; section rules read `body.<template> main .section:has(…)` or hang on a named section style. The rest of the chrome delivery contract (open states, `aria-current`, variants) is `reference/chrome.md`.
- The section scaffold: keep the boilerplate's `main > .section` padding/margin rules, retuned to the prototype's rhythm — majority spacing here, module/adjacency deviations as `.section` classifiers, remainder as budgeted tokens (§ Section rhythm). Undecorated-content hiding is the RUNTIME's job (`data-section-status` + the body gate) — do not add `display: none` rules for sections or `main > div`.
- **Page templates that cap `main > .section > div` need ONE full-bleed escape, defined at template level.** A template rule such as `.inner main > .section > div { max-width: 1158px }` out-specifies every block's own full-bleed wrapper rule (`main .X-container > div { max-width: none }`), squeezing heroes, dark bands and card grids into a capped column with white gutters — it reads as a block bug, and it shipped THREE times on different pages before the template rule was found (recorded). Define the escape once, at the template's specificity (`.inner main > .section > div:where(.hero-wrapper, .band-wrapper, …)`, or a `.full-bleed` section style), route every full-bleed block through it, and assert it: `qa-gate.mjs` warns when a full-bleed block's section wrapper computes narrower than the viewport (list derived from block CSS; `--full-bleed hero,band` overrides).
- **Section style values for default-content sections (D1).** Each `style` value used by a default-content section gets its rule here — a SMALL closed set (`main .section.dark { … }`, `.tinted`, …), typography/ground only. On current sites the pipeline renders these classes server-side (section-metadata `style` → classes on the section div; other keys → `data-*`; the metadata block itself is removed from served HTML — sites with rendering version ≥ 2 / created after 2026-05). Blocks still paint their own sections; this vocabulary exists ONLY so prose sections don't need blocks.
- **Vocabulary budget.** Section `style` values are a *named* closed set whose names say what a section IS (`dark`, `tinted`, `narrow`, `quote-band`), never the CSS they apply (`pb-sm`, `u-p-4`, `separator-60`, `cols-8-4`, `h1-0-h2`, a pixel value, a boolean); a block instance carries few variant tokens, and a variant never encodes grid, offset or width numbers (`lg-9-offset-0`, `cols-46-54`, `media-576`) — counts stay inside the lint's vocabulary budget (`davids-model-lint` 🟡 D9-VOCAB / D15-STYLE / STYLE-SEL; thresholds in the lint header table). The majority rhythm of a template lives in `main .section` / `.<block>-container` CSS; a per-band deviation is a content-anchored `:has()` or adjacent-sibling rule at `.section` specificity BEFORE any token is minted. Never author a section whose only child is `section-metadata`. One `style` value per section by default; several only inside the budget and comma-separated (#120, next bullet). Lock the vocabulary (styles, variants, counts) in `stardust/eds-conversion-log.md` the way Step 2 locks block names; exceeding the budget is recorded there with its reason.
- **Section `style` values are comma-separated; each token becomes one class (#120).** `style: rt, band-navy` → `.section.rt.band-navy`. A space-separated value is hyphen-joined into ONE token that matches no rule (`rt band-navy` → `.rt-band-navy`) and silently kills the band — lint `D15 STYLE-SPACE` 🟡. Default stays one value per section; a second styling axis prefers a content-anchored `:has()` (`main .section.a:has(img[alt^="…"])`); more than one token only inside the vocabulary budget. Pipeline fact and probe date: catalogued in `reference/pipeline-facts.md`.
- **Empty styled sections must respect the section-status hiding (#121).** A `style`-carrying section that is otherwise empty needs `display: block !important` to defeat the boilerplate's `:empty { display: none }` — but an unscoped override ALSO defeats the runtime's PRE-LOAD hiding (`data-section-status` + inline `display:none`, see the scaffold rule above), so the section paints before the rest of the page and produces a massive layout shift (measured 0.75 CLS). Always scope the override: `main .section.x[data-section-status='loaded'] { display: block !important }`.
- **Section styles that paint several wrappers as ONE surface must contain child margins.** A "white card on a dark ground" section whose `default-content-wrapper` and block wrapper are both white rendered a 29px dark stripe between them: the heading's bottom margin COLLAPSED through its unpadded wrapper and pushed the next wrapper down onto the section ground (recorded) — every wrapper's own computed margin reads 0, so the gap looks inexplicable. Give such wrappers `display: flow-root` (or ≥1px vertical padding); diagnose by inspecting the FIRST/LAST child's margins of each wrapper, not the wrappers' own.
- **Quirks-mode sources (`_provenance.compatMode: "BackCompat"` in the extract).** The boilerplate's `<!DOCTYPE html>` puts the EDS page in standards mode; a legacy source in quirks mode sizes boxes, tables and inline images differently, and a token-perfect foundation still drifts. For a **replica** the doctype is mirrored (dropped) per `replica/reference/recreation-procedure.md` § CSS lifting step 5 and the deviation is logged in `stardust/eds-conversion-log.md`; for a **redesign** keep the doctype and treat the quirks-only geometry as source debt, not a gate target.
- A global button system (see next section). This is the one place per-block CSS does NOT own its paint — buttons are site-wide and convention-driven.
## Experience Workspace edit-mode foundation (EW3/EW6/EW10)

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
## Header reservation and hero CLS (#81, #107, #108, #100)

- **Reserve the header's real height — or the late chrome load shifts the first section → CLS (#81).** The `header` block loads in `loadLazy`, AFTER first paint. In the common layout where the header sits in flow ABOVE the first section (full-bleed hero *below* the nav), the hero would render at `y=0`, then jump DOWN by the header's height when the nav lands — a large layout shift the browser attributes to the hero block (a real page measured **CLS 0.143, ~0.13 of it the hero**; metric-matched fonts do NOT fix it because the cause is the header box appearing, not a font swap). The boilerplate reserves this natively — `header { height: var(--nav-height) }` plus `header .header { visibility: hidden }` until `[data-block-status="loaded"]` — so the job is to make the reservation MATCH your chrome: set `--nav-height` (responsive, per breakpoint) to the prototype header's real rendered height, and give the bare `<header>` the chrome's own `background` so any reserve-vs-actual delta is invisible:
  ```css
  :root { --nav-height: 98px; }                                       /* desktop nav+banner height */
  header { background: var(--brand-ground); }
  @media (width <= 767px) { :root { --nav-height: 102px; } }
  @media (width <= 480px) { :root { --nav-height: 120px; } }          /* banner wraps to 2 lines */
  ```
  Make the header's height **deterministic** so the reserved value actually matches: keep the reservation breakpoints in sync with the header block's, and avoid nav-link *wrap zones* (e.g. extend the burger/hamburger breakpoint so the inline links can't wrap to a second row at awkward widths). A multi-row chrome (utility bar + nav) is taller than the stock 64px — measure it, don't keep the default. Reserve slightly OVER the natural height (a few px) so you never under-reserve and shift. **The footer needs NO reservation** — it's below the fold, so its late load shifts nothing above it. Verify with a CLS probe (Playwright `PerformanceObserver({type:'layout-shift'})`) that **delays the woff2/nav fetches** to reproduce the slow-network swap PSI measures — run it **against the DEPLOYED preview URL only (#101)**: local assets load instantly, so a harness run hides the shift and false-passes.
- **The reservation collapses block-internal `<header>` elements (#107).** The stock `header { height: var(--nav-height) }` + visibility rules match EVERY `<header>` on the page, not just the chrome host — a block whose `decorate()` emits a semantic `<header>` (natural when porting prototype DOM verbatim) gets it clamped to nav height and hidden, and every such block breaks at once while all text gates stay green. Do not emit `<header>` in block DOM — use a `<div class="…-head">`. (Scoping the stock selector to `body > header` would fix it at the root but edits the boilerplate's structural layer — if you are already adding the `border-box` reset above, scope the reservation in the same pass; otherwise the warning is the fix.)
- **Overlay chrome — the #81 case with NO reservation (#108).** When the prototype's header is transparent and floats OVER the hero (hero content starts at `y=0` behind it), reserving `--nav-height` would push the hero DOWN below where the source renders it. Set `--nav-height: 0` and position the header absolutely (`header { position: absolute; top: 0; left: 0; right: 0; }` with the block styling its own ground) — nothing is in flow, so the late chrome load shifts nothing (measured CLS 0.0004 with this pattern on a real page).
- **The hero must eager-load its LCP image AND reserve its media slot (#100).** The runtime's `loadSection(main.querySelector('.section'), waitForFirstImage)` eager-izes only the FIRST section's first image — a metadata-only first section (an authoring error, Step 9) or any band above the hero leaves the hero's pipeline-emitted `<img loading="lazy">` lazy. And a hero image styled `width: auto` (contain-in-a-max-height layouts) has a **zero-height box until it loads**, so the hero grows by the image's full height when it lands, shifting every section below (a real page measured CLS 0.134 attributed to the section under the hero). Both halves in the hero block: `decorate()` sets `loading="eager"` + `fetchpriority="high"` on its first `<img>`, and the CSS reserves the media slot (`min-height` on the figure per breakpoint, or an explicit `aspect-ratio`). **Run the CLS probe ONLY against the DEPLOYED preview URL (#101)** — harness images are local and instant, so the harness measures ~0 while the live page shifts (this exact false-pass shipped once); a local CLS number carries no information either way.

That's it. No motion primitives. No utility classes beyond the button system. Section `style` values stay the small closed set above — never a parallel styling system for block-owned sections (see anti-pattern 2).

`scripts/scripts.js` stays stock except the project-owned hooks: `buildAutoBlocks()` gains the site's D1 auto-blocks (embed/video URLs); `decorateMain()`/`loadEager` are never restructured. No reveal-on-scroll. No marquee init. No header scroll-state. Per-block animation is owned by per-block CSS.

## Token-completeness gate (#91)

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

## Favicon

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
4. Verify at the published origin as part of the atomic contract: a `HEAD`
   request to `/favicon.<ext>` must return 200 — a repo-root file that never
   made the code push ships the default icon silently.

If extract captured no favicon, **WARN LOUDLY and record it in the deploy
log — never invent one, never skip silently.** A missing
`stardust/current/assets/favicon.<ext>` usually means a bounded extract
(`--single`/`--pages`) ran before crawl.mjs captured favicons in all modes —
one crawl of the entry page (or a manual fetch of `link[rel~="icon"]` /
`/favicon.ico`) recovers it; otherwise the deployed site ships the default
icon, which reads as broken to the client.

## Section rhythm

Inter-module spacing that varies per band is a Step 3 concern with its own chapter — `reference/section-rhythm.md` (decision rule: majority in CSS, derivable deviations as `.section` classifiers, remainder as budgeted tokens; the `--mt` engine, its silent traps, the replica hand-off). This heading stays as the pointer the replica chapters cite.
