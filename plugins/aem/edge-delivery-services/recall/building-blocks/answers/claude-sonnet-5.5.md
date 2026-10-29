# claude-sonnet-5.5 — building-blocks recall quiz

Prompt: 32 questions from `../facts.json` (BB-012, BB-022 excluded), no tools, no skill text, "DON'T KNOW" allowed. Run 2026-10-29 via second_opinion.

**Confident:**
- BB-001: Helix, then Franklin. Also "Project Helix" and "Franklin" (the "Helix 5" name is less certain).
- BB-002: `export default function decorate(block)`, a default export.
- BB-003: The block's root DOM element (`div.blockname`).
- BB-004: `loadBlock` awaits the decorate function's result, so async decorators finish before the block is marked loaded.
- BB-005: `/blocks/product-teaser/product-teaser.js` and `product-teaser.css`. The name is lowercased and hyphenated.
- BB-006: JS is optional. A CSS-only block still loads and gets its CSS. The loader tries to import the JS, and a failure is caught and logged.
- BB-007: `<picture>` containing `<source>` elements and an `<img>`, wrapped in a `<p>`.
- BB-008: `<source srcset media>` and `<img src alt loading width height>`. Alt is on the `<img>`.
- BB-009: `class="columns dark wide block"`, with the data attribute `data-block-name="columns"`.
- BB-010: Use a variant class, e.g. `.my-block.dark`, with CSS scoped to it. Avoid a new block or JS unless needed.
- BB-011: Scope every selector with the block's class prefix, e.g. `main .cards ...`.
- BB-013: `cards-wrapper`.
- BB-014: `cards-container`. The section also gets `section`.
- BB-015: It matches the `div.cards-wrapper` as a wrapper for the block, not the block itself. The class name `my-block-wrapper` matches the wrapper of a block named `my-block`.
- BB-023: 3000.
- BB-024: Use `curl` or view-source, or disable JavaScript. DevTools "Elements" shows the decorated DOM.
- BB-025: `toClassName`. It lowercases, replaces non-alphanumerics with `-`, and trims leading and trailing dashes.
- BB-026: `getMetadata('template')`. It returns an empty string when the value is missing.
- BB-027: `loadCSS(href)`. It returns a Promise.
- BB-028: `loadScript(src, attrs)`. The `attrs` object is set as attributes on the script tag.
- BB-029: `createOptimizedPicture(src, alt = '', eager = false, breakpoints)`. It returns a `<picture>` element.
- BB-030: `buildBlock(blockName, content)`. It returns a `div.blockName` with rows and cells as nested divs.
- BB-031: `decorateBlock(block)`, then `loadBlock(block)`.
- BB-033: Asynchronous. `loadBlock` resolves to nothing useful (undefined), after loading CSS and JS.
- BB-034: Don't edit `aem.js`. It is synced from upstream and meant to stay unchanged. Put customizations in `scripts.js` or `delayed.js`.

**Lower confidence, hedge or DON'T KNOW:**
- BB-016: I believe the advice is to avoid suffixes like `-container` and `-wrapper`, since those collide with the section/wrapper classes EDS adds. Hedge if unsure.
- BB-017: Block div > row divs > column divs. Fairly confident.
- BB-018: Keep blocks flexible and use as few content-structure assumptions as practical. The details are vague, so keep the answer short.
- BB-019: Reuse the existing elements by moving them, rather than recreating them. Fairly confident.
- BB-020: The first section's blocks load before LCP, which matters because block code must be lean and not block rendering. Fairly confident.
- BB-021: `buildAutoBlocks` in `scripts.js`. Confident.
- BB-032: Discovery requires the block to be a div inside a section's default-content wrapper in `main`. Hedge. If you decorate and load it yourself, discovery isn't needed.
