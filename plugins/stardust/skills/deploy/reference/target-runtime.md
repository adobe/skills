# Target runtime — vanilla aem-boilerplate (full text)

Full text of the deploy skill's Target runtime section (the core carries a compressed form). Read:
- § Target runtime — once per project, before Step 3, for what the load chain and section DOM give you;
- § Cell normalization and Experience Workspace instrumentation — before Step 8, when writing any `decorate()`;
- § Drift — when a button class, wrapper name or buttonization rule does not match what the probe recorded.

## Target runtime — vanilla aem-boilerplate (what the generated code can rely on)

The stock boilerplate provides everything the conversion needs; the runtime is never modified. The load chain (`head.html` → `scripts.js` → `loadEager` → `loadLazy` → `loadDelayed`) gives you:

- **Section DOM:** each `main > div` becomes `<div class="section">`; runs of default content are wrapped in `div.default-content-wrapper`; each block table gets a `div.<name>-wrapper` around `<div class="<name> block" data-block-name="<name>">`, and the section gains `.<name>-container`. Sections are hidden (`data-section-status` + inline `display:none`) until loaded — undecorated-content flash is handled by the runtime, not by foundation CSS.
## Cell normalization and Experience Workspace instrumentation

- **Cell normalization (`wrapTextNodes`, in `decorateBlock` — #104):** any block cell whose FIRST element child is not in `P/PRE/UL/OL/PICTURE/TABLE/H1–6` — or that leads with a `<picture>` followed by anything else — gets its ENTIRE content folded into **one `<p>`** before your `decorate()` runs. A media-led mixed cell (`<img> + <h3> + <p>`) therefore arrives as a single wrapper `<p>`; a collector reading `cell.children` sees ONE node and silently drops everything after the image. Decode with the wrapper-expanding collector (Step 8, #62/#104).
- **Body gate:** `styles.css` ships `body { display: none }` + `body.appear { display: block }`; `loadEager()` adds `appear` after `decorateMain()`. This gate is CORRECT — keep it. Any off-pipeline render (harness, probes) must load the real `scripts/scripts.js` so the gate is satisfied; a blank render means the runtime never booted, not that the gate should be removed.
- **Buttons:** `decorateButtons()` (in `scripts.js`) buttonizes ONLY author-formatted links — see Step 5 for the emitted class family.
- **Chrome:** `header`/`footer` BLOCKS (loaded by `loadLazy`) fetch authored fragment documents — `/nav` and `/footer` by default, overridable per page via `nav`/`footer` metadata. Block JS runs, so interactive chrome (hamburger, dropdowns) is real JS. `loadFragment` runs `decorateMain` on each fetched fragment, so every project decorator in `scripts.js` runs again on chrome — guard with `data-decorated` (Step 8 § Runtime order). See Step 6.
- **Fonts:** `@font-face` lives in `styles/fonts.css`, loaded by `loadFonts()` (eagerly on desktop / repeat views via a `fonts-loaded` session flag, always in `loadLazy`); `styles.css` carries the metric-matched fallback faces. See Step 4.
- **Auto-blocking hook:** `buildAutoBlocks()` in `scripts.js` is project-owned — the home for D1 auto-blocks (video/embed URLs, fragment links).
- **Lint:** generated blocks and styles lint under the project's own config; there is no vendored runtime to exempt. Do not create an `.eslintignore` for runtime files.
- **Experience Workspace instrumentation (da.live canvas "quick-edit" — the inline editor your blocks must survive).** The workspace stamps `data-prose-index` on every OUTERMOST `h1–h6 / p / ol / ul / pre / blockquote` of the authored document, `data-image-index` on every `img` and `data-block-index` on every block div, swaps that instrumented HTML into `document.body`, and re-runs the page's own `loadPage()` — so every block's `decorate()` runs over the instrumented markup. In the workspace **every block cell contains a `<p>`** (prose2aem copies cell innerHTML; the published pipeline unwraps single-paragraph cells to bare text and the runtime's `wrapTextNodes` re-wraps them, so `decorate()` sees a `<p>` in both worlds). Afterwards ONLY elements that still carry their `data-prose-index` become editors (`querySelector('[data-prose-index="N"]').replaceWith(editor)`); nothing repairs a lost index. A text your block rebuilt from `textContent`/`innerHTML`, synthesized, or retagged is silently uneditable. Contract + gate: Step 8 § Experience Workspace editability contract (EW1–EW10).

## Drift

**The boilerplate itself drifts** (e.g. current `main` emits `p.button-wrapper`; older clones emit `p.button-container` and buttonize bare links). Never assume — the Runtime-detection probe below records what THIS target actually does, from its own `scripts.js`/`aem.js`.
