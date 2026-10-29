# gpt-6.1-sol — building-blocks recall quiz

Prompt: 32 questions from `../facts.json` (BB-012, BB-022 excluded), no tools, no skill text, "DON'T KNOW" allowed. Run 2026-10-29 via second_opinion.

BB-001: Project Helix, later Adobe Franklin.

BB-002: A default-exported decoration function, typically `export default function decorate(block) { ... }`.

BB-003: The block's root DOM element—an `HTMLElement`, not its wrapper or section.

BB-004: It awaits the returned Promise before marking the block as loaded.

BB-005: `blocks/product-teaser/product-teaser.js` and, if needed, `blocks/product-teaser/product-teaser.css`.

BB-006: No. The loader attempts both JavaScript and CSS; a missing JavaScript module is caught/logged, while the stylesheet can still load and style the block.

BB-007: A `<picture>` containing responsive `<source>` elements and a fallback `<img>`, often inside an authored paragraph.

BB-008: Responsive candidates live in `srcset` attributes on `<source>` elements; alternative text lives in the `<img alt="...">` attribute.

BB-009: Initially `class="columns dark wide"`; client-side block decoration adds `block`, producing `class="columns dark wide block"`.

BB-010: Use a variant class and scoped CSS, such as `.columns.dark`. Appearance-only variants generally do not need JavaScript branching.

BB-011: Prefix selectors with the block's root class, such as `.cards ...`. Stylesheets are not automatically isolated by Shadow DOM.

BB-013: `cards-wrapper`.

BB-014: `cards-container`.

BB-015: The block's immediate wrapper element inside `main`, not the block root itself.

BB-016: Avoid `-wrapper` and `-container` for internal element classes. These suffixes conventionally identify the generated block wrapper and containing section, creating opportunities for selector collisions.

BB-017: A block-root `<div>` contains row `<div>` elements, each containing cell/column `<div>` elements. Authored content sits inside those cells.

BB-018: Prefer a simple, predictable authoring contract rather than supporting many unrelated structures in one block. Handle useful variations deliberately; use separate blocks when structures or purposes genuinely differ.

BB-019: Move existing DOM nodes with methods such as `append()` or `replaceChildren()` rather than unnecessarily rebuilding them with HTML strings. This preserves authored attributes and existing element behavior.

BB-020: In the standard eager path, `waitForLCP(LCP_BLOCKS)` loads the first block if its name is in `LCP_BLOCKS`. That block's decoration is on the critical rendering path, so avoid slow work and unnecessary dependencies.

BB-021: Automatically constructing blocks from ordinary authored content rather than explicit block tables. The project-specific entry point is `buildAutoBlocks(main)` in `scripts/scripts.js`.

BB-023: Port `3000`.

BB-024: Use View Page Source, or request the page's `.plain.html` endpoint to inspect the undecorated main-content markup. The browser's Elements panel normally shows the already-modified DOM.

BB-025: `toClassName()`: lowercases text and replaces runs of non-alphanumeric characters with hyphens, removing leading and trailing hyphens.

BB-026: Import `getMetadata` from `../../scripts/aem.js` and call `getMetadata('template')`. A missing value returns `''`.

BB-027: `loadCSS(href)`. It returns a Promise for stylesheet loading.

BB-028: `loadScript(src, attrs = {})`. Pass attributes as an object, for example `loadScript(url, { async: true, crossorigin: 'anonymous' })`.

BB-029: `createOptimizedPicture(src, alt = '', eager = false, breakpoints = [...])`. It returns a `<picture>` containing optimized responsive `<source>` elements and an `<img>`; breakpoint entries specify `width` and optionally `media`.

BB-030: `buildBlock(blockName, content)` takes a block name and content, commonly a two-dimensional array of rows and cells. It returns a detached block `<div>` with the block-name class and nested row/cell `<div>` elements.

BB-031: Call `decorateBlock(block)`, then `await loadBlock(block)`. `buildBlock()` alone neither establishes the loader metadata nor loads the block's code.

BB-032: Automatic discovery expects the block directly inside a wrapper directly inside a section: `main > div > div > div`. Explicitly calling `decorateBlock()` and `loadBlock()` bypasses that discovery requirement, though placement still matters for CSS and section conventions.

BB-033: `loadBlock(block)` is asynchronous. It returns a Promise resolving to the block element.

BB-034: Treat `scripts/aem.js` as shared boilerplate/library code and avoid project-specific edits. Put customization in `scripts/scripts.js` or other project modules so upstream library updates remain straightforward.
