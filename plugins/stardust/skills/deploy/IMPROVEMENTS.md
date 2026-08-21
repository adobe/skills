# Snowflake skill — improvement notes

Running log of friction and gaps found while applying `stardust-to-snowflake`
to the `samples/**` claude-design prototypes in this repo. Each test converts
**one** prototype on a `snowflake-blocks-test-N` subbranch and deploys to DA at
`/snowflake-blocks/test-N`; durable skill fixes are implemented here on
`snowflake-blocks`.

Status legend: 🔴 blocker / bug · 🟠 missing guidance · 🟡 nice-to-have ·
✅ implemented in skill.

---

## Findings (wasatch-back deploy — `stardust:deploy`)

### #81 🔴 Late static-header fragment shifts the first section → CLS — reserve the header height ✅
**Where:** Wasatch Back Sodaworks conversion (full-bleed hero *below* an in-flow
sticky header). PSI mobile flagged **CLS 0.143**, culprit `div.hero`.
**Cause:** `postlcp.js` injects `fragments/header.html` AFTER first paint. The
`<header>` started at height 0, so the hero rendered at `y=0`, then jumped down
by the header's full height (~118px mobile) the moment the fragment landed. The
shift is attributed to the hero block, and it is **independent of fonts** — a
delayed-woff2 CLS probe still showed 0.1285 from `div.hero` after the body/display
fonts were metric-matched, because the cause is the header *box appearing*, not a
glyph swap.
**Repro:** Playwright `PerformanceObserver({type:'layout-shift'})` with
`page.route('**/*.woff2', …)` delaying fonts ~1.8s (and the postlcp fragment fetch
naturally lands post-paint even on localhost). A fast localhost load hides it.
**Fix applied:** reserve the header height on the **bare `<header>`** in
`styles/styles.css` (applies before the fragment loads), responsive `min-height`
matching the fragment per breakpoint + the chrome background so the small
reserve-vs-actual delta is invisible on a uniform ground. Also extended the
burger breakpoint (640→767px) so the inline nav can't wrap to a 2nd row at
641–767px, keeping the reserved height deterministic. Plus metric-matched the
above-the-fold display faces (Lilita One hero `<h1>`, Bebas Neue) with dedicated
`*-fallback` `@font-face` families (Arial-based `size-adjust`, NOT reusing the
body's renamed `"Arial"` face) to zero any residual swap shift. **Result: CLS
0.13 → 0.0017** at 412px.
**Implemented in SKILL.md:** Step 3 Foundation (header-reservation block + probe
note), Step 4 #12 (metric-match above-fold display faces), per-page checklist.
The footer needs no reservation (below the fold; late injection shifts nothing
above it).

---

## Run log

### test-1 — Wheeler CAT (`samples/Wheelercat`)
- Branch: `snowflake-blocks-test-1`
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-1`
- Preview: `https://snowflake-blocks-test-1--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-1`
- Outcome: ✅ faithful end-to-end render (header, hero, quick, used, stats,
  service, offers, brands, locations, footer). 8 blocks + 2 chrome fragments.
- Prototype type: single-file HTML, inline `<style>` with `:root` tokens,
  semantic `<section class="…">` — the **closest** of the samples to what the
  skill expects.

### test-2 — Festool (`samples/Festool`)
- Branch: `snowflake-blocks-test-2` (off the **improved** `snowflake-blocks`)
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-2`
- Preview: `https://snowflake-blocks-test-2--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-2`
- Outcome: ✅ faithful end-to-end render (header, hero, new-products, brand-band,
  discover, service-band, footer). 5 blocks + 2 chrome fragments.
- Prototype type: single-file HTML with an **external** `.css`, semantic
  `<section>`, green-accent brand, reuses **Barlow** (body) + Barlow Condensed
  (display), chevron text-links instead of chunky buttons.
- **Skill fixes validated:** #13 held — all 5 parallel-built blocks reproduced
  the `.wrap` max-width container (no full-width bug; the agent briefs now state
  the rule). #4 held — no footer "Error" box (runtime port carried the lazy.js
  fix). Body-fragment (#7), non-variable fonts (#11), image-slot fallbacks (#2),
  headless deploy (#10) all worked from the skill as written.
- **New findings surfaced:** #14, #15, #16 below.

### test-3 — Beehive Brewing (`samples/Beer maker Utah design`)
- Branch: `snowflake-blocks-test-3` (off `snowflake-blocks`)
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-3`
- Preview: `https://snowflake-blocks-test-3--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-3`
- Outcome: ✅ faithful end-to-end render incl. the **interactive beer selector**
  (click a beer → glass fill + detail + strength bar update) and the **count-up
  stats**. 5 blocks (hero, marquee, lineup, story, taproom) + 2 chrome fragments.
- Prototype type: **`<x-dc>` document-content** — everything inline-styled, with
  template `{{ }}` bindings, a `<sc-for>` loop, `<sc-if>`, and a JS `Component`
  class driving state. The hardest input shape; exercised the new inline-style
  lifting + interactive-block paths.
- **Skill fixes validated:** #1 (`<x-dc>` handling), #2 (no real images — kept
  inline SVG/CSS), #4 (no footer error box), #7/#10/#11/#13/#14/#15 all held —
  body fragment, headless deploy, non-variable Anton, story capped at `--maxw`
  while lineup/taproom are padded-full (matching the prototype), reveal dropped,
  no reserved-class block names. The improved skill carried this hard case.
- **New findings surfaced:** #17, #18, #19, #20 below.

### test-4 — JFK International (`samples/JFKAirport`)
- Branch: `snowflake-blocks-test-4` (off `snowflake-blocks`)
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-4`
- Preview: `https://snowflake-blocks-test-4--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-4`
- Outcome: ✅ faithful end-to-end render. 8 blocks (hero w/ ASK tab toolbar, status
  live wait-times table, wc-strip, guide, essentials, redev, accessibility, news)
  + 2 chrome fragments.
- Prototype type: **React/JSX app** (HTML shell mounts `.jsx` into `#root`) with an
  external `jfk-styles.css`. The **last untested input shape** — validated the
  "pre-render JSX → static HTML first" path (#1).
- **Skill fixes validated:** #21 footer-class fix held on a fresh conversion (navy
  footer renders); #13 (`.wrap` reproduced), #14 (no JS-reveal), #19/#23 QA, body
  fragment, headless deploy, non-variable/variable fonts all held.
- **New findings surfaced:** #24, #25, #26 below.

### test-5 — Evergreen Bank (`samples/Wells Fargo`)
- Branch: `snowflake-blocks-test-5` (off `snowflake-blocks`)
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-5`
- Preview: `https://snowflake-blocks-test-5--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-5`
- Outcome: ✅ pixel-faithful render **with the interactive features reproduced** —
  selectable account cards, a transaction filter, and a Quick Transfer form with
  validation, a live balance update, and a confirmation. 1 interactive `dashboard`
  block + 2 chrome fragments.
- Prototype type: **React/JSX app** with a signed-in dashboard behind a sign-on
  flow, brand.css tokens + per-element inline styles, serif display (Source Serif 4).
- **Skill fixes validated:** #17 (component → rows + block JS), #24 (JSX pre-render),
  #22 (serif display weight), #21 footer class — all held.
- **New findings surfaced:** #27, #28 below. (Goal of this run: reproduce the
  *interactive* JSX, not just static markup.)

### test-6 — Meridian Airways (`samples/Virgin Atlantic`)
- Branch: `snowflake-blocks-test-6` (off `snowflake-blocks`)
- DA: `https://da.live/#/paolomoz/claude-design-eds/snowflake-blocks/test-6`
- Preview: `https://snowflake-blocks-test-6--claude-design-eds--paolomoz.aem.page/snowflake-blocks/test-6`
- Outcome: ✅ faithful render **with the full multi-step booking flow reproduced** —
  search → flight results (live cabin price toggle) → seat map → boarding-pass
  confirmation, all in one interactive `booking` block. + 3 marketing blocks
  (destinations, cabins, loyalty) + 2 chrome fragments. Verified the whole flow
  end-to-end on the **deployed** page (header/footer fragments, 4 generated
  flights, seat pick, confirmation hash) with zero page errors.
- Prototype type: **React/JSX app** — a linear booking *flow* (4 sequential views
  swapped by a `view` state), brand tokens in `<style>`, Bricolage Grotesque
  (opsz) display + Albert Sans body.
- **Skill fixes validated:** #28 (stateful view → one block), #24 (JSX pre-render),
  #30 (opsz font), #31 (footer margin) — all held.
- **New findings surfaced:** #32, #33 below. (Goal of this run: reproduce the
  *interactive* multi-step flow.)

---

## Findings (test-8 — Knack, native stardust `uplift-knack/home-C-cinematic`)

First conversion of a real stardust prototype (10 blocks) with the SEO-hardened
skill. SEO #34/#35 held perfectly as a forward design (1 `<h1>` + 8 `<h2>` server-
visible, real `<title>`/description). A Playwright prototype↔EDS visual diff then
surfaced four fidelity gaps — three are reinforcements/new guidance below.

### 36. 🔴 EDS-delivered `<img>` carry width/height attrs — the global reset MUST set `height: auto`
The feature-tabs screenshot (intrinsic 1920×1258, landscape) rendered **677×1258** — width constrained to the column but height stuck at the intrinsic attribute value, stretching it vertically. Cause: the EDS media pipeline emits `<img width="1920" height="1258">`; the foundation reset had `img { max-width: 100% }` but no `height: auto`, so the height attribute won the cascade. This is invisible on prototypes (raw `<img>`, no attrs) and only appears post-pipeline — a silent, EDS-specific distortion. Fix: `img { … height: auto; }` in styles/styles.css.
**Proposed:** Step 3 (Foundation) document reset MUST include `img { max-width: 100%; height: auto; }`. Add to the Checklist. (The prototype's own reset won't show the bug — it's introduced by the pipeline's width/height attributes.)

### 37. 🟠 Anti-pattern #13 reinforced — parallel block agents drop the `.wrap` on 4 of 10 blocks
The prototype wraps every section's content in `.wrap` (max-width 1180 + 24px padding) over a full-bleed section. Agents preserved it on the full-bleed band blocks (compare/integrations/stats/faq/final — the bg made it obvious) but **dropped it on the plain-background blocks** (hero, proof, feature-tabs, value-cards), which rendered full-bleed flush-left/edge-to-edge (`panelW = 1280`, hero text at x=0). The cue is weakest exactly where the section background is the page background. Fix: max-width content wrap on each (`.hero-grid` keeps the section full-bleed for the `--wash` bg; the others constrain the block element).
**Proposed:** strengthen anti-pattern #13 and the Step 7 brief — state that EVERY block constrains content to `--maxw` with side padding, **including plain-background sections** (the easiest to forget); the only thing that stays full-bleed is a section *background*. Consider adding the wrap to the Step 8 scaffold.

### 38. 🟠 Shared prototype primitives applied via a global class need per-block CSS (or a global rule) — agents miss them
The prototype's `.eyebrow` (uppercase, purple) is a single global rule reused across sections. Each block agent re-lifts its own section CSS, so most styled their eyebrow — but the **hero agent dropped it** (eyebrow rendered dark/lowercase). Same class of issue as the stars below. When a visual primitive lives in a global selector the prototype shares across sections, a per-section agent can omit it.
**Proposed:** Step 2/Step 7 — when the audit finds a shared global class (`.eyebrow`, `.pill`, `.chip`), either lift it once into styles.css as a documented primitive OR list it explicitly in every owning agent's brief so none drop it.

### 39. 🟡 `<span>`-dependent styling breaks — EDS strips `<span>` in block cells
The hero trust line used `<span class="stars">★★★★★</span>` for the orange color. EDS strips `<span>` (and its class) inside block cells (da rule §3.9), so the stars rendered in the inherited muted color. Fix: the block JS re-wraps the leading ★ run in a `.stars` span itself (don't depend on an authored span surviving).
**Proposed:** cross-reference the da-content "block cells strip `<span>`" rule in Step 8 — any styling that depends on a `<span>`/class inside a block cell must be re-created in `decorate()`, not authored. (Relates to the buttons convention, which uses `<strong>`/`<em>` precisely because those survive.)

**Implemented (#36–39):** On test-8 (the page) — #36 global img `height:auto`, #37 max-width wraps on hero/proof/feature-tabs/value-cards, #38 `.hero .eyebrow`, #39 hero.js star-wrap. In the skill (here on `snowflake-blocks`) — #36 → Step 3 reset + Checklist; #37 → anti-pattern #13 strengthened (plain-background sections) + Checklist; #39 → Checklist (re-create span styling in decorate); #38 → this finding (lift shared global primitives once, or list them per-agent brief). The whole diff-and-reconcile loop is now solidified as **Step 10 (optional)** + a committed probe `tools/da/visual-diff.mjs` (structured metrics + advisory red flags seeded from #36/#37/#38/#39, not a pixel diff); validated by running it against the fixed test-8 → "red flags: none".

---

## Findings (30-prototype hardening loop, test-9…test-38)

Autonomous loop converting 30 diverse stardust prototypes, each validated with
`tools/da/visual-diff.mjs`, fixed, and generalised into the skill. Surfaced (even
by a mis-targeted iter-1 run) three foundational issues:

### 40. 🔴 Foundation must NOT gate `body` display on `body.appear` — off-pipeline renders go blank (and the probe false-passes)
A scaffold agent reused the aem-boilerplate pattern `body { display: none } body.appear { display: block }` as a font gate. But the snowflake static-chrome runtime's `ak.js` adds `body.session` (font swap) — it never adds `body.appear`. So every OFF-pipeline render (the Local-QA harness #8 and the visual-diff probe #36–39) stays permanently hidden/zero-height. Worse, `visual-diff.mjs` had no blank guard: it screenshotted a hidden page, still saw headings in the (hidden) DOM, and printed "red flags: none" — a silent FALSE PASS that would invalidate all local validation across the loop.
**Implemented:** (a) `tools/da/visual-diff.mjs` now emits a `BLANK RENDER` red flag (and suppresses all other metrics) when `body` is `display:none` / `<main>` is zero-height / has <20 chars of text. (b) Skill: Step 4 foundation — keep `body` VISIBLE; font-gate ONLY via `body { font: <fallback> } body.session { var(--font-body) }` (ak.js adds `body.session`); never port the boilerplate `body{display:none}/body.appear` gate (the static-chrome runtime doesn't drive `appear`).

### 41. 🟠 Surface-aware button/link overrides keyed to the SECTION class silently miss (the prototype's dark-surface class becomes a BLOCK class)
A dark-surface ghost-button override targeted `main .section.hero a.btn-secondary` / `.section.dark …`. In EDS the section is `<div class="section">` and the block is a nested `<div class="hero">`, so `.section.hero` never matches — the secondary CTA rendered dark-on-dark (near-invisible). Invisible in metrics (the button exists); only contrast/eyeball catches it.
**Implemented:** Step 5 (button system) / Step 7 brief — when a button/link/text variant is surface-aware, scope the on-dark override to BOTH the section state AND the dark *block* class (`.section.dark a.btn-secondary, .hero a.btn-secondary …`), because the prototype's dark-surface selector usually becomes a block class one level below the section after conversion.

### 42. 🟠 Lead/hero blocks must decorate by QUERYING content, not hard row indices — the #34/#35 SEO rework collides with index-based decorate()
A hero block hard-indexed `rows[3]=headline, rows[4]=lede, rows[5]=CTA` (the rich prototype shape). The SEO-rebuilt content page (#34/#35: single `<h1>`, real metadata) consolidates headline+lede+CTAs into ONE cell, so the index lookups were `undefined` and the hero `.wrap` (the LCP element + the only `<h1>`) rendered EMPTY, silently. This collides directly with the mandatory-metadata/single-`<h1>` rework, which pushes content toward the consolidated shape.
**Implemented:** Step 8 + the #35 Headings rule — lead/hero blocks decorate by querying content (`block.querySelector('h1,h2…')`; first link-free `<p>` = lede; link-bearing `<p>` = CTAs; `picture` from anywhere), tolerating BOTH the rich multi-row shape and the consolidated single-cell shape. Local-QA: assert the hero inner wrap is non-empty and contains the `<h1>` after decoration.

### 43. 🟠 visual-diff STRETCHED-IMAGE check false-passes when the EDS image fails to load (natural 0×0)
Snowflake images use absolute `aem.page` origin URLs (#2/#9). In the OFF-pipeline local harness those 404 (cross-origin / not-yet-deployed), so `naturalWidth/Height` come back `0×0`. The #36 stretch test is `!isSvg && natAR && renAR && …` — with `natAR=0` it short-circuits to `false`, so the probe printed "red flags: none" without ever running the check, precisely when the asset didn't load. Surfaced on test-9 (Stripe hero `wave.webp`).
**Implemented:** (a) `visual-diff.mjs` now emits an `IMAGE DID NOT LOAD` red flag when an `<img>` rendered a box but has natural `0×0`. (b) The Local-QA harness recipe (Step 10): when building the harness, rewrite absolute `…aem.page/img/...` URLs to root-relative `/img/...` (the asset is committed locally) so the image loads and the stretch check has real dimensions. convert.workflow.js validate phase does this rewrite.

### 44. 🔴 Block JS that injects fixed brand imagery must use root-relative `/img/...`, never an absolute origin
Two test-11 blocks (proof.js, resources.js) hard-coded the asset origin as `http://localhost:3000/img/...` (whatever the agent tested with locally). This PASSES local QA (the dev server *is* localhost:3000, so the images load and the stretch check even runs) but **404s on every real environment** (branch preview, main preview, live) — the trust marks, impact icons, and watermark silently vanish in production. Distinct from #43 (which only rewrites absolute `aem.page/img` URLs in the *harness HTML*, not URLs baked into committed block JS); and the #43 IMAGE-DID-NOT-LOAD guard can't catch it because the localhost origin happens to resolve in the harness.
**Implemented:** anti-pattern + Step 10 grep gate — block JS that injects non-authored imagery (logos/icons/watermarks) MUST reference assets root-relative `/img/...`; never an absolute origin. Pre-deploy gate: `grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` must be empty. (convert.workflow.js validate phase runs this gate.)

### 45. 🟡 A STRETCHED-IMAGE flag is JUSTIFIED (don't "fix" it) when it's a faithful reproduction
The #36 stretch check (natural AR vs rendered-element-box AR) fires on any `img { height: Npx; padding; box-sizing: border-box }` — the padding is subtracted from the content box so the element AR ≠ image AR — and on any `object-fit: cover` full-bleed background/watermark. When the PROTOTYPE does the same thing (the diff flags it on the proto side too), "fixing" the EDS would make it DIVERGE from the reference. Agents were chasing faithful flags into divergence.
**Implemented:** Step 10 red-flags rule — a STRETCHED-IMAGE flag is justified (leave the CSS) when (a) `object-fit: cover` intentional full-bleed, OR (b) the same flag appears on the PROTO side. Treat it as a defect only when the proto renders the image at natural AR but the EDS does not.

### 46. 🟡 The QA harness metadata-strip was hand-rolled per run and fragile — give it a committed helper
Building the harness means taking the content `<main>` "with the metadata section removed", but the mandatory metadata block (#34) is nested div-in-div, so a naive non-greedy `…</div></div>` regex stops one tag early and leaves an orphan `</div>` that silently corrupts the harness DOM (an agent hit this 3× on test-12). It recurs on EVERY iteration.
**Implemented:** committed `tools/da/build-harness.mjs <contentFile> <outHarness>` — extracts `<main>`, removes the metadata wrapper by **balanced tag counting** (not regex), rewrites absolute/localhost `…/img/` URLs to root-relative (#43), warns on any leading orphan tag, and emits the full harness doc. Step 10 + convert.workflow.js validate now call it instead of hand-rolling.

### 47. 🟡 visual-diff false-passes on an imagery gap — no proto-vs-EDS image-count comparison
On test-13 the prototype rendered 8 images but the EDS rendered 0 (image-less content, all CSS fallbacks per #2). The probe inspects `eds.images` in isolation (stretched/failedToLoad) and never compared `proto.images.length` vs `eds.images.length`, so it printed "red flags: none" despite a wholesale imagery gap — and a *broken* fallback (rendered nothing) would look identical to an intentional one. Distinct from #40 (blank page), #43 (an EDS img that 404s to 0×0), #44 (absolute origins): here the images simply aren't in the EDS DOM.
**Implemented:** `visual-diff.mjs` now emits an `IMAGERY GAP` advisory when the proto has ≥3 images and the EDS has <50% of that count — labelled expected-for-image-less-content (#2) but forcing an eyeball of the fallbacks rather than a silent "none". Advisory, not a defect.

### 48. 🟠 EVERY block (not just hero) must classify rows/cells by content, not fixed indices
On test-14 both blocks were written against a fixed row/cell contract that didn't match the authored shape: `contact-strip` assumed 1-row-2-cells but got 3-rows-1-cell (silently **dropped the paragraph and CTA**); `taproom` assumed a 7-row contract with a single `<dl>` cell but the content authored one `dt|dd` pair per row + a single-cell `"01 — …"` tag (→ **duplicated eyebrow, empty data grid, empty tap list**). All silent: the page renders *something* and the metrics diff can't see a dropped CTA or empty grid. Same class as #42 (lead/hero) and #23 (agent drift), but it generalises to every block.
**Implemented:** Step 8 query-content rule extended to ALL blocks — classify by content (heading / `<picture>` / link / number prefix / 2-cell `dt|dd`), read one `dt|dd` pair per row (not a single `<dl>` cell), never `block.children[N]`. Pairs with the #49 CONTENT GAP probe flag + mandatory per-section eyeball.

### 49. 🟠 visual-diff must flag proto-vs-EDS content gaps (heading / contentBox / main-height deltas) — a dropped section is the worst defect and was invisible
The probe printed "red flags: none" on test-14 round 1 while the EDS was missing an entire taproom section AND the contact CTA — because the red-flag set only covered stretch/flush/blank, and the metrics JSON required a human to notice proto had 2 taproom-head boxes / 4 headings vs EDS 1 / 3. A missing section/dropped sub-element is the highest-severity conversion defect and was invisible to the automated pass. Same blind spot #47 fixed for image count.
**Implemented:** `visual-diff.mjs` now emits a `CONTENT GAP` advisory when proto vs EDS differ materially in heading count (≥3), contentBox count (proto ≥4 and EDS <60%), or main-height ratio (<0.6) — "EDS dropped/duplicated authored content, eyeball the section pair." (mirrors the #47 image-count rule.)

### 50. 🟠 DA flattens semantic `<dl>`/`<ol>`/`<ul>` to single-cell delimited lines — parse by delimiter, not tag (refines #48)
test-15 broke the same two blocks again: the real authored shape is neither a `<dl>` cell nor #48's `dt|dd` 2-cell rows — it's a sequence of single-cell `<p>` lines with inline delimiters (`Address: PLACEHOLDER · …` key:value; `01 · Tabernacle · Imp. Stout · 6.5%` spec line; `Heber Valley · Utah · Est 1996` foot). A block querying `dl,dt`/`ol,ul,li` finds nothing and silently drops the whole data table/tap list — invisible to a render check (the card head still shows). Caught by the #49 CONTENT GAP flag (1062px vs 1935px).
**Implemented:** Step 8 — the canonical contract is "one line per row, delimiters carry structure"; parse `Key: value` on the colon, split `·`-delimited lines into spans, detect a list by its preceding heading; never rely on authored `<dl>/<ol>/<ul>` surviving. Checklist: assert the data container's row count is non-zero post-decorate.

### 51. 🟡 Eyebrow vs lede: "first link-free `<p>`" swaps them — disambiguate by order/length (refines #42)
page-intro took the first link-free `<p>` as the lede, but the short eyebrow line is also a link-free `<p>` and comes first, so eyebrow and lede swapped. Recurs on any lead/intro with both a small eyebrow and a body paragraph.
**Implemented:** Step 8 #42 heuristic refined — the canonical lead order is eyebrow → heading → lede; the eyebrow is the short/uppercase line BEFORE the heading, the lede the sentence AFTER it; classify by document order/length, not "first paragraph".

### 52. 🟠 Repeating card/tile grids: DA flattens N units into ONE cell — segment by the repeating heading, don't iterate rows
test-16 dropped beer cards (0 rendered) and a whole taproom tile (only 1 of 2) because featured-beer/the-people decorated one-DOM-row-per-unit, but DA collapsed each N-up grid into a SINGLE cell with all units' elements as flat siblings. Distinct from #48/#50 (which flatten WITHIN one unit). Caught by the #49 CONTENT GAP heading-count delta.
**Implemented:** Step 8 repeating-groups rule — detect `rows.length===1` with multiple headings, segment the flat siblings into one group per repeating heading (boundary = the MOST FREQUENT heading tag, so the lone section-title `h2` isn't mistaken for a card; cards are `h3`). Support both flat and one-row-per-unit shapes. Local-QA: grid must hold the expected count (not 0/1).

### 53. 🟡 Cell classifiers must match the element ITSELF or a descendant
After segmentation the "cells" are bare sibling elements (`<img>`/`<a>`/`<h3>`), so `cell.querySelector('img')` returns null and the content vanishes. 
**Implemented:** Step 8 — classify with `el.matches(sel) || el.querySelector(sel)`; extract with `el.tagName==='IMG' ? el : el.querySelector('img')` (likewise A / Hn).

### 54. 🟡 IMAGERY/CONTENT GAP flags are whole-page — a focused `--sections` run can wrongly dismiss them
test-17 ran `--sections .hero`; the hero matched cleanly, but the page-wide CONTENT/IMAGERY GAP flags pointed at the services block dropping 3/4 cards. An agent focused on the named section can rationalise GAP flags as "outside my section". 
**Implemented:** Step 10 — GAP flags are whole-page (computed regardless of `--sections`, which only picks screenshots); when either fires, run an unscoped full-page diff and locate the dropped block before trusting the focused pass. convert.workflow.js validate prompt updated.

### 55. 🟠 Cloning a headline cell's childNodes into a live heading nests `<h1>` in `<h1>`
test-18's story-hero cloned each slide cell's *childNodes* into its live `<h1>`; the cells wrapped text in their own `<h1>` (per #35/#42), producing `<h1><h1>…</h1></h1>` — a duplicate heading at 2× font. Caught by the visual-diff (second h1 at doubled size).
**Implemented:** Step 8 — unwrap first: `const inner = cell.querySelector('h1..h6') || cell; clone inner.childNodes`. Assert one `<h1>`, 0 descendant headings in the live headline.

### 56. 🟠 A multi-row head leaks fragments into the item grid (inverse of #52)
story-cards took "the first no-image row" as the head; the head was authored as 3 separate rows (eyebrow / heading / CTA), so the section heading + CTA became bogus 22px cards. Recurs on any section-header authored multi-row.
**Implemented:** Step 8 — the head is everything BEFORE the first content/image cell; collect ALL leading no-image rows. Local-QA: grid holds exactly the expected count; section heading at section-title size.

### 57. 🟠 Carousel/rotator lead emits N server `<h1>`s — author one h1, rest h2
A rotating hero with N slide headlines each as `<h1>` delivers N `<h1>`s (the block rotates one live `<h1>` post-JS, but crawlers see all N) — violates #35. test-18 had 6.
**Implemented:** Step 8 + #35 — author the first slide's headline as the page `<h1>`, the rest as `<h2>` (block reads headings generically so the carousel still works). Local-QA: `<h1>` count in the content file = 1. (Applied to test-18.)

### 58. 🟠 Merging two prototype bands with different `data-ground` silently inverts the lost band
test-19's pipeline block fused a light `data-ground="dust"` intro (navy heading) with the following dark `ink` scene into one ink slab — the intro heading flipped navy→cream and the light-band beat vanished. Silent (lint clean, content present); only an eyeball/the #59 flag catches a whole band changing ground.
**Implemented:** anti-pattern 1b + Step 2 audit cue — when one block spans >1 `data-ground`, reproduce EACH ground as a distinct full-bleed sub-band (light head + dark scene); note each section's ground before merging.

### 59. 🟡 visual-diff records heading colors but never compared them — a ground inversion printed "none"
The probe stores each heading/eyebrow color but `redFlags()` only checked blank/imagery/content/load/stretch/flush — no proto-vs-EDS color comparison, so a full ground inversion (a matched h2 navy→cream) passed silently. Same blind spot #47/#49 closed for other metrics.
**Implemented:** `visual-diff.mjs` matches headings by text across proto/EDS and emits a `SURFACE/GROUND MISMATCH` advisory when a matched heading's luminance differs by >90 (dark↔light). Step 10 red-flags list updated.

### 60. 🟡 visual-diff heading count was skewed by the prototype's chrome headings + a proto blank-measure artifact
test-20's proto reported 20 headings vs EDS 14 (a false CONTENT GAP): the 6 extra were the proto's nav/footer chrome headings (chrome is fragments in EDS, outside `<main>`). Also the proto's sticky/scroll-choreography hero made the proto's own `<main>` measure 0px (blankRender on the proto side), making height/box ratios meaningless.
**Implemented:** `visual-diff.mjs` scopes heading analysis to `<main>` (chrome excluded); when the proto measures blank-ish (`blankRender` or main <50px) the height/contentBox ratios are skipped and only the heading delta is trusted.

### 61. 🟠 Card grids that alternate ground lose the rhythm when no surface marker survives — reconstruct by index
The prototype's 2nd feature card has `--dark`, but that marker doesn't survive into DA content, so a block that flips dark only on an authored marker rendered every card light (the dark card's white heading went dark-on-light). Caught by #59.
**Implemented:** Step 8 — fall back to the positional pattern (`dark = marker ?? i%2===1`); scope on-dark overrides to `.card.dark` (#41).

### 62. 🔴 META: co-generated block JS + content must DEFAULT to the DA-flattened single-cell contract
All 6 test-20 blocks were generated with multi-row index contracts (`rows[0]=eyebrow…`) but the co-generated content delivered each block as ONE row with ONE flat cell — so every block read its whole cell as `rows[0]` and rendered 1-of-N (jumbled hero, one-card grids), invisible to lint. This is the systemic root cause behind #42/#48/#50/#52/#53/#55/#56. `tutorial.js` (the one block that flattened up front) survived unchanged — proving flatten-first is the safe default.
**Implemented:** Step 8 + the convert.workflow.js block brief — flatten-first is the DEFAULT contract (`block.querySelectorAll(':scope > div > div > *')`, segment/classify by content); one-cell-per-row is only a fallback. Checklist assertion: after decorate the rendered count = authored count (hero non-empty + has `<h1>`; card grid holds N, never 1). Turns "classify by content" from a per-block post-hoc fix into a generation-time default.

### 63. 🟠 Headingless card grid (one delimited line per card) renders 0 cards — falls between #50 and #52
test-21's beer-rail rendered 0 of 10 cards: each beer is ONE delimited `<p>` line (`Furious · IPA · 6.7% · Year-round`) with no per-card heading, so #52's heading-boundary segmentation found only the section `<h2>` → zero card boundaries, and #50 is framed for data lists not card tiles. Silent (the section heading still shows); caught only by the #49 CONTENT GAP / a card-count assert.
**Implemented:** Step 8 #52 rule — segmentation order: (1) per-card heading boundary, ELSE (2) one card per delimited `<p>` line (split on `·`: name / meta / trailing-keyword badge), ELSE (3) one-row-per-unit. Assert the count even when no per-card headings were found.

### 64. 🟠 Card segmentation keyed on `<picture>` collapses N cards to 1 on image-less content (reinforces #52)
test-22's featured-beers keyed card boundaries on the can `<picture>`, but the content is image-less (#2) so all 3 beers collapsed into 1 — even though each had a per-card `<h3>`. The sibling events.js (heading boundary, picture as hint) was fine. Caught by #49.
**Implemented:** Step 8 #52 — never use `<picture>` as the primary card boundary; segment on the per-card heading first, picture only a media hint. A grid rendering 1-of-N is the symptom.

### 65. 🟠 Every named font family must ship an @font-face — else silent serif/sans fallback
test-23 lifted `--display: "Hebden Incised", …` but self-hosted only the body face, so every heading/numeral/title fell back to Times serif — silent (size/color match the proto; only the #66 FONT MISMATCH flag or an eyeball catches it). Distinct from #11/#22 (weight) and #30 (opsz): the family is NAMED but NEVER SHIPPED.
**Implemented:** Step 4 principle 0 — self-host an @font-face for EVERY quoted family in --display/--body/heading stacks (download+commit woff2 root-relative, not the brand CDN #44). Checklist: grep every quoted family against the @font-face names in styles.css.

### 66. 🟡 visual-diff never captured fontFamily — a wholesale display-font fallback passed silently
The probe compared color (#59) and size but not font, so the #65 fallback produced no flag (sizes/colors matched; only glyphs differed). Same blind-spot class as #47/#49/#59.
**Implemented:** `visual-diff.mjs` captures the first named family per heading + whether it loaded (`document.fonts.check`), and emits a `FONT MISMATCH` advisory when a text-matched heading's named face loaded in the proto but not the EDS. Step 10 red-flags list updated.

### 67. 🟠 Block CSS `background-image: url()` is an absolute-origin leak — and #9 contradicted #44
3 of 5 #44 leaks on test-24 were CSS `background-image: url("https://…aem.page/img/…")` (full-bleed section washes), not JS — and anti-pattern #9 / the Step-9 "fully-qualified host URL" rule actively told the agent to bake exactly that absolute origin. The #44 grep gate caught it reactively, but the generation-time instruction was contradictory.
**Implemented:** anti-pattern 9b broadened to cover block CSS `background-image: url()` AND JS literals; #9 and the Step-9 image rule now carve out that the fully-qualified host applies ONLY to AUTHORED content `<img>` for uploaded assets — fixed block-code imagery (backgrounds/watermarks/fallbacks) is always root-relative. Resolves the #9↔#44 contradiction (#67).

### 68. 🟠 Node collector must CASCADE (cells → direct children → bare cell text), not a single selector (extends #62)
Two test-25 blocks (hero, testimonials) hard-coded `:scope > div > div > *` and rendered EMPTY (blank hero box; height-0 testimonials = the CONTENT GAP) because this hand-authored content placed copy as DIRECT children of the block and quote/attribution as BARE CELL TEXT. #62 only covered the nested-cell run.
**Implemented:** Step 8 — cascade collector: (1) `:scope>div>div>*`; else (2) direct element children; else (3) read each cell's own text. Local-QA: assert every block's content container is non-empty post-decorate (a 0-node mismatch otherwise renders a silent blank box).

### 69. 🟠 Carousel slide segmentation must be HEADING-boundary driven and order-agnostic (generalises #51)
The hero produced 7 jumbled slides with 0 CTAs: it assumed eyebrow→heading order (#51), but this content authored heading-FIRST then label/CTAs, so post-heading text opened spurious slides that stole the heading slot.
**Implemented:** Step 8 — segment slides ONLY on the heading boundary; fold everything between two headings into the open slide regardless of order (first non-link run = eyebrow, links = CTAs). Local-QA: slide count == heading count, CTA count == authored.

### 70. 🟡 Marker/badge injection must be idempotent — strip a matching leading glyph before prepending
test-26's channel-archive prepended a `▶` to a section h2 that already began with `▶` → `▶ ▶ Latest signal`. Silent (lint clean); caught by the visual-diff text-match. The same block already stripped it for card links but not the title.
**Implemented:** Step 8 (near #55) — when decorate() prepends a fixed marker (glyph/badge/`CH NN`) to authored heading/link text, strip a matching leading occurrence first, consistently at every injection site.

### 71. 🟠 The cascade collector must be CELL-LEVEL, not block-level (corrects #68)
test-27: all 6 blocks used `:scope > div > div > *`; the content authored each element in its OWN row, and text-only cells (eyebrow/lede/count/meta/date) hold a bare text node, so `> *` dropped them. #68's BLOCK-level chain doesn't help: its first tier succeeds whenever any cell has a child element, so the bare-text cells are still dropped in mixed blocks. This is the common one-element-per-row DA shape.
**Implemented:** Step 8 + workflow brief — canonical `collectNodes()` iterates `:scope > div > div` CELLS and recovers each (child elements if any, else synthesize a `<p>` from the cell text). Checklist: assert text-only cells (counts/meta/eyebrows) survive.

### 72. 🟡 Media classifiers must match `<img>` as well as `<picture>`
Two test-27 bands matched only `picture`/`querySelector('picture')`; a bare authored `<img>` (harness / un-pipelined / pasted URL) was dropped → empty media box.
**Implemented:** Step 8 #53 — every media test uses `picture, img` (`el.matches('picture, img') ? el : el.querySelector('picture, img')`).

### 73. 🟠 One-row-per-card grids: group by ROW in authored order — media-before-tag shifts every image by one
test-29's articles authored cards one-row-per-card (fields media→tag→heading→excerpt→date), but the flat heading-gap heuristic assumed tag→media→heading and pulled "trailing media + the text node before it" as each card's lead — so each card's image was attributed to the PREVIOUS card and the first card's image dropped. A 1-of-N image SHIFT that passes a card-count check; caught only by the IMAGERY GAP delta + an eyeball that each image matches its title.
**Implemented:** Step 8 card-segmentation tier 0 — detect ≥2 `:scope>div` rows each with a card heading, group per ROW from `[...row.children]` in authored order (no assumed field order); flat heading-gap is the fallback. Local-QA: each card's image src matches its own title.

### 74. 🟡 An emitted `.wrap` with no matching CSS rule flushes content left (distinct from #37's dropped wrapper)
test-30's variant-cards.js correctly emitted `<div class="wrap">`, but variant-cards.css never defined the `.wrap` rule (every sibling block did), so the heading + grid rendered edge-to-edge. #37 frames this as the agent DROPPING the wrapper; here the markup is right and the CSS rule is just absent (only bites when no inner card supplies padding). Caught by the #37 FLUSH-LEFT flag.
**Implemented:** anti-pattern #13 — a JS-emitted `.wrap`/container class with no matching `.{block} .wrap { max-width; margin; padding }` rule is a silent no-op; grep every block whose JS writes a wrap class for the matching CSS rule.

### 75. 🟠 Preview races the asset deploy → `about:error` on a newly-committed authored image
A page that authors a real `<img>` for a freshly-committed Code Bus asset can ship a broken hero/photo on launch: the content **preview** fetches every `<img src>`, hashes the bytes into Media Bus, and writes `src="about:error"` if the URL doesn't return image bytes AT THAT MOMENT — and a just-pushed `img/<brand>/x.jpg` loses the race with Code Sync. Silent (a broken image, no error). Hit on the beermaker page's new heritage photo. (Most snowflake pages are image-less per #2, so this only bites pages with authored `<img>` for committed assets — but then it's a visible launch defect.) The `about:error` *cause* is in da-content rule #5; the deploy protocol didn't guard the *ordering* or *verify* it.
**Implemented:** da-deploy-protocol.md — (1) before preview, poll each authored image URL until 200 (assets live on Code Bus first); (2) after preview, `curl <page>.plain.html | grep -c about:error` must be 0, else re-preview (idempotent — it re-ingests and repairs).

### 76. 🔴 Heading-boundary segmentation drops the eyebrow when it PRECEDES the heading
A split/repeating block that segments on the `<h2>` boundary (the #52/#73 pattern) silently corrupts every group when the eyebrow sits BEFORE its heading — the common "small label above a big title" layout. Symptoms, all at once: the pre-heading eyebrow of the first group is dropped (no group is open yet when it's seen); the body sentence after the heading gets mis-assigned as the eyebrow (and inherits the eyebrow's accent/uppercase paint); and the NEXT group's eyebrow folds into the prior group's teaser slot (cross-group bleed). The content is all present in the DOM — it's purely a classification failure, so a content-count check passes while the render is wrong. Hit on beermaker `the-people` (two taproom halves, each `eyebrow → h2 → body → CTA → picture`): "Visit · taproom 01" vanished, the body rendered as the yellow eyebrow, and "Visit · taproom 02" appeared under Heber Valley.
**Implemented:** SKILL.md Step 8 segmentation contract — when grouping on a heading boundary, BUFFER any pre-heading text as the *pending eyebrow* and attach it to the group its heading opens; after a group already has its body/CTA, treat further bare text as the NEXT group's pending eyebrow (not this group's teaser). Don't assume the eyebrow follows the heading — in split/photo-overlay blocks it usually leads it.

### 77. 🟠 `document.fonts.check` lies for local fonts → false "font match"; self-host the prototype's intended fallback, not its accidental system render
Two traps when reconciling typography. (a) `document.fonts.check('24px "X"')` returns **true for any family name** the page references, whether or not the glyphs are actually installed — so it can't tell you what really rendered. Measure instead: set a probe span to `font-family:"X",monospace` and compare its width to a known-absent name; equal width ⇒ X fell back ⇒ X is NOT really there. (b) Prototypes routinely **load zero `@font-face`** and name a proprietary brand font first (`--display: "Bellfort", "Bebas Neue", system-ui`), so on any machine lacking the brand font the prototype silently renders **system-ui** — its on-screen display face is an *accident*, not the design intent. Don't match that accident. The prototype's OWN stack documents the intent: self-host the first **redistributable** fallback (here Bebas Neue, OFL) so EDS ships the condensed display face the design clearly wants. An earlier beermaker pass set `--display` to Bebas Neue on the false premise (via `fonts.check`) that "the proto renders Bebas Neue" — a width probe showed the proto actually renders system-ui, yet Bebas Neue was still the right call because it's the documented intended fallback. Reconciled with the user: keep Bebas Neue.
**Implemented:** SKILL.md Step 4 — verify rendered faces with a width probe (never `document.fonts.check`); when a prototype's display stack is `proprietary-brand → redistributable-fallback → system`, self-host the redistributable fallback (design intent) rather than matching the prototype's accidental system-ui render; document proprietary families in the conversion log.

### 78. 🟠 The visual diff is pixel-heuristic only — it's structurally blind to dropped/mis-slotted content; add a content+type diff
`visual-diff.mjs` reasons about rendered geometry (stretch/wrap/blank/colour). That ceiling is exactly why three real defects shipped past it this session: the `the-people` eyebrow↔body scramble (#76), the dropped `the-place` CTA, and the typography fork (#77). All three keep full pixels and plausible colours, so no pixel flag fires — they are *semantic* failures ("right text, wrong slot" / "one CTA gone" / "different face"), invisible to a geometry probe. Tuning the heuristics can't fix a missing dimension; the fix is a second, structural layer. Also, visual-diff's own `FONT MISMATCH` used `document.fonts.check` — the #77 false-positive trap — so its font signal was unreliable.
**Implemented:** new `tools/da/content-diff.mjs` — extracts an ordered, role-classified inventory ({heading, eyebrow, cta+href, body}; images are visual-diff's domain) from each `<main>`, classifying by computed-style+tag so the prototype `.ds-*` DOM and the EDS block DOM compare symmetrically, then diffs: `MISSING CTA/HEADING/EYEBROW` (🔴), `ROLE SWAP` (🔴, the #76 class), `MISSING BODY`/`EXTRA` (🟡 placeholder/invented), `FONT FORK` (🟠 rendered-face width probe, grouped). Validated: 0 structural 🔴 on the fixed beermaker page; fires `MISSING EYEBROW`+`MISSING CTA` on a reverted fixture. Wired into SKILL.md Step 10 as a mandatory second probe alongside visual-diff, and fixed visual-diff's `fontLoaded` to use the width probe instead of `document.fonts.check`. Step 10 pass bar: visual red flags none/justified AND content-diff 0 structural 🔴.
**Follow-up (profile + skill):** the EDS-specific strings (source/target labels, per-flag remediation hints, font-delta, eyebrow thresholds, content-root selector) factored into `tools/da/diff-profiles.mjs` — the engines are now framework-agnostic; `--profile eds` (default) carries the DA/EDS language + finding numbers, `--profile generic` is neutral for any prototype↔build comparison. Both probes packaged as the standalone **`stardust-diff`** skill (`/stardust-diff`), referenced by Step 10 and the workflow Validate phase. Add a stack by copying the `generic` profile.

### 79. 🔴 The delivery pipeline unwraps a single-`<p>` block cell → a `querySelectorAll('p')` read silently drops plain-text fields on live
**Symptom:** a block's plain-text fields — eyebrow, subhead, lede, tag, prose, body — render correctly in the local static harness but are **silently dropped on the live/preview** render. Headings, CTAs, and images survive; only the bare paragraphs vanish. A count-only check passes (heading/CTA/image counts match) while the text is gone.
**Root cause:** the delivery pipeline **unwraps the `<p>` from a block cell that contains a single paragraph**, leaving the text as a bare node in the cell `<div>`:
```
authored   <div><div><p>Heber Valley + Park City</p></div></div>
delivered  <div><div>Heber Valley + Park City</div></div>   ← the <p> is gone
```
So `block.querySelectorAll('p')` (and `[...].filter(p => !p.querySelector('a'))`) finds NOTHING for those cells and drops them. Same family as #50/#62, but it bites the *simple* text fields, not just the rich/repeating ones — so it's easy to assume "this field is just one paragraph, querying `p` is fine." It is not.
**Why it's invisible locally:** `build-harness.mjs` serves the RAW authored HTML, which still contains the `<p>`, so block JS finds it and the harness renders the text. The bug only appears once the real pipeline strips the `<p>` — a harness-vs-pipeline false pass. The `<strong>`/`<em>` button paragraph is unwrapped the same way (so the CTA-by-`p` lookup fails too) — query the anchor directly via `block.querySelector('a')`.
**Fix:** classify by CELL and read `textContent`, never depend on a `<p>` wrapper. Iterate `block.querySelectorAll(':scope > div > div')`; for each cell test `picture, img` → `h1..h6` → `a` → else `cell.textContent.trim()`; build your own `<p>` from that text. Tolerates BOTH shapes — harness `<div><p>text</p></div>` and live `<div>text</div>`.
**Guards (do all):**
1. Make the QA harness simulate the pipeline: strip `<p>` from single-`<p>` cells (`<div><p>X</p></div>` → `<div>X</div>`) before loading, so the harness reproduces the delivered DOM instead of masking it.
2. Local-QA / Checklist assertion: after decorate, assert EVERY authored text field is present (eyebrow AND subhead AND lede AND tag AND body), not just block heights > 0 and heading/CTA/image counts.
3. content-diff catches this ONLY when run against the live/preview build (or the pipeline-simulating harness) — a content-diff against the raw-`<p>` harness shows the text present on both sides and misses the drop. Run the structural diff against the decorated LIVE url.
**Implemented:** SKILL.md per-page checklist entry — read plain-text fields by CELL/`textContent`, verify against the decorated live/preview render. Guard 1 (a `<p>`-stripping mode in `build-harness.mjs`) is a recommended follow-up, not yet coded.

### 80. 🟠 Proprietary brand fonts were dropped to Arial (silent brand divergence) + condensed faces need a condensed fallback
**Context:** CardValet (Fiserv brand) conversion, `paolomoz/stardust-deploy-test-2`. Prototype names proprietary faces — **PP Formula** (Pangram Pangram, a *narrow* display face) + **Univers for Fiserv** (Monotype) — and ships them as `.otf` under `assets/fonts/`.
**Symptom:** stakeholder immediately noticed the EDS headings "looked different." Width-probe vs prototype: every metric (size/weight/line-height/letter-spacing/transform) matched EXACTLY, but the rendered FACE was Arial — PP Formula H1 string measured **839px** in the proto vs **975px** (Arial) in EDS (~16% wider, different letterforms).
**Root cause (two faults):**
1. The old skill guidance said proprietary → "keep CDN / accept Arial / document the CLS trade-off." For a brand-faithful/presales conversion that silent degrade reads as broken.
2. Even the fallback was wrong-class: PP Formula is *condensed*; the stack's final fallback was plain `arial` (a normal-width grotesque) — a width-class mismatch on top of the missing face.
**Fix (policy change):** **self-host EVERY brand face, proprietary included**, for fidelity — convert the prototype's `.otf`/`.ttf` to latin woff2 with fontTools (`f.flavor='woff2'`) and declare `@font-face` in `styles.css`. Because proprietary fonts carry a redistribution obligation, raise a **licensing alert in three places** (styles.css banner + `styles/fonts/LICENSING.md` + conversion log) + the user hand-off, with a documented remove-and-fall-back path; do not publish to `aem.live` until the license is confirmed. AND fix classification to include WIDTH: condensed faces fall back to `"Arial Narrow"` / a self-hosted free condensed analog, never plain Arial.
**Implemented:** SKILL.md Step 4 principle 2 (self-host proprietary + 3-place alert), principle 4 (width is part of classification), anti-pattern 10 closing line, and two per-page checklist entries. User preference captured: prefer fidelity + loud licensing alert over a silent generic fallback.

**Implemented (#40–78):** #40 → blank guard + Step 4; #41 → Step 5/7; #42 → Step 8; #43 → load guard + Step 10 harness rewrite; #44 → anti-pattern + Step 10 grep gate; #45 → Step 10 justified-flag rule; #46 → build-harness.mjs; #47/#49/#59 → visual-diff count/colour advisories; #48/#50/#51/#52/#53/#55/#56/#57 → Step 8 decoration contract; #54 → Step 10 whole-page; #58 → anti-pattern 1b; #75 → da-deploy-protocol asset-before-preview + about:error gate; #76 → Step 8 pre-heading-eyebrow buffering; #77 → Step 4 width-probe font verification + self-host the intended fallback; #78 → content-diff.mjs structural content+type probe (Step 10) + visual-diff font-probe fix, factored into diff-profiles.mjs (eds|generic) + the stardust-diff skill. (Tooling: convert.workflow.js arg-parse/fail-fast + title/desc plain-prose + leak gate; .eslintignore excludes vendored runtime; dev-server guard in iter-setup.)

---

## Findings (SEO audit — all pages, test-1…test-7)

Source: a marketing/SEO audit workflow over all 8 deployed pages (per-page reports
in `seo-audit/test-*.md`, synthesis + skeptical validation in
`seo-audit/SKILL-FIXES.md`). Eight systemic issues surfaced (P0×2, P1×2, P2×2,
P3×2). The **two P0s are implemented below**; P1–P3 (favicon + `<html lang>`,
JSON-LD, `noindex` for signed-in views, server-visible semantic skeleton for
interactive blocks, non-404 share image, no `#` placeholder links) remain queued
in `SKILL-FIXES.md`.

### 34. 🔴 Per-page `metadata` block is MANDATORY (Title + Description) — never a block-name `<title>`
The skill *forbade* a per-page metadata block (Step 9 opened "Content pages contain only the body sections — no metadata block…"; the Checklist said "No metadata block needed"). Consequence on **7 of 8 pages**: with no Title/Description authored, EDS derives `<title>` from the first content cell → junk like `<title>Hero</title>`, `<title>Quiz</title>`, `<title>Dashboard</title>`, `<title>Site Nav</title>` — non-unique, keyword-free — and since EDS mirrors Title/Description into `og:`/`twitter:`, the junk also poisons share/AI cards; missing descriptions force Google to synthesise snippets. **Control:** test-6 (Meridian) was the only page that authored a metadata block → the only page with a correct `<title>` + real description + complete OG, proving the fix end-to-end. Verified live: test-7 `<title>Quiz</title>`, `og:title=Quiz`.
**Implemented:** Step 9 now *requires* a `metadata` block as part of every content page (Title ≤60 chars from the real `<h1>`, never a block name; Description ~155 chars; `header/footer/Robots` rows in the same block); scaffold DOM + Checklist updated. One block resolves title/description/og/twitter at once.

### 35. 🔴 Promote one cell to `<h1>` and section titles to `<h2>`/`<h3>` — pages had zero headings
**7 of 8 pages contained zero `<h*>` elements**; test-6 had sibling `<h2>`s but **no `<h1>`** — so even the "good" page had a broken outline. The Step 8 JSDoc listed "`<h2>` headline" as a comment but the example DOM and real blocks emitted headlines as bare `<div>`s, and nothing forced a single `<h1>`. The `<h1>` is the strongest on-page relevance signal, the source of the page `<title>` (#34), and the document outline crawlers / AI engines / screen readers rely on.
**Implemented:** Step 8 JSDoc + a new "Headings" rule require the hero/lead headline to render as the page's **single `<h1>`** and section titles as `<h2>`/`<h3>` (interactive blocks included — lead title is `<h1>` in server-visible markup); never leave a headline as a bare `<div>`. Scaffold DOM (`<h1>` in the hero) + Checklist updated.

**Implemented (#34–35):** #34 → Step 9 (mandatory metadata block) + scaffold + Checklist; #35 → Step 8 JSDoc + Headings rule + scaffold + Checklist. **Validated by rebuilding test-1 as `test-1-seo`** (branch `snowflake-blocks-test-1-seo`).

---

## Findings (test-6)

### 32. 🔴 A block must not inject a `<main>` element — it collides with the foundation section reset
The `booking` block swaps 4 views via `block.replaceChildren(viewEl)`. The view wrapper was first ported literally from the React component as `<main class="md-flow-page">`. The runtime foundation reset hides undecorated sections with `main > div { display: none }` (and re-shows decorated ones with `main div.section { display: block }`). An injected `<main>` makes its child `<div>`s direct children of *a* `main`, so they matched `main > div` and rendered `display:none` — the whole flow came up blank/partial. It is **silent**: lint passes, no console error; only the missing content reveals it (QA caught it as a `waitForSelector` timeout on a `hidden` element). A normal block injecting plain `<div>`s scoped under itself never trips this, because those divs are not direct children of `main`. Fix: make the view wrapper a `<section>` (switched all three `el('main', …)` → `el('section', …)`).
**Proposed:** add an anti-pattern — when a block injects its own layout/view wrapper, never use `<main>` (or a bare top-level `<div>` that the section reset matches); use a `<section>` or keep nodes scoped under the block element. Do not port a prototype's `<main>` wrapper literally.

### 33. 🟠 Sequential in-page flow → ONE block with an internal view state machine (not multiple pages)
Meridian is a *linear* booking flow (search → results → seats → confirm) whose views are **sequential and not independently addressable** — you always enter from search. This is the inverse decomposition from #29 (independently-addressable views with different chrome → multiple pages). Here all four views are one EDS page + one `booking` block with `state.view` and a `render()` dispatcher that `replaceChildren()`s the active view. **Decision rule:** addressable-with-own-chrome → multiple pages (#29); sequential-from-one-entry → one block.
- Page-specific detail (kept here, not promoted to core): because the block *is* the home view's hero and the marketing sections (destinations/cabins/loyalty) below it belong to the home view only, the block hides its **sibling sections** when it leaves search — it walks up to its owning section (the ancestor whose parent is `<main>`) and toggles `display` on each `nextElementSibling`; the header/footer fragments stay as persistent chrome.
- Minor QA nuance: when asserting computed style right after a Playwright click, move the mouse off the element and let CSS transitions settle, or a mid-`transition`/`:hover` read gives a false negative (a picked seat read as un-highlighted until the 0.12s background transition finished).
**Proposed:** extend #29 in the interactive-blocks guidance — distinguish *sequential flow* (one block, internal `state.view` + `render()` dispatcher, single page) from *independently-addressable views* (multiple pages, #29).

**Implemented (#32–33):** #32 → Anti-patterns (new); #33 → Step 8 interactive-blocks note (flow vs pages, cross-ref #29).

---

## Findings (test-5)

### 27. 🟠 Pre-render a view behind routing/auth by seeding the app's persisted state
Evergreen's interactive part (the dashboard) is behind a sign-on flow; the default render is the marketing home. The app persists its route to `localStorage` (`evergreen_state`). To pre-render the target view, **seed that state before the app boots** — Playwright `page.addInitScript(() => localStorage.setItem('evergreen_state', JSON.stringify({page:'dashboard',user:'Alex'})))`, then navigate. (Generic alternatives: drive the UI to the view, e.g. fill + submit the sign-on form, then capture; or set the framework's router/hash.) Capture `#root` for the view you actually want to convert.
**Proposed:** add to the #24 pre-render recipe — for app views behind routing/auth, seed the persisted state (localStorage/hash/URL) or drive the UI to the target view before capturing.

### 28. 🟢 Reproducing rich interactivity: one stateful view → one self-contained block
The dashboard is a single React component tree with `accounts` state lifted to the app and a transfer that mutates it (re-rendering cards, total, and the form selects). The faithful EDS form is **one interactive block that owns that state**:
- **Data → keyed authorable rows.** Heterogeneous data (user / accounts / transactions / insight) authored as rows keyed by a first cell (`account | id | name | …`), parsed by the block.
- **Behavior → block JS with local state + render functions.** Hold a mutable `state` (selected, filter, balances); write small `renderCards()` / `renderList()` functions and re-invoke the affected one on each interaction — this is the manual equivalent of React's re-render. The transfer validates, mutates balances, calls `renderCards()` + updates the total + rebuilds the select `<option>`s, then shows a confirmation.
- **Verify the interactivity in QA**, not just the static render: Playwright-drive each control (click a card, click a filter, submit a bad amount → expect the error, submit a valid one → assert the balance/confirmation changed). This run asserted `$4,862.13 → $3,862.13` after a `$1,000` transfer.
**Proposed:** add an "Interactive blocks" subsection to Step 8 — keyed rows for heterogeneous data; local state + targeted re-render; and a QA step that drives the controls and asserts state changes (extends #17).

### 29. 🟠 Multi-view SPA → multiple EDS pages; per-page chrome via `header: off` + a nav block
A prototype SPA can have several views with **different chrome** (Evergreen: a marketing home with a full nav + "Sign on", and a signed-in dashboard with a minimal utility bar + "Sign off"). Pre-render each view (#27) and convert each to its own EDS page (`/…/test-5`, `/…/test-5-home`). But `postlcp.js` loads ONE shared `fragments/header.html` for the whole site, so two different headers can't both be the fragment. Resolution: keep the most common header as the fragment (here: the dashboard's), and on the *other* page set **`header: off`** (a `metadata` block: `header | off`) and render that page's header as a **block** (`site-nav`) at the top of its content. The footer was identical across views, so the footer fragment is shared. Link the views with real hrefs (the home "Sign on" → the dashboard page).
- Harness caveat: the `metadata` block is consumed by the delivery pipeline (→ head `<meta>`), but the local harness has no pipeline, so it (a) doesn't apply `header: off` and (b) tries to load `metadata` as a block → a stray "Error" box. Build the harness with the `<header>` element stripped to preview header-off pages; both are non-issues live (verified: `<meta name="header" content="off">`, no error box, only `site-nav` renders).
**Proposed:** add a "Multi-view / multi-page" note to Step 9 — one EDS page per view; shared chrome stays a fragment; per-page chrome = `header: off`/`footer: off` metadata + a nav block; link views with hrefs.

### 30. 🟠 Optical-size (`opsz`) fonts: self-host the opsz variant, not the wght-only file
Found by eyeballing the deployed home vs the prototype — the serif headings were subtly off. The prototype's Google Fonts URL was `Source+Serif+4:opsz,wght@8..60,400;…` — it uses the **optical-size axis**. The default `@fontsource-variable/<name>` file (`<name>-latin-wght-normal.woff2`) is **wght-only** (fixed optical size), so headings render at one optical master and look heavier/different at large sizes. Fontsource also ships an **opsz** file (`<name>-latin-opsz-normal.woff2`, ~2× the bytes) that carries both `wght` and `opsz`; with `font-optical-sizing: auto` (the CSS default) the browser tracks `opsz` to the font-size and headings match. After the swap, the heading close-ups were identical (same family/weight/size/optical-sizing).
**Proposed:** add to Step 4 — check the prototype's font URL for an `opsz` axis; if present, self-host the `…-opsz-normal.woff2` fontsource file (not the wght-only one) and rely on `font-optical-sizing: auto`. Generally: match the exact axes the prototype loads.

### 31. 🟠 Lift the chrome element's own margins into the static fragment
The footer sat flush against the last block on both Evergreen pages. Cause: the prototype's footer carried its own `margin-top: 72px` (an inline/own style on the `<footer>` element itself), and I'd lifted the footer's *inner* styles but not the **element-level** margin. Static chrome fragments inject into the EDS `<header>`/`<footer>`, which sit OUTSIDE `<main>` — so the spacing between the last section and the footer comes entirely from the footer's own top margin (the last block usually has none to spare). Same applies to a header that has a bottom margin/border. After adding `margin-top: 72px` to `footer.footer`, both pages got the correct 72px gap.
**Proposed:** add to Step 6 — when extracting header/footer, lift the prototype chrome element's OWN box styles (margin, padding, border) onto `header.header` / `footer.footer`, not just the inner content styles. Easy to miss because the inner content looks right; only the gap to `<main>` is wrong.

**Implemented (#27–31):** #27 → Step 1; #28 → Step 8 + Local QA; #29 → Step 9; #30 → Step 4; #31 → Step 6 (lift chrome element's own margins).

---

## Findings (test-4)

### 24. 🟠 Pre-render JSX prototypes over a STATIC HTTP server (not file://)
The JSX prototype mounts `.jsx` into `#root` via babel-standalone, which fetches the `.jsx` files by XHR. Under `file://` those XHRs are **CORS-blocked**, so nothing renders (empty `#root`). The aem dev server transforms/CSP-blocks the page too. What worked: serve the prototype's own folder with a plain static server (`python3 -m http.server` in `samples/<proto>/`), load it in Playwright (React/babel fetch from unpkg — needs internet), wait, then capture `#root`'s `innerHTML` as the static DOM. From there it converts like an external-CSS prototype (semantic classes + the prototype's `.css`). Save the captured DOM (e.g. `samples/<proto>/_rendered.html`) so block agents read it.
**Proposed:** put the concrete recipe in the #1 pre-render note: static server + Playwright capture of `#root`, save `_rendered.html`, then convert the rendered DOM.

### 25. 🟠 Multi-variant button systems don't fit the strong/em convention
JFK ships four context-specific button variants (`.btn--accent`, `.btn--primary`, `.btn--ghost`, `.btn--onblue`). The skill's strong/em → primary/secondary/accent convention only has three slots and can't express "white-on-blue" vs "ghost" vs "accent" by author emphasis. What worked: **lift the prototype's full `.btn` + variant system into `styles/styles.css`** and have each block apply the right variant class to the cloned CTA (author CTAs as plain `<a>`; the block knows the section's variant). This is the documented "convention is for simple primary/secondary; if it doesn't fit, style per-prototype" escape hatch — just applied at the button-system level.
**Proposed:** add to Step 5: when a prototype has >3 button variants or variants the convention can't name, lift the variant system globally and let blocks assign variant classes; don't force it into strong/em.

### 26. 🟡 Fragment root class: wrap content in the prototype's root class
postlcp sets the host element's class to `header`/`footer` (#21). If the prototype's chrome styling is keyed to a different root class (JFK footer = `.site-footer`, header = `.utilnav`), wrap the fragment content in a `<div class="<that-class>">` so the lifted CSS root selector matches — or rewrite the selector to `footer.footer`. Wrapping is the lower-friction choice (keeps the lifted CSS verbatim).
**Proposed:** note in Step 6 — fragment content goes in a `<div>` with the prototype's chrome root class; `header.header`/`footer.footer` is just the host.

**Implemented (#24–26):** #24 + #26 added to SKILL.md (Step 1 pre-render recipe; Step 6 fragment-root-class note); #25 added to Step 5 (lift multi-variant button systems). The JSX pre-render also exercised the agent-resilience path: when subagents died on transient API 500s mid-build, the finished lint-clean blocks were kept and the one missing block + the content page were authored by hand from each block's JSDoc contract + the captured `_rendered.html`.

---

## Findings (test-3)

### 17. 🟠 Component-driven prototypes → authorable rows + block JS (block JS *can* run)
Beehive's logic lives in a `<script type="text/x-dc">` `Component` class: state (`active` beer), a `baseBeers()` data array, a `<sc-for>` list loop, `{{ activeBeer.* }}` bindings, count-up via IntersectionObserver. The conversion pattern that worked:
- **Data → authorable rows.** The 5 beers became 5 block rows (`name | style | abv | ibu | notes | blurb | glass-color`); the stats became `number | label` rows.
- **Behavior → block JS.** Unlike static *fragments*, **block JS runs** — so `decorate()` wires the click-to-select interactivity, builds the glass gradient from the authored color, and runs the count-up observer. State that lived in the component becomes local state in the block.
- Template bindings (`{{ }}`), `<sc-for>`, `<sc-if>` are NOT EDS syntax — read them as "loop over these rows" / "show one state"; render the default/active state and drive the rest from JS.
**Proposed:** add a short "Interactive / component-driven sections" subsection to Step 7/8: data→rows, behavior→block JS, and the explicit reminder that **block JS runs** (only fragments can't) so interactivity is fine.

### 18. 🟡 Lifting an all-inline-styled (`<x-dc>`) section is mechanical but heavy
Every element carries `style="…"`; there's no class to scope under. The reliable method: rebuild the section DOM with **new semantic class names**, move each element's inline style into the block CSS under `.<block> .<name>`, and copy the needed `@keyframes` from the prototype's `<helmet><style>`. Parallel agents handled one section each well. No skill change beyond #1's pointer, but worth noting the per-element-style reality so estimates are realistic.

### 19. 🟠 QA screenshots: a 100vh hero breaks the "tall window" capture
The local QA recipe (#8) suggested a tall capture window. A `min-height:100vh` hero then becomes *window-tall* (e.g. 7800px), pushing its centered content far down and off the top crop — looked like the hero text was missing. **Fix:** screenshot at a realistic viewport (e.g. 1440×900) and `scrollIntoView()` each section (Playwright), rather than one giant-window capture. Keep the wide-viewport width check (#13) as a separate 1600px pass.
**Proposed:** amend the "Local QA" recipe — capture at a normal viewport and scroll per section; reserve the tall capture only for short pages.

### 20. 🟠 EDS CSP blocks inline event handlers — forms in fragments can't `onsubmit`
The footer had a newsletter `<form onsubmit="return false">`. EDS's delivered CSP is `script-src 'nonce-…' 'strict-dynamic' 'unsafe-inline'` — with `strict-dynamic`, `'unsafe-inline'` is ignored, so **inline `on*` handlers don't fire** (and `<script>` in fragments never runs). A real `<form>` would then submit and reload. **Fix:** render such controls non-submitting — a `<div>` wrapper with `<button type="button">`, no `<form>`/`onsubmit`. (Generalizes #5: not just `<script>`, but inline handlers too.)
**Proposed:** add to Step 6 (fragments): "no `<form onsubmit>` / inline `on*` — CSP blocks them; render decorative controls as non-submitting (`type="button"`, no `<form>`)."

### 21. 🔴 The #4 footer fix silently breaks fragment ROOT styling (regression)
Found by visual review: the Beehive footer should be **yellow**, but it rendered on the dark body background. Cause: `postlcp.js` only does `el.innerHTML = html` — it does NOT set a class on the `<footer>`. `decorateHeader()` sets the *header's* class, but the **footer's** class was set by `utils/footer.js` → which the #4 fix removed. So `footer.footer { background: … }` (the fragment's own root selector) never matches, and any styling on the fragment ROOT (background, padding, color) silently no-ops. It was invisible in test-1/test-2 only because their dark footers ≈ the dark body.
**Fix applied (test-3):** `postlcp.js` sets `el.className = name` before injecting, so `header.header` / `footer.footer` match.
**Proposed:** fold this into the Runtime bootstrap right next to the #4 lazy.js edit — two halves of the same change. Future runtime ports must include BOTH (port from the latest test branch that has both fixes, not test-1).

### 22. 🟠 Single-weight display fonts: match the prototype's effective (faux-bold) weight
Beehive's display face is **Anton** (ships only weight 400). The prototype renders headings via the browser-default heading bold (700) → faux-bold. My foundation set `h1,h2,h3 { font-weight: 400 }`, so headings rendered visibly **lighter** than the prototype. Match the *effective* weight the prototype shows (here 700, synthesized from the 400-only Anton) — don't assume "single-weight font ⇒ font-weight 400".
**Proposed:** add to Step 4: when the display font has one weight but the prototype shows it bold (default `<h1>`/`<h2>` weight), set that weight explicitly so the faux-bold matches.

### 23. 🟠 Visually diff each section against the prototype — parallel agents drift on layout
Two agent-built fidelity bugs only showed on a side-by-side: the taproom header used `justify-content: space-between` with eyebrow + headline as siblings (splitting them left/right) when the prototype **stacks** them top-left; and a hard `<br>` in the headline ("COME BUZZ / BY") was dropped because the block read `textContent` (use the cell's `innerHTML` and author the `<br>`). Programmatic width/decoration checks (#13/#19) pass these; only an eyeball-vs-prototype catches them.
**Proposed:** strengthen QA — capture the **prototype** (it self-renders from its file) and the **live/harness** at the same viewport per section and compare. Watch for: header alignment, intentional line breaks, heading weight, and section-root background/color.

**Implemented (#17–23):** applied to SKILL.md — #17 Step 7 brief (interactive/component-driven → rows + block JS); #18 covered by #1's `<x-dc>` lift pointer; #19 + #23 "Local QA" (real-viewport scroll capture + per-section visual diff); #20 Step 6 (no inline `on*`/forms in fragments); #21 Runtime bootstrap (postlcp `el.className = name`, paired with the #4 lazy.js edit); #22 Step 4 (match the prototype's effective heading weight). The #21 footer-class fix also shipped in test-3's `postlcp.js`.

---

## Findings (test-2)

### 14. 🔴 Scroll-reveal animations rely on JS — never ship the `opacity:0`
Festool sections carry a `.reveal` class (`opacity:0; transform:translateY()`) that an IntersectionObserver flips to `.in` on scroll. That observer lives in the prototype's inline `<script>`, which **does not run** in EDS (block JS rebuilds the DOM; the prototype script is discarded). If a block lifts `.reveal { opacity:0 }` verbatim, the content is **permanently invisible**.
**Fix applied (test-2):** drop the reveal entirely — render content visible; keep only hover transitions. (Optional: a per-block IntersectionObserver could re-add a reveal, but it wasn't worth it.)
**Proposed:** add to Step 7 brief + a checklist line + an anti-pattern: "if the prototype hides content behind a JS-toggled reveal class, render it visible — never ship `opacity:0` without an observer." Generalizes #5 (fragments can't run JS) to **block** content.

### 15. 🟠 Block name must not collide with reserved EDS classes
Festool's two main sections both use `class="section"` (`section` + `section tinted`). `section` is a **reserved EDS class** (the section wrapper becomes `<div class="section">`), and `default-content` / `block-content` are reserved too. Naming a block `section` would break decoration. Had to rename to semantic block names (`new-products`, `discover`) and apply the `tinted` treatment as a block variant.
**Proposed:** add to Step 2 naming rules: "block name = the section's class, EXCEPT when that class is generic/reserved (`section`, `default-content`, `block-content`, `wrap`, `button`) — then derive a semantic name from the section's `data-screen-label`/intent."

### 16. 🟠 Secure `.env` (DA token) on the PARENT branch, not per-test
The DA token lives in repo `.env`. Test subbranches branch from `snowflake-blocks`, so if `.gitignore` doesn't ignore `.env` on the **parent**, every new test branch re-exposes the token (had to re-add the ignore on both test-1 and test-2). Fixed once on `snowflake-blocks` so all subbranches inherit it. Also gitignore `qa/` (the local QA harness) and keep `samples/` out of commits.
**Proposed:** add an early skill step / bootstrap line: "ensure `.gitignore` excludes `.env`, `.env.*`, `qa/` before the first commit; the token must never enter git." Pair with the existing token-expiry caveat (dev tokens ~24h; a 401 with empty body = expired → refresh).

**Implemented (#14–16):** all three applied to SKILL.md — #14 Step 7 brief + anti-pattern 16 + checklist; #15 Step 2 naming rules + checklist; #16 "Running headless" token-hygiene note. Parent `.gitignore` now excludes `.env`/`qa/` so test subbranches inherit it.

---

## Findings (test-1)

### 1. 🟠 Input scope assumes stardust, not claude-design prototypes
The skill keys off `stardust/prototypes/**/*.html`. Our inputs are
`samples/<Name>/*.html` claude-design outputs in three shapes:
- single-file inline-`<style>` + `<section>` (Wheelercat, Festool) — works
- `<x-dc>` document-content, everything inline-styled (Beehive Brewing)
- React/JSX (Fable variants, Virgin, Wells Fargo, JFK) — needs rendering first
**Proposed:** generalize the "When to use" + audit steps to any per-page styled
HTML; add a pre-step for JSX/`<x-dc>` inputs ("render to static HTML first").

### 2. 🟠 `<image-slot>` placeholders, not real images
Claude-design prototypes use `<image-slot>` custom elements as drop targets —
**no real image assets exist**. The skill assumes real images at a prototype
host (Step 9 / anti-pattern #9 say use fully-qualified prototype URLs).
What worked: treat each image as an **optional** leading cell; if empty, fall
back to the prototype's background treatment (dark `--ink`) via block CSS.
**Proposed:** document the `image-slot → optional <picture> cell + CSS
background fallback` convention as the default for image-less prototypes.

### 3. 🟠 Runtime is a prerequisite but not shipped/with the skill
SKILL.md references `scripts/ak.js`, `postlcp.js`, `body.session`,
`decorateSession()`, `fragments/` injection, `tools/da/sanitise.js` — all of
which live in the **author-kit** repo (`aemsites/author-kit`), not in the
skill. Porting onto a vanilla `aem-boilerplate` project required copying
`scripts/{ak,lazy,postlcp,scripts}.js`, `scripts/utils/*`, `tools/*`, `deps/*`,
`head.html`, `blocks/{fragment,section-metadata}`, and **removing** boilerplate
(`scripts/aem.js`, `scripts/delayed.js`, `blocks/{header,footer,cards,columns,
widget}`, `styles/{fonts,lazy-styles}.css`).
**Proposed:** add a "Runtime bootstrap" step with an explicit file manifest +
removal list for the plain-boilerplate case, or a script that vendors it.

### 4. 🔴 `lazy.js` block-footer collides with `postlcp.js` static footer (BUG)
The author-kit `lazy.js` runs `utils/footer.js` → `loadBlock(footer)` while the
skill's `postlcp.js` injects the footer as a **static fragment**. With no
`blocks/footer`, this surfaces a visible "Error" box between the last section
and the footer (`error.js` renders it).
**Fix applied in test-1:** removed the `utils/footer.js` import from `lazy.js`.
**Proposed:** the runtime port must reconcile the two footer mechanisms —
when using static chrome fragments, drop `utils/footer.js` (and the analogous
header path) from `lazy.js`.

### 5. 🟠 Fragments cannot run JS — interactive chrome needs CSS-only
`postlcp.js` injects fragments via `innerHTML`, so `<script>` in a fragment
never executes. The prototype's mobile-menu toggle + header scroll-shadow JS
had to be reworked: mobile menu → CSS checkbox-hack (`<input type=checkbox> +
<label>`), scroll-shadow → dropped (kept a static border).
**Proposed:** call this out explicitly in Step 6 and provide the checkbox-hack
pattern; list which interactive behaviors degrade (scroll-state, focus-trap).

### 6. 🟠 Lint config mismatch (author-kit helix vs boilerplate airbnb)
The vendored runtime is authored for `@adobe/eslint-config-helix`; the
boilerplate lints with `airbnb-base`. `npm run lint` produced ~6600 errors
(runtime + minified `deps/lit` + `samples/`).
**Fix applied:** `.eslintignore` the vendored runtime
(`deps/`, `scripts/{ak,lazy,postlcp,scripts}.js`, `scripts/utils/`, `tools/`,
`blocks/fragment/`) and `samples/`; our generated blocks + `styles.css` lint
clean under airbnb after expanding single-line rules.
**Proposed:** ship `.eslintignore` additions (or recommend swapping to the
helix eslint config) as part of the runtime bootstrap.

### 7. 🟠 DA content format: body-fragment vs the skill's full document
Skill Step 9 emits `<!DOCTYPE html><html><body>…</body></html>`. The DA
**Source API** (the headless deploy path) requires a **body fragment** — no
doctype/html/head (per `da-content` skill, silent-failure rule #1). The
mount-based deploy may tolerate the full doc, but Source-API deploy needs it
stripped to `<body>…</body>`.
**Fix applied:** content page authored/stored as a body fragment; sanitised
with `tools/da/sanitise.js` (21 non-ASCII → entities). PUT `data=@…;type=text/html`
+ POST preview both succeeded (201 / 200).
**Proposed:** make Step 9 emit a body fragment by default; note the mount path
as the only place a full doc is acceptable.

### 8. 🟠 Local testing recipe is missing / `--html-folder` is misleading
`aem up --html-folder content` serves repo files **statically** and does NOT
render brand-new paths through the full pipeline (it needs remote routing; new
paths 404 on the rendered route). Reliable local-decoration QA = a
self-contained harness = `head.html` scripts + the body fragment, saved as a
**static repo file** (e.g. `qa/page.html`) and opened via the dev server so the
real runtime decorates it. Headless Chrome (`--virtual-time-budget`,
`--screenshot`/`--dump-dom`) verifies the post-JS result.
**Proposed:** add a "Local QA harness" recipe to the skill; stop implying
`aem up` renders unpublished content.

### 9. 🟡 Single-page naming ceremony is heavier than needed
Step 2 says "surface 3–5 naming questions." For a single page with self-evident
section names (`hero`, `quick`, `used`, `stats`…), section-class = block-name
was unambiguous; the questions were overkill.
**Proposed:** scale the naming step to multi-page sites; for single pages, lock
section-class names and proceed.

### 10. ✅ Headless DA Source API is the only deploy path
This skill deploys entirely headlessly from Claude Code: `git push` (Code Sync)
+ DA Source API PUT + `admin.hlx.page` preview via `curl` (see
`da-deploy-protocol.md`). SKILL.md is pure methodology — input → blocks →
content → deploy — and assumes no cloud authoring UI or host runtime.
**Resolved:** any prior host-integration coupling was removed entirely ahead of
moving the skill into the `stardust` plugin; the headless DA Source API deploy is
now the only documented path.

### 11. 🟠 Font step assumes variable fonts (`@fontsource-variable`)
Barlow is a **non-variable** Google font (named weights). The skill's Step 4
relies on `@fontsource-variable/<name>` for woff2 + the published "Fallback"
`@font-face` calibration — neither exists for static families.
**Fix applied:** fetched static `@fontsource/<name>` latin woff2 weights and
**computed** `size-adjust` / `ascent-override` / `descent-override` from the
woff2 (fonttools, Barlow vs Arial: 116.22% / 86.04% / 17.21%).
**Proposed:** add the non-variable-font branch — static `@fontsource`, compute
metrics with fonttools when no published fallback exists.

### 12. 🟡 Multi-family brands: only the body font gets full CLS treatment
Wheelercat uses 3 families (Barlow body + Barlow Condensed + Barlow Semi
Condensed). `body.session` gates only the body font; the condensed/semi
families are referenced by class and load with `font-display: swap`, leaving
minor heading CLS.
**Proposed:** note the multi-family case — only the body family is fully
metric-matched; document the display-font CLS trade-off (and that adding
metric-matched fallbacks per display family is optional polish).

### 13. 🔴 Parallel block agents inconsistently reproduce the max-width container
Found post-deploy on the live preview: the prototype wraps most section
content in `<div class="wrap">` (max-width 1320, centered) — the dark/colored
section **background** bleeds full-width but the **content** must not. Of 8
blocks built by 4 parallel agents, 4 reproduced the `.wrap` (hero, service,
offers, locations) and 3 did not (`used`, `stats`, `brands`) — their grids ran
edge-to-edge at wide viewports. (`quick` is correctly full-bleed — the
prototype has no `.wrap` there.)
**Fix applied (test-1):** each block's content appended into a `.wrap` div,
`block.replaceChildren(wrap)` (stats keeps the full-width `.stripe` outside).
**Proposed:** (a) make the per-block agent brief explicit — "if the prototype
section content sits inside a max-width container, reproduce it; only go
full-bleed where the prototype is"; (b) add a post-build QA step that measures
each block's inner content width at a wide viewport (>1440) and flags
unintended full-width content. This bug is invisible at ≤1440px (where 1320
max-width ≈ viewport) — **test wide**.

---

## Implementation checklist (apply to SKILL.md on `snowflake-blocks`)

All implemented on `snowflake-blocks` (SKILL.md + da-deploy-protocol.md).

- [x] #1 Generalize input scope + JSX/`<x-dc>` pre-render note — "When to use" + Step 1
- [x] #2 Document `image-slot → optional picture cell + CSS fallback` — Step 7 brief, Step 9, anti-pattern 14
- [x] #3 Add runtime-bootstrap step (file manifest + removals) for plain boilerplate — "Runtime bootstrap"
- [x] #4 Reconcile `lazy.js` footer with static `postlcp.js` footer — bootstrap + Step 6 + anti-pattern 15
- [x] #5 Fragment interactivity = CSS-only (checkbox-hack pattern) — Step 6
- [x] #6 Ship `.eslintignore` additions for vendored runtime — "Runtime bootstrap"
- [x] #7 Step 9 = body fragment by default (Source-API path) — Step 9 + checklist
- [x] #8 Add the local QA harness recipe — "Local QA before deploy"
- [x] #9 Scale naming ceremony to multi-page only — Step 2
- [x] #10 Headless methodology; document curl DA deploy — "Running headless" + da-deploy-protocol.md
- [x] #11 Non-variable-font branch (compute metrics) — Step 4 + anti-pattern 11
- [x] #12 Multi-family CLS note — Step 4
- [x] #13 Block briefs must reproduce max-width container; add wide-viewport QA — Step 7 brief, Local QA, anti-pattern 13

---

## Findings (multitest-280626 — 8-site parallel stress test, 2026-06-28)

Eight live sites (xfinity, paramount, bankofamerica, starbucks, sycamorepartners,
paypal, samsung, sony) migrated in parallel, one branch + DA subfolder each. Four
fixes implemented here (deploy + extract). The trailing-slash-subfolder-home bug
(all 8 sites) and the logo-locator misses (3 sites) are tracked separately.

### #82 🔴 Image-fidelity gate `curl`-omits real imagery on bot-walled origins ✅
**Where:** 5 sites behind Akamai/Cloudflare (paramount/xfinity/sony/samsung/bofa).
**Cause:** the gate said "curl each external `<img>`; if not 200, omit." Bot
managers 403 a bare curl while serving a real browser, so the rule would strip
EVERY real brand image. And `content.da.live` media URLs 401 to anon curl though
they ingest fine.
**Fix applied (`deploy/SKILL.md` ENCODE→Images, `da-deploy-protocol.md` 2b):**
verify with the recorded `_crawl-log.json#discovery.fetchTechnique` (in-page
headed-chrome fetch inherits the JA3 fingerprint), distinguish 403-bot-wall from
404-missing, **default to download-and-rehost to DA Media Bus** (not omit), and
exempt `content.da.live`/`admin.da.live` URLs from the anon 200-check (verify via
post-preview `about:error` instead). Omit only on a true 404.

### #83 🟠 No bundled crawler / resumable batch-deploy driver ✅
**Where:** all 8 (a transient API blip killed all agents ~40 min in mid-deploy).
**Cause:** extract specifies the recipe but shipped no runnable crawler (each run
re-implements Playwright); deploy/rollout said "long batches in background, re-drive
FAILs" but shipped no driver — hand-rolled serial loops truncated their log on
restart and re-PUT already-live pages.
**Fix applied:** `skills/extract/scripts/crawl.mjs` (full recipe + bot fallback +
#85 hardening) and `skills/deploy/scripts/deploy-batch.mjs` (concurrency pool,
persistent ledger that skips already-live pages, retry/backoff on 000/429/5xx,
append-only log, delivered-`.plain.html` verify before flip; idempotent re-run
re-drives only FAILs). Wired into extract/SKILL.md, deploy/SKILL.md, rollout/SKILL.md.

### #84 🟠 AuthorKit bootstrap is manual + version-drifted ✅
**Where:** 5 sites. ~15 manual file ops with two silent-failing mandatory edits;
"port from the latest test branch" is an unpinned moving target, and author-kit's
runtime has drifted (static-fragment → block-based) so the documented edits can
miss.
**Fix applied:** `skills/deploy/scripts/bootstrap-authorkit.mjs` — `--from-sibling`
(copy a known-good already-bootstrapped sibling runtime, offline/parity-safe — the
multi-site default) or `--ref` (pinned author-kit tarball). Ports the manifest,
removes the boilerplate set, **applies AND verifies both mandatory edits** (hard
error instead of silent footer-error-box), patches the `body.appear` blank-render
gate (#40), writes `.eslintignore`. Validated end-to-end against a fresh vanilla
clone + a real sibling. `deploy/SKILL.md` Runtime-bootstrap updated to lead with
the script + pin/sibling guidance.

### #85 🔴 Extract captures hidden/transient/modal DOM as content ✅
**Where:** bankofamerica (error/lang interstitials as headings), starbucks (consent
banner + SPA shell), sycamorepartners (AJAX-modal detail captured byte-identical to
its listing → 35 silent duplicates).
**Fix applied (`extract/reference/playwright-recipe.md` § Capture hygiene + crawl.mjs):**
visibility filter (skip display:none/aria-hidden/off-screen/zero-area), interstitial/
error-state heuristic with a `filteredInterstitials` count, content-substance check
(`spaShellSuspect` when <2 distinct main headings + tiny innerText + no real media;
a lone off-origin tracking pixel does NOT count as media), modal/AJAX `textContent`
capture even while hidden, and cross-page `duplicateOf` detection (detail==listing).
Implemented and smoke-tested in crawl.mjs.

- [x] #82 CDN-aware image-fidelity gate (verify-by-technique, rehost, 401-exempt) — ENCODE→Images
- [x] #83 Bundled crawl.mjs + resumable deploy-batch.mjs — extract/deploy/rollout SKILLs
- [x] #84 bootstrap-authorkit.mjs (sibling/pinned, verifies edits) — Runtime bootstrap
- [x] #85 Capture hygiene (visibility/interstitial/SPA-shell/modal/dup) — playwright-recipe.md
- [x] #86 Key facts in server-rendered content, never fragment-only; raw-HTML key-facts grep in the atomic contract — ENCODE contract + Per-page atomic delivery (stardust-style e2e, learning L9)
- [ ] #87 content-diff JOIN/SPLIT concat-matching (node-granularity false 🔴 → 🟡 advisory) — diff SKILL.md documents the limitation; code fix pending (stardust-style e2e, learning L8)
- [x] #88 crawl.mjs: verbatim slash forms + key-dedupe + 404 slash-retry; reducedMotion emulation + settle; codeBlocks[] capture — extract (stardust-style e2e, learnings L1/L2/L3, smoke-tested live)
- [x] #89 --no-save playwright installs pruned by later npm i → per-skill re-probe rule; token-hygiene check moved to first hands-off commit; partial-inventory broken-link carve-out; cinematic-pickup sentence corrected — extract/stardust/migrate/prototype SKILLs (learnings L7/L6/L4/L5)

---

## 2026-07 Fairmas e2e — per-instance fidelity on the first pass

- [x] #90 Front-loaded **style-fingerprint probe** (`scripts/style-fingerprint.mjs`) added as a Step-1
  pre-block gate: clusters each sibling instance by a COMBINED signature — computed style-delta
  (bg/border/color/bg-image/weight/align) **and** structural (`hasImg`/`hasSvg`/childCount) — and flags
  any group with >1 cluster as a per-instance variation the block must reproduce. The structural half is
  load-bearing: image-vs-image-less cards and other `:has()`/`:not()` variants share top-level computed
  style, so a style-only probe misses them. Complements Step 10's post-deploy `content-diff` by catching
  the variation BEFORE block code. Evidence: contact dept buttons flattened (all styled alike when only
  the middle is accent) with no probe → blog listing (active filter chip + 24 image vs 4 image-less
  navy title-cards) correct on the first pass with it. — SKILL.md Step 1 + Checklist.
- [x] #91 **Token-completeness gate** — SKILL.md Step 3. A `var(--x)` a lifted block CSS references but
  the foundation `:root` never defines **silently invalidates the whole declaration** (undefined
  `--navy-700` in a gradient → background dropped → navy card renders light, no error/lint). Added the
  `comm -23` grep of `blocks/**/*.css` `var()`s vs `styles.css` `:root` (must be empty) to the foundation
  and checklist. Distinct class from variation-flattening; caught by grep, not eyeball.
- [x] #92 **`content-diff` per-instance/role check promoted from "optional" to REQUIRED** for the first
  page of each template — SKILL.md Step 10. The atomic-delivery/layout gates (one `<h1>`, grids compute
  `grid`) pass GREEN while a per-instance detail is wrong (uniform card grid when one card is accent), so
  those gates cannot be the last word. Pairs with #90: fingerprint catches variation before block code,
  content-diff confirms it survived DA after deploy.
- [x] Added `scripts/render-harness.mjs` — reproduces EDS block decoration locally (inject styles + block
  CSS, run each `decorate()`, screenshot) so first-pass fidelity is verifiable with NO DA/dev-server and
  even when `DA_TOKEN` is expired (fidelity is decided at conversion time, not deploy time).

---

## 2026-07 deploy-accuracy pass — close the round-trip at authoring time (#93–#95)

Motivation: the six-site e2e campaign showed the `stardust:diff` structural probe catching real
dropped-CTA / role-swap / flattened-variant defects on EVERY site — post-deploy, when each fix costs
a redeploy loop. All of them are one disease: ENCODE (authored rows) and DECODE (block JS) written
independently and hoped to be inverses. This pass moves the defect-FINDING to conversion time; Step
10 becomes the proof that the round-trip survived DA transport, not the repair loop.

- [x] #93 **Section schema as the shared ENCODE/DECODE contract** (`scripts/section-schema.mjs`) —
  per-section ordered role inventory (heading/eyebrow/cta+href/body, the SAME classifier as
  content-diff) + repeating-unit groups (count, per-unit composition, uniformity flag that
  cross-checks the #90 fingerprint). Authored rows and block decode are both written FROM it; a
  deliberately dropped item is a logged decision, never an accident. — SKILL.md Step 2b + Step 7
  brief + Checklist.
- [x] #94 **In-loop per-block round-trip gate** (`scripts/block-roundtrip.mjs`) — decorates the
  authored content locally with the block's own JS+CSS (render-harness technique; no DA, no dev
  server), inventories the decorated section vs the matching prototype section, exits 2 on any
  structural 🔴 OR any decorate error — a block that throws, or whose inlined JS fails to install
  (module-scope import/export), must never pass: its raw rows can false-match the prototype and
  green-light a decode that was never exercised. Font forks deliberately excluded (harness fonts are
  local — faces are Step 4/10's business). Validated on a synthetic fixture: a buggy hero decode
  produced exactly MISSING EYEBROW + ROLE SWAP + MISSING CTA (exit 2); the fixed decode exits 0; a
  correct cards block closes on the first run; an import-bearing/throwing block exits 2 with a
  decorate-error report; a shallow/empty metadata block, a section-metadata row before the block, and
  a two-block section are all handled (metadata dropped in the DOM, not by regex; every block in a
  section tagged, section-metadata excluded). — SKILL.md Step 8 + Local QA + Step 10 reframe + Checklist.
- [x] #95 **Per-section decode tier: template-slotted vs reconstructive** — fixed-composition bespoke
  sections keep the prototype section's inner DOM verbatim in decorate() and slot authored values in
  by role: fidelity by construction, the #48/#52/#56/#76 segmentation class cannot occur, and the
  copy stays server-rendered authored content (#86 doesn't bite). Only repeat/authorable sections
  are reconstructed. — SKILL.md Step 2b + Checklist.
- [x] Factored content-diff's classifier + differ into `skills/diff/scripts/content-inventory.mjs`,
  imported by content-diff.mjs / section-schema.mjs / block-roundtrip.mjs — every fidelity gate
  measures with the same instrument; change the classifier once and all gates move together.
  content-diff.mjs CLI behavior unchanged.

---

## 2026-07-21 — AuthorKit era retired; David's Model becomes a mechanical gate (#96–#97)

### #96 🔴 AuthorKit runtime dependency removed — vanilla aem-boilerplate is the only target ✅
**Why:** the port was the pipeline's most fragile step (#84's pin-guard existed because
author-kit@main drift bricked repos), it forced an `.eslintignore` for a vendored runtime, and
field runs kept skipping it by agent initiative — the runtime-contract mechanism already made
vanilla targets work. Existing AuthorKit sites are declared out of scope (product decision).
**What changed:** `bootstrap-authorkit.mjs` deleted; Runtime-bootstrap chapter replaced by a
"Target runtime" contract (stock boilerplate, never edited); buttons → `a.button.primary/.secondary/
.accent` in `p.button-wrapper` (probe `buttonClasses`/`buttonization` per target — current main
requires emphasis and emits `button-wrapper`, older clones emit `button-container` and buttonize
bare links); chrome → authored `/nav` + `/footer` documents + template-slotted `header`/`footer`
blocks (real JS: stock hamburger machinery kept; `nav:`/`footer:` metadata replaces `header: off`);
fonts → `styles/fonts.css` + metric-matched `<brand>-fallback` faces (stock convention; #40
inverted — the `body.appear` gate is the runtime's and STAYS); anti-patterns 2/5/6/17 rewritten,
15 tombstoned. Harness scripts (`build-harness`, `render-harness`, `block-roundtrip`) boot the real
`scripts.js` / add `body.appear` / synthesize the vanilla wrapper DOM. Two facts verified against
the live sources while rewriting: section metadata is now applied by the DELIVERY PIPELINE
(helix-html-pipeline `extract-section-metadata`, rendering v2 / sites created ≥ 2026-05: `style` →
server-rendered section classes, other keys → `data-*`, the block removed from served DOM), and
stock `styles.css` natively reserves the header via `--nav-height` + `visibility` gating (#81's
recipe simplified to "set `--nav-height` responsively").

### #97 🟠 David's Model was ~5/15 rules of advisory prose — now a bundled contract + lint ✅
**Where:** a prior project's first-pass DA structure needed an explicit second "follow David's
Model" pass to fix (over-blocked prose, display copy in key-value rows).
**Fix applied:** `davids-model.md` (all 15 rules mapped to enforcement points, `D#N` citations);
ENCODE contract gains the missing structural rules (D2 no nested blocks, D3 spans, D4 fully-
qualified URLs, D10 ≤4 columns, D13 alt-text, D15 no code-as-text, D1 auto-blocked embeds); Step 2
opens with D1/D11 triage (prose section → default content + a small closed section-`style`
vocabulary, resolving the old anti-pattern-2 tension; Block Collection pattern → mirror its
content model); Step 2b records `defaultContent` + the component-model shape (simple/key-value/
container) per block for UE forward-compat. `scripts/davids-model-lint.mjs` (dependency-free,
🔴 exits 2) is wired into the atomic delivery contract before sanitise and into the checklist —
conformance is now mechanical on the FIRST pass, not a second-pass correction.

---

## 2026-07-22 — vanilla-EDS e2e round 2 (flexiloans subfolder site, #98–#100)

Context: second Phase-5 validation run — 11-section fintech page onto stock boilerplate,
subfolder scope `/flexiloans/`, per-page `nav`/`footer` metadata chrome overrides (worked
first try live). davids-model-lint again 0 🔴 on the first pass with no model instruction
in the run prompt. Three live-only findings, all invisible to the local harness:

### #98 🔴 Pipeline wraps nav trigger links in `<p>` — desktop nav renders unstyled ✅
**Where:** delivered `nav.plain.html` has `<li><p><a>…</p><ul>` where the authored/harness
shape is `<li><a>…<ul>`. The header block's `:scope > a` trigger lookup and the
`.nav-links > li > a` CSS silently missed on live → the whole desktop nav rendered as
run-on plain text while mobile (burger) worked and the harness passed. The #79 class
hitting CHROME. **Fix applied:** SKILL.md Step 6 nav-DECODE note (match
`:scope > a, :scope > p > a`, unwrap the `<p>`; verify the styled desktop nav on the
deployed preview).

### #99 🔴 Authored SVGs with embedded raster data 409 the whole page's preview ✅
**Where:** preview `POST` returned `409 "error from content-bus"` for any page referencing
an authored `content.da.live/*.svg` whose SVG embeds base64 raster data behind a `pattern`
fill (exported award badges, 82–143 KB). Pure-vector SVGs (logo, 10–30 KB) pass. No
per-asset error anywhere — the page-level 409 is the only signal; bisecting sections was
required to find it. **Fix applied:** ENCODE Images rule (extract the embedded raster →
author the PNG) + davids-model-lint 🟡 advisory on any authored `.svg` media URL.

### #100 🔴 Metadata-first empty section defeats waitForFirstImage → hero LCP lazy → CLS ✅
**Where:** live CLS 0.134 (target <0.1) attributed to the section BELOW the hero, while
the harness probe measured 0.0007 — local images load instantly, so the harness
false-passes. Chain: the metadata block leaves the FIRST section empty → the runtime's
`loadSection(first, waitForFirstImage)` eager-izes nothing → the hero `<img>` stays
`loading="lazy"`; its `width: auto` contain layout gives the un-loaded img a 0-height box
→ the hero grows ~380px when the image lands. **Fix applied:** SKILL.md Step 3 bullet
(hero decorate() sets `loading=eager` + `fetchpriority=high`; CSS reserves the media slot;
run the CLS probe against the DEPLOYED preview) + checklist line.

### #101 🟡 Local-QA scope trimmed to what the harness can actually prove ✅
**Where:** transcript timing across three e2e runs (surly 74m/6 sections, flexiloans 72m/11,
sos 42m/13). Three local steps cost 10–15 min/run and caught nothing — or worse:
harness-side `content-diff`/`visual-diff` found zero defects in any run once
`block-roundtrip` was green (same classifier, same DOM — nothing left to find by
construction); the local CLS probe FALSE-PASSED the one time it mattered (0.0007 harness vs
0.134 live, #100); and every run hand-rolled a fresh probe.mjs (~3–5 min) asserting what the
section schema already encodes.
**Fix applied:** (1) new stock `scripts/qa-gate.mjs` — one run asserts the decoration
contract from the page's eds-schema (boot, one `<h1>`, blocks loaded + non-empty, unit
counts incl. densest-container + unitSelector-tag proxies, wide-1600 warnings); validated
42/42 against the sos harness. (2) Local-QA scope boundary in SKILL.md: CLS,
`content-diff`/`visual-diff`, and `nav:`/`footer:` overrides are DEPLOYED-URL-ONLY checks.
(3) Step 10 + #81/#100 + checklist reworded accordingly. Expected effect: ~70 → ~55 min per
single-page conversion with a quality GAIN (no false local CLS confidence).

### #102 🔴 WASM-based players are CSP-blocked on EDS — Lottie needs lottie-web's SVG renderer ✅
**Where:** baremetrics e2e (3-site parallel batch, 2026-07-22). The hero's dotlottie web
player worked in every local environment but silently fell back to its static card on the
deployed preview: `WebAssembly.instantiateStreaming(): … violates Content Security Policy`
— EDS's delivered CSP has no `wasm-unsafe-eval`, and dotlottie compiles WASM. Module
`import()` from a pinned CDN is fine (strict-dynamic trusts it — the player JS itself
loaded); only the WASM compile is blocked, so the failure is silent-with-fallback and
invisible to every local gate.
**Fix applied:** use `lottie-web`'s pure-JS **svg renderer** (`lottie.loadAnimation({
renderer: 'svg', … })`) for Lottie animations — verified animating on the deployed preview
with zero console errors. General rule for block dependencies: nothing that compiles WASM
(dotlottie, some video/audio codecs, wasm-backed parsers); check the browser console on
the DEPLOYED preview for CSP violations as part of Step 10 (a fallback can make the breakage
invisible to layout gates).

### #103 🔴 DA media bus is images-only — an authored content.da.live mp4 401s for visitors ✅
**Where:** interacoustics e2e (3-site batch). The hero authored its background video as a
`content.da.live/...mp4` link; the preview ingester only processes `<img>` content, so the
URL survives verbatim into the block's `<video src>` — and `content.da.live` is auth-gated,
so every anonymous browser gets **401** (readyState 0, poster-only). Silent: the poster
makes the page look intentional; only a live console/video probe catches it.
**Fix applied:** video ships from the CODE ORIGIN — commit the mp4 to the repo and
reference it root-relative (`/media/<scope>/<file>.mp4`), like any fixed asset (#67
semantics); the poster stays an authorable editorial `<img>`. For heavyweight video, an
external host also works. Never author a `content.da.live` URL for anything the ingester
doesn't rehost (`<img>`/`<picture>` only) — verified playing live post-fix (readyState 4).

### #104 🔴 wrapTextNodes folds media-led cells into one `<p>` — codified after TWO rediscoveries ✅
**Where:** flexiloans found it (recorded only in that site's runtime-contract notes, never
promoted to the skill); interacoustics then paid ~10 min re-discovering it (products
shipped thumbnails without titles until a cellNodes() expansion landed in 6 blocks); the
3-site batch timing analysis flagged the repeat cost. The runtime's `decorateBlock` runs
`wrapTextNodes`: a cell whose FIRST element child is not in `P/PRE/UL/OL/PICTURE/TABLE/
H1–6` — or that leads with `<picture>` followed by anything — gets its ENTIRE content
wrapped in ONE `<p>`, so `cell.children`-based collectors see a single node and drop
every sibling after the image.
**Fix applied:** (1) Target-runtime section documents the normalization; (2) the #62
canonical collector now expands the wrapper `<p>` back into its children; (3)
`block-roundtrip.mjs` + `render-harness.mjs` synthetic decoration now RUN wrapTextNodes,
so the harness presents the live shape and an unexpanded collector FAILS the gate in-loop
instead of shipping. Lesson: a runtime quirk recorded per-site is a quirk the next site
re-pays — promote to the skill the same day it's found.

### #105 🟡 Per-section eyeball capped to flagged sections ✅
**Where:** 3-site batch timing — interacoustics ran 13 proto-vs-harness section pairs
(~7.5 min); across all six e2e runs every per-section catch was either visible in the
full-page pair or in a section already flagged by a probe (roundtrip 🟡, qa-gate warn,
fingerprint variation).
**Fix applied:** #23 reworded — full-page pairs at TWO viewports always; per-section pairs
only for flagged sections, bespoke/cinematic or slot-heavy template-slotted sections, and
the chrome. Expected ~3–5 min saved on large pages at negligible risk.
