---
name: deploy
description: Convert per-page styled HTML prototypes (stardust under stardust/prototypes/**, or claude-design / Mobirise / Relume / Lovable / v0 / Figma-derived pages, or JSX prototypes pre-rendered to HTML, often under samples/) into Edge Delivery Services (EDS / AEM) blocks and content pages, then deploy via DA. Each prototype section becomes one EDS block; the prototype's per-section CSS becomes that block's CSS scoped under the block class. Use when the user wants to lift styled per-page HTML prototypes into a working EDS site under blocks/ and content/.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:deploy — prototypes → EDS/AEM

**This file is the outline.** The text of each section below is in `skills/deploy/reference/`, in the file the section names. Read that file in full when you reach the section; never work from a heading alone. A numbered rule that another file cites as `#N` is in one of those files: search `skills/deploy/` for `#N`.

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

Read `skills/deploy/reference/target-runtime.md` in full before you act on this section.

## Playwright re-probe (run before anything that renders)

Read `skills/deploy/reference/target-runtime.md` in full before you act on this section.

## Runtime-detection probe (run before Step 1 — write `stardust/runtime-contract.json`)

Read `skills/deploy/reference/target-runtime.md` in full before you act on this section.

## Deploy (DA Source API, from a local agent)

Read `skills/deploy/reference/da-source-api.md` in full before you act on this section.

## The one rule that drives everything else

**One distinct visual PATTERN = one EDS block — and a section with NO pattern is NOT a block at all.** The content structure that lands in DA must follow **David's Model** (`davids-model.md`, bundled with this skill — the 15 rules mapped to this skill's contracts; cited as `D#N` throughout). Its first rule shapes everything here:

- **D1 — blocks aren't ideal for authoring.** A block is a table an author must maintain. A section whose content is plain prose — heading, paragraphs, an image, CTAs, with **no repeating units and no bespoke interactive structure** — is authored as **DEFAULT CONTENT** in its own section, never wrapped in a block. Its skin rides a minimal section-metadata `style` value (see Step 3); the section's semantics stay native `<h2>`/`<p>`/`<picture>`/`<a>`. Never create a `text`/`heading`/`image` block around bare default content — that is the D1 anti-pattern verbatim.
- **Blocks are for structure default content can't express:** repeating units (cards, FAQ, logos, team), genuinely bespoke compositions (a countdown, a stat band, a cinematic hero), and interactive components. For those, one distinct prototype pattern = one block. Don't abstract speculatively, and don't extract "patterns" across prototypes unless sections are genuinely the same pattern — each pattern's bespoke CSS can't be wrongly shared; violating this casually cost full resets (see ANTI-PATTERNS).

**The one deliberate exception — collapse SAME-PATTERN sections into one block + VARIANT classes.** When two or more sections are the same content pattern (card grids, prose/CTA bands, quotes, accordions) differing only in skin, emit ONE canonical block (`cards`, `text`, `quote`, `accordion`) and put each section's look behind a variant class (`class="cards brands"`), brand styling in the variant CSS. The block JS stays generic (classify cells by content); only the CSS differs per variant. This is the David's-Model library win (D9: small, reusable, variant-driven — not 20 bespoke names) and is proven to preserve fidelity. Keep genuinely-unique sections (a hero, a countdown) bespoke. Budget for it: variant CSS is careful work and some grids are count-specific.

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

Read `skills/deploy/reference/encode-contract.md` in full before you act on this section. It covers: Section heads: default content the block reabsorbs; Images: editorial → authored content, decorative → CSS only.

## Steps

### 1. Audit (light)

Read `skills/deploy/reference/step-1-audit.md` in full before you act on this section.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Read `skills/deploy/reference/step-2-names-and-schema.md` in full before you act on this section.

### 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

Read `skills/deploy/reference/step-2-names-and-schema.md` in full before you act on this section.

### 3. Foundation

Read `skills/deploy/reference/step-3-foundation.md` in full before you act on this section.

### 4. Self-host fonts and minimize CLS — never put font loads in `head.html`

Read `skills/deploy/reference/step-4-fonts.md` in full before you act on this section.

### 5. Lean on EDS button conventions — DO NOT manufacture button anchors in block JS

Read `skills/deploy/reference/step-5-buttons.md` in full before you act on this section.

### 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Read `skills/deploy/reference/step-6-chrome.md` in full before you act on this section.

### 7. Blocks (parallel agents)

Read `skills/deploy/reference/step-7-blocks.md` in full before you act on this section.

### 8. Block JS scaffold

Read `skills/deploy/reference/step-8-block-js.md` in full before you act on this section. It covers: Experience Workspace editability contract.

### 9. Content page scaffold

Read `skills/deploy/reference/step-9-content-page.md` in full before you act on this section.

## Local QA before deploy (no DA)

Read `skills/deploy/reference/local-qa.md` in full before you act on this section.

## Step 10 — Reconcile on the DEPLOYED URL (content-diff ADVISORY + eyeball + CLS)

Read `skills/deploy/reference/step-10-reconcile.md` in full before you act on this section.

## Anti-patterns (lessons paid for the hard way)

Read `skills/deploy/reference/anti-patterns.md` in full before you act on this section.

## Checklist (per page)

Read `skills/deploy/reference/checklist.md` in full before you act on this section.

## When you finish

First page of a site, or a new block or variant: publish the DA library (`../rollout/SKILL.md` § Phase D, #160). Update `stardust/eds-conversion-log.md` (or create one) with: final block inventory, decisions locked, anti-patterns avoided this run, anything site-specific the next person should know. The log is the running history of "why does this look the way it does."

## References

- `davids-model.md` — David's Model (aem.live) distilled: the 15 rules (`D#N`), each mapped to the contract or gate in this skill that enforces it, plus the component-model shape compatibility notes.
- `da-deploy-protocol.md` — the curl-based DA Source API deploy contract (auth, source PUT, preview/publish, asset-before-preview ordering).
- `(#NN)` citations in this document and in the deploy/diff scripts point to the deploy improvement ledger (findings #1–#80), removed from the tree; read it with `git show 940b8795:plugins/stardust/notes/deploy-improvements-archive.md`. New findings go to `skills/stardust/reference/learnings.md`.
- `scripts/ew-editability-probe.mjs` — the Experience Workspace editability gate (Step 8 § contract): instrument → decorate → count survivors; `--simulate-editor` edit-mode drift; URL and `--content` harness modes; reads `@ew-exempt` JSDoc tags.
- Experience Workspace sources the contract was verified against (read them when the mechanism seems to have changed): da.live `blocks/canvas/editor-utils/editor-utils.js` (`getInstrumentedHTML` — what is stamped), `blocks/canvas/ew-editor-wysiwyg/ew-editor-wysiwyg.js`, `blocks/shared/prose2aem.js` (cells keep their `<p>`); da-nx `nx/public/plugins/quick-edit/quick-edit.js` (`setBody` → `loadPage` → `restoreBlockIndices`), `src/prose.js` (`createEditor` swap shape), `src/images.js`, `src/dom-index.js`, `src/selection.js` (cursor math on `textContent` length).
