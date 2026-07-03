---
name: deploy
description: Convert per-page styled HTML prototypes (stardust under stardust/prototypes/**, or claude-design / Mobirise / Relume / Lovable / v0 / Figma-derived pages, or JSX prototypes pre-rendered to HTML, often under samples/) into Edge Delivery Services (EDS / AEM) blocks and content pages, then deploy via DA. Each prototype section becomes one EDS block; the prototype's per-section CSS becomes that block's CSS scoped under the block class. Use when the user wants to lift styled per-page HTML prototypes into a working EDS site under blocks/ and content/.
license: Apache-2.0
---

# stardust:deploy — prototypes → EDS/AEM

## When to use

The user has (1) **per-page styled HTML prototypes** — one file per page, each carrying its own CSS; (2) an EDS project at the repo root (`blocks/`, `styles/`, `scripts/`, `head.html`, `fragment`/`section-metadata` blocks — if it's **vanilla `aem-boilerplate`**, run Runtime bootstrap first); (3) a goal: prototypes → authorable EDS blocks + content pages under `content/**`. Accepted prototype shapes:
- **Single-file with inline `<style>`** + `:root` tokens + semantic `<section class="…">` (stardust / claude-design / Mobirise / Relume). Convert directly.
- **External per-page `.css`** — read the linked CSS as you would an inline `<style>`.
- **`<x-dc>` document-content, per-element `style="…"`** — lift inline styles into a scoped block stylesheet.
- **React/JSX prototypes** — pre-render to static HTML first (Step 1, #24); you cannot decorate a shell with no server-rendered `<main>`.

Prototypes typically live under `stardust/prototypes/**` or `samples/<Name>/` — discover them, don't hard-code the path. Prototypes but no EDS scaffolding → stop and ask whether to bootstrap. EDS but no prototypes → this skill doesn't apply.

## Runtime bootstrap (vanilla aem-boilerplate targets)

This skill assumes the **AuthorKit** runtime (`ak.js` page boot, `postlcp.js` static header/footer fragments, `body.session` font gating, `decorateSession()`), from `github.com/aemsites/author-kit`. (`sanitise.js` is bundled with this skill at `skills/deploy/scripts/sanitise.js`, not ported.) If the target has `scripts/aem.js` + `scripts/scripts.js` and `header`/`footer` blocks but no `ak.js`/`postlcp.js`, port the runtime before Step 1:

- **Automate it (#6):** `node skills/deploy/scripts/bootstrap-authorkit.mjs --target . [--from-sibling <dir> | --ref <gitref>]` — copies the port-in set, removes the boilerplate set, applies AND verifies both mandatory edits, patches the `body.appear` gate, writes `.eslintignore`.
- **Prefer `--from-sibling <dir>`** when another site in the repo is already bootstrapped (offline, deterministic, parity with a known-good deployed runtime). Otherwise `--ref` with a **pinned** commit/tag — never a tracking branch (author-kit's runtime drifts; if it no longer matches the static-fragment model, pin an older ref or use `--from-sibling`).
- **Two mandatory edits — do BOTH (halves of one change).** If bootstrapping manually, verify each; a miss is silent:
  1. **`scripts/lazy.js` (#4):** delete the `import('./utils/footer.js')…` line — it `loadBlock(footer)`s against the static fragment and renders a visible "Error" box.
  2. **`scripts/postlcp.js` (#21):** in `loadStaticFragment`, set `el.className = name;` BEFORE `el.innerHTML = html;` — otherwise `header.header`/`footer.footer` root selectors never match and fragment-root styling silently no-ops.
- **Lint mismatch (#6):** treat the runtime as vendored — `.eslintignore` it (the bootstrap script writes the list); your blocks + `styles/styles.css` still lint clean under airbnb.

Hand-porting, or debugging a port? **READ `reference/runtime-bootstrap.md` first** — it carries the full PORT-IN/REMOVE manifest, the edit mechanics, the `.eslintignore` list, and the drift history.

## Playwright re-probe (run before anything that renders)

`--no-save` playwright installs from earlier phases are pruned by any later real `npm i`. Before the Local-QA harness, the computed-layout gate, or any probe: verify `node -e "import('playwright').then(()=>process.exit(0))"` from the project root; on failure → `npm i -D playwright --no-save --legacy-peer-deps`.

## Runtime-detection probe (run before Step 1 — write `stardust/runtime-contract.json`)

Two EDS runtimes look identical from the content side but need different generated code; a wrong assumption is **silent and sitewide**. Inspect the repo (`scripts/ak.js` vs `scripts/aem.js`, how `loadBlock` wraps blocks, what the button decorator emits) and record:

```json
{
  "runtime": "authorkit | vanilla-eds",
  "blockWrapperClass": "none | block",
  "buttonClasses": ".btn / .btn-primary / .btn-group | .button / .button-container",
  "fragmentScriptPolicy": "inert-innerHTML | executed",
  "emptySectionCollapse": true
}
```

Block CSS/JS generation and the Local-QA harness read this contract. The two costliest wrong guesses:
- **`blockWrapperClass`** — AuthorKit's `loadBlock` never adds a `.block` class (only `data-block-name`; blocks sit inside `.block-content`). CSS must scope `.<name> …`, **never `.<name>.block`** — that selector silently never matches, every grid falls back to `display: block` and stacks single-column while typography still looks fine. Confirm by asserting a grid container computes `display: grid` in a headless render.
- **`buttonClasses`** — the AuthorKit decorator emits `a.btn`/`.btn-primary`/`.btn-secondary` in `p.btn-group`, NOT stock `.button`/`.button-container`. Style the wrong family → every CTA ships as a bare link.
- When `emptySectionCollapse` is true, add `main .section:empty { display: none }` to the foundation — or an empty ~88px band sits under the header.

## Deploy (DA Source API, from a local agent)

**Steps 1–9 are the conversion methodology**; deploy is the one transport-specific step. Per page:

| Stage | How |
|---|---|
| Code | `git push` the branch → AEM Code Sync builds it |
| Sanitise | `skills/deploy/scripts/sanitise.js` before every write (DA corrupts raw UTF-8) |
| Content write | DA Source API: `PUT admin.da.live/source/<org>/<repo>/<path>.html` (multipart, field **`data`**, `type=text/html`) |
| Make live | `POST admin.hlx.page/preview/<org>/<repo>/<branch>/<path>` (then optionally `/live/...`) |
| Auth | IMS token (`DA_TOKEN`) — see the `da-content` / `da-auth` skills |

The content payload is a **body fragment** (Step 9); the code branch must be pushed so `<branch>--<repo>--<org>.aem.page` renders your blocks. Full curl contract: `da-deploy-protocol.md`.

- **More than a few pages → use the bundled driver, never a hand-rolled loop (#4):** `node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> --content content [--concurrency 4] [--no-publish]`. Persistent ledger (`content/.deploy-ledger.json`) skips already-live pages and re-drives only FAILs; capped-backoff retries on `000/429/5xx`; append-only log; delivered-`.plain.html` check before flipping `live`. Idempotent — Ctrl-C and re-run is the documented recovery for a half-deploy.
- **Per-page atomic delivery contract.** A page is `deployed` only when the full chain passes in order: sanitise → `PUT` → `POST /preview/` → `POST /live/` → **GET the delivered `.plain.html` and assert** HTTP 200, `<body>` wrapper intact, exactly one `<h1>`, zero `about:error`, no `/img/` srcs. When `DESIGN.json.extensions.metadata.keyFacts[]` exists (#86, written by `direct`), also grep the RAW full-page HTML (not rendered DOM) for each fact on the pages that carry it; if the field is absent, skip the gate and note the skip. Only then flip the ledger entry — **never on the POST codes** (admin 200 ≠ delivered).
- **A `.plain.html` pass is NOT a layout pass — run the computed-style gate (the silent-failure guard), once per template.** The `.<name>.block` scoping bug renders a green-text page as a single stacked column. On the delivered LIVE URL, headless-load the first page of each template and assert: every block whose CSS declares grid/flex **computes `display: grid`/`flex` (not `block`)**; `main .section` count > 0; blocks decorated (`data-block-name` present); zero `pageerror`; zero broken images. A should-grid block computing `block` fails the page → do not flip to `deployed`; fix the CSS scoping per the runtime contract.
- **Field decodes:** a burst of `PUT` 400s is a **malformed path, not rate limiting** — lowercase every segment, never a double slash (`content//…`), no trailing `-`/`_`. Write long loops to a bash **script file** with absolute binary paths (`/usr/bin/curl`, full `node` path) — zsh drops PATH inside `while`/`for` in some contexts and the `command not found` burst mimics a transport failure.
- **Token hygiene (#16).** `DA_TOKEN` lives in repo `.env`. Before the first commit, `.gitignore` must exclude `.env`, `.env.*`, `qa/` **on the branch you'll branch tests from** (or every subbranch re-exposes the token); keep `samples/` out of commits. Dev tokens last ~24h; `401` with empty body = expired → refresh and retry (the write is idempotent).
- **DA_TOKEN lifecycle — preflight and re-check, never fail pages on it.** At setup: decode the JWT `exp` claim and smoke-test ONE authenticated DA call. Re-check before each long batch. On a mid-batch `401` → checkpoint the ledger, stop, and halt with one actionable instruction ("DA_TOKEN expired; refresh in `.env` and re-run the same command — the ledger skips delivered pages"). Token expiry is a legitimate hard stop even in a hands-off run.

## The one rule that drives everything else

**One prototype `<section>` = one EDS block — as the SAFE DEFAULT.** Don't abstract speculatively; don't extract "patterns" across prototypes unless sections are genuinely the same pattern. Violating this casually cost full resets (see Anti-patterns).

**The one deliberate exception — collapse SAME-PATTERN sections into one block + VARIANT classes.** When sections are the same content pattern (card grids, prose/CTA bands, quotes, accordions) differing only in skin, emit ONE canonical block (`cards`, `text`, `quote`, `accordion`) with each look behind a variant class (`class="cards brands"`); JS stays generic, only variant CSS differs. This is the David's-Model library win and is proven to preserve fidelity. Keep genuinely-unique sections (hero, countdown) bespoke. Budget for it: variant CSS is careful work and some grids are count-specific.

The prototype is the visual spec. The block exists to AUTHOR its content — the ENCODE contract defines well-authored content; Step 8's disciplines define how a block defensively PARSES it.

## Output you will produce

For a typical 5–10 page site: **one block per distinct prototype section** (~12–18 blocks; some reused across pages, e.g. `closing`); **one EDS content page per prototype page**; **nav + footer fragments** at `content/fragments/{nav,footer}.html` (navigation lives in `nav.html`); **updated `styles/styles.css`** (brand tokens from the prototype's `:root`, a reset, the EDS section scaffold, the global button system — nothing more). **No shared utility modules, wave systems, section-metadata style classes, or motion libraries** — the prototype encodes these per-section; keep them inside the owning block.

## The ENCODE contract — what well-authored content looks like

Step 8 is the **decode** side (parse robustly whatever DA hands you); this is what the content page should EMIT. One principle drives all of it:

> **Decoration that must survive DA rides a semantic inline tag — never a class, never an invented delimiter.** DA strips `<span>` and author classes from block cells, but PRESERVES `<strong>`, `<em>`, `<code>`, `<a>`, `<picture>`/`<img>`.

- **Accent/emphasis → `<em>`, never `<span class="em">`** (DA strips the span). Block CSS targets BOTH `em` and `.em`.
- **Key facts live in SERVER-RENDERED content, never solely in chrome fragments (#86)** — fragments are client-injected, invisible to non-rendering crawlers/AI bots. Verify by grepping the RAW served HTML for the key-facts list (rationale in `reference/encode-contract.md`).
- **Sub-fields → a leading preserved tag, never an in-band delimiter.** No `Step|Title` / `flag :: desc` micro-syntax; lead the cell with kicker → `<strong>`, code/flag/path → `<code>`. (Blocks MAY parse delimiters as decode fallback — never emit them.)
- **No raw presentational HTML:** no `<sup>` (block generates it from `185+`); no layout `<br>` (a deliberate Shift+Enter editorial break is fine).
- **Grouped item sets → one row per item**, its parts as flat siblings in that cell — never one cell per atom, never all-in-one-cell.
- **Lists/FAQ → rows:** head cell, then one row per Q/A (David's #5) — not nested lists, not one blob.
- **Section head → DEFAULT CONTENT, not block rows** (David's #1): the eyebrow/heading/lede above a repeating block is authored as section default content; the block **reabsorbs** it at decorate time — zero pixel change. (NOT for a widget whose rows ARE its structure, e.g. countdown.)
- **Buttons → one emphasis axis:** primary `<strong><a>`, secondary `<em><a>`; never `<strong><em><a>` (Step 5).
- **Headings → real outline, no level jumps:** one `<h1>`; section titles `<h2>`; card titles `<h3>` (canonicalise a prototype's `<h4>` card titles to `<h3>`).
- **Metadata stays name/value** (config only — David's #14); never name/value for semantic content.

**Images — editorial vs decorative:**
- **Any meaning-carrying raster/brand image is EDITORIAL → authorable content**, including hero/feature/CTA-band backgrounds behind text+scrim. Upload the binary to DA (`PUT admin.da.live/source/{org}/{repo}/media/<scope>/<file>`, multipart field `data`), author one `<img src="https://content.da.live/…" alt="…">` per cell. **Never** repo-relative `/img/…` in content (→ `about:error`); **never** bake imagery into block JS by index (`CARD_IMAGES`) — not authorable.
- The block renders the authored `<img>` into a background LAYER (`.hero-bg`/`.card-media`); scrim/gradient is CSS `::before` over it; keep a fixed CSS asset as no-image fallback.
- **Decorative = CSS only**: image-less treatments (gradients/scrims/washes) and genuinely fixed brand assets as CSS backgrounds, root-relative `/img/<brand>/…` (browser-fetched, never ingested).
- **Gate: after preview, grep the delivered `.plain.html` for the expected `<img>`+alt count** — "it renders" hides CSS-background images (absent from `.plain.html`, no alt, not authorable or AI/SEO-visible). Fails → reauthor as content `<img>`.
- **Migration source URLs — verify BEFORE authoring, with the recorded fetch technique (#2):** read `_crawl-log.json#discovery.fetchTechnique`; when `headed-chrome`, verify via in-page fetch (a bare `curl` falsely reports bot-walled assets broken and would strip every real brand image). `403`/`401` = blocked-not-missing → **download-and-rehost to DA, never omit**; omit only on a true `404` after attempting the rendition/`?`-delimiter repairs; never substitute a generic logo. `content.da.live` URLs 401 to anonymous curl — that's normal; verify those post-preview only (`about:error` grep + img/alt count).

**Before authoring any image cell or section head, READ `reference/encode-contract.md`** — it carries the upload/verification/repair procedures and the section-head reabsorption mechanics (`block.closest('.block-content')?.previousElementSibling`, match `.default-content` AND `.default-content-wrapper`, back-compat fallback, byte-identical outerHTML verification).

## Steps

### 1. Audit (light)

**Normalize the input to static HTML first.**
- **React/JSX (#24):** serve the prototype's OWN folder with a plain static server (`cd samples/<proto> && python3 -m http.server 8765` — NOT `file://`, babel-standalone CORS-blocks; NOT the aem dev server, CSP-blocks). Load in Playwright (React/babel come from unpkg — needs internet), wait for mount, save `#root.innerHTML` to `samples/<proto>/_rendered.html` for the block agents. Then treat as an external-CSS prototype.
- **`<x-dc>` document-content:** sections are still `<section>`/`<div>`; expect inline `style="…"` instead of a `<style>` block.
- **View behind routing/sign-in (#27):** seed persisted state before boot (`page.addInitScript(() => localStorage.setItem('<key>', JSON.stringify({page:'dashboard'})))`), or drive the UI / set the router hash — capture `#root` for the view you intend to convert.

Read every prototype's `<main>` (skip `<style>` for now) and produce a per-page section list:

```
home: hero, work, approach, team, clients, closing
approach: approach-hero, manifesto, tenets-detailed, cadence, closing
```

Dispatching the `Explore` subagent at thoroughness=quick works well. You need filenames + section names, not a 22-pattern punch list. **Resist "finding shared patterns"** — reuse emerges when two sections turn out byte-identical.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

- Block name = the prototype's `<section class="X">` value, kebab-cased.
- **Never name a block after a reserved EDS class (#15):** `section`, `default-content`, `block-content`, `wrap`, `button` collide with the runtime's decoration DOM. When the section class is generic/reserved, derive a semantic name from `data-screen-label`/intent (`new-products`, `discover`); carry modifiers like `tinted` as variants.
- Same section, multiple pages, identical treatment → ONE block everywhere (classic: `closing`).
- Same role, different look per archetype → different blocks, archetype-prefixed (`hero` / `case-hero` / `service-hero`).
- Two sections in one prototype, same treatment, different copy → merging into one block with a variant cell is fine. Use judgment.
- **Scale the ceremony to the page count.** Single-page with self-evident unique names → lock `block name = section class` and proceed; don't pepper the user. Multi-page → surface 3–5 naming questions first ("Are the closing CTAs identical across pages — same `closing` block?", "Case-study discovery/decisions/solutions: one block or three?").
- **Lock the answers in writing** (`stardust/eds-conversion-log.md`). This is the single highest-leverage step; building before the lock is Anti-pattern 8.

### 3. Foundation

Update `styles/styles.css` to the following — and ONLY the following:
- `:root` tokens lifted verbatim from the prototype (colors, fonts, type scale, weights, tracking, layout, motion easing).
- Document reset. **The `img` reset MUST be `img { display: block; max-width: 100%; height: auto; }` (#36)** — EDS emits width/height attrs; without `height: auto` images stretch vertically (a landscape 1920×1258 rendered 677×1258; invisible on the prototype, appears post-pipeline).
- The minimal EDS section scaffold:
  ```css
  main .section { display: block; }
  main .section > .default-content,
  main .section > .block-content { display: block; }
  main > div, .has-template, div[data-status] { display: none; }
  ```
- The global button system (Step 5) — the one place per-block CSS does not own its paint.
- **Reserve the static header's height on the bare `<header>` element (#81)** — `postlcp.js` injects the header fragment AFTER first paint; with the header in flow above the hero, the hero jumps down by the header height → CLS ~0.13 attributed to the hero (metric-matched fonts do NOT fix it). Responsive `min-height` per breakpoint matching the fragment (reserve a few px OVER), plus the chrome's own `background`; keep the header height deterministic (breakpoints in sync, no nav-link wrap zones). Footer needs NO reservation (below the fold). Verify with a fetch-delayed CLS probe (target < 0.1; fast localhost hides the shift). Full mechanics + CSS: `reference/font-strategy.md` § #81.

That's it. No section-style classes, no motion primitives, no utilities beyond buttons. `scripts/scripts.js` stays minimal — page boot only; per-block animation is owned by per-block CSS.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

**Before writing any `@font-face`, READ `reference/font-strategy.md`** and apply every recipe that matches (fontsource fetch commands, opsz/static-weight variants, fonttools metric math, licensing-alert mechanics, width-probe verification). The inline rules:

- **#65 — Ship an `@font-face` for EVERY named family, not just the body face.** An un-shipped display family silently falls back to Times/Arial, invisible to size/color checks. Gate: grep every quoted family in `styles.css` stacks against declared `@font-face { font-family }` names — any unmatched name fails.
- **1. `head.html` untouched. No font lines, period** — no Google Fonts `<link>`, no CDN stylesheet, no `@font-face` `<style>`, **no `<link rel="preload" as="font">`**. All `@font-face` lives in `styles/styles.css`.
- **2. Self-host EVERY brand face — proprietary included — and emit a licensing alert (#80).** OFL/Apache → self-host (fontsource latin woff2, 30–60 KB). Proprietary → self-host anyway for fidelity (convert the prototype's `.otf`/`.ttf` to woff2 with fontTools) BUT surface the licensing obligation in THREE places: `styles.css` banner comment, `styles/fonts/LICENSING.md`, conversion log + hand-off message; document the remove-and-fall-back path. Never a silent Arial degrade; keep a CDN load only when the files are unobtainable (document the coupling).
  - **#30:** match the axes the prototype loads — an `opsz` axis needs the opsz fontsource file, or headings render subtly off.
  - **#11:** non-variable families (Barlow, Anton…) → static `@fontsource/<name>` per weight, and **compute** the metric overrides from the woff2 with fonttools (no published Fallback face).
- **3. `body.session` pattern with a metric-matched fallback `@font-face`.** The brand font must NOT render at first paint:
  ```css
  @font-face { font-family: "<Brand>"; src: url("/styles/fonts/<brand>-variable.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
  /* System-font metrics overridden to the brand font's line box. Naming it after
     the system font makes every stack reference pick it up site-wide. */
  @font-face { font-family: "Arial"; src: local("Arial"); size-adjust: <X>%; ascent-override: <Y>%; descent-override: <Z>%; line-gap-override: 0%; }
  :root { --font-body: "<Brand>", arial, sans-serif; }
  body { font-family: arial, sans-serif; }
  body.session { font-family: var(--font-body); }
  ```
  Lift `size-adjust`/`ascent-override`/`descent-override` verbatim from the fontsource package's published `<Name> Fallback` face (recipe in the reference). Result: zero shift at session-activate and at brand-font load.
- **#40 — keep `body` VISIBLE; never port `body { display:none } body.appear { display:block }`** — the static-chrome runtime never adds `appear`, so every off-pipeline render (harness, visual-diff) stays blank and silently passes most checks.
- **4. Match the fallback to the brand font's classification.** Sans → metric-overridden `"Arial"`; serif → `"Times New Roman"`; mono → `"Courier New"` (skipping mono metric-match is fine for small labels — document it). Never cross classifications.
  - **#80 — classification includes WIDTH:** a condensed/narrow display face needs a condensed fallback (`"<Brand>", "Arial Narrow", arial, …`, or a self-hosted OFL condensed analog for Android/Linux coverage) — plain Arial runs ~15–20% wider and rewraps headings. Gate: every condensed `--*-font-family` token has a condensed non-generic fallback.
  - **#77 — self-host the prototype's INTENDED fallback, not its accidental system render**, when the named brand font never loads anywhere (the proto's own stack documents intent — take its first redistributable face). **Verify rendered faces with a width probe, never `document.fonts.check`** (it returns true for any referenced name).
  - **#12 — multiple display families:** define each as a `:root` token, reference per-block; metric-matching every display family is optional polish (document the trade-off) — **but metric-match any family used in an ABOVE-THE-FOLD heading**, with its own dedicated fallback name (never reuse the body's `"Arial"` face — wrong metrics).
  - **#22 — match the prototype's EFFECTIVE weight:** a single-weight face (Anton, 400-only) is usually faux-bolded by the browser-default heading weight 700 — set the weight the prototype shows, don't assume `400`.

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

`decorateButton()` in `scripts/ak.js` applies button classes from the author's inline emphasis, AFTER block JS:

| Author markup | Class applied | Visual |
|---|---|---|
| `<strong><a>` | `.btn.btn-primary` | brand fill |
| `<em><a>` | `.btn.btn-secondary` | transparent + outline (color-aware) |
| `<em><strong><a>` | `.btn.btn-accent` | canvas fill on dark surfaces |
| `<del><a>` | `.btn.btn-negative` | rare; destructive |
| `+ <u>` inside any | adds `.btn-outline` | transparent variant |
| 2+ buttons in same parent | parent gets `.btn-group` | flex with gap |

- **Add the brand button system to `styles/styles.css`** — before writing it, READ `reference/encode-contract.md` § Buttons for the worked CSS (base `a.btn`, primary/secondary, light-surface overrides, trailing arrow, `.btn-group`).
- **Block JS just clones the cell** — never `cta.className = 'btn-loud'`, never inject custom SVG arrows:
  ```js
  const ctaCell = rows[N]?.firstElementChild;
  if (ctaCell && ctaCell.querySelector('a')) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    [...ctaCell.childNodes].forEach((n) => actions.append(n.cloneNode(true)));
    container.append(actions);
  }
  ```
- **Block CSS overrides only what's actually different** (e.g. `.closing .actions a.btn-primary { padding: 22px 32px; }`) — target the global class, never a custom one.
- **#41 — surface-aware variants scope to the BLOCK class, not just the section:** `main .section.hero a.btn-secondary` never matches post-conversion (the block class is one level below `.section`) → on-dark CTAs silently render dark-on-dark. Write `main .section.dark …, main .hero … { }` and eyeball-QA every dark-surface CTA for contrast.
- **Not every link is a button:** styled text links, whole-card tile anchors, `tel:`/`mailto:` channel values stay plain `<a>` (no emphasis wrap); the owning block styles them.
- **#25 — more variants than primary/secondary/accent?** Don't force emphasis: lift the prototype's full `.btn` + variant system into `styles/styles.css`, author plain `<a>`, and let each block apply its `btn btn--<variant>` class to the cloned anchor.

### Page templates (page-level CSS a block cannot own)

Some page-level treatments — a per-page ground inversion (cream docs body on an
ink site), a fixed-rail offset (`main { padding-left: 240px }`), chrome-state
overrides — cannot live in a block (a block cannot restyle sibling sections)
and must NOT go in `styles/styles.css` (foundation is site-wide). The home for
them is a **template**: a metadata row `Template: <name>` in the content page →
the pipeline emits `<meta name="template">` → AuthorKit `loadTemplate()` loads
`/templates/<name>/<name>.css` and adds body class **`<name>-template`** (note
the `-template` suffix — scope selectors to `body.<name>-template …`).
Specificity warning: a template rule like `body.x-template :focus-visible`
(0,2,1) silently outranks a block's `.block :focus-visible` (0,2,0) — scope
template pseudo-class rules narrowly or blocks lose their focus styling
(same silent-failure family as #41). Harness parity: `build-harness.mjs`
strips the metadata block, so re-inject `<meta name="template" content="<name>">`
into the harness head or the template CSS never loads and every ground/color
assert reads wrong.

### 6. Static header + footer fragments

Header and footer are **static fragments** — prototype DOM + styles verbatim, no EDS authoring, no block JS parsing — at repo-root `fragments/{header,footer}.html`, committed as code. Format: a `<style>` tag (scoped rules incl. all breakpoints) followed by the raw DOM. No `<!DOCTYPE>`/`<html>`/`<body>`. `scripts/postlcp.js` fetches them from the code origin and injects via `innerHTML`.

Extraction rules:
1. Copy the header DOM (utility bar + topnav) and footer DOM from any prototype (shared across pages).
2. Collect their CSS from `_tokens.css` + page `<style>` blocks, incl. responsive breakpoints, into the fragment's `<style>`.
3. **Lift the chrome element's OWN box styles (#31)** — `margin`/`padding`/`border` on the prototype's `<header>`/`<footer>` element — onto `header.header`/`footer.footer`; the last-section↔footer gap comes entirely from the footer's own top margin, easy to miss.
4. Rewrite relative asset paths to fully-qualified code-origin URLs (`https://main--<repo>--<owner>.aem.page/…`); rewrite relative link hrefs to root-relative (`/donate`). (On branch-hosted pages, relative fragment paths resolve to the branch automatically.)

**Fragments cannot run JavaScript** (`innerHTML` injection = inert `<script>`). Re-implement interactive chrome CSS-only, and document anything dropped in the conversion log:
- Mobile menu/drawer → checkbox-hack (`<input type="checkbox" id="mnav-toggle">` + `<label for>` open/close/scrim + `#mnav-toggle:checked ~ #mnav { … }`).
- Scroll-state shadow / sticky color change → drop (keep a static border) or CSS scroll-driven where supported. Never reattach JS.
- **Forms / inline `on*` handlers (#20):** EDS's CSP (`strict-dynamic` makes `'unsafe-inline'` ignored) means inline handlers never fire and a real `<form>` submits+reloads. Render non-submitting: `<div>` wrapper (no `<form>`) + `<button type="button">`.

More rules:
- **Footer reconciliation (#4):** verify the Runtime-bootstrap edit removed `lazy.js`'s `utils/footer.js` import, or the footer double-loads as an error box.
- **Fragment root class (#26):** `postlcp.js` sets the host class to `header`/`footer` only. Chrome styling keyed to a different root class (`.utilnav`, `.site-footer`) → wrap the fragment content in `<div class="<that-class>">` (never nest another `<header>`/`<footer>`).
- **`header: off` / `footer: off`** in a page's metadata block suppresses chrome on that page (the loader checks `getMetadata()` before fetching).

### 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster (utility pages, services, case studies…), each owning a non-overlapping set of blocks + content pages. Three to four parallel agents is the sweet spot; they don't coordinate — the brief tells them what to reuse.

The brief template:

> Per the project's locked direction: each prototype `<section>` becomes its own EDS block. Lift the prototype's `<style>` for that section verbatim, scope it under the block class (`.block-name .x`, not `section.x .y`), and rebuild the prototype's DOM through a `decorate(block)` function that consumes EDS table-block input.
>
> **READ FIRST — mandatory, before writing any block code:** (1) `skills/deploy/reference/decode-disciplines.md` — apply EVERY discipline (#42–#79: query-don't-index, flatten-first collector, segmentation order, delimiter decode, idempotent markers, eyebrow buffering…); (2) `skills/deploy/reference/encode-contract.md` — authoring shapes, image handling, section-head reabsorption, button CSS; (3) SKILL.md § Step 8 (scaffold + canonical `collectNodes`) and § The ENCODE contract (the one-line rules you must satisfy).
>
> **You own**: prototypes [list], content pages [list], sections [list].
> **Existing blocks — REUSE, do not recreate**: [list with one-line authoring shape per block].
> **Brand tokens** are global in `styles/styles.css`; do not redefine.
> **Section layout (#13)**: if the prototype section wraps content in a centered max-width container (`.wrap`/`.container`/`.inner`), your block MUST recreate it (`block.replaceChildren(wrap)`) — background bleeds full-width, content stays constrained. Full-bleed content only where the prototype itself has no inner wrapper. Invisible ≤1440px — QA wide.
> **Images (#2)**: claude-design prototypes use `<image-slot>` placeholders — usually NO real assets. Treat each image as an OPTIONAL authored cell (`cell.querySelector('picture, img')`); when empty, fall back to the prototype's background treatment via block CSS. Leave image cells EMPTY in the authoring snippet.
> **Scroll-reveal (#14)**: never lift a JS-toggled `opacity:0` reveal — the prototype script doesn't run in EDS; content would be permanently invisible. Render visible; keep only `:hover` transitions; honor `prefers-reduced-motion`.
> **Interactive sections (#17)**: component-driven sections (state, `<sc-for>`/`<sc-if>`/`{{ }}`, counters, tabs) split into data → authorable rows and behavior → block JS (block JS runs, unlike fragments). Render the default state in markup; drive the rest from JS-held local state.
> **Buttons**: author CTAs as `<strong><a>` / `<em><a>`; clone cell child nodes into a `.actions` wrapper; never manufacture anchors. Text links with flourish are NOT buttons.
> **EDS block convention**: `blocks/<name>/<name>.{js,css}`; JS exports `default async function decorate(block)`; input is `<div class="block-name"><div>row<div>cell</div></div>…</div>`; CSS scoped under `.block-name`; SVG inline per-block; honor `prefers-reduced-motion`.
> **EDS content page format**: NO `<head>` (project `head.html` is injected), empty `<header></header>`/`<footer></footer>`, each top-level `<div>` in `<main>` is one section with one block, no `<style>`/`<script>`/section-metadata, fully-qualified image URLs.
> **Done criteria**: [list of paths]. Return new blocks + one-line summary per page.

### 8. Block JS scaffold + decode disciplines

**Before writing any block, READ `reference/decode-disciplines.md`** — each rule below is explained there with its failure signature and worked example. The one-liners here are the enforceable contract; violating any of them ships a silent 1-of-N/blank/scrambled render.

```js
/**
 * <block-name> — <one-line description from prototype data-intent attribute>
 * Authoring rows (positional): 1. <picture> bg image · 2. eyebrow ·
 *   3. headline — a REAL heading, never a bare <div>: hero/lead → the page's
 *   single <h1>, other section titles <h2> (sub-items <h3>) · 4. body ·
 *   5. CTAs (<strong><a> primary / <em><a> secondary; decorator applies classes) ·
 *   6..N card rows — cells: num | label | description
 */
export default async function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;
  // 1. Read content by QUERYING/classifying (collectNodes below), not hard row indexes.
  // 2. Build the prototype's DOM (prototype-style class names).
  // 3. CTA rows: clone cell child nodes into a .actions wrapper (Step 5).
  // 4. block.replaceChildren(...newMarkup);
}
```

The canonical CELL-LEVEL cascade collector (#62/#68/#71) — flatten-first is the DEFAULT:

```js
function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    // walk childNodes, not children: a cell mixing bare text with inline
    // elements (text + <strong>/<a> siblings) otherwise silently drops the
    // text-node part (A/B-validation finding).
    [...cell.childNodes].forEach((n) => {
      if (n.nodeType === 1) out.push(n);
      else if (n.textContent.trim()) { const p = document.createElement('p'); p.textContent = n.textContent.trim(); out.push(p); }
    });
  });
  return out.length ? out : [...block.children]; // last-ditch: direct children
}
```

Disciplines (terse; full narratives in the reference):
- **#62/#68/#71 — DA delivers most blocks as ONE row/ONE cell of flat siblings.** Default to the collector above, then segment/classify by content; one-cell-per-row is the fallback. Never a block-level fallback chain (#71 — it silently drops every bare-text cell). QA: rendered count == authored count; every primary container non-empty post-decorate (childCount>0 / height>0).
- **#42 — lead/hero blocks: query, don't hard-index rows** (`querySelector('h1,h2')`, link-bearing `<p>` = CTAs) — the #34/#35 SEO rework consolidates the head into one cell and fixed indexes render an EMPTY `<h1>`/LCP. QA: hero wrap non-empty, contains the `<h1>`.
- **#51 — eyebrow vs lede by ORDER/length, not "first `<p>`":** eyebrow = short/uppercase line BEFORE the heading; lede = sentence-length `<p>` AFTER it.
- **#55 — unwrap the cell's own heading before cloning into your live heading** (`cell.querySelector('h1,…,h6') || cell`) or you ship `<h1><h1>`. QA: one `<h1>`, 0 nested headings.
- **#70 — marker injection is IDEMPOTENT:** strip a matching leading glyph/badge before prepending, at EVERY injection site — or authored markers double (`▶ ▶ …`).
- **#69 — carousel slides segment on heading boundaries, ORDER-AGNOSTIC:** fold everything between headings into the open slide (eyebrow may come AFTER the heading); a post-heading text node must never open a new slide. QA: slide count == heading count; per-slide CTA count == authored.
- **#76 — split/photo-overlay panels: BUFFER the pre-heading eyebrow** (`pendingEyebrow`) and attach it to the group its heading opens; once a group is filled, bare text re-buffers for the NEXT group. QA: each group's eyebrow/heading/body/CTA in their OWN slots, not just N groups.
- **#57 — carousel lead: exactly ONE server `<h1>`** — first slide `<h1>`, others `<h2>`; block reads them generically. QA: `<h1>` count in the content file = 1.
- **#56 — a multi-row head is EVERYTHING before the first content/image cell** — collect all leading no-image rows, or the section title leaks into the grid as a bogus card.
- **#61 — alternating light/dark card rhythm: `explicitMarker ?? (i % 2 === 1)`** — the prototype's structural marker doesn't survive DA; scope on-dark overrides to the resulting `.card.dark` (#41).
- **#48 — classify rows/cells by CONTENT on EVERY block** (heading / `<picture>` / link / `/^\d+/` / `dt|dd` shape), never `block.children[N]` — index contracts silently drop CTAs/duplicate eyebrows.
- **#50 — DA flattens semantic lists to delimiter lines** (`Key: value`, `01 · Name · 6.5%`): parse by delimiters as decode fallback, never by `<dl>`/`<ol>` tags alone. QA: data containers have the expected non-zero row count.
- **#52/#63/#73/#64 — card/tile grids: segment, don't iterate rows.** Boundary = the MOST FREQUENT heading tag (not "any heading"). Order: (0) one-row-per-card in AUTHORED field order (never assume `tag→media→heading` — #73's off-by-one image shift passes count checks); (1) per-card heading boundary; (2) one card per `·`-delimited `<p>` line (name / meta / trailing badge keyword); (3) one-row-per-unit. **Never `<picture>` as the PRIMARY boundary (#64)** — image-less content collapses N cards to 1. QA: grid count asserted even with no per-card headings; each card's image src matches its OWN title.
- **#53/#72 — classifiers match the element ITSELF or a descendant** (`el.matches(sel) || el.querySelector(sel)`); media always tests `picture, img` (harness/pasted content delivers bare `<img>`).
- **#79 — read plain-text fields by CELL/`textContent`, never `querySelectorAll('p')`** — the pipeline unwraps `<p>` in single-text cells; live drops what the harness shows. Assert each text field present (counts don't catch it).
- **#35 — promote headlines to real headings:** one `<h1>` per page (hero/lead), `<h2>` sections, `<h3>` sub-items — interactive blocks included, in server-visible markup.
- **#28 — interactive blocks: ONE self-contained block owns the state** — data as keyed authorable rows, behavior as local `state` + targeted `render*()`; shared data → one block, not cross-block sync. QA: drive each control and assert the state change.
- **#33 — sequential-from-one-entry flow → one block** (`state.view` + `render()` dispatcher); independently-addressable views with different chrome → multiple pages (#29).
- **#23/#49 — always pair with a per-section screenshot eyeball and the `CONTENT GAP` probe flag** — a heading/contentBox-count or main-height delta means dropped/duplicated content.

### 9. Content page scaffold

- **Every page MUST begin with a `metadata` block (#34):** Title ~50–60 chars (brand + primary keyword/location, derived from the page's real `<h1>` — NEVER a block/section name) + Description ~150–160 chars. Skip it → EDS derives `<title>` from the first cell (`<title>Hero</title>`) and mirrors the junk into `og:`/`twitter:` cards. `header: off` / `footer: off` / `Robots` rows go in the same block (`<div><div>header</div><div>off</div></div>`; the pipeline finds the block anywhere in `<main>`).
- **The page is a DA *body fragment* (#7)** — the Source API requires it to start at `<body>`: **no `<!DOCTYPE>`, no `<html>`, no `<head>`** (only the mount-based deploy tolerates a full document — it strips `<head>` on ingestion). Emit exactly:

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
    <div><!-- next section: its title decorates to <h2> --></div>
  </main>
  <footer></footer>
</body>
```

- **Before any DA write, run `node skills/deploy/scripts/sanitise.js <file>`** — non-ASCII (`® · – —`, accents, emoji) → HTML entities, or DA corrupts them to U+FFFD.
- **Never emit a `<head>` element** — document metadata lives in the project `head.html`, injected at delivery; a content `<head>` is dead weight or a duplication conflict.
- **Multi-view SPA → multiple pages (#29):** views with **different chrome** each become their own page (pre-render each per #27), linked with real hrefs. One shared `fragments/header.html` can't be two headers: keep the representative one as the fragment; the other page sets `header: off` and renders its header as a block (`site-nav`) at the top of its content. (Harness caveat for `header: off`: see `reference/decode-disciplines.md` § #29.)
- **Real images:** authored `<img src>` must be ingester-fetchable — **prefer `https://content.da.live/{org}/{repo}/media/<scope>/<file>`** (branch-independent; upload the binary first — ENCODE contract § Images). A `main--<repo>--<owner>.aem.page` URL ingests but is branch-locked. **NEVER repo-relative `/img/…` in authored content** (→ `about:error`). **#67 — this rule is ONLY for authored content `<img>`:** fixed assets in block JS/CSS backgrounds stay root-relative `/img/<brand>/…` (anti-pattern 9b), browser-fetched, never ingested. `<image-slot>` prototypes → leave image cells EMPTY (`<div></div>`); the block's CSS fallback renders the section; the author drops real images later.

## Local QA before deploy (no DA)

`aem up --html-folder content` is NOT a reliable preview — brand-new paths 404 on the rendered route (only paths already in the remote routing index render through the pipeline). Build the harness instead:

```bash
# 1. dev server (serves /scripts /styles /blocks /fragments at real paths)
npx -y @adobe/aem-cli up --no-open &
# 2. harness — use the committed helper; do NOT hand-roll the metadata strip (#46).
#    It also rewrites absolute /img/ URLs to root-relative (#43). qa/ is gitignored.
node skills/deploy/scripts/build-harness.mjs content/<path>.html qa/page.html
#    (mkdir -p qa first — the helper does not create the output dir; the harness
#    also emits no <header>/<footer> elements and strips the metadata block, so
#    patch those back in when QA'ing fragments or a Template: page — see
#    § Page templates. Programmatic .focus() does not match :focus-visible; use
#    keyboard Tab when asserting focus styles.)
```

Open `http://localhost:3000/qa/page.html` (`loadArea()` runs, blocks load, fragments inject); screenshot/inspect with headless Chrome (`--virtual-time-budget=9000 --screenshot` / `--dump-dom`) or Playwright. Then run every gate; a failure loops back to the owning step:

- **#19 — capture at a real viewport (e.g. 1440×900) and `scrollIntoView()` each section** — a giant capture window makes a `100vh` hero window-tall and its content looks vanished.
- **#23 — visually diff each section against the prototype at the SAME viewport** (the prototype self-renders from its file). Programmatic checks miss header alignment, intentional `<br>`s, heading weight, and a section root's background/color. Mismatch → fix the owning block's CSS.
- **#28 — drive every interactive block and assert state changes** (click tab → active item changes; invalid submit → error text; valid submit → visible state change). Re-run the same drive against the **deployed** preview — harness-green JS can still trip on CSP live. Let transitions settle before computed-style asserts.
- **#13 — wide-viewport check at ≥1600px (not just 1440):** measure each block's inner content width; anything spanning full width that the prototype constrains is a dropped wrap → restore it. Probe snippet: `reference/decode-disciplines.md` § QA probes.
- Per-block content asserts from Step 8 (counts, non-empty containers, single `<h1>`).

## Step 10 — Visual + structural diff & reconcile (optional, recommended)

After deploy, reconcile against the prototype with **two complementary probes — run BOTH (#78)**; either alone gives a false "looks fine". Neither is a pixel diff (computed-style/geometry only; pixels are noise):

1. **`skills/diff/scripts/visual-diff.mjs` — PIXEL/layout probe:** stretched images (#36), dropped wraps (#37), blank renders (#40), colour flips (#59). Structurally blind to wrong-slot text or a missing CTA.
2. **`skills/diff/scripts/content-diff.mjs` — STRUCTURAL content+type probe:** ordered role-classified inventory ({heading, eyebrow, cta+href, body}) from each `<main>`, diffed — the layer the pixel probe can't see.

```bash
# Prereq: a RENDERABLE prototype (serve its own dir; JSX → pre-render first, #24/#27).
( cd <prototype-dir> && python3 -m http.server 8791 & )
node skills/diff/scripts/visual-diff.mjs "http://localhost:8791/<p>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" --profile eds --sections ".hero,.compare"
node skills/diff/scripts/content-diff.mjs "http://localhost:8791/<p>.html" \
  "https://<branch>--<repo>--<owner>.aem.page/<path>" --profile eds   # live URL, not .plain.html (--json dumps both inventories)
```

Both probes are owned by the **`stardust:diff`** skill (`--profile generic` for non-EDS builds). Read the output — each flag names its fix:

- `BLANK RENDER` → #40 (`body{display:none}` gate or harness load failure) — fix before trusting anything else.
- `IMAGE DID NOT LOAD` → #43: the harness `<img>` 404'd — rewrite absolute `…aem.page/img/...` srcs to root-relative `/img/...` in the harness or the stretch check silently skips.
- `STRETCHED IMAGE` → #36 (add `height:auto`). **#45 — justified, leave the CSS, when** (a) it's an intentional `object-fit: cover` full-bleed, or (b) the SAME flag fires proto-side (a faithful lift); a real defect only when the proto renders natural AR and the EDS doesn't.
- `FLUSH-LEFT TEXT` → #37: the owning block dropped its max-width wrap.
- **Metrics JSON:** compare `proto` vs `eds` — eyebrow/heading colors (#38: a primitive styled in the proto, dropped in one block), image dims, `contentBoxes` (dropped-wrap blocks sit at left ≈ 0). Screenshots land in `--out` (default `qa/`) — eyeball them.
- **#44 — pre-deploy URL gate:** `grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` MUST be empty (absolute origins pass local QA, 404 everywhere real).
- `FONT MISMATCH` → #66: a family that loaded proto-side but not EDS-side = missing `@font-face` (#65) — ship the woff2 self-hosted.
- `SURFACE/GROUND MISMATCH` → #59: heading luminance flipped dark↔light = a band on the wrong ground (#58) — check the owning block's section background.
- **#54 — GAP flags are WHOLE-PAGE**, independent of `--sections`: `IMAGERY GAP` (#47) / `CONTENT GAP` (#49) may point at a different block than the one you scoped. Never dismiss as "outside my section" → re-run an UNSCOPED diff and locate the dropped/duplicated content.

Reading `content-diff` (#78):
- `MISSING CTA/HEADING/EYEBROW` 🔴 — real dropped content, BLOCKING (missing eyebrow → usually #76; missing CTA → the link cell never rendered).
- `ROLE SWAP` 🔴 — same text, wrong slot (#76 mis-classification) → fix the block's segmentation.
- `MISSING BODY` / `EXTRA` 🟡 — usually a placeholder→real-copy rewrite; CONFIRM intended, not lost/hallucinated prose.
- `FONT FORK` 🟠 — matched line, different rendered face (width probe). `proto X→sys` with EDS shipping the intended fallback is CORRECT (#77); EDS falling back → ship the missing `@font-face`.
- The per-role summary counts are a fast dropped-section signal before reading flags.

**Exit criteria:** re-run BOTH probes until visual red flags are "none" (or justified per #45) and content-diff shows **0 structural 🔴** (🟡/🟠 confirmed intended). The flag lists double as a regression checklist — a new silent regression deserves a fix AND a probe signal.

## Anti-patterns (lessons paid for the hard way)

These look reasonable; each cost a full reset. **Before Step 2 naming, and before merging or abstracting ANY sections, READ `reference/anti-patterns.md`** for the full failure narratives. The contract:

1. Never abstract sections into "blocks with variants" speculatively — one block per distinct section; reuse only byte-identical ones.
   1b. Never merge two prototype bands with different `data-ground`/surfaces (#58) — the lost band's heading silently inverts; reproduce EACH ground as a sub-band or don't merge.
2. No section-metadata style classes paralleling block variants — per-block CSS paints the entire section; one styling system.
3. No shared utility modules (waves, animation primitives) — inline the SVG in the owning block.
4. Never manually create button anchors in block JS — clone the cell anchor; `decorateButton()` applies classes.
5. Never write block JS to parse/rebuild header/footer — static fragments are injected verbatim.
6. Never guess EDS's section DOM (`.default-content-wrapper`…) — inspect a rendered page; the shape is `.section > .default-content` + `.block-content`.
7. Don't over-audit — a per-page section list, not a 22-pattern punch list.
8. Don't build before locking naming/reuse decisions in writing (Step 2).
9. No generic placeholder image paths (`/img/case-studies/foo.jpg` 404s) — author URLs that render in preview from day one.
   9b. No absolute-origin URLs in block CODE — JS literals AND CSS `background-image` (#44, #67): fixed assets are root-relative `/img/<brand>/…`; absolute origins pass local QA and 404 everywhere real. Gate: the #44 grep.
10. Never touch `head.html` for fonts — preload included; all `@font-face` in `styles/styles.css` (Step 4).
11. Never skip the metric-matched fallback `@font-face` — fontsource calibration for variable brands, fonttools-computed for static ones (#11).
12. Don't over-apply the button convention — tile anchors, `tel:`/`mailto:` values, styled text links are NOT buttons.
13. Never drop the prototype's max-width container — worst on plain-background sections (#37); and the emitted `.wrap` must be STYLED in CSS (#74). Gate: JS emits a wrap class → grep its CSS for the matching rule.
14. `<image-slot>` placeholders have no real assets — optional cells + CSS background fallback, never a hard-coded prototype URL.
15. Never load the footer twice (block + static fragment) — remove `lazy.js`'s `utils/footer.js` import (#4).
16. Never lift a JS-toggled `opacity:0` reveal — the prototype script doesn't run; content goes permanently invisible.
17. Never inject a `<main>` element from block JS — the foundation reset hides `main > div`; use `<section>` or stay inside the block element.

## Checklist (per page)

- [ ] Each prototype section has a corresponding block call in the content page.
- [ ] Content page is a **body fragment**: starts at `<body>`, no `<!DOCTYPE>`/`<html>`/`<head>` (#7).
- [ ] `sanitise.js` run before any DA write (non-ASCII → entities).
- [ ] `<header></header>` / `<footer></footer>` EMPTY (fragments load via `postlcp.js`).
- [ ] Page begins with a `metadata` block (#34): real Title ≤60 chars from the `<h1>` + ~155-char Description; `header: off` / `Robots` rows in the same block when needed.
- [ ] Exactly one `<h1>` (#35); section titles `<h2>`/`<h3>`; no headline left as a bare `<div>` (interactive blocks included).
- [ ] Editorial images are authorable content — uploaded to DA `/media`, authored as `content.da.live` `<img>` with `alt`; hero/CTA-band backgrounds count. Decorative/fixed → CSS background. Verify: delivered `.plain.html` has the expected `<img>`+alt count. `<image-slot>` → empty cells + CSS fallback.
- [ ] ENCODE shapes: one row per grouped item; FAQ = head + Q/A rows; sub-fields via leading `<strong>`/`<code>`, no invented delimiters; accents `<em>` not `<span class="em">`; no `<sup>`/layout-`<br>`.
- [ ] Section heads authored as DEFAULT CONTENT; block reabsorbs (0 wrappers left, decorated outerHTML byte-identical — `reference/encode-contract.md`).
- [ ] Same-pattern sections share ONE block + variants; only genuinely-unique sections bespoke.
- [ ] Heading outline has no level jumps (`h2 → h3`, never `h2 → h4`).
- [ ] Every block reproduces the prototype's max-width container — plain-background sections included (#37); no unintended full-width content at ≥1600px (#13); emitted wrap classes are styled (#74).
- [ ] Global `img` reset is `display: block; max-width: 100%; height: auto;` (#36).
- [ ] Bare `<header>` has a reserved responsive `min-height` matching the fragment when the header sits above the first section (#81); CLS verified with a fetch-delayed probe, target < 0.1.
- [ ] Any styling depending on a `<span>`/class INSIDE a block cell is re-created in `decorate()` (#39) — EDS strips spans in cells (e.g. wrap a `.stars` run in JS).
- [ ] Blocks read plain-text fields by CELL/`textContent`, not `querySelectorAll('p')` (#79); each text field asserted present against a decorated render.
- [ ] No `<style>`/`<script>` in the content page; no section-metadata blocks.
- [ ] Closing CTA reuses the shared `closing` block.
- [ ] CTAs wrapped `<strong>`/`<em>`; text links and tile anchors plain `<a>`.
- [ ] Block JS exports `default async function decorate(block)` with row-describing JSDoc.
- [ ] Block CSS scoped under `.block-name`; no global-token or global-button redefinition (size/hover overrides only).
- [ ] SVG inline in block JS (no shared utility); no manufactured button anchors.
- [ ] `prefers-reduced-motion: reduce` honored on any animation.
- [ ] No lifted JS-toggled `opacity:0` reveal — content renders visible.
- [ ] No block named after a reserved EDS class (#15).
- [ ] `head.html` untouched; all `@font-face` in `styles/styles.css`; woff2s in `styles/fonts/`.
- [ ] EVERY named brand face self-hosted, proprietary included (#80/#65); licensing alert in all three places when proprietary shipped; hand-off flags "license required before `aem.live`".
- [ ] Condensed/narrow faces fall back to a condensed face, never plain Arial (#80).
- [ ] Body defaults to a metric-matched system fallback; `body.session` switches to the brand stack.
- [ ] Override `@font-face` named after the system font declares `size-adjust`/`ascent-override`/`descent-override` (fontsource calibration or fonttools-computed, #11) — zero CLS on swap.
- [ ] No per-block `font-family: var(--font-body)`/`var(--font-display)` — brand font flows from `body.session` by inheritance; only mono/serif families set per-block.

## When you finish

Update `stardust/eds-conversion-log.md` (or create it): final block inventory, decisions locked, anti-patterns avoided this run, anything site-specific the next person should know. The log is the running history of "why does this look the way it does."

## References

- `da-deploy-protocol.md` — the curl-based DA Source API deploy contract (auth, source PUT, preview/publish, asset-before-preview ordering).
- `reference/runtime-bootstrap.md` — port manifest, mandatory-edit mechanics, lint list (read before hand-porting).
- `reference/font-strategy.md` — font recipes, metric math, licensing mechanics, #81 header-reservation deep dive (read before Step 4).
- `reference/encode-contract.md` — section-head reabsorption, image upload/verify/repair, worked button CSS (read before authoring images/heads and before Step 5 CSS).
- `reference/decode-disciplines.md` — full #42–#79 narratives + QA probes (read before Step 8 and named in every Step 7 brief).
- `reference/anti-patterns.md` — the full failure narratives behind the numbered list.
- `IMPROVEMENTS.md` — running log of friction/gaps and the numbered findings (#NN) the `stardust:diff` `eds` profile cites.
