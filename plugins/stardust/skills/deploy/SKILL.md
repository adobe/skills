---
name: deploy
description: Convert per-page styled HTML prototypes (stardust under stardust/prototypes/**, or claude-design / Mobirise / Relume / Lovable / v0 / Figma-derived pages, or JSX prototypes pre-rendered to HTML, often under samples/) into Edge Delivery Services (EDS / AEM) blocks and content pages, then deploy via DA. Each prototype section becomes one EDS block; the prototype's per-section CSS becomes that block's CSS scoped under the block class. Use when the user wants to lift styled per-page HTML prototypes into a working EDS site under blocks/ and content/.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
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
2. An EDS project at the repo root — **vanilla `aem-boilerplate`** (`github.com/adobe/aem-boilerplate`): `scripts/aem.js` + `scripts/scripts.js`, `blocks/` with `header`/`footer`/`fragment`, `styles/styles.css` + `styles/fonts.css`, `head.html`. This is the ONLY runtime this skill targets — no runtime files are ever ported, vendored, or edited.
3. A goal to convert: prototypes → authorable EDS blocks + EDS content pages under `content/**`.

If the user has prototypes but no EDS scaffolding, stop and ask whether to scaffold from `adobe/aem-boilerplate` (use the template as-is; the conversion never modifies `scripts/aem.js`). If they have EDS but no prototypes, this skill doesn't apply.

**Flow guard (stardust projects).** When `stardust/state.json` exists but has no `flow` and the ask is a migration (a URL plus "migrate" / "to EDS" / "re-platform"), stop before Step 1: print the master skill's two-flow table (`skills/stardust/SKILL.md` § Two migration flows) and hand back to its routing, which stamps `flow` (`skills/stardust/reference/state-machine.md` § Flow keys). Hand-authored prototypes with no `state.json` are unaffected — that is this skill's standalone use.

## Target runtime — vanilla aem-boilerplate (what the generated code can rely on)

The stock boilerplate provides everything the conversion needs; the runtime is never modified. The load chain (`head.html` → `scripts.js` → `loadEager` → `loadLazy` → `loadDelayed`) gives you:

- **Section DOM:** each `main > div` becomes `<div class="section">`; runs of default content are wrapped in `div.default-content-wrapper`; each block table gets a `div.<name>-wrapper` around `<div class="<name> block" data-block-name="<name>">`, and the section gains `.<name>-container`. Sections are hidden (`data-section-status` + inline `display:none`) until loaded — undecorated-content flash is handled by the runtime, not by foundation CSS.
- **Cell normalization (`wrapTextNodes`, in `decorateBlock` — #104):** any block cell whose FIRST element child is not in `P/PRE/UL/OL/PICTURE/TABLE/H1–6` — or that leads with a `<picture>` followed by anything else — gets its ENTIRE content folded into **one `<p>`** before your `decorate()` runs. A media-led mixed cell (`<img> + <h3> + <p>`) therefore arrives as a single wrapper `<p>`; a collector reading `cell.children` sees ONE node and silently drops everything after the image. Decode with the wrapper-expanding collector (Step 8, #62/#104).
- **Body gate:** `styles.css` ships `body { display: none }` + `body.appear { display: block }`; `loadEager()` adds `appear` after `decorateMain()`. This gate is CORRECT — keep it. Any off-pipeline render (harness, probes) must load the real `scripts/scripts.js` so the gate is satisfied; a blank render means the runtime never booted, not that the gate should be removed.
- **Buttons:** `decorateButtons()` (in `scripts.js`) buttonizes ONLY author-formatted links — see Step 5 for the emitted class family.
- **Chrome:** `header`/`footer` BLOCKS (loaded by `loadLazy`) fetch authored fragment documents — `/nav` and `/footer` by default, overridable per page via `nav`/`footer` metadata. Block JS runs, so interactive chrome (hamburger, dropdowns) is real JS. See Step 6.
- **Fonts:** `@font-face` lives in `styles/fonts.css`, loaded by `loadFonts()` (eagerly on desktop / repeat views via a `fonts-loaded` session flag, always in `loadLazy`); `styles.css` carries the metric-matched fallback faces. See Step 4.
- **Auto-blocking hook:** `buildAutoBlocks()` in `scripts.js` is project-owned — the home for D1 auto-blocks (video/embed URLs, fragment links).
- **Lint:** generated blocks and styles lint under the project's own config; there is no vendored runtime to exempt. Do not create an `.eslintignore` for runtime files. **Know the rules before writing:** lines ≤ 100 chars (`max-len` was 91 of 100 hits in a recorded run), CSS custom properties kebab-case; fix a hit with a targeted edit, never by rewriting the file (six block files were rewritten for line length); never `--fix` a file another agent is editing. When `DESIGN.json` `extensions.breakpoints.target` is set, `npm run lint` includes `breakpoint-lint.mjs` (replica handoff contract § Boilerplate lint): every `@media` width and JS threshold sits on a target step.
- **Experience Workspace instrumentation (da.live canvas "quick-edit" — the inline editor your blocks must survive).** The workspace stamps `data-prose-index` on every OUTERMOST `h1–h6 / p / ol / ul / pre / blockquote` of the authored document, `data-image-index` on every `img` and `data-block-index` on every block div, swaps that instrumented HTML into `document.body`, and re-runs the page's own `loadPage()` — so every block's `decorate()` runs over the instrumented markup. In the workspace **every block cell contains a `<p>`** (prose2aem copies cell innerHTML; the published pipeline unwraps single-paragraph cells to bare text and the runtime's `wrapTextNodes` re-wraps them, so `decorate()` sees a `<p>` in both worlds). Afterwards ONLY elements that still carry their `data-prose-index` become editors (`querySelector('[data-prose-index="N"]').replaceWith(editor)`); nothing repairs a lost index. A text your block rebuilt from `textContent`/`innerHTML`, synthesized, or retagged is silently uneditable. Contract + gate: `reference/block-js.md` § Experience Workspace editability contract (EW1–EW10).

**The boilerplate itself drifts** (e.g. current `main` emits `p.button-wrapper`; older clones emit `p.button-container` and buttonize bare links). Never assume — the Runtime-detection probe below records what THIS target actually does, from its own `scripts.js`/`aem.js`.

## Playwright re-probe (run before anything that renders)

Every script below runs from its project copy (`stardust/scripts/<skill>/`, synced by `../stardust/SKILL.md` § Setup).

`--no-save` playwright installs from earlier phases are pruned by any later
real `npm i` — including any setup step adding a devDependency
(extract SKILL.md § Setup → `--no-save` installs are ephemeral). Before the
Local-QA harness, the computed-layout gate, or any probe below, verify
`node -e "import('playwright').then(()=>process.exit(0))"` from the project
root and re-install (`npm i -D playwright --no-save --legacy-peer-deps`) on
failure.

## Runtime-detection probe (run before Step 1 — write `stardust/runtime-contract.json`)

Boilerplate clones drift (button classes, wrapper names, buttonization rules differ across vintages), and a wrong assumption here is **silent and sitewide**. Before converting anything, read the TARGET's own `scripts/scripts.js` + `scripts/aem.js` — what the button decorator emits and requires, how `decorateBlock` wraps blocks — and record the answers:

```json
{
  "runtime": "vanilla-eds",
  "blockWrapperClass": "block",
  "buttonClasses": ".button / .button.primary / .button.secondary / .button.accent, in p.button-wrapper",
  "buttonization": "formatted-only | bare-links-too",
  "fragmentScriptPolicy": "inert-innerHTML",
  "emptySectionCollapse": true
}
```

Block CSS/JS generation and the Local-QA harness read this contract instead of assuming. The values above are current `adobe/aem-boilerplate` main; the two known drift axes to verify per target:
- **`buttonClasses`** — current main emits `a.button` (+ `.primary`/`.secondary`/`.accent`) inside `p.button-wrapper`; older clones emit `p.button-container`, and some buttonize a bare `<a>` alone in a paragraph (`buttonization: bare-links-too`) while current main requires authored `<strong>`/`<em>`. Style the wrong container class and spacing/group layout silently breaks; assume the wrong buttonization rule and plain text links ship as buttons (or CTAs ship as bare links).
- **`blockWrapperClass`** — `decorateBlock` adds `.block` + `data-block-name` and wraps the block in `div.<name>-wrapper` (section gains `.<name>-container`). Scope block CSS under `.<name>` (the class every vintage sets); confirm empirically by asserting a grid container computes `display: grid` in a headless render — a wrong scoping guess makes every grid fall back to `display: block` ("mobile layout on desktop") while typography still looks fine.

When `emptySectionCollapse` is true (the page-metadata block leaves an empty padded section after its content is consumed into `<head>`), add `main .section:empty { display: none }` to the foundation — or an empty ~88px band sits between the header and the first real section.

## Deploy (DA Source API, from a local agent)

**Steps 1–9 are the conversion methodology**; deploy is the one transport-specific step. From a local agent (Claude Code / CLI), each converted page deploys headlessly:

| Stage | How |
|---|---|
| Code | `git push` the branch → AEM Code Sync builds it |
| Localize links | `skills/deploy/scripts/localize-links.mjs --source-host <live-host> [--redirects stardust/redirects.tsv]` — after EVERY generator, before EVERY write, over the WHOLE tree (below) |
| Sanitise | `skills/deploy/scripts/sanitise.js` — run it before the write (DA corrupts raw UTF-8) |
| Content write | DA Source API: `PUT admin.da.live/source/<org>/<repo>/<path>.html` (multipart, field name **`data`**, `type=text/html`) |
| Make live | `POST admin.hlx.page/preview/<org>/<repo>/<branch>/<path>` (then optionally `/live/...`) |
| Auth | IMS token (`DA_TOKEN`) — see the `da-content` / `da-auth` skills |

The content payload is a **body fragment** (see Step 9). The deploy needs the **code branch pushed to GitHub** so the branch preview (`<branch>--<repo>--<org>.aem.page`) renders with your blocks. See `da-deploy-protocol.md` for the full curl contract.

**For more than a few pages, use the bundled driver instead of a hand-rolled loop (#4).** `node stardust/scripts/deploy/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> --content content [--concurrency 4] [--no-publish]` runs `PUT → preview → live` across a content tree with bounded concurrency, a **persistent ledger** (`content/.deploy-ledger.json`) so a re-run **skips pages already live** and only re-drives FAILs, capped-backoff retries on `000/429/5xx` (and on a `401` — the `DA_TOKEN` lifecycle rule below: a `401` that persists halts the batch with exit 3 and the exact re-run command, never a per-page FAIL), an **append-only** log (survives a restart), and a delivered-`.plain.html` check before flipping a page to `live` (admin 200 ≠ delivered). It's idempotent — safe to Ctrl-C and re-run, which is the documented recovery for a transient-blip half-deploy. A serial hand-rolled bash loop that truncates its own log on restart is the anti-pattern this replaces.

**Per-page atomic delivery contract.** A page is `deployed` only when the full chain passes, in order: `localize-links.mjs` run over the content tree (then `--check` exit 0 — no source-host href left whose target exists locally) → `davids-model-lint.mjs` exit 0 (0 🔴 — the content-structure gate) → sanitise-wrapped file (`scripts/sanitise.js`) → `PUT` (multipart field `data`, `type=text/html`) → `POST /preview/` → `POST /live/` → **GET the rendered `.plain.html` and assert**: HTTP 200, the `<body>` wrapper intact, exactly one `<h1>`, zero `about:error`, no `/img/` srcs — plus, when key facts are declared for the site (#86 — `DESIGN.json.extensions.metadata.keyFacts[]`, written by `direct`; skip the gate and note the skip when the field is absent), grep the RAW full-page HTML (not the rendered DOM) for each fact string on the pages that carry them. → **AI-readability gate (#100)**: `node stardust/scripts/deploy/ai-readability.mjs --origin <live> <paths>` — the checker score (served words ÷ rendered-DOM words, landmarks ignored) with fragments credited must be **≥ 98** on the published page; record the strict score and the per-block served gap in the gate report (`reference/ai-readability.md`). Only then flip the page's ledger entry to `deployed` — never on the POST codes (admin 200 ≠ delivered).

**Link localization is a pipeline stage, not an afterthought.** Generators carry captured hrefs as fully-qualified source-domain URLs (the D4 "opaque tokens" rule), which sends visitors back to the live site for pages that exist on the new origin. **D4 is a capture-fidelity rule for media and external targets; it is never a delivery rule for internal links.** The pipeline owns a URL map (every served path in the content tree + `stardust/redirects.tsv` entries) and `localize-links.mjs` rewrites, idempotently, every source-host `<a href>` whose path resolves in the map to the root-relative URL EDS serves (`eds-path.mjs`: no `.html`; a folder index at `/x/`, a leaf at `/x/y`), query and fragment preserved — and normalizes root-relative internal hrefs the same way. Everything else stays absolute: genuinely external targets and not-yet-migrated pages are the honest integration boundary, and the tool lists them. **Re-run it over the WHOLE tree after every wave**: earlier waves' pages gain newly valid internal targets only when a later wave ships them. `davids-model-lint.mjs --source-host <live-host>` flags any remaining localizable link as a 🟡 LOCALIZE advisory (advisory in this release; the fix is the stage, never a hand edit).

**A `.plain.html` pass is NOT a layout pass — add one computed-style assertion (#the silent-failure guard).** The text-level asserts above are all satisfied while the page renders as a single stacked column, because a block-CSS scoping mistake (a selector keyed to a wrapper class the target runtime doesn't emit — see `blockWrapperClass` in the runtime contract) makes every grid fall back to `display: block` *with the typography still correct*. This shipped green on a real e2e site. So the contract's final gate is a **headless computed-style check on the delivered live URL** (not `.plain.html`): load the page in a headless browser and assert, for the first page of each template, that every block whose CSS declares a grid/flex layout **computes `display: grid`/`flex` (not `block`)**, `main .section` count > 0, blocks are decorated (`data-block-name` present), zero `pageerror`, zero broken images — **and every visible loaded image renders non-zero: `clientWidth > 0` (#122)**. Loaded ≠ rendered: an `<img>` with `naturalWidth > 0` can still render 0×0 (recorded: a flex item whose width derives from the image while the image's `max-width: 100%` derives from the item — circular sizing collapses to zero), and both the `.plain.html` checks and a `naturalWidth === 0` broken-image probe miss it. A block that should grid but computes `block` fails the page — do not flip it to `deployed`. This is the assertion `blockWrapperClass` in the runtime contract calls for; the atomic contract is where it must actually run, once per template. Two field-decodes worth pinning: a **burst of `PUT` 400s is a malformed path, not rate limiting** — lowercase every segment, never a double slash (`content//…` 400s the PUT while preview/live still 200), no trailing `-`/`_` on a segment; and **write long loops to a bash script file with absolute binary paths** (`/usr/bin/curl`, the full `node` path) — zsh drops PATH inside `while`/`for` in some contexts, and the resulting `command not found` burst mimics a transport failure.

**Token hygiene (#16).** The IMS token typically lives in repo `.env` as `DA_TOKEN`. Before the first commit, make sure `.gitignore` excludes `.env` and `.env.*` **on the branch you'll branch tests from** — otherwise every test subbranch re-exposes the token (the master skill's Setup step 6 writes the managed block; the local harness and pre-renders live under `stardust/.work/`, which `stardust/.gitignore` already excludes). Dev tokens last ~24h; a `401` with an empty body means expired → refresh and retry (the write is idempotent).

**DA_TOKEN lifecycle — preflight and re-check, never fail pages on it.** At setup, preflight the token: decode the JWT `exp` claim when present (base64-decode the middle segment) and smoke-test ONE authenticated DA call before any batch. **Re-check before each long batch** — a token fresh at setup can expire mid-run. On a `401` mid-batch, do not read the first one as expiry — a valid token can be answered `401` under a concurrent burst (recorded: the whole first burst of a media batch got `401` on a token with hours of validity left, and a lone sequential PUT went straight through). Both shipped drivers apply the rule themselves — `da-media-upload.mjs` (media) and `deploy-batch.mjs` (pages): a JWT past its `exp` exits 3 before any request; a `401` from the admin API (the media PUT; the page PUT, preview and live) retries like a `429` — the uploader's first upload additionally runs alone to prove the token; a `401` that still persists through its retries on ANY file or page halts the batch with exit 3 — ledger checkpointed, in-flight work finished, the rest not attempted, one actionable stderr line with the exact re-run command (`HALT <path> 401 after <n> attempts — refresh DA_TOKEN and re-run: …`; the same command resumes from the ledger). A `401` is never a per-file or per-page FAIL: an expired token once left an 894-row batch failing file by file for 5.5 hours. **Token source per driver:** both drivers take both flags — `--token-env <NAME>` (the environment variable holding the token, default `DA_TOKEN`) or `--token-file <path>` (read once at start, trimmed; never both — for a harness that hands the token over as a file rather than a variable; a recorded hands-off run had the token in a file while the uploader read `DA_TOKEN` only); the value is never printed, never in the re-run command and never written to a ledger or log, and every expiry or halt line names the variable or file to refresh (in file mode the re-run command carries no `<var>=<fresh token>` prefix). A hand-rolled loop (never for more than a few pages — above) follows the same shape: checkpoint the ledger, retry the `401` like a `429`, and halt with a single actionable instruction only once a lone sequential request still gets `401`. Token expiry is the one credential failure the agent cannot self-recover; it is a legitimate hard stop even in a hands-off run.

## The one rule that drives everything else

**One distinct visual PATTERN = one EDS block — and a section with NO pattern is NOT a block at all.** The content structure that lands in DA must follow **David's Model** (`davids-model.md`, bundled with this skill — the 15 rules mapped to this skill's contracts; cited as `D#N` throughout). Its first rule shapes everything here:

- **D1 — blocks aren't ideal for authoring.** A block is a table an author must maintain. A section whose content is plain prose — heading, paragraphs, an image, CTAs, with **no repeating units and no bespoke interactive structure** — is authored as **DEFAULT CONTENT** in its own section, never wrapped in a block. Its skin rides a minimal section-metadata `style` value (see Step 3); the section's semantics stay native `<h2>`/`<p>`/`<picture>`/`<a>`. Never create a `text`/`heading`/`image` block around bare default content — that is the D1 anti-pattern verbatim.
- **Blocks are for structure default content can't express:** repeating units (cards, FAQ, logos, team), genuinely bespoke compositions (a countdown, a stat band, a cinematic hero), and interactive components. For those, one distinct prototype pattern = one block. Don't abstract speculatively, and don't extract "patterns" across prototypes unless sections are genuinely the same pattern — each pattern's bespoke CSS can't be wrongly shared; violating this casually cost full resets (see ANTI-PATTERNS).

**The one deliberate exception — collapse SAME-PATTERN sections into one block + VARIANT classes.** When two or more sections are the same content pattern (card grids, prose/CTA bands, quotes, accordions) differing only in skin, emit ONE canonical block (`cards`, `text`, `quote`, `accordion`) and put each section's look behind a variant class (`class="cards brands"`), brand styling in the variant CSS. The block JS stays generic (classify cells by content); only the CSS differs per variant. This is the David's-Model library win (D9: small, reusable, variant-driven — not 20 bespoke names) and is proven to preserve fidelity. Keep genuinely-unique sections (a hero, a countdown widget) bespoke. Budget for it: variant CSS is careful work and some grids are count-specific.

The prototype is the visual spec. The block exists to AUTHOR its content — see **The ENCODE contract** below for what well-authored content looks like, and ANTI-PATTERNS for how a block must defensively PARSE it.

## Output you will produce

For a typical 5–10 page site:

- **One block per distinct prototype PATTERN** (D1/D9). A 5-page site with 6 sections each → typically ~8–14 blocks: prose bands land as default content, same-pattern sections share one block + variants, and only genuinely bespoke sections get their own block.
- **One EDS content page per prototype page.** Same number of pages.
- **Nav + footer documents** at `content/nav.html` and `content/footer.html` — authored content, deployed and published like any page, fetched by the stock `header`/`footer` blocks (D12: chrome is the canonical fragment use case).
- **Per-site `blocks/header` + `blocks/footer` CSS/JS** reproducing the prototype's chrome (see Step 6).
- **Updated `styles/styles.css`** with brand tokens lifted from the prototype's `:root`, a reset, the EDS section scaffold, a global button system (see "Lean on EDS button conventions" below), and the styles for the few section-metadata `style` values default-content sections use. Nothing more.
- **No shared utility modules.** No wave systems. No motion library. The prototype already encodes these per-section; keep them inside the owning block. Section-metadata `style` values stay a SMALL closed set (`dark`, `tinted`, …) used only by default-content sections — blocks keep painting their own sections.

## The ENCODE contract — what well-authored content looks like

What a content page emits, where David's Model is enforced (D1–D15): no nested block tables or spans, fully-qualified media and external URLs, no code as text, decoration on semantic inline tags (never a class or delimiter), one row per grouped item, section heads as default content the block reabsorbs, editorial images as authored content and decorative ones as CSS only, rehosted from the captured src. Rules, the reabsorb pattern and the image procedure: `reference/encode-contract.md` — read it before Step 2b and before authoring any content page. Gate: `node stardust/scripts/deploy/davids-model-lint.mjs content/`.

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
#    fs.writeFileSync('stardust/.work/prerender/<proto>.html', root.innerHTML)   # never write into samples/ (user input)
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

A useful pattern: dispatch a read-only exploration subagent with this exact ask where the harness offers one (Claude Code: the `Explore` agent at thoroughness=quick); otherwise run the search inline. You don't need a 22-pattern punch list — you need filenames + section names. **Resist the urge to "find shared patterns."** Pattern reuse will emerge organically when two sections turn out to be byte-identical.

**Fingerprint per-instance variation BEFORE writing block code (#90).** A section-name list is
copy-level; it does NOT reveal that instances *inside* a repeated group look different — an active
filter chip vs its outline siblings, a filled accent CTA among outline CTAs, image cards vs
image-less title-cards. Those are the details a copy-driven conversion silently flattens (a whole
grid of identical cards, one CTA styled like the rest), and the mandatory gates (one `<h1>`, grids
compute `grid`) still pass. So run the proactive probe up front:
`node stardust/scripts/deploy/style-fingerprint.mjs "file://<abs>/<proto>.html"`. For every group of
sibling instances it clusters each instance by a COMBINED signature — computed **style-delta**
(`background/border/color/background-image/weight/align`) AND **structural** (`hasImg`, `hasSvg`,
child count) — and reports any group with >1 cluster as a **candidate** per-instance variation for
the owning block to reproduce. It is advisory: it will also flag legitimate variation (a footer with
one bold link among plain ones), so filter false positives with judgment — but never flatten a real
variant (an active chip, an accent CTA, an image-less card) just because the block treats siblings uniformly.
The structural half is load-bearing: image-vs-image-less cards (and any `:has()`/`:not()`-driven
variant) share the same top-level computed style, so a style-only probe misses them — include the
structural signals. The manifest becomes the block author's checklist; this is the pre-block
complement to Step 10's post-deploy `content-diff` (which catches the same class of miss too late).

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Two triage questions come BEFORE naming, per section (record both in the conversion log):

1. **Is it a block at all (D1)?** No repeating units, no bespoke interactive structure → **default content** + a section-metadata `style` value. Not a block, no name needed. **Exception that overrides D1:** a section the dynamic inventory marks `client-only` (calculator, filter, comparison) or modal-bearing gets a dedicated block — flattening it into prose is the recorded way interactive structure was lost.
2. **Does it match a Block Collection pattern (D11)?** Hero, cards, columns, accordion, quote, table, embed, carousel/tabs — if yes, **mirror that block's name and content model** (the authoring shape and row semantics from `github.com/adobe/aem-block-collection`), even when the CSS stays fully bespoke. An author who has seen any EDS site can then author yours. Only sections matching no collection pattern get an invented name.

Naming rules (for the sections that ARE blocks and match no collection pattern):
- Block name = the prototype's `<section class="X">` value, kebab-cased (`hero`, `work`, `closing`, `approach`).
- **Never name a block after a reserved EDS class** (#15). `section`, `block`, `wrap`, and `button` are used by the runtime's section/decoration DOM, and names ending in `-wrapper` or `-container` collide with the wrapper/container classes `decorateBlock` derives (`.<name>-wrapper`, `.<name>-container`) — a block named `section` collides with `<div class="section">` and breaks decoration. When the prototype's section class is generic/reserved (one sample used `class="section"` twice), derive a semantic name from the section's `data-screen-label` / intent instead (`new-products`, `discover`) and carry any modifier like `tinted` as a block variant.
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

### 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

The dropped-CTA / role-swap / flattened-variant class has ONE root cause: the authored rows (ENCODE) and the block's `decorate()` (DECODE) are written independently and hoped to be inverses. Two moves close the loop up front; the in-loop `block-roundtrip` gate (#94, Step 8) then proves it closed.

**Emit the section schema — the shared ENCODE/DECODE contract (#93).** Once names are locked, generate the per-section contract both sides are written FROM:

```bash
node stardust/scripts/deploy/section-schema.mjs "http://localhost:8791/<prototype>.html" \
  --out stardust/eds-schema/<page>.json
```

Per section it emits the ordered role-classified inventory (heading / eyebrow / cta+href / body — the SAME classifier `content-diff` and `block-roundtrip` measure with, from `skills/deploy/scripts/content-inventory.mjs`) and the repeating-unit groups (count + per-unit composition: headings/ctas/imgs/textRuns, uniform or not). Use it on both sides:

- **ENCODE**: one row per repeat unit, fields in schema order; every schema item appears in the authored content. An item you deliberately drop is a decision recorded in the conversion log — never an accident.
- **DECODE**: the block's JSDoc cites its section's schema path; `decorate()` classifies exactly the roles the schema lists, and the schema's unit count is the post-decorate count assertion (#48/#52).

Cross-check `repeats[].uniform` against the #90 fingerprint: `uniform: false` means a per-instance variant (active chip, accent CTA, image-less card) the block must reproduce, not flatten.

**Pick the decode tier per section — template-slotted vs reconstructive (#95).** Reconstruction is where decode bugs live, so only reconstruct where authors need the structural freedom:

- **Template-slotted = NODE-slotting (fidelity by construction, editability by construction).** For fixed-composition sections whose structure never changes at authoring time (a bespoke hero, a cinematic band, a stat/countdown composition): `decorate()` holds the prototype section's inner DOM as a template literal whose text positions are **empty slot containers** (`<div class="headline"></div>`, `<div class="eyebrow"></div>`, `<div class="actions"></div>`, `<div class="media"></div>`), and MOVES the authored elements into them by role — the authored `<h1>` into `.headline`, the eyebrow `<p>` into `.eyebrow`, each CTA's `<p>` into `.actions`, the authored `<picture>` into `.media`. The wrapper carries the layout class; the authored element keeps its tag, its attributes and its identity. The decorated DOM ships structurally equal to the prototype, so the segmentation-bug class (#48/#52/#56/#76) cannot occur, AND every authored text stays inline-editable in Experience Workspace (EW1/EW2). **Value-slotting — copying authored TEXT into template nodes (`slot.textContent = cell.textContent`, `innerHTML` templates with `${text}` interpolation) — is banned:** it renders pixel-perfect and is 100 % uneditable in the workspace (every template-slotted block on a real site failed this way; anti-pattern 18). Editors still own every line of copy — the content page is unchanged and server-rendered (this is NOT client-injected chrome; #86 doesn't bite). Structure edits need a developer: the right trade for sections whose structure nobody edits.
- **Reconstructive (authorable structure).** For repeating/data sections where authors add/remove units (cards, FAQs, listings, menus): classify + segment defensively per #48/#50/#52 — and let the schema + round-trip gate carry the burden of proof.

Record the tier per block in the conversion log. Default: template-slotted for bespoke one-offs, reconstructive for repeat groups. **Both tiers are subject to the Experience Workspace editability contract (Step 8, EW1–EW10); the gate is `block-roundtrip --ew` (default on) / `ew-editability-probe.mjs`** — a block that passes the role round-trip but leaves a dead text is not done.

**Record two more things per section in the schema (D1/D11 + forward-compat):** sections triaged to default content in Step 2 carry `"defaultContent": true` (the encode side emits prose, not a table — the lint flags a block wrapping bare default content); and every block's authored shape must be expressible as one of the three component-model shapes — **simple** (one property per row), **key-value** (config), or **container** (own rows + one row per child) — so a later Universal Editor adoption needs no content migration (see aem.live "component model definitions"). A shape that fits none of the three is a signal the model is wrong, not that a fourth shape is needed.

### 3. Foundation

Rebrand `styles/styles.css`: replace the boilerplate's demo layer, keep its structural layer verbatim (the `body.appear` gate), lift `:root` tokens from the prototype; one full-bleed escape per template, one `style` value per section, the Experience Workspace edit-mode foundation, the header-height reservation and an eager, slot-reserved hero LCP image (CLS), the token-completeness gate and the favicon. Procedure: `reference/foundation.md` § 3.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

An `@font-face` for every named family, `head.html` untouched, every brand face self-hosted (with a licensing alert), axes and weights matched, metric-matched fallbacks chosen by classification and width: `reference/foundation.md` § 4.

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

`decorateButtons()` classes authored CTAs before any `decorate()` runs: block JS moves the CTA paragraphs, `styles.css` restyles the boilerplate's button rules, variants scope to the block class: `reference/foundation.md` § 5.

### 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Nav and footer content are authored DA documents (`content/nav.html`, `content/footer.html`, on the publish roster), presented by template-slotted `blocks/header` / `blocks/footer`; hover surfaces, CSP limits and per-page variants: `reference/foundation.md` § 6.

### 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster (utility pages, services, case studies, etc.). Each agent owns a non-overlapping set of new blocks and content pages. Three to four parallel agents is the sweet spot. Without subagents, run the clusters one after another on the same briefs (`../stardust/SKILL.md` § Hands-off mode, fan-out rule).

**Brief size and reading discipline.** The brief points at files — `stardust/eds-schema/<page>.json`, the conversion log's triage rows for its pages, this card's § 7, `reference/block-js.md`, `davids-model.md` — and never pastes reference text into the prompt. Each agent reads by section (list the headings, then read the range it needs), not the whole file: across twelve field migrations this document (~27k words) was read end to end about twenty times per run, once per dispatched agent; in one recorded run the two conversion agents the harness's no-progress watchdog killed carried the fattest briefs, while a re-dispatch with a lean brief and line-ranged reads finished the same pages. Long-running steps (captures, gates, batch pushes) run in the background with a progress file the agent appends to per page, so the coordinator can read progress instead of waiting blind. The coordinator's own waiting follows the master skill's wait discipline: nothing runs in the foreground past ~2 minutes, no single `sleep` reaches 5 minutes (the prompt-cache window — at deploy-phase context sizes each expiry re-writes the whole prefix), and progress is read from the file at most every 4 minutes.

The brief template:

> Per the project's locked direction: each prototype `<section>` becomes its own EDS block. Lift the prototype's `<style>` for that section verbatim, scope it under the block class (`.block-name .x` instead of `section.x .y`), and rebuild the prototype's DOM through a `decorate(block)` function that consumes EDS table-block input.
>
> **You own**: prototypes [list], content pages [list], sections [list].
>
> **Existing blocks — REUSE, do not recreate**: [list with one-line authoring shape per block].
>
> **Brand tokens** are global in `styles/styles.css`; do not redefine.
>
> **Round-trip contract (#93/#94)**: the page's authored rows AND your block's decode are both written from `stardust/eds-schema/<page>.json` (roles + repeat units — Step 2b); cite the schema path in the block JSDoc. After writing each block, run `node stardust/scripts/deploy/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` — the block is NOT done until it exits 0 (0 structural 🔴).
>
> **Section layout — reproduce the prototype's max-width container (#13)**: if the prototype section wraps its content in a centered max-width container (`<div class="wrap">` / `.container` / `.inner`), your block MUST recreate it — build the content into a `.wrap` div (`block.replaceChildren(wrap)`), so the colored/section background bleeds full-width but the **content** stays within the page max-width. Only render content edge-to-edge where the prototype section itself is full-bleed (no inner wrapper). Getting this wrong is invisible at ≤1440px and only shows at wide viewports.
>
> **Mobile overrides must match variant specificity (#109)**: a generic mobile rule (`.cards .card-list`) loses to a desktop variant rule (`.cards.color .card-list`) in ANY media query — the media query changes *when* a rule applies, never *how strongly*. Write every mobile override at the variant's own specificity (one override per variant, or `:where()` the variant selectors down). The trap is silent on single-variant blocks and bites the moment a rollout adds variants. Two more mobile/CSS traps: **un-floating columns in a media query loses the float's BFC margin containment (#113)** — the last child's margin escapes (mobile-only, a few px); add `display: flow-root` to the un-floating override. And **a wrapper reset can out-specify the block's own rules (#114)** — `footer .footer > div { padding: 0 }` beats `footer .f-root { padding: … }` silently; keep resets at LOWER specificity than the rules they might shadow (`:where()` them down).
>
> **Flex/grid children — no `<br>`, no bare child rules**: inside a flex or grid container an authored `<br>` becomes a SIZED flex item (recorded: a two-line label splayed across a 120px tile by a ~26px `<br>` item) — emit separate elements instead. And never write a bare `.label > span { display: block }`-style child rule in variant CSS: it out-specifies a lower-specificity `.explore { display: none }` and resurrects hidden elements — scope with `:not()` against every state class the block owns, and verify with a computed-style dump of the child list, not by eye.
>
> **Images — `<image-slot>` placeholders (#2)**: claude-design prototypes use `<image-slot>` custom elements as image drop-targets; there are usually NO real image assets. Treat each image as an **optional** authored cell holding a `<picture>`/`<img>` (`const pic = cell.querySelector('picture, img'); if (pic) …`). When the cell is empty, fall back to the prototype's background treatment (e.g. dark `--ink`, or a placeholder rectangle) via the block CSS so the section still looks right with no image. Leave image cells EMPTY in the authoring snippet.
>
> **Scroll-reveal / JS-hidden content (#14)**: if the prototype hides content behind a class an inline `<script>` toggles on scroll (`.reveal { opacity:0 }` + an IntersectionObserver that adds `.in`), do NOT lift the `opacity:0` — the prototype script does not run in EDS, so the content would be **permanently invisible**. Render it visible; drop the reveal (keep only hover/`:hover` transitions). Honor `prefers-reduced-motion`.
>
> **Interactive / component-driven sections (#17)**: when a section is driven by a component (state, a list loop like `<sc-for>`, conditionals like `<sc-if>`, `{{ }}` bindings, a `data-count` counter, a tab/selector), split it: **data → authorable rows** (one row per list item, with the item's fields as cells) and **behavior → block JS**. Unlike static *fragments*, **block JS runs** — so `decorate()` is the right place to wire click handlers, an IntersectionObserver count-up, tab switching, etc. Render the default/active state in markup; drive the rest from JS-held local state. `{{ }}`/`<sc-for>`/`<sc-if>` are NOT EDS syntax — read them as "loop these rows" / "show one state". **The same split applies to blocks whose data arrives at runtime** — `stardust/dynamic-features.md` rows with disposition `data-fed` or `index-backed`: the block's authored rows ARE the fallback (rendered before any fetch resolves, and what ships if it never does), `decorate()` fetches the `Source` / index and re-renders, and the brief names the endpoint, the fields the cards need, and the failure behaviour. Never author a block whose only content arrives by fetch. The inventory is brief input for every page: `#modal` link markers, player URLs, per-page form endpoints in `scripts/site-config.js`. Patterns: `skills/dynamics/reference/patterns.md`.
>
> **David's Model (the authored-structure contract — `davids-model.md`)**: a prose section with no repeating units and no bespoke structure is DEFAULT CONTENT, not a block (D1 — the Step-2 triage in the conversion log says which of your sections these are); no nested block tables (D2); blocks stay ≤4 columns (D10); if your section matches a Block Collection pattern the conversion log names, follow that block's authoring shape (D11); no code visible as text in cells (D15). Your pages must pass `node stardust/scripts/deploy/davids-model-lint.mjs content/<page>.html` with 0 🔴.
>
> **Buttons**: do NOT manufacture button anchors. Author CTAs paragraph-wrapped as `<strong><a>` (primary) or `<em><a>` (secondary) in the content page — `decorateButtons()` classes them (`a.button.primary`/`.secondary`) BEFORE your `decorate()` runs; in block JS, MOVE the CTA paragraph into a `.actions` wrapper (`actions.append(a.closest('p') || a)`) — never clone it (EW3). Block CSS only overrides global button styles when something is genuinely different (e.g. larger size). Text links with flourish (wavelength underline) are NOT buttons — leave as plain `<a>` and style per-block.
>
> **Experience Workspace editability contract (Step 8, EW1–EW10) — every block you write obeys it and passes the EW gate before it is done.** MOVE authored `h1–h6/p/ul/ol/picture` into generated wrappers (`wrap.append(heading)`); never rebuild from `textContent`/`innerHTML`, never `cloneNode` + discard, never retag, never `.trim()` displayed text (EW1). Wrappers carry the layout classes; style the authored element through the wrapper with DESCENDANT selectors (`.headline :is(h2, h3)`), never a class on the authored element and never `>`/`:first-child`/`:nth-child` on the path to it (EW2). CTAs move as their `<p>` (EW3). Presentational clones (loop slides, marquee copies) get `stripInstrumentation()` (EW4). Text you cannot make editable is declared with an `@ew-exempt` JSDoc tag, never dropped silently (EW5). A `<button>`/`<summary>` cannot host the editor (EW7). `block-roundtrip` runs with `--ew` by default: a dead non-exempt text or a duplicated index is a 🔴.
>
> **EDS block convention**: each block at `blocks/<name>/<name>.{js,css}`. JS exports `default async function decorate(block)`. Block input is `<div class="block-name"><div>row<div>cell</div></div>…</div>` (the runtime adds `.block` + `data-block-name` and nests it in `.<name>-wrapper` before your JS runs). CSS scoped under `.block-name`. Inline SVG markup per-block (no shared utility). Honor `prefers-reduced-motion`.
>
> **EDS content page format**: NO `<head>` element (project `head.html` is injected by EDS), empty `<header></header>`/`<footer></footer>`, each top-level `<div>` inside `<main>` is one section holding one block OR default content, section-metadata only as a Step-3 `style` value on default-content sections, no `<style>`/`<script>`, fully-qualified image URLs.
>
> **Done criteria**: [list of paths]. Return a list of new blocks + one-line summary per page.

Agents do not need to coordinate on shared blocks — the brief tells them which existing blocks to reuse.

### 8. Block JS scaffold

The `decorate(block)` scaffold; the Experience Workspace editability contract (EW1–EW10: move authored elements, never rebuild them; style through wrappers with descendant selectors; CTAs move as their `<p>`; clones strip instrumentation; exempt text is declared) and its gate, `block-roundtrip --ew`; and the decode rules every block follows (DA-flattened single-cell default, heading-driven segmentation, one `<h1>`, consume every element type, interactive state): `reference/block-js.md`. Every block author reads it before writing code.

### 9. Content page scaffold

**Every content page MUST begin with a `metadata` block (#34).** At minimum it carries a **Title** (~50–60 chars: brand + primary keyword/location, derived from the page's real `<h1>` — NEVER a block or section name) and a **Description** (~150–160 chars summarising the page). Skip it and EDS derives `<title>` from the first content cell — junk like `<title>Hero</title>` / `<title>Quiz</title>` — and emits no description; and because EDS **mirrors Title/Description into `og:`/`twitter:`**, that junk poisons social/AI share cards too. Authoring this one block resolves title, description, og:title, og:description, twitter:title and twitter:description at once. `nav` / `footer` path overrides / `Robots` rows go in the same block when needed (the pipeline extracts the block wherever it sits in `<main>` — first or last). The `header`/`footer` blocks load `/nav` and `/footer` automatically; no other per-page configuration is required.

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

(Only the **mount-based** deploy tolerates a full `<!DOCTYPE html><html>…</html>` document — it strips `<head>` on ingestion. For the Source-API/`curl` path, emit the body fragment above. Before any DA write, run `node stardust/scripts/deploy/sanitise.js <file>` to encode non-ASCII — `® · – —`, accents, emoji — to HTML entities, or DA corrupts them to U+FFFD.)

To give a specific page different chrome, add `nav` and/or `footer` path rows to that same `metadata` block (the `header`/`footer` blocks read them — Step 6):

```html
    <div>
      <div class="metadata">
        <div><div>nav</div><div>/nav-minimal</div></div>
      </div>
    </div>
```

**Multi-view SPA → multiple pages (#29).** If the prototype is a single-page app with several views that have **different chrome** (e.g. a marketing home with a full nav vs. a signed-in dashboard with a minimal bar), convert **each view to its own EDS page** (pre-render each per #27) and link them with real hrefs. Under vanilla EDS this is trivial: author a second nav document (`content/nav-app.html`) and point the dashboard pages at it with `nav: /nav-app` metadata — one header block, two authored navs. Share `/footer` if the footer is the same. (Harness caveat: the `metadata` block is consumed by the delivery pipeline into a `<head>` `<meta>`, but the local harness has no pipeline — so the `nav` override won't apply locally; verify per-page chrome on the deployed preview.)

**Do NOT emit a `<head>` element.** EDS content pages are markdown-equivalent fragments: the document metadata (title, meta, stylesheets, scripts) lives in the project's `head.html`, which EDS injects at delivery time. A `<head>` block in a content page is dead weight at best and a duplication conflict at worst.

When the prototype has **real** images, AUTHORED content `<img src>` URLs must point at a host the preview ingester can fetch — **prefer `https://content.da.live/{org}/{repo}/media/<scope>/<file>`** (branch-independent; upload the binary via the Source API first — see **The ENCODE contract → Images**). A fully-qualified `https://main--<repo>--<owner>.aem.page/…` also ingests but is branch-locked. **NEVER** a repo-relative `/img/…` in authored content — it delivers as `<img src="about:error">`. **This applies ONLY to authored content `<img>` — NOT to fixed assets referenced as CSS backgrounds from block JS/CSS (#67): those stay root-relative `/img/<brand>/…` (anti-pattern 9b), browser-fetched and never ingested.** When the prototype uses **`<image-slot>` placeholders** (no real assets — common for claude-design prototypes), leave the image cells EMPTY (`<div></div>`); the block CSS background fallback (Step 7) renders the section correctly without an image. The author drops real images in later.

## Local QA before deploy (no DA)

`aem up` does not render new paths: build the self-contained harness (`build-harness.mjs`), then run the whole-page round-trip gate, the edit-mode simulation and the stock `qa-gate.mjs`. CLS, `content-diff` and the visual eyeball run on the deployed URL only. Procedure: `reference/local-qa.md`.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

On the deployed URL only: `content-diff` (advisory), the full-page eyeball at desktop and mobile (load-bearing), the CLS probe, the chrome crop gate (≥ 98 %), the content-cap row, geometry-fix hygiene and, at delivery, the all-pages published-origin gate. Procedure and how to read each output: `reference/reconcile.md`.

## Anti-patterns (lessons paid for the hard way)

Nineteen recorded ways a conversion ends in a full reset — variants for distinct sections, shared utility modules, hand-built button anchors, absolute-origin URLs in block code, font loads in `head.html`, value-slotting, classes on authored elements and more: `reference/anti-patterns.md`. Read it once before Step 2.

## Checklist (per page)

The per-page done list — lint, round-trip and EW gates, metadata block, one `<h1>`, ENCODE shapes, chrome crop gate, internal links localized: `reference/checklist.md`. A page is not deployed until every box holds.

## When you finish

Update `stardust/eds-conversion-log.md` (or create one) with: final block inventory, decisions locked, anti-patterns avoided this run, anything site-specific the next person should know. The log is the running history of "why does this look the way it does."

## References

- `davids-model.md` — David's Model (aem.live) distilled: the 15 rules (`D#N`), each mapped to the contract or gate in this skill that enforces it, plus the component-model shape compatibility notes.
- `da-deploy-protocol.md` — the curl-based DA Source API deploy contract (auth, source PUT, preview/publish, asset-before-preview ordering).
- `(#NN)` citations in this document and in the deploy/diff scripts point to the deploy improvement ledger (findings #1–#80), removed from the tree; read it with `git show 940b8795:plugins/stardust/notes/deploy-improvements-archive.md`. New findings go to `skills/stardust/reference/learnings.md`.
- `reference/encode-contract.md`, `foundation.md` (Steps 3–6), `block-js.md` (Step 8), `local-qa.md`, `reconcile.md` (Step 10), `anti-patterns.md`, `checklist.md` — the step bodies, read when the card's step points there.
- `scripts/ew-editability-probe.mjs` — the Experience Workspace editability gate (`reference/block-js.md` § contract): instrument → decorate → count survivors; `--simulate-editor` edit-mode drift; URL and `--content` harness modes; reads `@ew-exempt` JSDoc tags.
- Experience Workspace sources the contract was verified against (read them when the mechanism seems to have changed): da.live `blocks/canvas/editor-utils/editor-utils.js` (`getInstrumentedHTML` — what is stamped), `blocks/canvas/ew-editor-wysiwyg/ew-editor-wysiwyg.js`, `blocks/shared/prose2aem.js` (cells keep their `<p>`); da-nx `nx/public/plugins/quick-edit/quick-edit.js` (`setBody` → `loadPage` → `restoreBlockIndices`), `src/prose.js` (`createEditor` swap shape), `src/images.js`, `src/dom-index.js`, `src/selection.js` (cursor math on `textContent` length).
