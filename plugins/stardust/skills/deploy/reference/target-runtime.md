# stardust:deploy: the target runtime and its two probes

The text of this part of `skills/deploy/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Target runtime — vanilla aem-boilerplate (what the generated code can rely on)

The stock boilerplate provides everything the conversion needs; the runtime is never modified. The load chain (`head.html` → `scripts.js` → `loadEager` → `loadLazy` → `loadDelayed`) gives you:

- **Section DOM:** each `main > div` becomes `<div class="section">`; runs of default content are wrapped in `div.default-content-wrapper`; each block table gets a `div.<name>-wrapper` around `<div class="<name> block" data-block-name="<name>">`, and the section gains `.<name>-container`. Sections are hidden (`data-section-status` + inline `display:none`) until loaded — undecorated-content flash is handled by the runtime, not by foundation CSS.
- **Cell normalization (`wrapTextNodes`, in `decorateBlock` — #104):** any block cell whose FIRST element child is not in `P/PRE/UL/OL/PICTURE/TABLE/H1–6` — or that leads with a `<picture>` followed by anything else — gets its ENTIRE content folded into **one `<p>`** before your `decorate()` runs. A media-led mixed cell (`<img> + <h3> + <p>`) therefore arrives as a single wrapper `<p>`; a collector reading `cell.children` sees ONE node and silently drops everything after the image. Decode with the wrapper-expanding collector (Step 8, #62/#104).
- **Body gate:** `styles.css` ships `body { display: none }` + `body.appear { display: block }`; `loadEager()` adds `appear` after `decorateMain()`. This gate is CORRECT — keep it. Any off-pipeline render (harness, probes) must load the real `scripts/scripts.js` so the gate is satisfied; a blank render means the runtime never booted, not that the gate should be removed.
- **Buttons:** `decorateButtons()` (in `scripts.js`) buttonizes ONLY author-formatted links — see Step 5 for the emitted class family.
- **Chrome:** `header`/`footer` BLOCKS (loaded by `loadLazy`) fetch authored fragment documents — `/nav` and `/footer` by default, overridable per page via `nav`/`footer` metadata. Block JS runs, so interactive chrome (hamburger, dropdowns) is real JS. See Step 6.
- **Fonts:** `@font-face` lives in `styles/fonts.css`, loaded by `loadFonts()` (eagerly on desktop / repeat views via a `fonts-loaded` session flag, always in `loadLazy`); `styles.css` carries the metric-matched fallback faces. See Step 4.
- **Auto-blocking hooks:** `buildAutoBlocks()` in `scripts.js` is project-owned — the home for D1 auto-blocks (video/embed URLs, fragment links). `buildWidgetAutoBlocks()` + the `blocks/widget/` loader are STOCK (boilerplate ≥ 2026-06): any `a[href*="/widgets/"]` becomes a `widget` block, and a link alone in its `<p>` replaces the paragraph — port both from upstream on an older clone, never write a project block named `widget`.
- **Lint:** generated blocks and styles lint under the project's own config; there is no vendored runtime to exempt. Do not create an `.eslintignore` for runtime files. **Know the rules before writing:** lines ≤ 100 chars (`max-len` was 91 of 100 hits in a recorded run), CSS custom properties kebab-case; fix a hit with a targeted edit, never by rewriting the file (six block files were rewritten for line length); never `--fix` a file another agent is editing. `npm run lint` always includes `breakpoint-lint.mjs` (Step 3, #162): it fails on a desktop-first `@media` and, when `DESIGN.json` `extensions.breakpoints.target` is set, on any width or JS threshold off the target steps.
- **Experience Workspace instrumentation (da.live canvas "quick-edit" — the inline editor your blocks must survive).** The workspace stamps `data-prose-index` on every OUTERMOST `h1–h6 / p / ol / ul / pre / blockquote` of the authored document, `data-image-index` on every `img` and `data-block-index` on every block div, swaps that instrumented HTML into `document.body`, and re-runs the page's own `loadPage()` — so every block's `decorate()` runs over the instrumented markup. In the workspace **every block cell contains a `<p>`** (prose2aem copies cell innerHTML; the published pipeline unwraps single-paragraph cells to bare text and the runtime's `wrapTextNodes` re-wraps them, so `decorate()` sees a `<p>` in both worlds). Afterwards ONLY elements that still carry their `data-prose-index` become editors (`querySelector('[data-prose-index="N"]').replaceWith(editor)`); nothing repairs a lost index. A text your block rebuilt from `textContent`/`innerHTML`, synthesized, or retagged is silently uneditable. Contract + gate: Step 8 § Experience Workspace editability contract (EW1–EW10).

**The boilerplate itself drifts** (e.g. current `main` emits `p.button-wrapper`; older clones emit `p.button-container` and buttonize bare links). Never assume — the Runtime-detection probe below records what THIS target actually does, from its own `scripts.js`/`aem.js`.

## Playwright re-probe (run before anything that renders)

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
