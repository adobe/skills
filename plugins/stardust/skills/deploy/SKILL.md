---
name: deploy
description: Convert per-page styled HTML prototypes (stardust under stardust/prototypes/**, or claude-design / Mobirise / Relume / Lovable / v0 / Figma-derived pages, or JSX prototypes pre-rendered to HTML, often under samples/) into Edge Delivery Services (EDS / AEM) blocks and content pages, then deploy via DA. Each prototype section becomes one EDS block; the prototype's per-section CSS becomes that block's CSS scoped under the block class. Use when the user wants to lift styled per-page HTML prototypes into a working EDS site under blocks/ and content/.
license: Apache-2.0
---

# stardust:deploy — prototypes → EDS/AEM

## When to use

The user has:
1. **Per-page styled HTML prototypes** — one file per page, each carrying its own CSS. Accept any of these shapes:
   - **Single-file with inline `<style>`** and `:root` tokens + semantic `<section class="…">` (e.g. stardust output, or claude-design "Stardust"/Mobirise/Relume-style pages). Easiest — convert directly.
   - **External per-page `.css`** (the `<style>` lives in a sibling stylesheet). Read the linked CSS the same way you'd read an inline `<style>`.
   - **`<x-dc>` document-content with everything inline-styled** (per-element `style="…"`). Harder — you must lift inline styles into a scoped block stylesheet.
   - **React/JSX prototypes** (an HTML shell that mounts `.jsx` components at runtime). **Pre-render to static HTML first** (run it, or screenshot + read the JSX to reconstruct the DOM); you cannot decorate a shell that has no server-rendered `<main>`.
   The prototypes typically live under `stardust/prototypes/**` or a `samples/<Name>/` folder — don't hard-code the path; discover them.
2. An EDS project at the repo root — `blocks/`, `styles/`, `scripts/`, `head.html`, plus existing blocks (`fragment`, `section-metadata`). If the project is **vanilla `aem-boilerplate`** rather than the AuthorKit runtime this skill assumes, run the **Runtime bootstrap** below first.
3. A goal to convert: prototypes → authorable EDS blocks + EDS content pages under `content/**`.

If the user has prototypes but no EDS scaffolding, stop and ask whether to bootstrap. If they have EDS but no prototypes, this skill doesn't apply.

## Runtime bootstrap (vanilla aem-boilerplate targets)

This skill's runtime is the **AuthorKit** runtime (`ak.js` page boot, `postlcp.js` static header/footer fragments, `body.session` font gating, `decorateSession()`). The conversion steps below assume those files exist. They are **NOT** in this skill folder — they live in the canonical AuthorKit repo (`github.com/aemsites/author-kit`). (The `sanitise.js` DA-write helper is bundled with this skill at `skills/deploy/scripts/sanitise.js`; it is not part of the ported runtime.)

If the target project is a **vanilla `aem-boilerplate`** (it has `scripts/aem.js` + `scripts/scripts.js` and `header`/`footer` blocks, but no `ak.js`/`postlcp.js`), port the runtime before Step 1. Fetch the author-kit tarball and copy:

**Port in (from author-kit):**
```
scripts/ak.js scripts/scripts.js scripts/postlcp.js scripts/lazy.js scripts/utils/*
tools/**                      # da/da.js (+ sidekick, quick-edit, scheduler — keep so lazy.js/scripts.js imports resolve). sanitise.js is bundled with this skill, not ported.
deps/**                       # rum.js + lit (head.html loads deps/rum.js)
head.html                     # AuthorKit head: loads ak.js + scripts.js + styles.css + deps/rum.js
blocks/fragment blocks/section-metadata
.hlxignore
```

**Remove (boilerplate the AuthorKit runtime replaces):**
```
scripts/aem.js scripts/delayed.js          # replaced by ak.js + lazy.js
blocks/header blocks/footer                 # replaced by static fragments/{header,footer}.html (Step 6)
blocks/cards blocks/columns blocks/widget   # unused demo blocks (delete to avoid stale aem.js imports)
styles/fonts.css styles/lazy-styles.css     # @font-face goes in styles.css; AuthorKit head loads only styles.css
```

**After porting, two runtime edits are mandatory (do BOTH — they're halves of one change):**
1. **`scripts/lazy.js` (#4):** the stock AuthorKit `lazy.js` lazy-loads `utils/footer.js`, which does `loadBlock(footer)` and collides with the static footer fragment (renders a visible "Error" box, since there is no `blocks/footer`). **Delete the `import('./utils/footer.js')…` line.**
2. **`scripts/postlcp.js` (#21):** deleting `utils/footer.js` also removed the only code that set the `<footer>`'s class. Without it, the fragment's own root selector (`footer.footer { background: … }`) never matches and any styling on the fragment ROOT (background/padding/color) silently no-ops. In `loadStaticFragment`, set the class before injecting:
   ```js
   const html = await resp.text();
   el.className = name;          // so header.header / footer.footer match
   el.innerHTML = html;
   ```
   This bug is invisible when the footer happens to match the body background; it bites the moment a fragment has its own background (e.g. a yellow footer).

When starting a NEW conversion in this repo, port the runtime from the **latest test branch** (which already carries both edits), not from a stale early branch.

**Lint mismatch (#6).** The AuthorKit runtime is authored for `@adobe/eslint-config-helix`; a boilerplate project lints with `airbnb-base`, so `npm run lint` will throw thousands of errors on the vendored runtime + minified `deps/`. Treat the runtime as vendored — add to `.eslintignore`:
```
deps/
scripts/ak.js
scripts/lazy.js
scripts/postlcp.js
scripts/scripts.js
scripts/utils/
tools/
blocks/fragment/
samples            # reference prototypes, not project code
```
Your generated blocks + `styles/styles.css` still lint clean under airbnb (expand any single-line multi-declaration CSS rules the prototype used). Alternatively, adopt the author-kit `eslint.config.js` (helix) wholesale.

## Deploy (DA Source API, from a local agent)

**Steps 1–9 are the conversion methodology**; deploy is the one transport-specific step. From a local agent (Claude Code / CLI), each converted page deploys headlessly:

| Stage | How |
|---|---|
| Code | `git push` the branch → AEM Code Sync builds it |
| Sanitise | `skills/deploy/scripts/sanitise.js` — run it before the write (DA corrupts raw UTF-8) |
| Content write | DA Source API: `PUT admin.da.live/source/<org>/<repo>/<path>.html` (multipart, field name **`data`**, `type=text/html`) |
| Make live | `POST admin.hlx.page/preview/<org>/<repo>/<branch>/<path>` (then optionally `/live/...`) |
| Auth | IMS token (`DA_TOKEN`) — see the `da-content` / `da-auth` skills |

The content payload is a **body fragment** (see Step 9). The deploy needs the **code branch pushed to GitHub** so the branch preview (`<branch>--<repo>--<org>.aem.page`) renders with your blocks. See `da-deploy-protocol.md` for the full curl contract.

**Token hygiene (#16).** The IMS token typically lives in repo `.env` as `DA_TOKEN`. Before the first commit, make sure `.gitignore` excludes `.env`, `.env.*`, and `qa/` (the local QA harness) **on the branch you'll branch tests from** — otherwise every test subbranch re-exposes the token. Keep `samples/` out of commits too. Dev tokens last ~24h; a `401` with an empty body means expired → refresh and retry (the write is idempotent).

## The one rule that drives everything else

**One prototype `<section>` = one EDS block.** Do not abstract. Do not invent variants. Do not extract "patterns" across prototypes unless two sections are visually identical.

The prototype is the visual spec. The block exists to author its content. This rule sounds obvious. It is not what you will be tempted to do. See ANTI-PATTERNS below — every entry there is a real failure mode that cost a full reset on a previous run.

## Output you will produce

For a typical 5–10 page site:

- **One block per distinct prototype section.** A 5-page site with 6 sections each → ~12–18 blocks (some are reused across pages, e.g. `closing`).
- **One EDS content page per prototype page.** Same number of pages.
- **Nav + footer fragments** at `content/fragments/{nav,footer}.html` (the navigation lives in `nav.html`, not `header.html`).
- **Updated `styles/styles.css`** with brand tokens lifted from the prototype's `:root`, a reset, the EDS section scaffold, and a global button system (see "Lean on EDS button conventions" below). Nothing more.
- **No shared utility modules.** No wave systems. No section-metadata style classes. No motion library. The prototype already encodes these per-section; keep them inside the owning block.

## Steps

### 1. Audit (light)

**First, normalize the input to static HTML.** If a prototype is React/JSX (an HTML shell that mounts `.jsx` into `#root`), **pre-render it to static HTML** before auditing (#24). The reliable recipe:
```bash
# 1. serve the prototype's OWN folder with a plain static server (NOT file:// —
#    babel-standalone XHRs the .jsx and file:// CORS-blocks it; the aem dev
#    server CSP-blocks the inline scripts too).
( cd samples/<proto> && python3 -m http.server 8765 & )
# 2. load in Playwright (React/babel load from unpkg — needs internet), wait for
#    mount, capture #root's innerHTML, save it for the block agents to read:
#    page.goto('http://localhost:8765/<file>.html'); waitForTimeout(4000);
#    fs.writeFileSync('samples/<proto>/_rendered.html', root.innerHTML)
```
From there it converts like an external-CSS prototype (semantic classes + the prototype's `.css`). If it's `<x-dc>` document-content, the sections are still `<section>`/`<div>` elements; just expect inline `style="…"` instead of a `<style>` block. The rest of this skill assumes a static `<main>` exists.

**View behind routing / sign-in (#27).** If the view you want is not the default render (e.g. a signed-in dashboard behind a sign-on flow), **seed the app's persisted state before it boots** rather than capturing the landing page. Many prototypes persist their route to `localStorage`: `page.addInitScript(() => localStorage.setItem('<key>', JSON.stringify({page:'dashboard', user:'Alex'})))` then navigate. Generic alternatives: drive the UI to the view (fill + submit the sign-on form, then capture) or set the router hash/URL. Capture `#root` for the view you actually intend to convert.

Read every prototype's `<main>` markup (skip the `<style>` for now) and produce a per-page section list:

```
home: hero, work, approach, team, clients, closing
approach: approach-hero, manifesto, tenets-detailed, cadence, closing
team: team-hero, team-roster, work-style, recent, careers, closing
…
```

A useful pattern: dispatch the `Explore` subagent at thoroughness=quick with this exact ask. You don't need a 22-pattern punch list — you need filenames + section names. **Resist the urge to "find shared patterns."** Pattern reuse will emerge organically when two sections turn out to be byte-identical.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Naming rules:
- Block name = the prototype's `<section class="X">` value, kebab-cased (`hero`, `work`, `closing`, `approach`).
- **Never name a block after a reserved EDS class** (#15). `section`, `default-content`, `block-content`, `wrap`, and `button` are used by the runtime's section/decoration DOM — a block named `section` collides with `<div class="section">` and breaks decoration. When the prototype's section class is generic/reserved (Festool uses `class="section"` twice), derive a semantic name from the section's `data-screen-label` / intent instead (`new-products`, `discover`) and carry any modifier like `tinted` as a block variant.
- When the same section appears on multiple pages with identical visual treatment, build ONE block and use it everywhere. The classic example: `closing` CTA at the end of every page.
- When a section appears on multiple pages but looks different (e.g. home `hero` vs case-study `case-hero` vs service `service-hero`), they are different blocks. Prefix with the page archetype.
- When two sections within one prototype share the same visual treatment but different copy (e.g. case-study `discovery` and `decisions` are both 2-col prose with eyebrow + headline), it is fine to merge into one block (`case-prose-2col`) with a single text variant cell ("tinted" / "default"). Use your judgment.

**Scale the naming ceremony to the number of pages.** For a **single-page** conversion where each `<section class="X">` has a self-evident, unique name (`hero`, `quick`, `used`, `stats`…), there are no cross-page reuse decisions to make — just lock `block name = section class` and proceed; don't pepper the user with questions. The questions below matter for **multi-page** sites, where the same-looking section recurs and you must decide reuse vs. archetype-prefixing.

**Surface 3–5 naming questions to the user before writing any block code (multi-page sites):**
- "What's the home hero called? `hero`?"
- "Are the closing CTAs across all pages identical? Same `closing` block?"
- "Should case-study discovery/decisions/solutions be one block or three?"
- "Is the per-service hero distinct from the home hero? Build `service-hero` separately?"

Lock the answers in writing (in `stardust/eds-conversion-log.md` or similar). This is the single highest-leverage step in the whole process.

### 3. Foundation

Update `styles/styles.css` to the following — and ONLY the following:

- Lift `:root` tokens verbatim from the prototype's `<style>` (colors, fonts, type scale, weights, tracking, layout, motion easing).
- Document reset (box-sizing, margin reset, scroll-behavior, body font + bg, ::selection, img defaults, button reset). **The `img` reset MUST be `img { display: block; max-width: 100%; height: auto; }` (#36).** EDS's media pipeline emits `<img>` with `width`/`height` attributes; without `height: auto` a width constraint stretches the image vertically (a landscape 1920×1258 rendered 677×1258). The bug is invisible on the prototype (raw `<img>`, no attrs) — it only appears post-pipeline.
- A minimal EDS section scaffold:
  ```css
  main .section { display: block; }
  main .section > .default-content,
  main .section > .block-content { display: block; }
  main > div, .has-template, div[data-status] { display: none; }
  ```
- A global button system (see next section). This is the one place per-block CSS does NOT own its paint — buttons are site-wide and convention-driven.
- **Reserve the static header's height — or the late fragment injection shifts the first section → CLS (#81).** `postlcp.js` injects `fragments/header.html` AFTER first paint (it's a deferred fetch). In the common layout where the header sits in flow ABOVE the first section (full-bleed hero *below* the nav), the hero therefore renders at `y=0`, then jumps DOWN by the header's height the instant the fragment lands — a large layout shift the browser attributes to the hero block (a real page measured **CLS 0.143, ~0.13 of it the hero**; metric-matched fonts do NOT fix it because the cause is the header box appearing, not a font swap). Reserve the header's rendered height on the **bare `<header>` element** in `styles/styles.css` (it applies before the fragment loads — `decorateHeader()` sets the class early, but styling the bare element covers the pre-class sliver too), with responsive `min-height` matching the fragment per breakpoint and the chrome's own `background` so any reserve-vs-actual delta is invisible:
  ```css
  header { min-height: 98px; background: var(--brand-ground); }   /* desktop nav+banner height */
  @media (width <= 767px) { header { min-height: 102px; } }
  @media (width <= 480px) { header { min-height: 120px; } }       /* banner wraps to 2 lines */
  ```
  Make the header's height **deterministic** so the reserved value actually matches: keep the reservation breakpoints in sync with the fragment's, and avoid nav-link *wrap zones* (e.g. extend the burger/hamburger breakpoint so the inline links can't wrap to a second row at awkward widths). Reserve slightly OVER the natural height (a few px) so you never under-reserve and shift — on a dark/uniform ground the small gap is invisible; a `header:empty` page (`header: off`) removes the element so the reservation is moot. **The footer needs NO reservation** — it's below the fold, so its late injection shifts nothing above it. Verify with a CLS probe (Playwright `PerformanceObserver({type:'layout-shift'})`) that **delays the woff2/fragment fetches** to reproduce the slow-network swap PSI measures — a fast localhost load hides the shift.

That's it. No section-style classes. No motion primitives. No utility classes beyond the button system.

`scripts/scripts.js` stays minimal — only the page boot. No reveal-on-scroll. No marquee init. No header scroll-state. Per-block animation is owned by per-block CSS.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Four principles, applied in this order on every project:

**0. Ship an `@font-face` for EVERY named family — not just the body face (#65).** Prototypes name a display face AND a body face (`--display: "Hebden Incised", …; --body: "Lekton", …`). If you self-host only the body font, every heading/numeral/title whose stack names the un-shipped display family silently falls back to `Times New Roman`/`Arial` (generic serif/sans) — **invisible to size/color checks** (the glyphs differ but the metrics match; only the `FONT MISMATCH` probe flag #66 or an eyeball catches it). Distinct from #11/#22 (wrong weight) and #30 (opsz): here the family is NAMED but NEVER SHIPPED. For each quoted family in `--display`/`--body`/any heading stack, self-host a matching `@font-face` (download + commit the woff2 under `styles/fonts/`, reference root-relative — never the prototype's brand-CDN origin, #44). **Checklist:** grep every quoted family in `styles.css`'s font stacks against the `@font-face { font-family }` names declared — any unmatched name is a silent fallback.

Then four principles, applied in this order on every project:

**1. Leave `head.html` untouched. No font lines, period.**
No Google Fonts `<link>`. No CDN `<link rel="stylesheet">` for type. No `<style>` blocks declaring `@font-face`. **No `<link rel="preload" as="font">`** either — even self-hosted preloads belong out of `head.html`. The browser will fetch the woff2 it needs as soon as `styles/styles.css` parses; the `body { arial }` / `body.session { var(--font-body) }` split (principle 3) eliminates the CLS that preloading is normally meant to prevent. **All `@font-face` declarations live in `styles/styles.css`.**

**2. Self-host EVERY brand face — including proprietary ones — and emit a licensing alert (#80).**
Inspect the prototype to identify each font family and its license:
- SIL OFL 1.1 (Inter, JetBrains Mono, Fraunces, Roboto, Open Sans, IBM Plex, Source Sans, etc.) → self-host. License permits redistribution, including embedding on the served domain.
- Apache 2.0 (some Google Fonts) → self-host.
- **Proprietary commercial (Pangram Pangram, Adobe Fonts / Typekit, Monotype, foundry-direct) → self-host anyway for fidelity, BUT raise a LICENSING ALERT (#80).** The DEFAULT is brand-faithful: a converted/presales page that silently degrades the brand display face to Arial reads as broken to the client (this is exactly what a stakeholder notices first). So lift the prototype's actual webfonts — if the prototype ships `.otf`/`.ttf` (claude-design/stardust prototypes usually do, under `assets/fonts/`), convert them to latin `woff2` with `fontTools` (`f.flavor='woff2'; f.save(...)`, ~30–60 KB each) and declare them in `styles/styles.css` exactly like an OFL face. Because they're proprietary you MUST surface the licensing obligation in THREE places so it can't ship unnoticed:
  1. a banner comment at the top of `styles/styles.css` (`⚠️ FONT LICENSING REQUIRED BEFORE GOING LIVE` + foundry per family + "do not publish to `aem.live` until the webfont/embedding license is confirmed");
  2. a `styles/fonts/LICENSING.md` file (table: file → family → foundry → status, plus the remove-and-fall-back instructions);
  3. the conversion log, AND your hand-off message to the user.
  Document the **remove path**: if licensing can't be confirmed, delete the `.woff2` + their `@font-face` rules and the stacks fall back to the metric-matched system fallback (principle 3/4). This is the inverse of the old "keep CDN / accept Arial" guidance — prefer fidelity + a loud alert over a silent generic fallback. (Only keep a CDN load when the prototype itself loads from an Adobe/Typekit CDN AND you cannot obtain the font files — then document the CDN coupling + CLS cost.)

For OFL fonts, fetch latin-subset variable woff2 files. The fastest reliable source is jsDelivr's `@fontsource-variable/<name>` packages:

```bash
mkdir -p styles/fonts
curl -sSL -o styles/fonts/<name>-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-normal.woff2"
# italic, if used:
curl -sSL -o styles/fonts/<name>-italic-variable.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-wght-italic.woff2"
```

Latin-only variable woff2 is typically 30–60 KB per file, weights 100–900 included.

**Match the axes the prototype loads — incl. optical size (#30).** Check the prototype's Google Fonts `<link>` URL. If it requests an **`opsz`** (optical-size) axis — e.g. `Source+Serif+4:opsz,wght@8..60,400;…` — the default `@fontsource-variable/<name>` file (`<name>-latin-wght-normal.woff2`) is **wght-only** (one fixed optical master) and headings will render subtly off (heavier/different letterforms at large sizes). Fetch the **opsz** file instead (carries both `wght` + `opsz`, ~2× the bytes); `font-optical-sizing: auto` (the CSS default) then tracks the size:
```bash
curl -sSL -o styles/fonts/<name>-opsz.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/files/<name>-latin-opsz-normal.woff2"
```
More generally: self-host the variant whose axes match what the prototype loaded (wght-only vs opsz; italic if used).

**Non-variable fonts (#11).** Many Google fonts ship only as named static weights — no variable axis (e.g. **Barlow**, Barlow Condensed, Anton). For these, `@fontsource-variable/<name>` does NOT exist; use the **static** `@fontsource/<name>` package and fetch each weight you actually use:
```bash
curl -sSL -o styles/fonts/<name>-700.woff2 \
  "https://cdn.jsdelivr.net/npm/@fontsource/<name>@latest/files/<name>-latin-700-normal.woff2"
```
Static `@fontsource` packages also do **not** publish a "Fallback" `@font-face`, so you must **compute** the metric-override values yourself (principle 3) from the woff2 with fonttools:
```python
from fontTools.ttLib import TTFont
f = TTFont("styles/fonts/<name>-400.woff2"); upm=f['head'].unitsPerEm; hhea=f['hhea']; os2=f['OS/2']
arial = dict(upm=2048, xavg=904)  # Arial reference (use Times metrics for a serif brand)
size_adjust = (os2.xAvgCharWidth/upm) / (arial['xavg']/arial['upm'])
adj = upm*size_adjust
print(f"size-adjust:{size_adjust*100:.2f}% ascent-override:{hhea.ascent/adj*100:.2f}% "
      f"descent-override:{abs(hhea.descent)/adj*100:.2f}% line-gap-override:{hhea.lineGap/adj*100:.2f}%")
```
Apply those to the system-font override `@font-face` (renamed `"Arial"` / `"Times New Roman"`) exactly as in principle 3.

**3. Body.session pattern with a metric-matched fallback `@font-face`.**
The brand font must NOT render at first paint. Default to a metric-matched system font; switch to the brand font once `decorateSession()` (in `scripts/ak.js`) adds `body.session`. The recipe:

```css
@font-face {
  font-family: "<Brand>";
  src: url("/styles/fonts/<brand>-variable.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}

/* Override the system font's metrics so it renders with the brand font's
   line box. Naming the @font-face after the system font (e.g. "Arial",
   "Times New Roman") makes any reference to that family in a font stack
   pick up the metric-adjusted version site-wide — no per-block changes. */
@font-face {
  font-family: "Arial";          /* "Times New Roman" for a serif brand */
  src: local("Arial");           /* local("Times New Roman") for serif */
  size-adjust: <X>%;
  ascent-override: <Y>%;
  descent-override: <Z>%;
  line-gap-override: 0%;
}

:root {
  --font-body: "<Brand>", arial, sans-serif;       /* serif: times, "Times New Roman", serif */
}

body { font-family: arial, sans-serif; }
body.session { font-family: var(--font-body); }
```

**Keep `body` VISIBLE — never gate display on `body.appear` (#40).** The font gate is the `body` → `body.session` font swap above; `ak.js` adds `body.session`. Do NOT port the aem-boilerplate pattern `body { display: none } body.appear { display: block }` into the foundation: the static-chrome runtime never adds `appear`, so every OFF-pipeline render (the Local-QA harness, the `visual-diff` probe) stays permanently hidden/zero-height — and a blank page silently passes most checks. (The probe now emits a `BLANK RENDER` red flag as a backstop, but the foundation must not introduce the gate in the first place.)

The metric-override values come from the `@fontsource-variable/<name>` package's published calibration — fetch their CSS:

```bash
curl -s "https://cdn.jsdelivr.net/npm/@fontsource-variable/<name>@latest/index.css" \
  | grep -A 6 "Fallback"
```

Each fontsource package publishes a `<Name> Fallback` `@font-face` with `size-adjust`, `ascent-override`, and `descent-override` values. Lift those three numbers verbatim and apply them to a local-system `@font-face` renamed to the system font (`"Arial"`, `"Times New Roman"`, `"Courier New"`).

The CLS chain that results:
- **Initial paint**: `body { font-family: arial, sans-serif; }` — renders the metric-adjusted local Arial because the override `@font-face` named `"Arial"` wins over the OS Arial. Line box already matches the brand font's metrics.
- **Session activates**: `body.session` switches to `var(--font-body)`. Brand woff2 is still loading; Arial renders in its place with matching metrics. **Zero shift.**
- **Brand font loads**: swaps in. **Zero shift** because metrics already match.

**4. Match the fallback family to the brand font's classification.**
Use the SAME class of typeface for the fallback so visual rhythm is preserved during the load:
- Sans-serif brand → fallback `arial, sans-serif`. Override `@font-face "Arial"` with `local("Arial")`.
- Serif brand → fallback `times, "Times New Roman", serif`. Override `@font-face "Times New Roman"` with `local("Times New Roman")`.
- Monospace brand → fallback `"Courier New", courier, monospace`. Override `@font-face "Courier New"` with `local("Courier New")`. (Note: skipping monospace metric-matching is acceptable when the mono font is only used in small eyebrows/labels — CLS impact is negligible. Document the choice in the conversion log.)

Never substitute classifications (don't match a serif brand to Arial; don't match a sans brand to Times). Even with metric overrides, character widths and rhythm differ enough that the visible shift is jarring.

**Classification includes WIDTH — a condensed/narrow display face needs a condensed fallback, never plain Arial (#80).** "Sans→Arial" is only right for a *normal-width* sans. A narrow/condensed display face (PP Formula Narrow, Bebas Neue, Oswald, Barlow/Archivo Condensed, Anton) falling back to plain Arial is a width-class mismatch: Arial runs **~15–20% wider** with different letterforms, so headings lose the condensed character and wrap differently — a silent divergence the eye catches even when sizes/weights/tracking match exactly (a CardValet pass shipped PP Formula→Arial; the width probe showed Arial 975 vs PP Formula 839 for the same H1 string). When the condensed brand face is self-hosted (principle 2, now the default) this only bites if the webfont is blocked, but the fallback must STILL preserve width: put a condensed system/free face ahead of `arial` in the stack — `"<Brand>", "Arial Narrow", arial, sans-serif` (system `Arial Narrow` is present on macOS/Windows but NOT Android/Linux, so for guaranteed coverage self-host a free OFL condensed analog — Oswald / Barlow Semi Condensed / Archivo Narrow). Same logic for an *extended/wide* brand face. Quick check during foundation: for every `--*-font-family` token whose first face is condensed, confirm the final non-`sans-serif` fallback is also condensed.

**Self-host the prototype's INTENDED fallback, not its accidental system render — and verify with a width probe, never `document.fonts.check` (#77).** Prototypes routinely load **zero `@font-face`** and name a proprietary brand font first (`--display: "Bellfort", "Bebas Neue", system-ui`). On any machine missing the brand font the prototype silently renders **system-ui** — so its on-screen display face is an *accident of the viewing machine*, not the design intent. Do NOT match that accident (don't set EDS `--display` to system-ui because "that's what the proto shows"). The prototype's OWN stack documents the intent: self-host the first **redistributable** fallback (OFL/Apache — e.g. Bebas Neue) so EDS ships the condensed display face the design wants; keep proprietary families documented in the conversion log. **Verify what actually rendered with a width probe** — `document.fonts.check('24px "X"')` returns **true for any family name the page references**, installed or not, so it produces false "fonts match" reads. Instead measure: a span at `font-family:"X",monospace` whose width equals a known-absent name's width means X fell back (absent); a distinct width means X is really rendering. (A beermaker pass set `--display` to Bebas Neue via a `fonts.check` false-positive — the width probe later showed the proto actually renders system-ui, but Bebas Neue was still correct as the documented intended fallback.)

**Multiple display families (#12).** A brand may use several families — e.g. Barlow (body) + Barlow Condensed + Barlow Semi Condensed (display). The `body.session` pattern only gates the **body** family; display families referenced directly by class (headings, eyebrows) load with `font-display: swap` and aren't fully CLS-eliminated. Define each as a `:root` token (`--font-cond`, `--font-semi`) and reference it per-block on the elements that use it. Fully metric-matching every display family is optional polish — for display text used sparingly (eyebrows, big condensed headings) the CLS impact is small; **document the trade-off** in the conversion log rather than over-engineering it. **But when a display family is used in an ABOVE-THE-FOLD heading (the hero `<h1>`, an LCP title), metric-match it too** — compute its `size-adjust`/`ascent-override`/`descent-override` from the woff2 (the same fonttools recipe as #11) and put a dedicated fallback `@font-face` SECOND in that family's stack: `--hero: "Lilita One", "Lilita One Fallback", …`. The fallback family MUST have its own name — do NOT reuse the renamed `"Arial"` face the body match already defines (#11), since that carries the *body* font's metrics, not the display font's. (Note: in practice the dominant first-section CLS is usually the late header box, #81, not the display-font swap — fix the header reservation first, then metric-match above-fold display faces to zero the remainder.)

**Match the prototype's effective weight (#22).** A single-weight display font (e.g. **Anton**, ships only 400) often appears *bolder* in the prototype than its one weight: a bare `<h1>`/`<h2>` inherits the browser-default heading weight (700), and the browser **faux-bolds** the 400-only face. If your foundation sets `h1,h2,h3 { font-weight: 400 }`, headings render visibly lighter than the prototype. Set the weight the prototype actually shows (often 700) so the faux-bold matches — don't assume "one weight in the file ⇒ `font-weight: 400`".

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

The EDS link decorator in `scripts/ak.js` (`decorateButton()`) automatically applies button classes when authors wrap a link in inline emphasis. This runs during page boot, AFTER block JS. Block JS just needs to clone the cell anchor as-is.

**Author markup → auto-applied class:**

| Author markup | Class applied | Visual |
|---|---|---|
| `<strong><a>` | `.btn.btn-primary` | wavelength fill, dark text |
| `<em><a>` | `.btn.btn-secondary` | transparent + outline (color-aware) |
| `<em><strong><a>` | `.btn.btn-accent` | canvas fill on dark surfaces |
| `<del><a>` | `.btn.btn-negative` | rare; destructive |
| `+ <u>` inside any | adds `.btn-outline` | transparent variant |
| 2+ buttons in same parent | parent gets `.btn-group` | flex with gap |

**Add to `styles/styles.css`** (the project's brand button system):

```css
a.btn {
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

a.btn-primary { background: var(--color-wavelength); color: var(--color-ink-rich); border-color: var(--color-wavelength); }
a.btn-primary:hover { background: var(--color-canvas); border-color: var(--color-canvas); }

a.btn-secondary { background: transparent; color: currentcolor; border-color: rgb(255 255 255 / 40%); }
a.btn-secondary:hover { border-color: currentcolor; background: rgb(255 255 255 / 5%); }

/* On light surfaces, secondary uses dark-tinted outline. List the dark sections explicitly. */
main .section:not(.dark, .closing, .hero, .team) a.btn-secondary { border-color: var(--color-rule-strong); color: var(--color-ink-rich); }
main .section:not(.dark, .closing, .hero, .team) a.btn-secondary:hover { border-color: var(--color-ink-rich); }

/* Trailing arrow on primary/accent. */
a.btn-primary::after, a.btn-accent::after { content: "→"; font-weight: 600; transition: transform 0.3s var(--ease-out); }
a.btn-primary:hover::after, a.btn-accent:hover::after { transform: translateX(4px); }

.btn-group { display: inline-flex; flex-wrap: wrap; gap: 16px; align-items: center; }
```

**Surface-aware variants: scope to the BLOCK class, not just the section (#41).** When a button/link/text treatment differs on dark vs light surfaces, the prototype's dark-surface cue (e.g. `.hero`, `.cta-dark`) becomes a **block class** after conversion — a `<div class="hero">` nested inside the `<div class="section">`. So an override written as `main .section.hero a.btn-secondary` never matches (the `.hero` is one level below `.section`), and the on-dark CTA silently renders dark-on-dark. Scope on-dark overrides to BOTH: `main .section.dark a.btn-secondary, main .hero a.btn-secondary { … }`. QA any block on a dark background for secondary/ghost-CTA contrast (light outline + light text) — the button "exists" in metrics, so only contrast/eyeball catches this.

**Block JS pattern — just clone the cell:**

```js
// Get the cell that holds the CTAs
const ctaCell = rows[N]?.firstElementChild;
if (ctaCell && ctaCell.querySelector('a')) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  [...ctaCell.childNodes].forEach((n) => actions.append(n.cloneNode(true)));
  container.append(actions);
}
```

DO NOT manufacture anchors with `cta.className = 'btn-loud'` or inject custom SVG arrows. The global `::after` arrow + the convention's class system handle 95% of cases.

**Block CSS pattern — only override what's actually different:**

The `closing` block's CTA is slightly larger than the global default. That's a legitimate override:

```css
.closing .actions a.btn-primary { padding: 22px 32px; font-size: 13px; }
```

Three lines. Targets the global class, not a custom one. This is the entire "blocks slightly augment defaults" pattern.

**When NOT to use the convention:**

Some links are NOT buttons. Examples:
- A wavelength-underlined text link in a section footer ("How we work →"). It's a styled text link, not a chip.
- Whole-card anchors on tile grids (`<a class="tile">…</a>`). The whole tile is the click target.
- Channel values in a closing CTA (`<a href="tel:…">801-363-0101</a>`). It's a value, not a CTA.
- `mailto:` / `tel:` links inside prose.

For these: the author leaves the `<a>` as a plain anchor in content (no `<strong>` / `<em>` wrap), and the owning block styles it with per-block CSS. The convention is for buttons; if it's not a button, don't apply it.

**Multi-variant button systems (#25).** The strong/em convention only names three slots (primary / secondary / accent). When a prototype has **more** context-specific variants than that — e.g. JFK's `.btn--accent` (yellow), `.btn--primary` (blue), `.btn--ghost` (outline), `.btn--onblue` (white-on-blue) — author emphasis can't express them. Don't force it: **lift the prototype's full `.btn` + variant system into `styles/styles.css`**, author the CTAs as plain `<a>` in content, and have each block apply the right `btn btn--<variant>` class to the cloned anchor (the block knows its section's variant). This is the same "if it doesn't fit, style it" escape hatch, applied at the button-system level rather than per-link.

### 6. Static header + footer fragments

Header and footer are **static fragments** — extracted verbatim from the prototype with their full DOM and styles intact. No EDS authoring, no block JS parsing. They are stored in `fragments/header.html` and `fragments/footer.html` at the repo root and committed to GitHub as code.

**Fragment file format:**

```html
<style>
  /* Scoped styles lifted from the prototype's _tokens.css and page <style> */
  .utility { background: var(--color-ink); ... }
  nav.topnav { position: sticky; ... }
  .nav-inner { ... }
  /* Include responsive breakpoints */
  @media (max-width: 900px) { ... }
</style>
<!-- Full prototype DOM, copied verbatim -->
<div class="utility">...</div>
<nav class="topnav">...</nav>
```

No `<!DOCTYPE>`, no `<html>`, no `<body>` wrapper. Just the raw `<style>` + DOM. The EDS runtime injects it directly into the page's `<header>` or `<footer>` element via `innerHTML`.

**Extraction rules:**

1. Copy the header DOM (utility bar + topnav) from any prototype — it's shared across all pages.
2. Copy the footer DOM from any prototype — also shared.
3. For each fragment, collect the relevant CSS rules from the prototype's `_tokens.css` and any page `<style>` blocks. Include all responsive breakpoints.
3b. **Lift the chrome element's OWN box styles (#31)** — `margin`, `padding`, `border` set on the prototype's `<header>`/`<footer>` element itself — onto `header.header` / `footer.footer`, not just the inner content styles. The fragment injects into the EDS `<header>`/`<footer>`, which sit OUTSIDE `<main>`, so the gap between the last section and the footer comes entirely from the footer's own top margin (e.g. `footer { margin-top: 72px }`). Easy to miss: the inner content looks right while the footer sits flush against the last block.
4. Scope the CSS inside a `<style>` tag at the top of the fragment file.
5. Rewrite relative asset paths (e.g. `../assets/logo.png`) to fully-qualified URLs on the code origin: `https://main--<repo>--<owner>.aem.page/path/to/asset`.
6. Rewrite relative link hrefs (e.g. `donate.html`) to root-relative paths (e.g. `/donate`) matching how EDS serves pages.

**Loading mechanism:** `scripts/postlcp.js` fetches `fragments/header.html` and `fragments/footer.html` from the code origin (`codeBase`) and injects via `innerHTML`. On branch-hosted pages (`<branch>--repo--org.aem.live`), relative paths resolve to the correct branch automatically.

**Fragments cannot run JavaScript.** Because the fragment is injected via `innerHTML`, any `<script>` inside it is inert — the prototype's header JS (mobile-menu toggle, scroll-state shadow, dropdown logic) will NOT run. Re-implement interactive chrome as **CSS-only**:
- **Mobile menu / drawer** → checkbox-hack: a visually-hidden `<input type="checkbox" id="mnav-toggle">` as the first element, `<label for="mnav-toggle">` for the open button and the close button and a full-screen scrim label, and CSS `#mnav-toggle:checked ~ #mnav { … }` to drive the open/close state and the panel transform.
- **Scroll-state shadow / sticky color change** → drop it (keep a static border), or use a CSS scroll-driven approach where supported. Don't try to reattach JS to the fragment.
- **Forms / inline `on*` handlers (#20)** → EDS's delivered CSP is `script-src 'nonce-…' 'strict-dynamic' 'unsafe-inline'`; with `strict-dynamic`, `'unsafe-inline'` is **ignored**, so inline `onsubmit`/`onclick` never fire. A real `<form>` would then submit and reload the page. Render such controls **non-submitting**: a `<div>` wrapper (no `<form>`) with `<button type="button">`. (Same root cause as the no-`<script>` rule — fragments are inert.)
- Document anything you dropped in the conversion log.

**Footer reconciliation (see #4).** The AuthorKit `lazy.js` also tries to load the footer as a *block* (`utils/footer.js` → `loadBlock(footer)`), which collides with the static footer fragment and renders an error box. Make sure the Runtime-bootstrap edit removing that import has been applied.

**Fragment root class (#26).** `postlcp.js` sets the host element's class to `header` / `footer`. If the prototype's chrome styling is keyed to a *different* root class (e.g. JFK's `.utilnav` / `.site-footer`), wrap the fragment content in a `<div class="<that-class>">` so the lifted root selector matches — `header.header` / `footer.footer` is only the host. (Don't nest another `<header>`/`<footer>` inside the host element; use a `<div>`.)

**`header: off` / `footer: off`:** To suppress header/footer on a specific page, add a metadata block with `header: off` or `footer: off`. The loader checks `getMetadata('header')` / `getMetadata('footer')` before fetching.

### 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster (utility pages, services, case studies, etc.). Each agent owns a non-overlapping set of new blocks and content pages. Three to four parallel agents is the sweet spot.

The brief template:

> Per the project's locked direction: each prototype `<section>` becomes its own EDS block. Lift the prototype's `<style>` for that section verbatim, scope it under the block class (`.block-name .x` instead of `section.x .y`), and rebuild the prototype's DOM through a `decorate(block)` function that consumes EDS table-block input.
>
> **You own**: prototypes [list], content pages [list], sections [list].
>
> **Existing blocks — REUSE, do not recreate**: [list with one-line authoring shape per block].
>
> **Brand tokens** are global in `styles/styles.css`; do not redefine.
>
> **Section layout — reproduce the prototype's max-width container (#13)**: if the prototype section wraps its content in a centered max-width container (`<div class="wrap">` / `.container` / `.inner`), your block MUST recreate it — build the content into a `.wrap` div (`block.replaceChildren(wrap)`), so the colored/section background bleeds full-width but the **content** stays within the page max-width. Only render content edge-to-edge where the prototype section itself is full-bleed (no inner wrapper). Getting this wrong is invisible at ≤1440px and only shows at wide viewports.
>
> **Images — `<image-slot>` placeholders (#2)**: claude-design prototypes use `<image-slot>` custom elements as image drop-targets; there are usually NO real image assets. Treat each image as an **optional** authored cell holding a `<picture>`/`<img>` (`const pic = cell.querySelector('picture, img'); if (pic) …`). When the cell is empty, fall back to the prototype's background treatment (e.g. dark `--ink`, or a placeholder rectangle) via the block CSS so the section still looks right with no image. Leave image cells EMPTY in the authoring snippet.
>
> **Scroll-reveal / JS-hidden content (#14)**: if the prototype hides content behind a class an inline `<script>` toggles on scroll (`.reveal { opacity:0 }` + an IntersectionObserver that adds `.in`), do NOT lift the `opacity:0` — the prototype script does not run in EDS, so the content would be **permanently invisible**. Render it visible; drop the reveal (keep only hover/`:hover` transitions). Honor `prefers-reduced-motion`.
>
> **Interactive / component-driven sections (#17)**: when a section is driven by a component (state, a list loop like `<sc-for>`, conditionals like `<sc-if>`, `{{ }}` bindings, a `data-count` counter, a tab/selector), split it: **data → authorable rows** (one row per list item, with the item's fields as cells) and **behavior → block JS**. Unlike static *fragments*, **block JS runs** — so `decorate()` is the right place to wire click handlers, an IntersectionObserver count-up, tab switching, etc. Render the default/active state in markup; drive the rest from JS-held local state. `{{ }}`/`<sc-for>`/`<sc-if>` are NOT EDS syntax — read them as "loop these rows" / "show one state".
>
> **Buttons**: do NOT manufacture button anchors. Author CTAs as `<strong><a>` (primary) or `<em><a>` (secondary) in the content page; in block JS, clone the cell's child nodes into a `.actions` wrapper. Block CSS only overrides global button styles when something is genuinely different (e.g. larger size). Text links with flourish (wavelength underline) are NOT buttons — leave as plain `<a>` and style per-block.
>
> **EDS block convention**: each block at `blocks/<name>/<name>.{js,css}`. JS exports `default async function decorate(block)`. Block input is `<div class="block-name"><div>row<div>cell</div></div>…</div>`. CSS scoped under `.block-name`. Inline SVG markup per-block (no shared utility). Honor `prefers-reduced-motion`.
>
> **EDS content page format**: NO `<head>` element (project `head.html` is injected by EDS), empty `<header></header>`/`<footer></footer>`, each top-level `<div>` inside `<main>` is one section containing one block, no `<style>`/`<script>`/section-metadata, fully-qualified image URLs.
>
> **Done criteria**: [list of paths]. Return a list of new blocks + one-line summary per page.

Agents do not need to coordinate on shared blocks — the brief tells them which existing blocks to reuse.

### 8. Block JS scaffold

```js
/**
 * <block-name> — <one-line description from prototype data-intent attribute>
 *
 * Authoring rows (positional):
 *   1. <picture> background image
 *   2. eyebrow text
 *   3. headline — render as a REAL heading element, never a bare <div>: the
 *      hero/lead block's headline becomes the page's single <h1>; every other
 *      section title becomes <h2> (sub-items <h3>). (use <strong> for emphasis)
 *   4. body paragraph
 *   5. CTA links — wrap primary in <strong>, secondary in <em>; the EDS link
 *      decorator applies .btn.btn-primary / .btn.btn-secondary
 *   6..N: card rows — cells: num | label | description
 */

function text(cell) { return cell ? cell.textContent.trim() : ''; }
function pic(cell)  { return cell ? cell.querySelector('picture, img') : null; }

export default async function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  // 1. Read content by QUERYING, not by hard row index, for lead/hero blocks (#42):
  //    const h = block.querySelector('h1, h2');           // the heading
  //    const ps = [...block.querySelectorAll('p')];
  //    const lede = ps.find((p) => !p.querySelector('a')); // first link-free <p>
  //    const ctaP = ps.find((p) => p.querySelector('a'));  // link-bearing <p>
  //    const pic = block.querySelector('picture, img');
  // 2. Build the prototype's DOM (with prototype-style class names)
  // 3. For CTA rows, clone the cell's child nodes into a .actions wrapper —
  //    do NOT manufacture button anchors with custom classes.
  // 4. block.replaceChildren(...newMarkup);
}
```

**Lead/hero blocks: query content, don't hard-index rows (#42).** A hero that reads `rows[3]=headline, rows[4]=lede, rows[5]=CTA` breaks the moment the content shape differs — and the mandatory-metadata / single-`<h1>` SEO rework (#34/#35) actively **consolidates** the headline + lede + CTAs into ONE cell, so the fixed indices come back `undefined` and the hero `.wrap` (the LCP element and the only `<h1>`) renders EMPTY with no error. Decorate lead blocks by querying (`block.querySelector('h1,h2')`; link-bearing `<p>` = CTAs; `picture` from anywhere) so they tolerate BOTH the rich multi-row shape and the consolidated single-cell shape. **Disambiguate eyebrow vs lede by ORDER/length, not "first `<p>`" (#51):** both are link-free `<p>`s, so "first link-free paragraph = lede" swaps them (the short eyebrow comes first). The canonical lead order is **eyebrow → heading → lede**: the eyebrow is the short/uppercase line *before* the heading; the lede is the sentence-length `<p>` *after* it. Local-QA check: after decoration, assert the hero's inner wrap is non-empty and contains the `<h1>`.

**When cloning a cell into your OWN heading element, UNWRAP the cell's heading first (#55).** If you build a live `<h1>` and clone a source cell's *childNodes* into it, and that cell wraps its text in its own `<h1>` (which #35/#42 actively encourage), you get `<h1><h1>…</h1></h1>` — a duplicate heading and a doubled font cascade. Always `const inner = cell.querySelector('h1,h2,h3,h4,h5,h6') || cell;` then clone `inner.childNodes`. Local-QA: exactly one `<h1>`, and 0 descendant headings inside the live headline.

**Marker injection must be IDEMPOTENT (#70).** When `decorate()` PREPENDS a fixed decorative marker to authored heading/link text (a glyph `▶`, a badge, a `CH NN` number), first STRIP a matching leading occurrence from the cloned text node — `firstText.textContent = firstText.textContent.replace(/^\s*▶\s*/, '')` — because the author (or the #34/#35 SEO content rebuild) may already type it, so the marker doubles (`▶ ▶ Latest signal`). Apply the SAME strip at EVERY place the block injects that marker (section titles AND card links), not just some. (The visual-diff text-match catches a doubled glyph `X X …`.)

**Carousel slide segmentation is HEADING-boundary driven and ORDER-AGNOSTIC (#69).** Segment slides ONLY on the heading boundary — one heading opens one slide (a leading `<picture>` before the first heading may open slide 0). Fold EVERYTHING between two headings into the open slide regardless of authored order (eyebrow/label may come AFTER the heading, not before): first non-link text run = eyebrow, links = CTAs, extra text = description. Never let a post-heading text node open a NEW slide (that steals the heading slot and the CTAs never attach — symptom: N+2 jumbled slides with 0 CTAs). Local-QA: rendered slide count == authored heading count AND each slide's CTA count == authored.

**Split/photo-overlay segmentation: BUFFER the eyebrow that PRECEDES its heading (#76).** Heading-boundary segmentation (#52/#69/#73) opens a new group ON the heading — but in split panels and photo-overlay halves the eyebrow is the small label ABOVE the title, so it arrives BEFORE the heading and a "start collecting after the heading" loop drops it entirely. Worse, the body line after the heading then falls into the now-empty eyebrow slot (inheriting its accent/uppercase paint) and the next group's eyebrow bleeds into the prior group's teaser. Fix: keep a `pendingEyebrow` — any text seen before a heading is buffered and attached to the group that heading opens; once a group already has its body/CTA, further bare text re-buffers as the NEXT group's pending eyebrow (not this group's teaser). This complements #69 (carousel eyebrow may come AFTER the heading): don't hard-assume either order — buffer pre-heading text, classify post-heading text by what's already filled. The content is all in the DOM, so a count check passes while the render is scrambled — Local-QA: assert each group's eyebrow/heading/body/CTA land in their OWN slots (eyebrow text ≠ body text), not just that N groups exist. Hit on beermaker `the-people`.

**Carousel/rotator lead: exactly ONE server `<h1>` across all slides (#57).** A rotating hero authors N slide headlines; if each is an `<h1>`, the delivered HTML has N `<h1>`s (the block may rotate a single live `<h1>` post-JS, but crawlers see all N). Author the **first/primary** slide's headline as the page `<h1>` and every other slide's headline as `<h2>` — the block reads them generically (`querySelector('h1,h2…')`) so the carousel still works, and the server HTML has one `<h1>` (#35). Local-QA: count `<h1>` in the *content* file = 1.

**A multi-row head/intro must be collected whole, not just its first row (#56).** A block that takes "the first row with no image" as the head breaks when the head is authored as N separate single-cell rows (eyebrow / heading / CTA): only the eyebrow becomes the head and the section heading + CTA leak into the item grid as bogus cards (the section title then renders at card-title size). The head is **everything before the first content/image cell** — collect ALL leading no-image rows into the head. (Inverse of #52's flattening.) Local-QA: the item grid holds exactly the expected count, and the section heading renders at section-title size.

**DEFAULT to the DA-flattened single-cell contract (#62 — the root cause of most decode bugs).** When block JS and the content page are generated in the same run, they MUST agree on the row shape — and DA delivers most blocks as ONE row with ONE cell holding all elements as flat siblings, NOT the rich multi-row layout the prototype implies. A block written to a multi-row index contract (`rows[0]=eyebrow, rows[1]=title, rows[2]=cards…`) then reads its whole cell as `rows[0]` and finds `rows[1..]` undefined — rendering 1-of-N (a jumbled hero, a card grid with one card) while passing lint. So make **flatten-first the default**, via a CELL-LEVEL cascade collector (#68/#71) — NOT a single selector and NOT a block-level fallback chain. The trap (#71): a block-level chain (try `:scope>div>div>*` on the whole block, else…) succeeds on the first tier whenever ANY cell has a child element, so in a block that MIXES element cells (`img`/`h1`/`a`) with text-only cells (eyebrow, lede, count, meta, date) it returns only the element cells and **silently drops every bare-text cell** — the most common one-element-per-row DA shape. The canonical collector iterates CELLS and recovers each:
```js
function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    const kids = [...cell.children];
    if (kids.length) out.push(...kids);
    else if (cell.textContent.trim()) { const p = document.createElement('p'); p.textContent = cell.textContent.trim(); out.push(p); }
  });
  return out.length ? out : [...block.children]; // last-ditch: direct children
}
```
Then segment/classify the returned nodes by content; one-cell-per-row is a fallback. **Local-QA: assert every block's primary content container is non-empty post-decorate (childCount>0 / height>0)** — a 0-node selector mismatch otherwise renders a silent blank box (a blank hero only surfaces via a per-block height probe; testimonials surfaced as a CONTENT GAP). **Local-QA / Checklist assertion:** after `decorate()`, the rendered count must equal the authored count — the hero wrap is non-empty and has the `<h1>`; a card grid holds N cards (= N repeat-headings in source), never 1. Index-based contracts pass lint but silently render 1/N.

**Card grids that alternate ground: reconstruct the rhythm by INDEX when no marker survives (#61).** A prototype encodes a grid's light/dark alternation structurally (the 2nd card has `--dark`), but that marker does NOT survive into DA content. A block that flips dark only on an explicit authored "dark" cell renders every card light — the dark card's white heading/CTA go invisible (caught by the #59 `SURFACE/GROUND MISMATCH` flag). Fallback to the positional pattern: `const dark = explicitMarker ?? (i % 2 === 1)`. Then scope on-dark button/text overrides to the resulting `.card.dark` block class (#41).

**This applies to EVERY block, not just hero (#48).** The author's row/cell layout is rarely the contract the agent assumed — a block that hard-codes `rows[4] = <dl> data cell` silently drops content when the content authors one `dt|dd` pair per row instead, and a `[num]|[label]` two-cell assumption duplicates the eyebrow when the author wrote a single `"01 — Title"` cell. These are **silent**: the page still renders something, and the metrics-only diff (stretch/flush/blank) does NOT catch a dropped CTA, a duplicated eyebrow, or an empty data grid. Classify rows/cells by content — presence of a heading, a `<picture>`, a link, a number prefix (`/^\d+/`), a 2-cell `dt|dd` shape — never by `block.children[N]`. **The canonical authored shape is "one line per row, delimiters carry structure" (#50).** DA/snowflake content rarely preserves the prototype's semantic `<dl>`/`<dt>`/`<dd>`/`<ol>`/`<ul>`/`<li>` — it flattens them to a sequence of single-cell `<p>` rows with INLINE delimiters: `Address: PLACEHOLDER · Brand team to supply` (key:value), `01 · Tabernacle · Imp. Stout · 6.5%` (`·`-delimited spec line), `Heber Valley · Utah · Est 1996` (a plain foot line). So a block that `querySelector('dl, dt')` or `'ol, ul, li'` finds NOTHING and silently drops the whole data table / spec list / menu. **Parse by delimiters, not tags:** split `Key: value` on the first colon into `dt`/`dd`; split `·`-delimited lines into spans; detect a list's start by its preceding heading (`On tap this week`), not an `<ol>`. (Even #48's "one `dt|dd` pair per row" misses this — the row is ONE cell, not two.) Checklist: for any table/spec-list/menu block, assert post-decorate that the data container has the expected non-zero row count.

**Repeating card/tile grids: DA flattens N units into ONE cell — segment, don't iterate rows (#52).** A section that is a grid/band of N similar units (a 3-up card grid, a 2-up tile band, a logo row, a team grid) is very often collapsed by DA into a SINGLE cell of a SINGLE row, with each unit's elements (heading, picture, paragraphs, link) as flat siblings. A block written one-DOM-row-per-card then renders **0 cards** (the whole grid collapses into the section header) or **1** — silently dropping every other product/tile. Detect the flattened shape (`rows.length === 1` with multiple headings in the cell) and **segment the flat sibling list into one group per repeating heading**. The repeat-unit boundary is the **most frequent heading tag** in the cell (cards are `h3`; the lone section title is `h2` one level up) — segmenting on "any heading" turns the section title into a phantom first card. Support BOTH the flat-single-cell and the one-row-per-unit shapes. **Segmentation order (#63, #73):** (0) **one-row-per-card** — if ≥2 `:scope > div` ROWS each contain a card heading (`h3`/`h4`), build one group per ROW from `[...row.children]` in AUTHORED field order (treat leading non-card-heading rows as the section head); never assume a `tag → media → heading` field order — content authored `media → tag → heading` otherwise attributes each card's image to the PREVIOUS card and drops the first card's (a 1-of-N image shift that passes a card-COUNT check, #73); ELSE (1) per-card heading boundary if present; ELSE (2) **one card per delimited `<p>` line** — when the cards carry no per-card heading (only the section title), each card is a single `Name · meta · meta · Badge` line (the natural way to author a short card): split on the unit delimiter (`·`), first segment = name, a trailing keyword (`New`/`Limited`/`Sold out`…) = badge, the middle = meta; ELSE (3) one-row-per-unit. This unifies #50 (delimiter parsing) and #52 (card segmentation) for the headingless card/tile rail that falls between them (it silently renders 0 cards otherwise — the section heading still shows, so only the #49 CONTENT GAP / a card-count assert catches it). Local-QA: assert the grid count EVEN WHEN the block found no per-card headings (that's the case that returns 0), AND that each card's image src matches its OWN title (#73 — an image shifted by one passes a count-only check). **Never use `<picture>` as the PRIMARY card boundary (#64):** image-led prototypes tempt "the picture leads each card", but claude-design content is usually image-less (#2), so a picture-keyed split collapses N cards into 1. Segment on the per-card heading first; treat the picture only as a hint for which segment owns the media. (If a grid renders 1-of-N, suspect a picture-keyed boundary with no heading fallback.)

**Classifiers must match the element ITSELF or a descendant (#53), and media must match `picture, img` (#72).** In the flattened shape the segmented "cells" are bare sibling elements (an `<img>`, an `<a>`, an `<h3>`), so `cell.querySelector('img')` returns null and the content silently vanishes. Classify with `el.matches(sel) || el.querySelector(sel)`. For MEDIA, always test `picture, img` (not just `picture`) — un-pipelined/harness content and pasted external URLs deliver a bare `<img>` with no `<picture>` wrapper: `const media = el.matches('picture, img') ? el : el.querySelector('picture, img')`. (Likewise A / `Hn`.)

Always pair with a per-section screenshot eyeball (#23) and the `CONTENT GAP` probe flag (#49) — a heading/contentBox-count or main-height delta vs the proto means content was dropped or duplicated.

**Headings — exactly one `<h1>` per page + a real outline (#35).** Prototype headlines are usually styled `<div>`/`<span>`s with no heading semantics. Promote them: the hero/lead block renders its headline as the page's **single `<h1>`**; every other section title renders as `<h2>` (sub-items `<h3>`). Never leave a headline as a bare `<div>` — the `<h1>` is the strongest on-page relevance signal, it's the source of the page `<title>` (#34), and the outline drives crawlers, AI answer engines, and screen readers (WCAG). This applies to **interactive blocks too**: a flow/quiz/dashboard renders its lead title as `<h1>` in its server-visible markup, not just after JS. (Symptom this prevents: a converted page with zero `<h*>` elements, or sibling `<h2>`s with no `<h1>`.)

**Interactive blocks (#28).** When the prototype section is a stateful component (a selector, a filter, a form that mutates data, a multi-step flow), reproduce it as **one self-contained interactive block that owns the state** — block JS runs, so this is fully supported:
- **Data → keyed authorable rows.** For heterogeneous data, key each row by its first cell (`account | id | name | …`, `txn | date | desc | …`) and parse by key. Homogeneous lists are just one row per item.
- **Behavior → local state + targeted re-render.** Hold a mutable `state` object; write small `render*()` functions (e.g. `renderCards()`, `renderList()`) and re-invoke only the affected one on each interaction — the manual equivalent of a React re-render. A form that mutates data validates, updates `state`, re-renders the affected parts (cards, totals, `<option>`s), and shows a confirmation.
- This mirrors lifting state to a parent in React: if several widgets share data, put them in **one** block rather than trying to sync state across blocks. (Cross-block coordination, if ever needed, is a DOM `CustomEvent`.)
- **Sequential flow vs. addressable views — pick the right decomposition (#33).** A *sequential* flow whose views are entered from one starting point and are not independently addressable (search → results → seats → confirm; an onboarding wizard; a checkout) is **one block** with a `state.view` field and a `render()` dispatcher that `replaceChildren()`s the active view. This is the inverse of #29: *independently-addressable* views with **different chrome** become **multiple pages**. Rule of thumb — sequential-from-one-entry → one block; addressable-with-own-chrome → pages.
- **QA the behavior, not just the paint** — see Local QA: drive each control and assert the state change. (When asserting computed style right after a click, move the pointer off the element and let CSS transitions settle first, or a mid-`transition`/`:hover` read gives a false negative.)

### 9. Content page scaffold

**Every content page MUST begin with a `metadata` block (#34).** At minimum it carries a **Title** (~50–60 chars: brand + primary keyword/location, derived from the page's real `<h1>` — NEVER a block or section name) and a **Description** (~150–160 chars summarising the page). Skip it and EDS derives `<title>` from the first content cell — junk like `<title>Hero</title>` / `<title>Quiz</title>` — and emits no description; and because EDS **mirrors Title/Description into `og:`/`twitter:`**, that junk poisons social/AI share cards too. Authoring this one block resolves title, description, og:title, og:description, twitter:title and twitter:description at once. `header: off` / `footer: off` / `Robots` rows go in the same block when needed (the pipeline extracts the block wherever it sits in `<main>` — first or last). The static header/footer fragments still load automatically via `postlcp.js`; no other per-page configuration is required.

**The content page is a DA *body fragment* (#7).** The DA Source API (the headless deploy path) requires the document to start at `<body>` — **no `<!DOCTYPE>`, no `<html>`, no `<head>`** (the pipeline injects head/scripts/styles from Code Bus). Emit exactly:

```html
<body>
  <header></header>
  <main>
    <div>
      <div class="metadata">
        <div><div>Title</div><div>Brand — primary keyword / location (≤60 chars, from the &lt;h1&gt;)</div></div>
        <div><div>Description</div><div>A 150–160 character summary of the page.</div></div>
      </div>
    </div>
    <div>
      <div class="hero">
        <div><div><h1>The page's lead headline</h1></div></div>
        <div><div>body copy</div></div>
        <div><div><strong><a href="/path">Primary CTA</a></strong> <em><a href="/path">Secondary CTA</a></em></div></div>
      </div>
    </div>
    <div>
      <!-- next section: its title decorates to <h2> -->
    </div>
  </main>
  <footer></footer>
</body>
```

(Only the **mount-based** deploy tolerates a full `<!DOCTYPE html><html>…</html>` document — it strips `<head>` on ingestion. For the Source-API/`curl` path, emit the body fragment above. Before any DA write, run `node skills/deploy/scripts/sanitise.js <file>` to encode non-ASCII — `® · – —`, accents, emoji — to HTML entities, or DA corrupts them to U+FFFD.)

To suppress header/footer on a specific page, add `header: off` and/or `footer: off` rows to that same `metadata` block:

```html
    <div>
      <div class="metadata">
        <div><div>header</div><div>off</div></div>
      </div>
    </div>
```

**Multi-view SPA → multiple pages (#29).** If the prototype is a single-page app with several views that have **different chrome** (e.g. a marketing home with a full nav vs. a signed-in dashboard with a minimal bar), convert **each view to its own EDS page** (pre-render each per #27) and link them with real hrefs. Since `postlcp.js` loads ONE shared `fragments/header.html` for the whole site, two different headers can't both be the fragment: keep the most representative header as the fragment, and on the other page set **`header: off`** (metadata above) and render that page's header as a **block** (`site-nav`) at the top of its content. Share the footer fragment if the footer is the same. (Harness caveat: the `metadata` block is consumed by the delivery pipeline into a `<head>` `<meta>`, but the local harness has no pipeline — so it won't apply `header: off` and will try to load `metadata` as a block, showing a stray error. Strip the `<header>` element from the harness to preview a header-off page; it's a non-issue live.)

**Do NOT emit a `<head>` element.** EDS content pages are markdown-equivalent fragments: the document metadata (title, meta, stylesheets, scripts) lives in the project's `head.html`, which EDS injects at delivery time. A `<head>` block in a content page is dead weight at best and a duplication conflict at worst.

When the prototype has **real** images, AUTHORED content `<img src>` URLs (for uploaded/Media-Bus assets) MUST be fully qualified (`https://main--<repo>--<owner>.aem.page/…`) so EDS preview and the rendered prototype agree on what to show. **This applies ONLY to authored content `<img>` — NOT to fixed assets referenced from block JS/CSS (#67): those are always root-relative `/img/<brand>/…` (see anti-pattern 9b), since an absolute origin in block code 404s in production.** When the prototype uses **`<image-slot>` placeholders** (no real assets — common for claude-design prototypes), leave the image cells EMPTY (`<div></div>`); the block CSS background fallback (Step 7) renders the section correctly without an image. The author drops real images in later.

## Local QA before deploy (no DA)

`aem up --html-folder content` is **not** a reliable way to preview new pages: it serves repo files statically and only renders a path through the full pipeline if that path is already in the remote routing index — brand-new paths 404 on the rendered route. To verify decoration locally, build a **self-contained harness** and open it through the dev server (which serves repo code at its real paths):

```bash
# 1. dev server (serves /scripts, /styles, /blocks, /fragments at their real paths)
npx -y @adobe/aem-cli up --no-open &

# 2. harness — use the committed helper (do NOT hand-roll the metadata strip, #46):
#    it removes the metadata block by balanced tag-counting and rewrites absolute
#    /img/ URLs to root-relative (#43), then emits the full harness doc.
node skills/deploy/scripts/build-harness.mjs content/<path>.html qa/page.html   # qa/ is gitignored
```

Open `http://localhost:3000/qa/page.html` — `scripts.js` runs `loadArea()`, blocks load from the code origin, fragments inject via `postlcp.js`. Screenshot / inspect with headless Chrome (`--virtual-time-budget=9000 --screenshot` / `--dump-dom`) or Playwright.

**Capture at a real viewport and scroll — not one giant window (#19).** A `min-height:100vh` hero becomes *window-tall* under a huge capture window (e.g. 7800px), pushing its centered content far down and off the top crop — it looks like the hero text vanished. Instead, use Playwright at a normal viewport (e.g. 1440×900) and `scrollIntoView()` each section before each screenshot.

**Visually diff each section against the prototype (#23).** Programmatic checks (width, decoration counts, interactivity) pass things the eye catches — header alignment, intentional line breaks (`<br>`), heading **weight**, and a section root's **background/color** (e.g. a footer that should be a brand color but renders on the body background). Open the prototype itself (`<x-dc>`/JSX prototypes self-render from their file via their `support.js`/bundle) and the harness at the **same viewport, section by section**, and compare.

**Drive interactive blocks and assert state changes (#28).** For any interactive block, don't stop at the static render — Playwright-drive each control and assert the result: click a selector/tab → expect the active item / filtered count to change; submit an invalid form → expect the error text; submit a valid one → assert the visible state changed (e.g. a balance went `$4,862.13 → $3,862.13`, a confirmation appeared). Run the same drive against the **deployed** preview too — block JS that worked in the harness can still trip on CSP or a missing dependency live.

**Wide-viewport layout check (#13).** Always QA at a **wide** viewport (≥1600px), not just 1440 — a missing max-width container is invisible where the 1320 max ≈ the viewport. Measure each block's inner content width and flag anything spanning full width that shouldn't:

```js
// Playwright, viewport 1600: for each block, is the content constrained?
for (const n of ['hero','quick','used','stats','service','offers','brands','locations']) {
  const w = await page.evaluate((sel) => {
    const inner = document.querySelector(`.${sel} .wrap`) || document.querySelector(`.${sel}`).firstElementChild;
    return Math.round(inner.getBoundingClientRect().width);
  }, n);
  console.log(n, w, w > 1340 ? '<== FULL-WIDTH (check against prototype)' : '');
}
```

Cross-check each flag against the prototype: full-bleed is correct only where the prototype section has no inner max-width wrapper.

## Step 10 — Visual + structural diff & reconcile (optional, recommended)

After deploy, reconcile the EDS page against the source prototype with **two complementary probes — run BOTH** (#78). They catch disjoint failure classes; either alone gives a false "looks fine":

1. **`skills/diff/scripts/visual-diff.mjs` — the PIXEL/layout probe.** Reasons about rendered geometry: stretched images (#36), dropped max-width wraps (#37), blank renders (#40), surface/ground colour flips (#59). Good at "this looks broken." STRUCTURALLY BLIND to "the right text is in the wrong slot" or "one CTA is gone" — those keep full pixels and plausible colours, so no flag fires.
2. **`skills/diff/scripts/content-diff.mjs` — the STRUCTURAL content+type probe.** Extracts an ordered, role-classified inventory ({heading, eyebrow, cta+href, body}) from each `<main>` — classifying by computed style + tag so the prototype's `.ds-*` DOM and the EDS block DOM compare symmetrically — and DIFFS them: `MISSING CTA/HEADING/EYEBROW` (🔴 dropped content — caught the `the-place` CTA), `ROLE SWAP` (🔴 same text, wrong slot — caught the `the-people` eyebrow↔body scramble #76), `MISSING BODY`/`EXTRA` (🟡 placeholder→real-copy or invented prose), and `FONT FORK` (🟠 a matched line whose rendered FACE differs, by **width probe** not `document.fonts.check` — the #77 method, grouped into one advisory). This is the layer the pixel probe can't see.

Neither is a pixel diff — both use computed-style/geometry measurements; pixels are noise (fonts, animation, dynamic mock data).

```bash
# Prereq: a RENDERABLE prototype. Static → serve from its own dir so relative
# ../assets resolve. JSX → pre-render first (#24/#27).
( cd <prototype-dir> && python3 -m http.server 8791 & )

node skills/diff/scripts/visual-diff.mjs \
  "http://localhost:8791/<prototype>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" \
  --profile eds --sections ".hero,.feature-tabs,.compare"   # optional per-section shots

# Structural content + typography diff (same two URLs). Use the LIVE/harness EDS
# URL so blocks are decorated; a raw content .plain.html has no roles to classify.
node skills/diff/scripts/content-diff.mjs \
  "http://localhost:8791/<prototype>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" \
  --profile eds   # --json to dump both inventories
```

Both probes are owned by the **`stardust:diff`** skill and share
`skills/diff/scripts/diff-profiles.mjs`. The `--profile eds` flag supplies the EDS/DA remediation
language used in the flag messages below; the comparison engines are stack-agnostic
(`--profile generic` for non-EDS builds).

Read the output:
- **Red flags (advisory)** — `BLANK RENDER` (hidden/empty page → #40, a `body{display:none}` gate or harness load failure — fix before trusting anything else); `IMAGE DID NOT LOAD` (rendered box, natural 0×0 → #43, the harness `<img>` 404'd); `STRETCHED IMAGE` (raster aspect ≠ natural → #36, add `height:auto`); `FLUSH-LEFT TEXT` (a left-anchored heading/para at left≈0 → #37, the owning block dropped its max-width wrap). A clean page prints "none".
- **Harness images (#43):** when building the off-pipeline qa harness, rewrite absolute `…aem.page/img/...` `<img src>` to root-relative `/img/...` (the asset is committed locally) — otherwise the image 404s, natural dims are 0×0, and the stretch check silently skips.
- **Metrics JSON** — compare `proto` vs `eds`: `eyebrows`/`headings` colors (catches #38 — a primitive styled in the prototype but dropped in one block), `images` dims, and `contentBoxes` (each block's content width + left offset; a wrapped block sits at left ≈ (viewport−maxw)/2 + padding, a dropped-wrap block at left ≈ 0).
- **Screenshots** in the `--out` dir (default `qa/`): open the full-page pair and any per-section shots and confirm fidelity.

- **Justified vs defect `STRETCHED IMAGE` (#45):** a stretch flag is JUSTIFIED — leave the CSS — when (a) the image is an `object-fit: cover` intentional full-bleed background/watermark, OR (b) the SAME flag appears on the proto side of the diff (a faithful lift of the prototype's own `height:Npx; padding; box-sizing:border-box` rule). "Fixing" a faithful flag only makes the EDS diverge. Treat it as a real defect ONLY when the proto renders the image at its natural AR but the EDS does not.
- **Pre-deploy URL gate (#44):** `grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` MUST be empty. Block JS that injects fixed imagery (logos/icons/watermarks) must reference assets root-relative `/img/...`; an absolute origin baked into block JS passes local QA (the dev server is localhost:3000) but 404s in every real environment.

- **`FONT MISMATCH` (#66):** a heading whose named display/body family loaded in the proto but NOT in the EDS = a missing `@font-face` falling back to serif/sans (#65). Ship the woff2 self-hosted + root-relative.
- **`SURFACE/GROUND MISMATCH` (#59):** a heading that matches the proto by text but renders a materially different color (luminance flipped dark↔light) means its band rendered on the wrong ground (e.g. a light intro band fused into a dark scene, #58). Check the owning block's section background.
- **GAP flags are WHOLE-PAGE, independent of `--sections` (#54):** `IMAGERY GAP` (#47) and `CONTENT GAP` (#49) are computed page-wide; `--sections` only chooses which per-section *screenshots* are saved. So a focused `--sections .hero` run whose hero looks perfect can STILL fire a GAP pointing at a defect in a *different* block (e.g. services dropping 3/4 cards). Never dismiss a GAP flag as "outside my section" — when either fires, run an UNSCOPED full-page diff (or a per-section diff on the suspect block) and locate the dropped/duplicated content before trusting the focused pass.

**Reading `content-diff` (#78):**
- **`MISSING CTA/HEADING/EYEBROW` (🔴):** real dropped content — FIX. A missing eyebrow is most often a segmentation drop (#76, the eyebrow precedes its heading); a missing CTA means the block never authored/rendered the link cell. These are the failures the pixel probe cannot see (full pixels, plausible colours) — treat 🔴 as blocking.
- **`ROLE SWAP` (🔴):** the same text rendered under a different role (body painted as eyebrow, eyebrow folded into a teaser) — the #76 mis-classification class. FIX the owning block's node segmentation.
- **`MISSING BODY` / `EXTRA` (🟡):** body prose dropped, or EDS copy with no proto source. Usually fine — a prototype placeholder ("two paragraphs of prose live here…") legitimately becomes real authored copy. CONFIRM it's an intended rewrite, not lost/hallucinated prose.
- **`FONT FORK` (🟠):** matched lines whose rendered FACE differs (width probe). A `proto X→sys` means the prototype named font X but never loaded it and fell back to system — EDS self-hosting the intended fallback is then CORRECT (#77), not a bug. Confirm the fork is intended; if instead EDS is the one falling back, ship the missing `@font-face`. The probe groups all forked lines into ONE advisory (a proprietary→fallback swap fires on every display line).
- The summary line counts nodes per role on each side — a large `headings`/`cta` count delta is itself a fast dropped-section signal before reading individual flags.

Fix the flagged few, then re-run BOTH probes until visual red flags are "none" (or justified) and content-diff shows **0 structural 🔴** (🟡/🟠 confirmed intended). The flag lists double as a regression checklist — seeded from the findings above, so a new silent regression is worth adding both a fix AND a probe signal.

## Anti-patterns (lessons paid for the hard way)

These look reasonable. They will cost a full reset.

**1. Abstracting prototype sections into "blocks with variants."**
Building one `hero` block with five class-variant treatments (`dark` / `light` / `image` / `full-bleed` / `with-wave`) seems DRY. In practice the variants don't share enough markup or CSS to compress; the JS forks too many ways; CSS gets brittle. **Build one block per distinct prototype section.** Reuse only when sections are byte-identical.

**1b. Merging two prototype bands that have different `data-ground`/surfaces (#58).**
A cinematic/editorial prototype often alternates ground bands — a light `data-ground="dust"` intro (dark heading) followed by a dark `data-ground="ink"` scene (light heading). Fusing them into one block rendered on a single ground silently **inverts** the lost band (its heading flips dark↔light, the design beat vanishes) — lint passes, all content present, only an eyeball or the `SURFACE/GROUND MISMATCH` probe flag (#59) catches it. If one block must span >1 ground, reproduce EACH ground as a distinct full-bleed sub-band inside it (a `.loop-head` light sub-band + the dark scene), never collapse to one. Audit cue: note each section's `data-ground` before merging; a cross-ground merge must preserve both.

**2. Section-metadata style classes that parallel block variants.**
Defining `.section.dark`, `.section.prose-2col`, `.section.eyebrow`, etc. and applying them via section-metadata adds a second styling system that overlaps with block CSS. Authors don't know whether to set `dark` on the section or on the block. Pick one path: **per-block CSS that paints the entire section.** No section-style classes.

**3. Shared utility modules (waves, animation primitives).**
A wave SVG that all blocks import seems reusable. But each prototype section uses its wave differently (different dimensions, colors, animation). Inlining the SVG inside the owning block is more code on paper but eliminates a coupling and makes each block self-contained.

**4. Manually creating button anchors in block JS.**
Code like `cta.className = 'btn-loud'; cta.innerHTML = '<span>…</span>' + ARROW_SVG;` duplicates the EDS button decorator's job, fights its class-application order, and ties block JS to specific button classes. **Clone the cell anchor; let `decorateButton()` apply the class.** Block CSS overrides the global button style only when something is actually different (size, hover variant).

**5. Building complex block JS to parse and rebuild header/footer.**
The old pattern (fetch flat DA fragment → parse structurally → rebuild DOM) is fragile and lossy. Static fragments (`fragments/header.html`, `fragments/footer.html`) are injected verbatim — no parsing, no rebuild. If you find yourself writing block JS for header/footer, stop. Extract the prototype's header/footer as-is.

**6. `.default-content-wrapper` (or any guess about EDS's section DOM).**
The actual EDS shape is `<div class="section"><div class="default-content">…</div><div class="block-content">…</div></div>`. Confirm by inspecting a rendered page in the browser before designing CSS that relies on the wrapping shape.

**7. Doing the audit in too much depth.**
A 22-pattern audit produces abstractions. You only need a per-page section list. Pattern reuse emerges organically when you find two byte-identical sections.

**8. Building before locking decisions.**
Naming + reuse decisions look small but ripple through every block and content page. **Surface 3–5 naming questions to the user up front.** Lock answers in writing before any block code.

**9. Generic placeholder image paths.**
`/img/case-studies/foo.jpg` will 404 unless those images are uploaded. Use the prototype host URL so what you author renders correctly in EDS preview from day one.

**9b. Absolute-origin URLs baked into block CODE — JS string literals AND CSS `background-image: url(...)` (#44, #67).**
ANY fixed brand asset referenced from block code — a JS string literal (logo/icon/watermark/fallback) OR a CSS `background-image: url("…")` (a full-bleed section wash) — must be root-relative `/img/<brand>/x.png`, NEVER an absolute origin (`http://localhost:3000/img/...`, a branch `--…aem.page/img/...` host). An absolute origin passes local QA (the dev server *is* localhost:3000, so it loads) but 404s on every real environment. **This directly overrides anti-pattern #9 / the Step-9 "fully-qualified host URL" rule for fixed block assets (#67):** that rule applies ONLY to AUTHORED content `<img src>` for *uploaded/Media-Bus* assets — fixed imagery in block CSS/JS (section backgrounds, watermarks, CSS fallbacks) is always root-relative. (Cinematic prototypes lean on CSS background washes, so this is common.) Gate before deploy: `grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` must be empty (it scans CSS too).

**10. Touching `head.html` for fonts (preload included).**
Google Fonts `<link>` tags, Adobe Fonts script tags, any CDN-hosted stylesheet, AND `<link rel="preload" as="font">` lines all belong out of `head.html`. The first three add DNS/handshake hops and external coupling; the preload looks helpful but it's not — the metric-matched `body.session` pattern (principle 3) makes preload irrelevant for CLS, and adding it splits font discovery between two files. Declare `@font-face` in `styles/styles.css` only. Self-host proprietary brand faces too (for fidelity) and raise the licensing alert (#80) — only keep a CDN load when you genuinely cannot obtain the font files, and then document the CDN coupling + CLS trade-off.

**11. Skipping the metric-matched fallback `@font-face`.**
Without `size-adjust` + `ascent-override` + `descent-override` on a system-font fallback, the swap from system font → brand font shifts every line of text on the page when the woff2 lands. For a variable brand, lift the calibration from the matching `@fontsource-variable/<name>` package; for a **non-variable** brand (static weights only, no published Fallback face), compute it from the woff2 with fonttools (Step 4, #11). Rename the override `@font-face` after the system font (`"Arial"`, `"Times New Roman"`) so any reference to that family in a font stack picks up the adjusted metrics automatically.

**12. Over-applying the button convention.**
Not every link is a button. Whole-card tile anchors, tel:/mailto: channel values, and styled text links (e.g. wavelength-underlined "How we work →") are NOT buttons. Authors leave these as plain `<a>`; per-block CSS styles them. **The convention is for chips with a clickable boundary; if it's not that, don't apply it.**

**13. Dropping the prototype's max-width container.**
The prototype wraps section content in a centered max-width container (`.wrap` / `.container`) while the section background bleeds full-width. If your block appends content straight to the block root, the content runs edge-to-edge at wide viewports. **Recreate the container** (`block.replaceChildren(wrap)`, or a CSS `max-width: var(--maxw); margin: 0 auto; padding: 0 24px` on the content). This is the easiest bug to miss because it's invisible at ≤1440px — QA wide (see Local QA). Parallel block agents are especially prone to this: state the rule in each brief. **The trap is worst on plain-background sections (#37):** agents reliably keep the wrap on full-bleed *banded* blocks (the colored background makes the edge obvious) but drop it on sections whose background is the page background — there the missing constraint is invisible until you measure. EVERY block constrains content to `--maxw`; the only thing that stays full-bleed is a section *background* (e.g. keep the wrap on the inner grid so a hero's wash background still spans the viewport). **And the wrapper must be STYLED, not just emitted (#74):** a block whose JS writes `class="wrap"` but whose CSS never defines `.{block} .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px }` flushes left exactly the same — the markup looks right, the rule is just absent (it only shows when no inner card supplies its own padding). Gate: for every block whose JS emits a `.wrap`/container class, grep its CSS for the matching rule.

**14. Forgetting `<image-slot>` placeholders have no real assets.**
Claude-design prototypes use `<image-slot>` drop-targets, not `<img>` with real `src`. Don't hard-code a prototype image URL (it 404s) and don't ship a broken `<img>`. Treat the image as an **optional** cell and give the block a CSS background fallback so the empty state still looks right.

**15. Loading the footer twice (block + static fragment).**
The AuthorKit `lazy.js` lazy-loads `utils/footer.js` → `loadBlock(footer)`. With static chrome fragments (this skill) and no `blocks/footer`, that throws and renders a visible "Error" box between the last section and the footer. Remove the `utils/footer.js` import from `lazy.js` during Runtime bootstrap.

**16. Lifting a JS-toggled `opacity:0` reveal.**
Prototypes often hide sections with `.reveal { opacity:0 }` and reveal them via an inline-`<script>` IntersectionObserver. That script doesn't run in EDS, so the lifted `opacity:0` makes the content **permanently invisible** — and it looks fine in the prototype, so it's easy to miss. Render content visible; drop the reveal. (Same root cause as anti-pattern 5 and the fragment-JS rule: prototype `<script>` never executes after conversion.)

**17. Injecting a `<main>` element from block JS.**
A block that builds its own layout/view wrapper (common for interactive blocks that swap views, #33) must NOT use `<main>` — or a bare top-level `<div>` that the foundation reset matches. The reset hides undecorated sections with `main > div { display:none }`; an injected `<main>` makes its child `<div>`s direct children of *a* `main`, so they get `display:none` and the view renders **blank/partial**. It's **silent** — lint passes, no console error; only the missing content shows it. Use a `<section>` (or keep injected nodes scoped under the block element, which never trips `main > div`). Don't port a prototype's `<main>` wrapper literally into block-injected DOM.

## Checklist (per page)

- [ ] Each section in the prototype `<main>` has a corresponding block call in the content page.
- [ ] **Content page is a body fragment** for the Source-API deploy: starts at `<body>`, **no `<!DOCTYPE>`/`<html>`/`<head>`** — EDS injects the project `head.html` at delivery. (Only the mount deploy tolerates a full doc.)
- [ ] Ran `node skills/deploy/scripts/sanitise.js` on the content before any DA write (non-ASCII → entities).
- [ ] `<header></header>` and `<footer></footer>` are EMPTY (static fragments load automatically via `postlcp.js`).
- [ ] **Page begins with a `metadata` block** (#34): real Title (≤60 chars, from the `<h1>`, never a block name) + Description (~155 chars). `header: off` / `footer: off` / `Robots` rows go in the same block when needed.
- [ ] **Exactly one `<h1>` per page** (#35): the hero/lead headline is `<h1>`; section titles are `<h2>`/`<h3>`; no headline left as a bare `<div>` (interactive blocks included — the lead title is `<h1>` in server-visible markup).
- [ ] Real image URLs are fully qualified; `<image-slot>` placeholders → empty cells with a block CSS background fallback.
- [ ] Each block reproduces the prototype's max-width container — **including plain-background sections** (#37); **no unintended full-width content at a wide (≥1600px) viewport**.
- [ ] Global `img` reset is `display: block; max-width: 100%; height: auto;` (#36) — EDS adds width/height attrs; without `height: auto` images stretch vertically.
- [ ] When the header sits in flow above the first section, the bare `<header>` has a reserved responsive `min-height` matching the fragment (#81) — the late `postlcp.js` fragment injection must NOT push the hero down (verify CLS with a fetch-delayed probe; target < 0.1).
- [ ] Any styling that depends on a `<span>`/class INSIDE a block cell is re-created in `decorate()` (#39) — EDS strips `<span>` in block cells (e.g. wrap a `.stars` run in JS, don't author it).
- [ ] Every block reads plain-text fields by CELL/`textContent`, NOT `querySelectorAll('p')` (#79) — the pipeline unwraps the `<p>` in single-text cells, so a `p`-based read drops eyebrow/subhead/lede/tag/body on live while the raw-`<p>` harness still shows them. Verify against the decorated live/preview render or a `<p>`-stripping harness, and assert each text field is present (counts alone don't catch it).
- [ ] No `<style>` or `<script>` tags in the content page.
- [ ] No section-metadata blocks.
- [ ] Closing CTA reuses the shared `closing` block.
- [ ] CTA links are wrapped in `<strong>` (primary) or `<em>` (secondary). Text links and tile-card anchors are plain `<a>`.
- [ ] Block JS exports `default async function decorate(block)` with JSDoc describing rows and noting any button conventions.
- [ ] Block CSS is scoped under `.block-name`.
- [ ] Block CSS does NOT redefine global tokens.
- [ ] Block CSS does NOT redefine global button classes (only legitimate overrides like size or hover variant).
- [ ] SVG markup is inline in the block JS (no shared waves utility).
- [ ] Block JS does NOT manufacture button anchors with custom classes.
- [ ] `prefers-reduced-motion: reduce` honored on any animation.
- [ ] No JS-toggled `opacity:0` reveal lifted from the prototype — content renders visible (prototype scroll-reveal script doesn't run in EDS).
- [ ] No block named after a reserved EDS class (`section`, `default-content`, `block-content`, `wrap`, `button`).
- [ ] `head.html` is untouched. No font `<link>`, `<script>`, `<style>`, or `<link rel="preload" as="font">` lines added. All `@font-face` declarations live in `styles/styles.css`. Brand woff2(s) live in `styles/fonts/`.
- [ ] EVERY named brand face is self-hosted — including proprietary ones (#80); proprietary `.otf`/`.ttf` from the prototype were converted to woff2 with fontTools. If any proprietary face is shipped, the **licensing alert** exists in all three places (styles.css banner + `styles/fonts/LICENSING.md` + conversion log) and the hand-off message flags "license required before `aem.live`".
- [ ] Condensed/narrow display faces fall back to a **condensed** face, not plain Arial (#80): `"<Brand>", "Arial Narrow", arial, …` (or a self-hosted free condensed analog). Width-class is part of classification.
- [ ] Body defaults to a metric-matched system fallback (`arial, sans-serif` for sans brand, `times, "Times New Roman", serif` for serif). `body.session` switches to the brand stack via `var(--font-body)`.
- [ ] An override `@font-face` named after the system font (e.g. `"Arial"`) declares `size-adjust` / `ascent-override` / `descent-override`. For variable brands, lift the calibration from `@fontsource-variable/<name>`; for non-variable brands, **compute** it from the woff2 with fonttools. Result: zero CLS on font swap.
- [ ] No per-block `font-family: var(--font-body)` or `var(--font-display)` declarations. Brand font flows from `body.session` via inheritance. Only mono and serif (Fraunces / Times) families are explicitly set per-block.

## When you finish

Update `stardust/eds-conversion-log.md` (or create one) with: final block inventory, decisions locked, anti-patterns avoided this run, anything site-specific the next person should know. The log is the running history of "why does this look the way it does."

## References

- `da-deploy-protocol.md` — the curl-based DA Source API deploy contract (auth, source PUT, preview/publish, asset-before-preview ordering).
- `IMPROVEMENTS.md` — running log of friction/gaps and the numbered findings (#NN) that the `stardust:diff` `eds` profile cites.
