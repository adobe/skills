---
name: deploy
description: Convert per-page styled HTML prototypes (stardust under stardust/prototypes/**, or claude-design / Mobirise / Relume / Lovable / v0 / Figma-derived pages, or JSX prototypes pre-rendered to HTML, often under samples/) into Edge Delivery Services (EDS / AEM) blocks and content pages, then deploy via DA. Each prototype section becomes one EDS block; the prototype's per-section CSS becomes that block's CSS scoped under the block class. Use when the user wants to lift styled per-page HTML prototypes into a working EDS site under blocks/ and content/.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and playwright-cli on PATH.
metadata:
  impeccable: none
---

# stardust:deploy — prototypes → EDS/AEM

## Operator card

Read this card, then the one section you are at — never the whole skill. Every `reference/` chapter opens with its own TOC; read one `##` at a time. No deploy script ships a deadline flag; long steps run in the background with a progress file (Step 7).

| # | Step | Command / artefact | Pass bar |
|---|---|---|---|
| 0 | Probes | `node -e "import('playwright').then(()=>process.exit(0))"`; read the target's `scripts/aem.js` + `scripts/scripts.js` → `stardust/runtime-contract.json`; `pipeline-mimic.mjs --probe --org <org> --repo <repo> --branch <branch>` → `#pipeline` (optional; 2 = no verdict) | contract written before any code |
| 1 | Audit | pre-render JSX to `stardust/.work/prerender/`; `node skills/deploy/scripts/style-fingerprint.mjs "file://<abs>/<proto>.html"` | per-page section list + variation manifest |
| 2 | Names + reuse | D1/D11 triage per section → `stardust/eds-conversion-log.md` | names locked in writing before any block code |
| 2b | Schema + tier | `node skills/deploy/scripts/section-schema.mjs "<protoURL>" --out stardust/eds-schema/<page>.json` | schema + decode tier recorded per section |
| 3 | Foundation | `styles/styles.css` — tokens, reset, scaffold, style values (budgeted), edit-mode snippets, `--nav-height`, favicon | token-completeness grep prints nothing |
| 4 | Fonts | `styles/fonts.css` + `-fallback` faces in `styles.css`; woff2 under `fonts/` | every named family shipped; `head.html` untouched |
| 5 | Buttons | restyle the boilerplate `a.button` rules; block JS MOVES CTA paragraphs | no manufactured anchors |
| 6 | Chrome | `content/nav.html`, `content/footer.html`, `blocks/header`, `blocks/footer` | three-section nav contract kept |
| 7 | Block agents | one brief per archetype cluster from the template — pointers only | briefs name files + headings, never inline text |
| 8 | Block JS | `node skills/deploy/scripts/block-lint.mjs blocks/ --styles styles/styles.css`; `node skills/deploy/scripts/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` | block-lint exit 0; round-trip exit 0 — no structural 🔴, no dead text, no duplicated index; `code-sync-verify.mjs --lint` exit 0 before the commit |
| 9 | Content pages | `node skills/deploy/scripts/davids-model-lint.mjs content/ --icons-dir icons --styles styles/styles.css`; `sanitise.js <file>` | lint exit 0 + whole-page round-trip clean → first PUT + preview (URL in the first status line) |
| QA | Local harness | `block-lint.mjs blocks/ --styles styles/styles.css`; `pipeline-mimic.mjs --self-test`; `build-harness.mjs` → `qa-gate.mjs <harnessURL> --schema stardust/eds-schema/<page>.json`; whole-page `block-roundtrip --strict`; `render-harness.mjs content/<page>.html <out.png> --fragments content/`; `ew-editability-probe.mjs --simulate-editor` | block-lint + qa-gate exit 0; no edit-mode drift |
| D | Deploy | `node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> --content content --require-code-synced` (preview), then a separate `… --publish` run on pass; `localize-links.mjs --source-host <live-host> --check`; `ai-readability.mjs --origin <live> <paths>`; progress: `skills/stardust/scripts/progress.mjs read stardust/.work/deploy/deploy-batch.progress.json` | per-page atomic contract passed; AI-readability ≥ 98 |
| 10 | Deployed reconcile | `node skills/diff/scripts/content-diff.mjs "<protoURL>" "<deployedURL>" --profile eds` (advisory); fetch-delayed CLS probe; `skills/replica/scripts/crop-compare.mjs` on header/footer bands; `code-sync-verify.mjs --org <org> --repo <repo> --ref <branch>` exit 0 first | CLS < 0.1; chrome bands within the crop gate; deployed eyeball faithful |

Outputs: `blocks/<name>/<name>.{js,css}` · `content/**/*.html` (+ `nav.html`, `footer.html`) · `styles/styles.css`, `styles/fonts.css`, `fonts/*.woff2` · `stardust/runtime-contract.json` · `stardust/eds-schema/<page>.json` · `stardust/eds-conversion-log.md` · `content/.deploy-ledger.json`.

| At step | Read |
|---|---|
| 0 | this file § Playwright re-probe, § Runtime-detection probe; `reference/target-runtime.md` § Target runtime |
| 1–2b | `reference/audit-and-naming.md` § 1. Audit / § 2. Decide names + reuse / § 2b. Section schema + decode tier; `reference/encode-contract.md` § Structural rules |
| 3 | `reference/foundation.md` § 3. Foundation, § Header reservation and hero CLS; `reference/section-rhythm.md` when spacing varies per band; before deploy § Token-completeness gate, § Favicon |
| 4 | `reference/fonts-and-cls.md` § 0 through § 4 |
| 5 | `reference/buttons.md` § 5, § Block JS — move the CTA paragraph |
| 6 | `reference/chrome.md` § The nav/footer documents, § The header/footer blocks, § What still cannot run, § Chrome states and variants |
| 7 | `reference/block-agents-brief.md` § The brief template, § Shared cores and variants; `davids-model.md` |
| 8 | `reference/block-js-scaffold.md` § 8. Block JS scaffold, § Experience Workspace editability contract, § Runtime order, § Decode rules; `da-deploy-protocol.md` § Code push gates before the commit |
| 9 | `reference/content-page-scaffold.md` § 9. Content page scaffold; `reference/encode-contract.md` § Authoring shapes, § Pipeline-sensitive shapes, § Images |
| QA | `reference/local-qa.md` § Gates, § Local-QA scope boundary; `reference/pipeline-facts.md` § Local emulation, § Probe |
| D | `da-deploy-protocol.md` § Delivery pipeline, § Deploy (DA Source API + curl), § Two clocks; § DA_TOKEN lifecycle (`da-token-check.mjs`) before the first token read |
| 10 | `reference/deployed-reconcile.md` § The six reconcile checks, § Reading content-diff; `da-deploy-protocol.md` § Code push gates |
| any failure | `reference/anti-patterns.md` (by group); `reference/checklist.md` before each DA push |

## When to use

The user has:
1. **Per-page styled HTML prototypes** — one file per page, each carrying its own CSS. Accept any of these shapes:
   - **Single-file with inline `<style>`** and `:root` tokens + semantic `<section class="…">` — convert directly.
   - **External per-page `.css`** (the `<style>` lives in a sibling stylesheet). Read the linked CSS as you would an inline `<style>`.
   - **`<x-dc>` document-content with everything inline-styled** — lift inline styles into a scoped block stylesheet.
   - **React/JSX prototypes** (an HTML shell that mounts `.jsx` components at runtime). **Pre-render to static HTML first** (run it, or screenshot + read the JSX to reconstruct the DOM); you cannot decorate a shell that has no server-rendered `<main>`.
   Discover the prototype path (`stardust/prototypes/**`, `samples/<Name>/`); never hard-code it.
2. An EDS project at the repo root — **vanilla `aem-boilerplate`** (`github.com/adobe/aem-boilerplate`): `scripts/aem.js` + `scripts/scripts.js`, `blocks/` with `header`/`footer`/`fragment`, `styles/styles.css` + `styles/fonts.css`, `head.html`. This is the ONLY runtime this skill targets — no runtime files are ever ported, vendored, or edited.
3. A goal to convert: prototypes → authorable EDS blocks + EDS content pages under `content/**`.

If the user has prototypes but no EDS scaffolding, stop and ask whether to scaffold from `adobe/aem-boilerplate` (template as-is). EDS but no prototypes: this skill doesn't apply.

**Flow guard (stardust projects).** When `stardust/state.json` exists but has no `flow` and the ask is a migration (a URL plus "migrate" / "to EDS" / "re-platform"), stop before Step 1: print the master skill's two-flow table (`skills/stardust/SKILL.md` § Two migration flows) and hand back to its routing, which stamps `flow` (`skills/stardust/reference/state-machine.md` § Flow keys). Hand-authored prototypes with no `state.json` are this skill's standalone use.

## Target runtime — vanilla aem-boilerplate (compressed)

The stock boilerplate provides everything the conversion needs; the runtime is never modified. The load chain `head.html` → `scripts.js` → `loadEager` → `loadLazy` → `loadDelayed` gives you: the **section DOM** (`div.section` › `div.default-content-wrapper` / `div.<name>-wrapper` › `div.<name>.block`, hidden until loaded); **cell normalization** — `wrapTextNodes` folds a media-led or unlisted-first-child cell into ONE `<p>` before `decorate()` runs (#104); the **body gate** (`body { display: none }` / `body.appear`) — keep it, and load the real `scripts/scripts.js` in every off-pipeline render; **buttons** via `decorateButtons()` on author-formatted links only (Step 5); **chrome** as `header`/`footer` blocks fetching `/nav` and `/footer` (Step 6); **fonts** via `styles/fonts.css` + `loadFonts()` with the metric-matched fallbacks in `styles.css` (Step 4); the project-owned **`buildAutoBlocks()`** hook; and the **Experience Workspace instrumentation** — the inline editor stamps `data-prose-index` on the outermost authored elements, re-runs `loadPage()`, and only elements that still carry their index become editable (Step 8, EW1–EW10). Clones drift — the Runtime-detection probe below records what THIS target does. Full text: `reference/target-runtime.md`.

## Playwright re-probe (run before anything that renders)

`--no-save` playwright installs are pruned by any later real `npm i` (extract SKILL.md § Setup). Before the Local-QA harness or any probe below, run the card's row-0 probe from the project root and re-install (`npm i -D playwright --no-save --legacy-peer-deps`) on failure.

## Runtime-detection probe (run before Step 1 — write `stardust/runtime-contract.json`)

Boilerplate clones drift (button classes, wrapper names, buttonization rules), and a wrong assumption here is **silent and sitewide**. Before converting anything, read the TARGET's own `scripts/scripts.js` + `scripts/aem.js` — what the button decorator emits and requires, how `decorateBlock` wraps blocks — and record the answers:

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

Block CSS/JS generation and the Local-QA harness read this contract. Values above = current `adobe/aem-boilerplate` main; the two known drift axes:
- **`buttonClasses`** — current main emits `a.button` (+ `.primary`/`.secondary`/`.accent`) inside `p.button-wrapper`; older clones emit `p.button-container`, and some buttonize a bare `<a>` alone in a paragraph (`bare-links-too`) where current main requires authored `<strong>`/`<em>`.
- **`blockWrapperClass`** — `decorateBlock` adds `.block` + `data-block-name` and wraps the block in `div.<name>-wrapper` (section gains `.<name>-container`). Scope block CSS under `.<name>` (the class every vintage sets); confirm by asserting a grid container computes `display: grid` in a headless render (a wrong guess degrades every grid to `display: block` while typography still looks fine).

When `emptySectionCollapse` is true (a metadata-only section is consumed into `<head>` and leaves an empty padded band), add `main .section:empty { display: none }` to the foundation as the fallback — the rule is to never author the metadata block alone (Step 9).

## The one rule that drives everything else

**One distinct visual PATTERN = one EDS block — and a section with NO pattern is NOT a block at all.** The content structure that lands in DA follows **David's Model** (`davids-model.md` — the 15 rules mapped to this skill's contracts; cited as `D#N`). Its first rule shapes everything here:

- **D1 — blocks aren't ideal for authoring.** A block is a table an author must maintain. A section of plain prose — heading, paragraphs, an image, CTAs, with **no repeating units and no bespoke interactive structure** — is **DEFAULT CONTENT** in its own section, never wrapped in a block; its skin rides a minimal section-metadata `style` value (Step 3) and its semantics stay native `<h2>`/`<p>`/`<picture>`/`<a>`. Never wrap bare default content in a `text`/`heading`/`image` block (the D1 anti-pattern).
- **Blocks are for structure default content can't express:** repeating units (cards, FAQ, logos, team), bespoke compositions (a countdown, a stat band, a cinematic hero) and interactive components — one distinct prototype pattern = one block. Don't abstract speculatively across prototypes unless sections are the same pattern — bespoke CSS can't be wrongly shared (`reference/anti-patterns.md` § Structure and decisions).

**The one deliberate exception — collapse SAME-PATTERN sections into one block + VARIANT classes.** When two or more sections share a content pattern (card grids, prose/CTA bands, quotes, accordions) and differ only in skin, emit ONE canonical block (`cards`, `text`, `quote`, `accordion`) with each section's look behind a variant class (`class="cards brands"`). The block JS stays generic (classify cells by content); only the CSS differs per variant. (D9.) Keep genuinely-unique sections bespoke; budget for variant CSS — some grids are count-specific.

The prototype is the visual spec. The block exists to AUTHOR its content — **The ENCODE contract** below says what well-authored content looks like; `reference/anti-patterns.md` how a block defensively PARSES it.

## Output you will produce

For a typical 5–10 page site:

- **One block per distinct prototype PATTERN** (D1/D9). A 5-page site with 6 sections each → ~8–14 blocks: prose bands land as default content, same-pattern sections share one block + variants, only bespoke sections get their own.
- **One EDS content page per prototype page.**
- **Nav + footer documents** at `content/nav.html` and `content/footer.html` — authored content deployed like any page, fetched by the stock `header`/`footer` blocks (D12).
- **Per-site `blocks/header` + `blocks/footer` CSS/JS** reproducing the prototype's chrome (Step 6).
- **Updated `styles/styles.css`** with brand tokens lifted from the prototype's `:root`, a reset, the EDS section scaffold, a global button system (Step 5), and the styles for the few section-metadata `style` values default-content sections use. Nothing more.
- **No shared utility modules, wave systems or motion library** — keep them inside the owning block.

## The ENCODE contract — ten bullets

The decode side lives in `reference/anti-patterns.md` and `reference/block-js-scaffold.md`; this is the encode side — what the content page EMITS — and where David's Model is enforced (`davids-model.md`; gate: the Step 9 `davids-model-lint` command exits 0 before any DA write). Full text with every citation, § Section heads and § Images: `reference/encode-contract.md`.

1. **Decoration that must survive DA rides a semantic inline tag** (`<strong>`, `<em>`, `<code>`, `<a>`, `<picture>`, source `<sup>`/`<sub>`, `<del>`; never `<u>`, `<span>`) with one permitted meaning each — never a class, never an invented delimiter; a sub-field leads its cell with the field's tag.
2. **No nested block tables (D2), no spans beyond the block-name header (D3), blocks stay ≤ 4 columns (D10)**; section styles and block variants stay inside the vocabulary budget (`reference/foundation.md` § 3. Foundation).
3. **URLs:** fully-qualified for media and external targets (D4); internal links to migrated pages root-relative, extensionless, no trailing slash — `localize-links.mjs` rewrites them.
4. **No code visible as text (D15)** — including script bodies a scraper lifted as copy; video/embed URLs stay plain links for `buildAutoBlocks()` (D1); alt text describes the image only (D13).
5. **Key facts live in server-rendered page content, never solely in chrome or a fragment (#86), and `decorate()` adds no words to the DOM (#100)** — `reference/ai-readability.md`.
6. **No raw presentational HTML:** no design-added `<sup>`, no layout `<br>` (headings included — stripped), no spacer vehicles (#112 — the ladder in `reference/encode-contract.md` § Authoring shapes), never an `<hr>` — the section delimiter (#119); pipeline-rewritten shapes: § Pipeline-sensitive shapes there.
7. **Grouped item sets are one row per item; lists and FAQs are rows, not nested lists or one blob (D5).**
8. **The section head above a repeating block is default content the block reabsorbs by MOVING the wrapper's children (D1, EW8)** — zero pixel change.
9. **Buttons follow the emphasis convention (D6)** — `<strong><a>` primary, `<em><a>` secondary, `<em><strong><a>` accent; headings form a real outline with one `<h1>`; metadata is name/value config only (D14); site-wide constants are never per-page rows (`reference/encode-contract.md` § Structural rules).
10. **Images:** editorial imagery (hero/CTA backgrounds included) is uploaded to DA `/media` and authored as a `content.da.live` `<img>` with alt; decorative treatments and fixed brand assets are CSS only; verify the delivered `.plain.html` img/alt count; verify source URLs with the recorded fetch technique, rehost blocked assets from the CAPTURED src, keep SVGs pure-vector and small (#2, #99, #103, #118).

## Steps

Each step is a one-paragraph procedure; full text, citations and code live in the chapter named at its end. Read that chapter's `##` before the step — never the whole chapter.

### 1. Audit (light)

Normalize the input to static HTML first: pre-render JSX prototypes by serving their own folder and capturing `#root` into `stardust/.work/prerender/` (#24); seed persisted state to reach routed or signed-in views (#27). Read every prototype's `<main>` and produce a per-page section list — filenames + section names, not a pattern punch list; reuse emerges when two sections are byte-identical. Then fingerprint per-instance variation with `style-fingerprint.mjs` before any block code (#90): its manifest is the block author's checklist for the per-instance variation a copy-driven conversion flattens. Before this step read `reference/audit-and-naming.md` § 1. Audit and § Fingerprint per-instance variation.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Per section, two triage questions precede naming and are recorded in the conversion log: is it a block at all (D1 — no repeating units and no bespoke interactive structure means default content + a section `style` value; `client-only` and modal-bearing sections override this), and does it match a Block Collection pattern (D11 — mirror that block's name and content model). Name the rest from the prototype's section class, never a reserved EDS class (#15); one block for identical treatments across pages, archetype-prefixed blocks for different ones. Scale the ceremony to the page count — a single-page site just locks `block name = section class`; a multi-page site gets a handful of naming questions. Lock the answers in `stardust/eds-conversion-log.md` — the highest-leverage step. Before this step read `reference/audit-and-naming.md` § 2. Decide names + reuse.

### 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

Emit the per-section contract both sides are written from: `node skills/deploy/scripts/section-schema.mjs "<protoURL>" --out stardust/eds-schema/<page>.json` (roles + repeat units — the classifier `content-diff` and `block-roundtrip` measure with). ENCODE authors one row per repeat unit in schema order; DECODE cites the schema path in the block JSDoc and asserts its unit count post-decorate. Pick the decode tier per section: template-slotted NODE-slotting for fixed compositions (authored elements MOVED into empty slot containers — value-slotting copies of `textContent` are banned, anti-pattern 18), reconstructive for repeat groups authors edit. Record the tier, `defaultContent` flags and the component-model shape (simple / key-value / container) per section. Both tiers obey the Experience Workspace editability contract (Step 8). Before this step read `reference/audit-and-naming.md` § 2b. Section schema + decode tier.

### 3. Foundation

Rebrand `styles/styles.css` — lift the prototype's `:root` tokens verbatim, write the reset (#106 `border-box`, #36 `img`), retune the `main > .section` scaffold, define a SMALL closed set of section `style` values for default-content sections (one per section #120; scoped empty-section overrides #121; contained child margins), the global button system (Step 5), the three `.prosemirror-editor` edit-mode snippets (EW3/EW6/EW10) and the header reservation (`--nav-height` per breakpoint #81; overlay chrome reserves nothing #108; block DOM never emits `<header>` #107; the hero eager-loads its LCP image and reserves its media slot #100 — CLS probed on the DEPLOYED URL only #101). Preserve the boilerplate's STRUCTURAL layer verbatim — body gate and chrome reservation; `scripts/scripts.js` stays stock except `buildAutoBlocks()`. Gate before deploy: every `var(--x)` a block references is defined in `:root` (#91). Ship the favicon (§ Favicon) — the one permitted `head.html` addition. Before this step read `reference/foundation.md` § 3. Foundation and § Header reservation and hero CLS; before deploy § Token-completeness gate and § Favicon.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Ship an `@font-face` for EVERY named family (#65) and self-host every brand face — proprietary ones too, with the licensing alert in three places (#80) — matching the axes the prototype loaded (#30), static `@fontsource/<name>` files plus computed metric overrides for non-variable fonts (#11). Brand `@font-face` lives in `styles/fonts.css` (loaded by `loadFonts()`); the metric-matched `<brand>-fallback` face lives in `styles/styles.css` and is named SECOND in every stack, so first paint, `fonts.css` landing and the swap all shift nothing. Match the fallback's classification including width — a condensed face never falls back to plain Arial (#80); self-host the prototype's INTENDED fallback, verified with a width probe, never `document.fonts.check` (#77); metric-match above-the-fold display families (#12); match the effective weight (#22); keep the `body.appear` gate (#40). Before this step read `reference/fonts-and-cls.md` § 0 through § 4.

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

`decorateButtons()` classes emphasis-wrapped, paragraph-wrapped links BEFORE any `decorate()` runs (`<strong><a>` → `a.button.primary`, `<em><a>` → `.secondary`, `<em><strong><a>` → `.accent`, inside `p.button-wrapper` — per target in `runtime-contract.json`). Restyle the boilerplate's button rules in `styles/styles.css` with the brand paint; scope on-dark overrides to BOTH the section and the block class (#41). Block JS MOVES the CTA's paragraph into an `.actions` wrapper — `actions.append(a.closest('p') || a)` — and never clones it (EW3); variant classes go on the wrapper. Block CSS overrides only what is genuinely different. Non-button links (text links with flourish, whole-card anchors, `tel:`/`mailto:` values) stay plain `<a>` styled per block; more than three real variants lifts the full variant system into `styles.css` (#25). Before this step read `reference/buttons.md` § 5 and § Block JS — move the CTA paragraph.

### 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Content lives in `content/nav.html` (three sections: brand / link list / tools — the stock header block's contract) and `content/footer.html` (one section per band), deployed like any page; presentation lives in `blocks/header` and `blocks/footer`, template-slotted (#95): the prototype's chrome DOM with authored content moved into role slots, keeping the stock hamburger / `aria-expanded` / `isDesktop` machinery. Normalize the live pipeline's `<li><p><a>` wrap (#98); lift the chrome element's own box styles (#31); add a root-class wrapper when the lifted CSS needs one (#26); never pair a fixed `height` with vertical `padding` on a chrome row (#106). Authored content never carries `<script>` (D15); the delivered CSP blocks inline handlers and WebAssembly (#20, #102) — chrome forms and scroll state are wired in block JS. Per-page variants ride `nav:` / `footer:` metadata rows. Chrome signs off gated OPEN on the preview page — open states, `aria-current`, variant roster (`reference/chrome.md` § Chrome states and variants). Before this step read `reference/chrome.md` § The nav/footer documents, § The header/footer blocks and § What still cannot run.

### 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster owning a non-overlapping set of blocks and content pages (three to four agents). The brief points at files and headings — never pasting chapter text; each agent reads by section. Each agent is a fresh-context worker owning at most one cluster of ≤ 3 sibling pages (`../stardust/reference/fan-out.md` § Scope and type of delegated agents, § Worker contract); long steps run in the background with a per-page progress file and the coordinator waits per § Coordinator contract there. Shared cores (hero, cards, columns, chrome) are built in Steps 3–6 before fan-out and are additive-only for agents; the brief's ownership table and block-name claim in the conversion-log inventory keep parallel writers apart, and it names each block's round-trip, EW and David's Model gates. Before this step read `reference/block-agents-brief.md` § The brief template and use it verbatim.

### 8. Block JS scaffold

Every block: a JSDoc naming its authoring rows and schema path, the Experience Workspace helpers (`wrapNode`, `labelWrap`, `stripInstrumentation`, read-only `text` / `pic`) copied in with no shared import, and a `decorate()` that QUERIES content and captures traversal starts, CREATES wrappers carrying the layout classes, MOVES the authored nodes into them, then `replaceChildren()`s. The editability contract EW1–EW10 (`reference/block-js-scaffold.md` § Experience Workspace editability contract) is enforced by `block-roundtrip --ew` (default on) and `ew-editability-probe.mjs`; prove each block IN THE LOOP: `node skills/deploy/scripts/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` exits 0 (#94). Decode defensively (§ Decode rules): query, never hard-index (#42); move the authored heading; idempotent markers; heading-boundary, order-agnostic segmentation; the `collectNodes()` collector (#104); self-or-descendant `picture, img` classifiers; every authored element type consumed; one `<h1>` per page; interactive blocks own their state (#28). Runtime order (§ Runtime order): nothing measured in `decorate()`, `loadCSS` for imported builders, icons already decorated, fragments re-run `decorateMain` — `block-lint.mjs blocks/ --styles styles/styles.css` checks these and the position-aware EW-* signatures (`@ew-exempt all` caps the file's 🔴 to 🟡, an item caps one site — the round-trip decides). Before this step read `reference/block-js-scaffold.md` § 8. Block JS scaffold, § Experience Workspace editability contract, § Runtime order; § Decode rules when segmenting or collecting.

### 9. Content page scaffold

Every page carries a `metadata` block — in the first content section, never alone — with a real Title and Description derived from the `<h1>` (#34), plus `nav` / `footer` / `Robots` rows when needed. The page is a DA body fragment (#7): it starts at `<body>`, has empty `<header></header>` / `<footer></footer>`, each top-level `<div>` in `<main>` is one section holding one block OR default content, and there is no `<head>`, `<style>` or `<script>`. Run `node skills/deploy/scripts/sanitise.js <file>` before any DA write. A multi-view SPA with different chrome per view becomes multiple pages with their own nav documents (#29). Authored `<img src>` points at `content.da.live` media (never repo-relative `/img/`); fixed assets in block CSS/JS stay root-relative (#67); `<image-slot>` placeholders leave the cell empty. Before this step read `reference/content-page-scaffold.md` § 9. Content page scaffold.

## Local QA before deploy (no DA) — in brief

`aem up --html-folder content` is not a preview. Build the harness (`node skills/deploy/scripts/build-harness.mjs content/<path>.html stardust/.work/harness/page.html`; it applies `pipeline-mimic.mjs`, counts printed per run) and open it through the dev server (`npx -y @adobe/aem-cli up --no-open`). The DA-write bar (`davids-model-lint` exit 0 + the whole-page round-trip gate clean: `block-roundtrip.mjs` with no `--blocks`, `--ew` on) is met → PUT + preview at once; then, on the harness as the fast pre-check and on the preview origin as the gate (thresholds unchanged): the edit-mode simulation (`ew-editability-probe.mjs --content content/<page>.html --simulate-editor --verbose`) shows no drift; an editability conversion of an already-shipped block proves pixel parity; the stock `qa-gate.mjs <harnessURL> --schema stardust/eds-schema/<page>.json` exits 0 — never hand-roll a probe (#101); its full-bleed pass is derived from block CSS, `--full-bleed` overrides. Scope boundary (#101): CLS, the advisory `content-diff` and per-page chrome overrides are verified on the DEPLOYED URL only, and the visual eyeball also happens on the deployed page (#23, #105). Capture at a real viewport with scrolling (#19), drive interactive blocks (#28), QA wide (#13). Before this step read `reference/local-qa.md` § Gates and § Local-QA scope boundary.

## Deploy (DA Source API, from a local agent)

The stages (code push with forced Code Sync, `localize-links.mjs` over the WHOLE tree after every generator, `sanitise.js`, `PUT`, `POST /preview/` then `/live/`) and the per-page atomic contract (`davids-model-lint` exit 0 → PUT → preview → live → delivered `.plain.html` asserted → computed-style guard on the live URL, every visible image non-zero (#122) → AI-readability gate (#100) → only then the ledger flips to `deployed`) run through `node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> --content content` (#4); preview follows the DA-write bar, before any harness pixel iteration, and the first status line names the preview URL `deploy-batch.mjs` prints per page — publish is a separate `--publish` on PASS (D1/D16); a production-affecting action is its own command, never joined with edits or commits in one shell string. Token hygiene (#16) and the `DA_TOKEN` lifecycle (§ DA_TOKEN lifecycle: preflight, exit 3 on a mid-batch `401` → re-run `next`) are part of the contract. Two clocks — code first on the ref the user will look at, then content. Before this step read `da-deploy-protocol.md` § Delivery pipeline, § Deploy (DA Source API + curl) and § Two clocks.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

After deploy, reconcile each page against its prototype on the DEPLOYED URL only (#78, #101). The atomic contract ran the load-bearing automated gates; Step 10 adds six checks: the advisory `content-diff` structural summary (summary line first; per-node findings are leads to verify by eye), the deployed full-page eyeball at desktop + mobile (#23, #105 — the load-bearing visual check), the fetch-delayed CLS probe (#100), the chrome crop gate on the header and footer bands (`skills/replica/scripts/crop-compare.mjs`, diagnose with `chrome-parity.mjs` first, #115), the wide-viewport box check for frozen-vs-fluid widths (#116) and geometry-fix verification hygiene (#117). Also grep `blocks/` for fixed-asset URLs (#44). Gate only after `code-sync-verify.mjs --org <org> --repo <repo> --ref <branch>` exits 0 (every changed code path served == working tree; 124 = pending, 3 = push first — neither a gate result) and `served-check.mjs <page-url> --grep <marker> --wait 180` exits 0. Step 10 is per-page against the prototype; the site-wide sweep after rollout is the read-only `qa` skill. Before this step read `reference/deployed-reconcile.md` § The six reconcile checks and § Reading content-diff.

## When you finish

Update `stardust/eds-conversion-log.md` (create if absent): final block inventory, the locked vocabulary (`davids-model-lint --json` `census`), decisions locked, anti-patterns avoided, site-specific notes. Close with the hand-off shape in `../stardust/reference/handoff-report.md` § Gate table first.

## References

Chapters (full text of the sections this core compresses — read by `##`, each opens with a TOC):

- `reference/target-runtime.md` — the boilerplate's load chain, section DOM, cell normalization (#104), body gate and Experience Workspace instrumentation.
- `reference/encode-contract.md` — the ENCODE contract in full: structural rules, authoring shapes, § Section heads, § Images.
- `reference/audit-and-naming.md` — Steps 1, 2 and 2b: input normalization, the fingerprint probe (#90), D1/D11 triage, naming rules, section schema and decode tiers (#93, #95).
- `reference/foundation.md` — Step 3: structural layer, tokens, reset, section styles, edit-mode foundation, header reservation and hero CLS, token-completeness gate, favicon.
- `reference/section-rhythm.md` — Step 3: section-per-module encoding, the rhythm engine (`--mt`, classifiers), token remainder, replica hand-off.
- `reference/fonts-and-cls.md` — Step 4: the four font principles, licensing alert, metric-matched fallbacks, width classification, font traps.
- `reference/buttons.md` — Step 5: the `decorateButtons()` table, global button CSS, surface-aware variants, moving CTA paragraphs, multi-variant systems.
- `reference/chrome.md` — Step 6: nav/footer documents, template-slotted header/footer blocks, CSP limits, per-page variants.
- `reference/block-agents-brief.md` — Step 7: brief discipline, the brief template (ownership table, block-name claim), shared cores and variants.
- `reference/block-js-scaffold.md` — Step 8: the scaffold, the Experience Workspace editability contract (EW1–EW10), the EW and round-trip gates, decode rules, interactive blocks.
- `reference/content-page-scaffold.md` — Step 9: metadata block, body-fragment shape, SPA views, image hosts.
- `reference/local-qa.md` — the harness, the pre-push gates, the scope boundary, capture and drive rules.
- `reference/deployed-reconcile.md` — Step 10: the six deployed checks, running and reading `content-diff`.
- `reference/anti-patterns.md` — the twenty anti-patterns, grouped.
- `reference/checklist.md` — the per-page checklist.
- `reference/ai-readability.md` — the AI-readability rule (#86, #100): checker formula, block rules, gate.
- `reference/pipeline-facts.md` — what the DA → EDS pipeline rewrites on delivery: fact, remedy, lint id; § Local emulation, § Probe.
- `reference/ship-script.md` — the one-command ship script a hands-off run writes when a push or publish is denied: merge → push → explicit publish → post-ship gate → issue comment.

Bundled contracts:

- `davids-model.md` — David's Model distilled: the 15 rules (`D#N`) mapped to this skill's contracts and gates, plus component-model shape notes.
- `da-deploy-protocol.md` — the DA Source API deploy contract (auth, PUT, preview/publish, asset-before-preview ordering) and the delivery pipeline (stages, batch driver, atomic contract, link localization, token lifecycle).
- `../../notes/deploy-improvements-archive.md` — the frozen `(#NN)` ledger; new findings go to `skills/stardust/reference/learnings.md`.
- `scripts/ew-editability-probe.mjs` — the Experience Workspace editability gate (Step 8): instrument → decorate → count survivors; `--simulate-editor`; URL and `--content` modes; `@ew-exempt` tags.
- Experience Workspace sources the contract was verified against: `reference/block-js-scaffold.md` § Experience Workspace sources.
