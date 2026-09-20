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

Read this card, then the one section you are at — never the whole skill. Every `reference/` chapter opens with a TOC; one `##` at a time. Only `deploy-page --timeout` is a deadline (killed = no verdict, never FAIL); long steps run backgrounded with a progress file (Step 7).

| # | Step | Command / artefact | Pass bar |
|---|---|---|---|
| 0 | Probes | `node skills/stardust/scripts/preflight-runtime.mjs`; read the target's `scripts/aem.js` + `scripts/scripts.js` → `stardust/runtime-contract.json`; `pipeline-mimic.mjs --runtime scripts/scripts.js` → `#autoBlocks`; `--probe --org <org> --repo <repo> --branch <branch>` → `#pipeline` (optional) | contract written before any code |
| 1 | Audit | pre-render JSX to `stardust/.work/prerender/`; `node skills/deploy/scripts/style-fingerprint.mjs "file://<abs>/<proto>.html"` | per-page section list + variation manifest |
| 2 | Names + reuse | D1/D11 triage per section → `stardust/eds-conversion-log.md` | names locked in writing before any block code |
| 2b | Schema + tier | `node skills/deploy/scripts/section-schema.mjs "<protoURL>" --out stardust/eds-schema/<page>.json` | schema + decode tier recorded per section |
| 3 | Foundation | `styles/styles.css` — tokens, reset, scaffold, style values (budgeted), edit-mode snippets, `--nav-height`, favicon | token-completeness grep prints nothing |
| 4 | Fonts | `styles/fonts.css` + `-fallback` faces in `styles.css`; woff2 under `fonts/` | every named family shipped; `head.html` untouched |
| 5 | Buttons | restyle the boilerplate `a.button` rules; block JS MOVES CTA paragraphs | no manufactured anchors |
| 6 | Chrome | `content/nav.html`, `content/footer.html`, `blocks/header`, `blocks/footer` | three-section nav contract kept |
| 7 | Block agents | one brief per archetype cluster from the template — pointers only | briefs name files + headings, never inline text |
| 8 | Block JS | `node skills/deploy/scripts/block-lint.mjs blocks/ --styles styles/styles.css`; `node skills/deploy/scripts/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` | block-lint exit 0; round-trip exit 0 — no structural 🔴, no dead text, no duplicated index; `code-sync-verify.mjs --lint` exit 0 before the commit |
| 9 | Content pages | `node skills/deploy/scripts/prototype-to-content.mjs "<protoURL>" --schema stardust/eds-schema/<page>.json --out content/<page>.html` (`--thin` for a Path-B render); `node skills/deploy/scripts/davids-model-lint.mjs content/ --icons-dir icons --styles styles/styles.css` | transcriber exit 0 (`unmapped:` = exit 2, `--map` it); lint exit 0 + whole-page round-trip clean → first PUT + preview (URL in the first status line) |
| QA | Local harness | `block-lint.mjs blocks/ --styles styles/styles.css`; `pipeline-mimic.mjs --self-test`; `build-harness.mjs` → `qa-gate.mjs <harnessURL> --schema stardust/eds-schema/<page>.json`; whole-page `block-roundtrip --strict`; `render-harness.mjs content/<page>.html <out.png> --fragments content/`; `ew-editability-probe.mjs --simulate-editor` | block-lint + qa-gate exit 0; no edit-mode drift |
| D | Deploy | `node skills/deploy/scripts/deploy-page.mjs --org <org> --repo <repo> --branch <branch> --source-host <live-host> --content content <files|--all>` (chain, preview; forwards `--require-code-synced`), then `… --publish` — holds every row without a PASS in `stardust/rollout/gate-report.json` (`held=`); `ai-readability.mjs --origin <live> <paths>`; progress: `progress.mjs read stardust/.work/deploy/deploy-page.progress.json` | chain exit 0 (per-page atomic contract); AI-readability ≥ 98 |
| 10 | Deployed reconcile | `node skills/diff/scripts/content-diff.mjs "<protoURL>" "<deployedURL>" --profile eds` (advisory); fetch-delayed CLS probe; `skills/replica/scripts/crop-compare.mjs` on header/footer bands; `code-sync-verify.mjs --org --repo --ref` exit 0 + `served-check.mjs <page-url> --grep <marker>` first | CLS < 0.1; chrome bands within the crop gate; deployed eyeball faithful |

Outputs: `blocks/<name>/<name>.{js,css}` · `content/**/*.html` (+ `nav.html`, `footer.html`) · `styles/styles.css`, `styles/fonts.css`, `fonts/*.woff2` · `stardust/runtime-contract.json` · `stardust/eds-schema/<page>.json` · `stardust/eds-conversion-log.md` · `content/.deploy-ledger.json`.

| At step | Read |
|---|---|
| 0 | this file § Runtime preflight, § Runtime-detection probe; `reference/target-runtime.md` § Target runtime |
| 1–2b | `reference/audit-and-naming.md` § 1. Audit / § 2. Decide names + reuse / § 2b. Section schema + decode tier; `reference/encode-contract.md` § Structural rules |
| 3 | `reference/foundation.md` § 3. Foundation, § Header reservation and hero CLS; `reference/section-rhythm.md` when spacing varies per band; before deploy § Token-completeness gate, § Favicon |
| 4 | `reference/fonts-and-cls.md` § 0 through § 4 |
| 5 | `reference/buttons.md` § 5, § Block JS — move the CTA paragraph |
| 6 | `reference/chrome.md` § The nav/footer documents, § The header/footer blocks, § What still cannot run, § Chrome states and variants |
| 7 | `reference/block-agents-brief.md` § The brief template, § Shared cores and variants; `davids-model.md` |
| 8 | `reference/block-js-scaffold.md` § 8. Block JS scaffold, § Experience Workspace editability contract, § Runtime order, § Decode rules; `da-deploy-protocol.md` § Code push gates before the commit |
| 9 | `reference/content-page-scaffold.md` § 9. Content page scaffold, § Generator contract; `reference/encode-contract.md` § Authoring shapes, § Pipeline-sensitive shapes, § Images |
| QA | `reference/local-qa.md` § Gates, § Local-QA scope boundary; `reference/pipeline-facts.md` § Local emulation, § Probe |
| D | `da-deploy-protocol.md` § Delivery pipeline, § Deploy (DA Source API + curl), § Two clocks; § DA_TOKEN lifecycle (`da-token-check.mjs`) before the first token read; `../rollout/reference/publish-gate.md` § Gate 8 before `--publish`; `reference/site-lockdown.md` before the hand-off |
| 10 | `reference/deployed-reconcile.md` § The six reconcile checks, § Reading content-diff; `da-deploy-protocol.md` § Code push gates |
| any failure | `reference/anti-patterns.md` (by group); `reference/checklist.md` before each DA push |

## When to use

The user has:
1. **Per-page styled HTML prototypes** — one file per page with its own CSS, in any of these shapes:
   - **Single-file with inline `<style>`** and `:root` tokens + semantic `<section class="…">` — convert directly.
   - **External per-page `.css`** (a sibling stylesheet) — read it as you would an inline `<style>`.
   - **`<x-dc>` document-content with everything inline-styled** — lift inline styles into a scoped block stylesheet.
   - **React/JSX prototypes** (a shell mounting `.jsx` at runtime): **pre-render to static HTML first**; a shell with no server-rendered `<main>` cannot be decorated.
   Discover the prototype path (`stardust/prototypes/**`, `samples/<Name>/`); never hard-code it.
2. An EDS project at the repo root — **vanilla `aem-boilerplate`**: `scripts/aem.js` + `scripts/scripts.js`, `blocks/` with `header`/`footer`/`fragment`, `styles/styles.css` + `styles/fonts.css`, `head.html`. The ONLY runtime this skill targets — runtime files are never ported, vendored or edited.
3. The goal: prototypes → authorable EDS blocks + content pages under `content/**`.

No EDS origin yet (repo, `fstab.yaml`, Code Sync): `reference/site-bootstrap.md` at Setup — one question, `target` default; the new repo's clone is the scaffold. Moving the project to another org/site (`relocate <org>/<site>`): `reference/project-move.md`. EDS but no prototypes: this skill doesn't apply.

**Flow guard (stardust projects).** `stardust/state.json` without `flow` on a migration ask (a URL plus "migrate" / "to EDS" / "re-platform"): stop before Step 1, print the master's two-flow table (`skills/stardust/SKILL.md` § Two migration flows) and hand back to its routing, which stamps `flow` (`skills/stardust/reference/state-machine.md` § Flow keys). Hand-authored prototypes with no `state.json` are the standalone use.

## Target runtime — vanilla aem-boilerplate (compressed)

The runtime is never modified. The load chain `head.html` → `scripts.js` → `loadEager` → `loadLazy` → `loadDelayed` gives you: the **section DOM** (`div.section` › `div.default-content-wrapper` / `div.<name>-wrapper` › `div.<name>.block`, hidden until loaded); **cell normalization** — `wrapTextNodes` folds a media-led or unlisted-first-child cell into ONE `<p>` before `decorate()` runs (#104); the **body gate** (`body { display: none }` / `body.appear`) — keep it, load the real `scripts/scripts.js` in every off-pipeline render; **buttons** via `decorateButtons()` on author-formatted links only (Step 5); **chrome** as `header`/`footer` blocks fetching `/nav` and `/footer` (Step 6); **fonts** via `styles/fonts.css` + `loadFonts()` with metric-matched fallbacks (Step 4); the project-owned **`buildAutoBlocks()`** hook (D1 auto-blocks + lang/hreflang, `runtime-contract.json#autoBlocks`); and the **Experience Workspace instrumentation** — the inline editor stamps `data-prose-index` on the outermost authored elements, re-runs `loadPage()`, and only elements still carrying their index stay editable (Step 8, EW1–EW10). Full text: `reference/target-runtime.md`.

## Runtime preflight (run before anything that renders)

Before the Local-QA harness or any probe below, run `node skills/stardust/scripts/preflight-runtime.mjs` (master Setup step 10): playwright resolves from `stardust/node_modules` — never `npm i … --no-save` in the EDS repo (`skills/stardust/reference/runtime-preflight.md` § Contract).

## Runtime-detection probe (run before Step 1 — write `stardust/runtime-contract.json`)

Clones drift and a wrong assumption is **silent and sitewide**: before converting anything, read the TARGET's own `scripts/scripts.js` + `scripts/aem.js` and record the answers:

```json
{
  "runtime": "vanilla-eds",
  "blockWrapperClass": "block",
  "buttonClasses": ".button / .button.primary / .button.secondary / .button.accent, in p.button-wrapper",
  "buttonization": "formatted-only | bare-links-too",
  "fragmentScriptPolicy": "inert-innerHTML",
  "emptySectionCollapse": true,
  "pipeline": { "multiValueStyle": "comma", "residual": 0, "probedAt": "<ISO>" }
}
```

Block CSS/JS generation and the Local-QA harness read this contract; the harness `style-split` defaults to `pipeline.multiValueStyle` — a measured `first-only` narrows the local render, never the rule. Values above = current `adobe/aem-boilerplate` main; the two known drift axes:
- **`buttonClasses`** — current main emits `a.button` (+ `.primary`/`.secondary`/`.accent`) inside `p.button-wrapper`; older clones emit `p.button-container`, and some buttonize a bare `<a>` alone in a paragraph (`bare-links-too`) where current main requires authored `<strong>`/`<em>`.
- **`blockWrapperClass`** — `decorateBlock` adds `.block` + `data-block-name` and wraps the block in `div.<name>-wrapper` (section gains `.<name>-container`). Scope block CSS under `.<name>` (the class every vintage sets); confirm by asserting a grid container computes `display: grid` in a headless render.

When `emptySectionCollapse` is true, add `main .section:empty { display: none }` to the foundation as the fallback; the rule is never to author the metadata block alone (Step 9).

## The one rule that drives everything else

**One distinct visual PATTERN = one EDS block — and a section with NO pattern is NOT a block at all.** The content structure that lands in DA follows **David's Model** (`davids-model.md` — the 15 rules mapped to this skill's contracts; cited as `D#N`). Its first rule shapes everything here:

- **D1 — blocks aren't ideal for authoring.** A block is a table an author must maintain. A section of plain prose — heading, paragraphs, an image, CTAs, with **no repeating units and no bespoke interactive structure** — is **DEFAULT CONTENT** in its own section, never wrapped in a block; its skin rides a minimal section-metadata `style` value (Step 3) and its semantics stay native `<h2>`/`<p>`/`<picture>`/`<a>`. Never wrap bare default content in a `text`/`heading`/`image` block (the D1 anti-pattern).
- **Blocks are for structure default content can't express:** repeating units (cards, FAQ, logos, team), bespoke compositions (a countdown, a stat band, a cinematic hero) and interactive components — one distinct prototype pattern = one block. Don't abstract speculatively across prototypes unless sections share a pattern — bespoke CSS can't be wrongly shared (`reference/anti-patterns.md` § Structure and decisions).

**The one deliberate exception — collapse SAME-PATTERN sections into one block + VARIANT classes.** When two or more sections share a content pattern and differ only in skin, emit ONE canonical block (`cards`, `text`, `quote`, `accordion`) with each section's look behind a variant class (`class="cards brands"`). The block JS stays generic (classify cells by content); only the CSS differs per variant. (D9.) Genuinely unique sections stay bespoke; budget variant CSS (some grids are count-specific).

The prototype is the visual spec; the block AUTHORS its content — **The ENCODE contract** below says what well-authored content looks like, `reference/anti-patterns.md` how a block defensively PARSES it.

## Output you will produce

For a typical 5–10 page site:

- **One block per distinct prototype PATTERN** (D1/D9): prose bands land as default content, same-pattern sections share one block + variants, only bespoke sections get their own.
- **One EDS content page per prototype page.**
- **Nav + footer documents** at `content/nav.html` and `content/footer.html` — authored content deployed like any page, fetched by the stock `header`/`footer` blocks (D12).
- **Per-site `blocks/header` + `blocks/footer` CSS/JS** reproducing the prototype's chrome (Step 6).
- **Updated `styles/styles.css`** with brand tokens lifted from the prototype's `:root`, a reset, the EDS section scaffold, a global button system (Step 5) and the few section-metadata `style` values default-content sections use.
- **No shared utility modules, wave systems or motion library** (owned per block).

## The ENCODE contract — ten bullets

The decode side lives in `reference/anti-patterns.md` and `reference/block-js-scaffold.md`; this is the encode side — what the content page EMITS — and where David's Model is enforced (`davids-model.md`; gate: the Step 9 `davids-model-lint` command exits 0 before any DA write). Full text with every citation, § Section heads and § Images: `reference/encode-contract.md`.

1. **Decoration that must survive DA rides a semantic inline tag** (`<strong>`, `<em>`, `<code>`, `<a>`, `<picture>`, source `<sup>`/`<sub>`, `<del>`; never `<u>`, `<span>`) with one permitted meaning each — never a class, never an invented delimiter; a sub-field leads its cell with the field's tag.
2. **No nested block tables (D2), no spans beyond the block-name header (D3), blocks stay ≤ 4 columns (D10)**; section styles and block variants stay inside the vocabulary budget (`reference/foundation.md` § 3. Foundation).
3. **URLs:** fully-qualified for media and external targets (D4); internal links to migrated pages root-relative, extensionless, no trailing slash — `localize-links.mjs` rewrites them; a target no page serves follows the `links` decisions row (`--unmigrated bounce|list`).
4. **No code visible as text (D15)** — including script bodies a scraper lifted as copy; video/embed URLs stay plain links for `buildAutoBlocks()` (D1); alt text describes the image only (D13).
5. **Key facts live in server-rendered page content, never solely in chrome or a fragment (#86), and `decorate()` adds no words to the DOM (#100)** — `reference/ai-readability.md`.
6. **No raw presentational HTML:** no design-added `<sup>`, no layout `<br>` (headings included — stripped), no spacer vehicles (#112 — the ladder in `reference/encode-contract.md` § Authoring shapes), never an `<hr>` — the section delimiter (#119); pipeline-rewritten shapes: § Pipeline-sensitive shapes there.
7. **Grouped item sets are one row per item; lists and FAQs are rows, not nested lists or one blob (D5).**
8. **The section head above a repeating block is default content the block reabsorbs by MOVING the wrapper's children (D1, EW8)** — zero pixel change.
9. **Buttons follow the emphasis convention (D6)** — `<strong><a>` primary, `<em><a>` secondary, `<em><strong><a>` accent; headings form a real outline with one `<h1>`; metadata is name/value config only (D14); site-wide constants are never per-page rows (`reference/encode-contract.md` § Structural rules).
10. **Images:** editorial imagery (hero/CTA backgrounds included) is uploaded to DA `/media` and authored as a `content.da.live` `<img>` with alt; decorative treatments and fixed brand assets are CSS only; verify the delivered `.plain.html` img/alt count; verify source URLs with the recorded fetch technique, rehost blocked assets from the CAPTURED src, keep SVGs pure-vector and small (#2, #99, #103, #118).

## Steps

Each step is one paragraph; full text, citations and code live in the chapter named at its end — read that `##` before the step, never the whole chapter.

### 1. Audit (light)

Normalize the input to static HTML first: pre-render JSX prototypes by serving their own folder and capturing `#root` into `stardust/.work/prerender/` (#24); seed persisted state for routed or signed-in views (#27). Read every prototype's `<main>` into a per-page section list — filenames + section names, not a pattern punch list; reuse emerges when two sections are byte-identical. Then fingerprint per-instance variation with `style-fingerprint.mjs` before any block code (#90): its manifest is the block author's checklist for the per-instance variation a copy-driven conversion flattens. Before this step read `reference/audit-and-naming.md` § 1. Audit and § Fingerprint per-instance variation.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Per section, two triage questions precede naming and are recorded in the conversion log: is it a block at all (D1 — no repeating units and no bespoke interactive structure means default content + a section `style` value; `client-only` and modal-bearing sections override this), and does it match a Block Collection pattern (D11 — mirror that block's name and content model). Name the rest from the prototype's section class, never a reserved EDS class (#15); one block for identical treatments across pages, archetype-prefixed blocks for different ones. Scale the ceremony to the page count (a single-page site just locks `block name = section class`). Lock the answers in `stardust/eds-conversion-log.md` — the highest-leverage step. Before this step read `reference/audit-and-naming.md` § 2. Decide names + reuse.

### 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

Emit the per-section contract both sides are written from: `node skills/deploy/scripts/section-schema.mjs "<protoURL>" --out stardust/eds-schema/<page>.json` (roles + repeat units — what `content-diff` and `block-roundtrip` measure). ENCODE authors one row per repeat unit in schema order; DECODE cites the schema path in the block JSDoc and asserts its unit count post-decorate. Pick the decode tier per section: template-slotted NODE-slotting for fixed compositions (authored elements MOVED into slots; value-slotting `textContent` copies are banned, anti-pattern 18), reconstructive for repeat groups authors edit. Record the tier, `defaultContent` flags (`⚠ generic-with-structure`: a default-content section with interactive or ≥ 2-column facts needs a block or a `dynamics` row — `qa-gate --schema` FAILs it) and the component-model shape (simple / key-value / container) per section. Both tiers obey the Experience Workspace editability contract (Step 8). Before this step read `reference/audit-and-naming.md` § 2b. Section schema + decode tier.

### 3. Foundation

Rebrand `styles/styles.css` — lift the prototype's `:root` tokens verbatim, write the reset (#106 `border-box`, #36 `img`), retune the `main > .section` scaffold, define a SMALL closed set of section `style` values for default-content sections (one per section #120; scoped empty-section overrides #121; contained child margins), the global button system (Step 5), the three `.prosemirror-editor` edit-mode snippets (EW3/EW6/EW10) and the header reservation (`--nav-height` per breakpoint #81; overlay chrome reserves nothing #108; block DOM never emits `<header>` #107; the hero eager-loads its LCP image and reserves its media slot #100). Preserve the boilerplate's STRUCTURAL layer verbatim — body gate and chrome reservation; `scripts/scripts.js` stays stock except `buildAutoBlocks()`. Gate before deploy: every `var(--x)` a block references is defined in `:root` (#91). Ship the favicon (§ Favicon) — the one permitted `head.html` addition. Before this step read `reference/foundation.md` § 3. Foundation and § Header reservation and hero CLS; before deploy § Token-completeness gate and § Favicon.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Ship an `@font-face` for EVERY named family (#65) and self-host every brand face — proprietary ones too, with the licensing alert in three places (#80) — matching the axes the prototype loaded (#30): static `@fontsource/<name>` files plus computed metric overrides for non-variable fonts (#11). Brand `@font-face` lives in `styles/fonts.css` (`loadFonts()`); the metric-matched `<brand>-fallback` face lives in `styles/styles.css`, named SECOND in every stack, so first paint, `fonts.css` landing and the swap shift nothing. Match the fallback's classification including width (a condensed face never falls back to Arial); self-host the prototype's INTENDED fallback, verified with a width probe, never `document.fonts.check` (#77); metric-match above-the-fold display families (#12); match the effective weight (#22); keep the `body.appear` gate (#40). Before this step read `reference/fonts-and-cls.md` § 0 through § 4.

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

`decorateButtons()` classes emphasis-wrapped, paragraph-wrapped links BEFORE any `decorate()` runs (`<strong><a>` → `a.button.primary`, `<em><a>` → `.secondary`, `<em><strong><a>` → `.accent`, inside `p.button-wrapper` — per target in `runtime-contract.json`). Restyle the boilerplate's button rules in `styles/styles.css` with the brand paint; scope on-dark overrides to BOTH the section and the block class (#41). Block JS MOVES the CTA's paragraph into an `.actions` wrapper — `actions.append(a.closest('p') || a)` — and never clones it (EW3); variant classes go on the wrapper. Block CSS overrides only what differs. Non-button links (text links with flourish, whole-card anchors, `tel:`/`mailto:` values) stay plain `<a>` styled per block; more than three real variants lifts the full variant system into `styles.css` (#25). Before this step read `reference/buttons.md` § 5 and § Block JS — move the CTA paragraph.

### 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Content lives in `content/nav.html` (three sections: brand / link list / tools — the stock header block's contract) and `content/footer.html` (one section per band), deployed like any page; presentation lives in `blocks/header` and `blocks/footer`, template-slotted (#95): the prototype's chrome DOM with authored content moved into role slots, keeping the stock hamburger / `aria-expanded` / `isDesktop` machinery. Normalize the pipeline's `<li><p><a>` wrap (#98); lift the chrome element's own box styles (#31); a root-class wrapper when the lifted CSS needs one (#26); never pair a fixed `height` with vertical `padding` on a chrome row (#106). Authored content never carries `<script>` (D15); the delivered CSP blocks inline handlers and WebAssembly (#20, #102) — chrome forms and scroll state are wired in block JS. Per-page variants ride `nav:` / `footer:` metadata rows. Chrome signs off gated OPEN on the preview page (`reference/chrome.md` § Chrome states and variants). Before this step read `reference/chrome.md` § The nav/footer documents, § The header/footer blocks and § What still cannot run.

### 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster owning a non-overlapping set of blocks and pages (three to four). The brief points at files and headings, never chapter text; each agent reads by section. Each agent is a fresh-context worker owning one cluster of ≤ 3 sibling pages (`../stardust/reference/fan-out.md` § Scope and type of delegated agents, § Worker contract); long steps run in the background with a per-page progress file and the coordinator waits per § Coordinator contract. Shared cores (hero, cards, columns, chrome) are built in Steps 3–6 before fan-out, additive-only for agents; the brief's ownership table and block-name claim in the conversion-log inventory keep parallel writers apart, and it names each block's round-trip, EW and David's Model gates. Before this step read `reference/block-agents-brief.md` § The brief template and use it verbatim.

### 8. Block JS scaffold

Every block: a JSDoc naming its authoring rows and schema path, the Experience Workspace helpers copied in with no shared import (§ 8), and a `decorate()` that QUERIES content and captures traversal starts, CREATES wrappers carrying the layout classes, MOVES the authored nodes into them, then `replaceChildren()`s. The editability contract EW1–EW10 is enforced by `block-roundtrip --ew` (default on) and `ew-editability-probe.mjs`; prove each block IN THE LOOP: `node skills/deploy/scripts/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` exits 0 (#94). Decode defensively (§ Decode rules: query, never hard-index #42; move the authored heading; idempotent markers; heading-boundary segmentation; `collectNodes()` #104; every authored element type consumed; one `<h1>`; interactive blocks own their state #28) and keep the runtime order (§ Runtime order) — `block-lint.mjs blocks/ --styles styles/styles.css` checks both and the position-aware EW-* signatures (`@ew-exempt all` caps the file's 🔴 to 🟡; the round-trip decides). Before this step read `reference/block-js-scaffold.md` § 8. Block JS scaffold, § Experience Workspace editability contract, § Runtime order, § Decode rules.

### 9. Content page scaffold

Every page carries a `metadata` block (first content section, never alone; Title and Description from the `<h1>`, #34; `nav` / `footer` / `Robots` rows when needed) and is a DA body fragment (#7): starts at `<body>`, empty `<header></header>` / `<footer></footer>`, one section per top-level `<div>` in `<main>` holding one block OR default content, no `<head>`, `<style>` or `<script>`. Author it with `prototype-to-content.mjs` (the schema decides block vs default content; an unmapped section stops the page; `sanitise.js` runs inside), then `block-roundtrip`. A multi-view SPA becomes one page per view with its own nav document (#29). Authored `<img src>` points at `content.da.live` media, never repo-relative `/img/` (#67); `<image-slot>` placeholders leave the cell empty. Before this step read `reference/content-page-scaffold.md` § 9. Content page scaffold, § Generator contract.

## Local QA before deploy (no DA) — in brief

`aem up --html-folder content` is not a preview. Build the harness (`node skills/deploy/scripts/build-harness.mjs content/<path>.html stardust/.work/harness/page.html`; applies `pipeline-mimic.mjs`) and serve it with `npx -y @adobe/aem-cli up --no-open --port $(node skills/replica/scripts/port.mjs harness)` — the project's 3100–3199 slot, never a typed 3000; `qa-gate.mjs` asserts the harness identity first (exit 4 = no verdict). The DA-write bar (`davids-model-lint` exit 0 + the whole-page round-trip clean: `block-roundtrip.mjs` with no `--blocks`, `--ew` on) is met → PUT + preview at once; then, on the harness as pre-check and on the preview origin as the gate (thresholds unchanged): `ew-editability-probe.mjs --content content/<page>.html --simulate-editor --verbose` shows no edit-mode drift; an editability conversion of a shipped block proves pixel parity; the stock `qa-gate.mjs <harnessURL> --schema stardust/eds-schema/<page>.json` exits 0 — never hand-roll a probe (#101); full-bleed derives from block CSS, `--full-bleed` overrides. Scope boundary (#101): CLS, the advisory `content-diff`, per-page chrome overrides and the visual eyeball are verified on the DEPLOYED URL only (#23, #105). Capture at a real viewport with scrolling (#19), drive interactive blocks (#28), QA wide (#13). Before this step read `reference/local-qa.md` § Gates and § Local-QA scope boundary.

## Deploy (DA Source API, from a local agent)

The stages (code push with forced Code Sync, then per page: `localize-links.mjs` over the WHOLE tree → `davids-model-lint` exit 0 → EW gate (`block-roundtrip --ew`) → `delivery-lint` → `sanitise.js` → `PUT` → `POST /preview/` → delivered `.plain.html` asserted → computed-style guard on the live URL, every visible image non-zero (#122) → AI-readability gate (#100) → only then the ledger flips to `deployed`) run through `deploy-page.mjs` (the chain; a blocked page is never PUT) → `deploy-batch.mjs` (transport, #4); preview follows the DA-write bar, before any harness pixel iteration, and the first status line names the preview URL — publish is a separate `--publish` run that holds every row without a PASS in `gate-report.json` (`held (gate: …)`, `held=`; escape flags are owner flags — `../rollout/reference/publish-gate.md` § Gate 8; D1/D16); a production-affecting action is its own command, never joined with edits or commits. Token hygiene (#16) and the `DA_TOKEN` lifecycle (§ DA_TOKEN lifecycle) are part of the contract. Two clocks — code first on the user's ref, then content. Before the first content wave, register and verify the query index: `node skills/rollout/scripts/query-index.mjs --org <org> --site <site> --yaml helix-query.yaml --check` exit 0 (D13 — read-back decides; index-backed blocks read the published tree only; their local harness is `aem up --url <live origin>`). Before this step read `da-deploy-protocol.md` § Delivery pipeline, § Deploy (DA Source API + curl) and § Two clocks.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

After deploy, reconcile each page against its prototype on the DEPLOYED URL only (#78, #101); the atomic contract ran the automated gates, Step 10 adds six checks: the advisory `content-diff` structural summary (leads to verify by eye), the deployed full-page eyeball at desktop + mobile (#23, #105 — load-bearing), the fetch-delayed CLS probe (#100), the chrome crop gate on the header and footer bands (`skills/replica/scripts/crop-compare.mjs`, diagnose with `chrome-parity.mjs` first, #115), the wide-viewport box check (#116) and geometry-fix verification hygiene (#117); grep `blocks/` for fixed-asset URLs (#44). Gate only after `code-sync-verify.mjs --org <org> --repo <repo> --ref <branch>` exits 0 (124 / 3 are not gate results) and `served-check.mjs <page-url> --grep <marker> --wait 180` exits 0. Step 10 is per-page; the site-wide sweep after rollout is the `qa` skill. Before this step read `reference/deployed-reconcile.md` § The six reconcile checks and § Reading content-diff.

## When you finish

Update `stardust/eds-conversion-log.md` (create if absent): final block inventory, the locked vocabulary (`davids-model-lint --json` `census`), decisions, anti-patterns avoided, site notes. **Lockdown** (row `lockdown` on): after the last anonymous gate, `lockdown.mjs --org <org> --repo <repo>` exit 0 — else `blocked` + `owner:`, no `end` (`reference/site-lockdown.md`). Close with the hand-off shape in `../stardust/reference/handoff-report.md` § Gate table first.

## References

Chapters (full text of what this core compresses — read by `##`):

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
- `reference/content-page-scaffold.md` — Step 9: metadata block, body-fragment shape, SPA views, image hosts, the transcriber's generator contract.
- `reference/local-qa.md` — the harness, the pre-push gates, the scope boundary, capture and drive rules.
- `reference/deployed-reconcile.md` — Step 10: the six deployed checks, running and reading `content-diff`.
- `reference/anti-patterns.md` — the twenty anti-patterns, grouped.
- `reference/checklist.md` — the per-page checklist.
- `reference/ai-readability.md` — the AI-readability rule (#86, #100): checker formula, block rules, gate.
- `reference/pipeline-facts.md` — what the DA → EDS pipeline rewrites on delivery: fact, remedy, lint id; § Local emulation, § Probe.
- `reference/ship-script.md` — the one-command ship script a hands-off run writes when a push or publish is denied: merge → push → explicit publish → post-ship gate → issue comment.
- `reference/project-move.md` — relocating an EDS project to another org/site: rewrite → push → `da-copy.mjs` → `host-compare.mjs` → explicit publish → retire list.
- `reference/site-bootstrap.md` — no EDS origin yet: repo, `fstab.yaml`, Code Sync, seed + preview, `state.json.site.eds`.
- `reference/site-lockdown.md` — private repo + site auth before the hand-off: `lockdown.mjs`, gate contract.

Bundled contracts:

- `davids-model.md` — David's Model distilled: the 15 rules (`D#N`) mapped to this skill's gates, plus component-model shape notes.
- `da-deploy-protocol.md` — the DA Source API deploy contract (auth, PUT, preview/publish, asset ordering), § Code push gates and the delivery pipeline.
- `../../notes/deploy-improvements-archive.md` — the frozen `(#NN)` ledger; new findings go to `skills/stardust/reference/learnings.md`.
- `scripts/ew-editability-probe.mjs` — the Experience Workspace editability gate (Step 8): `--simulate-editor`; URL and `--content` modes; `@ew-exempt` tags.
- Experience Workspace sources: `reference/block-js-scaffold.md` § Experience Workspace sources.
