# gemini-4-argon — building-blocks recall quiz

Prompt: 32 questions from `../facts.json` (BB-012, BB-022 excluded), no tools, no skill text, "DON'T KNOW" allowed. Run 2026-10-29 via second_opinion.

**BB-001:** It was previously known as **Project Helix**, **Franklin** (or Project Franklin), and **AEM Live** (`aem.live`).

**BB-002:** It must export a **default function** (`export default function decorate(block)` or `export default async function decorate(block)`).

**BB-003:** It passes a single argument: the **block's root DOM `Element`** (the `<div class="<block-name> block">`).

**BB-004:** `loadBlock` is an `async` function that `await`s the call to `mod.default(block)` inside a `Promise.all` (alongside `loadCSS`), so the block's `data-block-status` is only set to `'loaded'` (and `loadBlock` only resolves) after the returned Promise settles.

**BB-005:** Lowercase, hyphen-separated folder and files under `/blocks/`: `blocks/product-teaser/product-teaser.js` and `blocks/product-teaser/product-teaser.css`.

**BB-006:** Technically, a JS file is expected because `loadBlock` unconditionally attempts `await import('/blocks/<name>/<name>.js')`. If the `.js` file is missing, the dynamic import fails (logging a 404 console error caught by the `try/catch` in `loadBlock`), while `loadCSS` still loads the `.css` file in parallel and the block status is still updated to `'loaded'`. *(Note: if a block truly needs zero JS, projects usually either include an empty default export `export default function decorate() {}` to avoid the 404 network request, or rely on the caught import failure).*

**BB-007:** It renders a `<picture>` element containing multiple `<source>` elements (for WebP and fallback format across breakpoints) and a fallback `<img>` element inside. (If the image is the only content in its paragraph, the `<picture>` is wrapped in a `<p>`).

**BB-008:** The responsive candidates live in the `srcset` attributes of the `<source>` elements (with `type="image/webp"` and fallback media queries) inside the `<picture>`, while the `alt` text (and fallback `src`, `width`, `height`, and `loading` attributes) lives on the child `<img>` element.

**BB-009:** It gets `class="columns dark wide"` initially in the delivered HTML (and after `decorateBlock` runs, `class="columns dark wide block"`).

**BB-010:** Purely visual variants should be implemented in **CSS only**, by scoping rules to the variant class on the block element (e.g., `.columns.dark { ... }`), without adding branching logic in JavaScript.

**BB-011:** Scoping all selectors in `<block-name>.css` with the block's class name (e.g., `.cards ...` or `main .cards ...`) so styles only apply inside that block.

**BB-013:** `cards-wrapper` (specifically, `decorateBlock` adds `<blockName>-wrapper` to `block.parentElement`).

**BB-014:** `cards-container` (specifically, `decorateBlock` adds `<blockName>-container` to the ancestor `.section` element).

**BB-015:** It matches the immediate parent `<div>` wrapping the `my-block` block element (i.e. `<div class="my-block-wrapper">`, which is a direct child of the `<div class="section">`).

**BB-016:** Avoid `-wrapper` and `-container` suffixes because EDS automatically generates `<block-name>-wrapper` on the parent div and `<block-name>-container` on the parent section, which causes selector collisions.

**BB-017:** A nested `<div>` structure: the block is a `<div class="<block-name>">`, each authored row is a direct child `<div>`, and each authored cell/column within a row is a nested child `<div>` (`div.<block> > div (row) > div (cell)`).

**BB-018:** Avoid overloading a single block to handle multiple distinct content structures or overly complex configuration; instead, keep the content model simple and consistent, or create separate blocks / clear variants so authoring remains intuitive and predictable.

**BB-019:** **Move (re-parent) existing DOM nodes** (e.g., using `append`, `appendChild`, `replaceWith`) rather than serializing/re-parsing HTML strings (`innerHTML`) or recreating elements from scratch, so you preserve attributes, event listeners, responsive `<picture>` structures, and instrumentation (like Universal Editor `data-aue-*` attributes).

**BB-020:** In `loadEager` (`scripts/scripts.js`), only the **first section** (and specifically the **first block** inside it if it holds the LCP candidate, via `loadSection(main.querySelector('.section'), waitForFirstImage)`) is loaded before LCP. This matters because any block that can appear first on a page must execute fast, avoid extra network requests or heavy dependencies, and render its images immediately to hit the 100 PageSpeed / Core Web Vitals target.

**BB-021:** Auto-blocking is the programmatic creation of blocks from regular authored content patterns (such as converting a standalone link or an `<h1>` + `<picture>` sequence into a `hero` block) before standard block decoration runs. It lives in the `buildAutoBlocks(main)` function inside `scripts/scripts.js`.

**BB-023:** Port **`3000`** (`http://localhost:3000`).

**BB-024:** Append `.plain.html` to the page URL (e.g., `http://localhost:3000/path/to/page.plain.html`) or use `curl` / View Page Source (`view-source:`) on the page URL before client-side JS executes.

**BB-025:** `toClassName(name)`. It converts the string to lowercase, replaces any sequence of non-alphanumeric characters (`[^0-9a-z]`) with a single hyphen `-`, and trims leading or trailing hyphens.

**BB-026:** `getMetadata(name, doc)` (e.g., `getMetadata('template')`). It queries `<meta name="..." content="...">` (or `property="og:..."` depending on the attribute) in `<head>` and returns an **empty string `''`** when the metadata tag is missing.

**BB-027:** `loadCSS(href)` in `scripts/aem.js`. It returns a **`Promise`** that resolves when the `<link rel="stylesheet">` finishes loading (or immediately if it is already present in `<head>`).

**BB-028:** `loadScript(src, attrs)`. You pass an object as the second parameter `attrs` (e.g., `{ async: '', type: 'text/javascript', 'data-foo': 'bar' }`), and `loadScript` iterates over its entries and calls `script.setAttribute(attr, value)` on the `<script>` element before appending it to `<head>`.

**BB-029:** `createOptimizedPicture(src, alt = '', eager = false, breakpoints = [{ media: '(min-width: 600px)', width: '2000' }, { width: '750' }])`. It produces and returns a `<picture>` DOM element containing `<source type="image/webp">` elements, fallback `<source>` elements for each breakpoint using query parameters (`?width=...&format=...&optimize=medium`), and a fallback `<img>` with `loading="eager"` or `"lazy"` and `alt`.

**BB-030:** `buildBlock(blockName, content)` takes the block name string (or array) and `content` (which can be a 2D array of cells, a 1D array of rows/cells, an object `{ elems }`, a single DOM Element, or a string). It returns a `<div class="<blockName>">` DOM element populated with nested row `<div>`s and column `<div>`s matching the standard EDS block markup structure.

**BB-031:** You must call **`decorateBlock(block)`** first, followed by **`await loadBlock(block)`** (in that exact order).

**BB-032:** Automatic block discovery (`decorateBlocks(main)`) queries `main.querySelectorAll('div.section > div > div')`—meaning a block must be a grandchild of a `div.section` (wrapped in a `<div>` inside a `<div class="section">`). If you decorate and load a programmatically built block yourself via `decorateBlock(block)` and `loadBlock(block)`, it does **not** need to sit at `div.section > div > div` to be discovered; however, `decorateBlock` will still add `<block>-wrapper` to its immediate parent and `<block>-container` to `.closest('.section')` if one exists.

**BB-033:** `loadBlock(block)` is **asynchronous** (`async function loadBlock(block)` returning a Promise), and it resolves to the **`block` DOM element itself** (`return block;`).

**BB-034:** **Do not edit `scripts/aem.js`**. It is the core EDS runtime library shared across projects and maintained upstream by Adobe; modifying it makes upgrading to newer versions of `aem.js` difficult and risks breaking core page lifecycle, RUM instrumentation, and decoration behavior (all project customizations belong in `scripts/scripts.js` or block files).
