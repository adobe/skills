# Step 8 — Block JS scaffold and the Experience Workspace editability contract (full text)

Full text of deploy Step 8. Read:
- § 8. Block JS scaffold — before writing any block: the JSDoc + helper + decorate() skeleton (EW1–EW4);
- § Experience Workspace editability contract — before the first block and whenever the EW gate fails (EW1–EW10);
- § The EW gate — when running `ew-editability-probe.mjs` / reading its exit codes;
- § Round-trip gate in the loop — after each block, before deploy (#94);
- § Runtime order — before writing any block that measures, builds another block's DOM, reads icons, or splits text into spans; `block-lint.mjs` checks the grep-able rules;
- § Decode rules — when a block segments, classifies or collects authored content (#42, #55, #70, #69, #76, #57, #56, #62, #61, #48, #52, #53, #35);
- § Interactive blocks — when a section is a stateful component (#28, #33).

## 8. Block JS scaffold

```js
/**
 * <block-name> — <one-line description from prototype data-intent attribute>
 *
 * Authoring rows (positional):
 *   1. <picture> background image
 *   2. eyebrow text
 *   3. headline — render as a REAL heading element, never a bare <div>: the
 *      hero/lead block's headline becomes the page's single <h1>; every other
 *      section title becomes <h2> (sub-items <h3>). (use <strong> for emphasis)
 *   4. body paragraph
 *   5. CTA links — wrap primary in <strong>, secondary in <em>; the EDS link
 *      decorator applies .button.primary / .button.secondary
 *   6..N: card rows — cells: num | label | description
 */

// ── Experience Workspace helpers (EW1–EW4) — copy into every block, no shared import ──
// Wrap an AUTHORED element in a generated wrapper that carries the layout class.
// The element moves (keeps its tag, attributes and data-prose-index); never copy it.
function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}
// CTA label: MOVE the authored <p> (the editor index is on the paragraph) and,
// for card-as-link layouts (EW6), unwrap the inner anchor after reading its href.
function labelWrap(link, className, { unwrap = false } = {}) {
  const w = document.createElement('div');
  w.className = className;
  const par = link.closest('p');
  w.append(par || link);
  if (unwrap && par) link.replaceWith(...link.childNodes);
  return w;
}
// Presentational clones (loop slides, marquee duplicates) must not keep the
// editor's indices — one element per index, and it must be the visible one (EW4).
function stripInstrumentation(el) {
  el.querySelectorAll('[data-prose-index], [data-image-index]').forEach((n) => {
    n.removeAttribute('data-prose-index');
    n.removeAttribute('data-image-index');
  });
  el.removeAttribute('data-prose-index');
  return el;
}
// Read-only classification helper — use for DECISIONS (is this the eyebrow?),
// never to produce displayed text (EW1).
const text = (el) => (el ? el.textContent.trim() : '');
const pic = (cell) => (cell ? cell.querySelector('picture, img') : null);

export default async function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  // 1. QUERY content and CAPTURE traversal starts before moving anything (#42, EW1):
  //    const heading = block.querySelector('h1, h2, h3');
  //    const ps = [...block.querySelectorAll('p')];
  //    const lede = ps.find((p) => !p.querySelector('a, picture, img'));
  //    const ctas = ps.filter((p) => p.querySelector('a'));
  //    const media = block.querySelector('picture, img');
  //    const start = heading ? heading.nextElementSibling : null; // capture BEFORE append()
  // 2. CREATE wrappers that carry the prototype's layout classes:
  //    const box = document.createElement('div'); box.className = 'stage-box';
  // 3. MOVE the authored nodes into them — never textContent/innerHTML/cloneNode/retag:
  //    if (media) box.append(wrapNode(media, 'media'));
  //    if (heading) box.append(wrapNode(heading, 'headline'));   // CSS: .headline :is(h1, h2, h3)
  //    if (lede) box.append(wrapNode(lede, 'lede'));
  //    if (ctas.length) { const a = document.createElement('div'); a.className = 'actions'; a.append(...ctas); box.append(a); }
  //    Sibling walks: `const next = node.nextElementSibling; wrapper.append(node); node = next;`
  // 4. block.replaceChildren(box); — the emptied rows go; the authored nodes already moved.
}
```

## Experience Workspace editability contract (EW1–EW10)

The hard property of stardust output: **any text an author wrote in a DA document is inline-editable in Experience Workspace (da.live canvas, "quick-edit") once the page is decorated by generated block JS — and the block looks the same while it is being edited.** Mechanism: § Target runtime → *Experience Workspace instrumentation*. The generated blocks were correct implementations of the old guidance (value-slotting, `text(cell)`, clone-the-anchor); the guidance was the bug — a 29-page sample measured 841 of 1452 authored texts editable before, 1416 after, with 0 px visual change and every remaining one a declared exemption.

**EW1 — Move authored elements; never rebuild them.** Every authored `h1–h6 / p / ul / ol / pre / blockquote / picture / img` is slotted into the generated layout with `append()`/`prepend()`/`before()`. Never re-create it from `textContent`/`innerHTML`, never `cloneNode` + discard, never retag (an authored `<h2>` stays an `<h2>`; the ENCODE side authors the tag the design needs), never `.trim()`/normalise displayed text (the editor's cursor math uses `textContent` length). Discarding the emptied rows afterwards (`block.replaceChildren(...)`) is fine — the nodes have already moved. When you walk siblings while moving them, capture `nextElementSibling` **before** `append()` — moving a node ends the walk otherwise (a real block dropped every subsidiary link silently).

**EW2 — Wrappers carry layout classes; style the authored element through the wrapper with descendant selectors.** The editor swap re-renders the same tag *without classes or spans* and inserts **two wrapper divs** (`div.prosemirror-editor > div.ProseMirror > <tag>`), so:
- rewrite `h3.headline { … }` as `.headline :is(h2, h3, h4) { … }` — same specificity, same cascade (the element keeps its global heading type and margins), and it still matches the editor's `<h3>`;
- never use child combinators or positional pseudo-classes on the path to an authored element (`.affordance > p`, `header > p`, `:first-child`, `:nth-child`); to exclude a moved CTA paragraph from a lede rule use `header p:where(:not(.affordance p))` (zero-specificity exclusion);
- only when the old rule itself set the type (a bespoke hero headline) does the wrapper carry `font-*` and the inner element gets `font: inherit; color: inherit; margin: 0`;
- `color` on the wrapper must be explicit when spans used to carry it (global `h1–h6 { color }` beats inheritance);
- **sibling rhythm lives on the wrappers.** Each moved `<p>`/heading sits in its own layout wrapper, so a lifted `p + p { margin-top }` never matches again and every text movement loses that gap on the published page; write the rhythm at wrapper level (`.text > * + *`, `.wrap + .wrap`), assert it with the pixel gate / `block-roundtrip` Δh, and keep `--simulate-editor` at 0 drift;
- inner restructuring of the authored element (per-line `<span>`s) is allowed only as a presentation refinement the wrapper does not depend on (a multi-line headline's per-line gap is lost while editing — accepted drift, not a gate failure).

**EW3 — CTAs move as their paragraph.** The index is on the `<p>`, not the `<a>`: `actions.append(a.closest('p') || a)`. `decorateButtons()` already put `.button.primary/.secondary` on the anchor before `decorate()` ran; those classes die while editing, so the foundation ships an **edit-mode repaint** derived from the authored marks (Step 3 (a)) — zero effect on published pages. Classes a block itself adds to an authored anchor or list (`a.link-download`, `ul.icon-list-items`) die the same way: style by element or attribute instead (`.icon-list ul`, `a[href*=".pdf"]`).

**EW4 — Presentational clones strip instrumentation.** Carousel loop slides, marquee duplicates, sticky copies: `stripInstrumentation(clone)` (scaffold helper). One element per index, and it must be the visible one — a duplicated index attaches the editor to the FIRST copy in DOM order, often a hidden clone.

**EW5 — Exempt text is declared, not silently dropped.** Three categories: (a) *text-as-metadata* never displayed (glyph keys, `label | value` keys, variant selectors, video/embed source links, hidden config rows); (b) *derived text* (an ISO date re-rendered as day/month spans) — prefer authoring the displayed form; (c) *index/API-driven blocks* whose authored rows are only the no-JS fallback (press listings, job lists, forms, maps). Declare each in the block JSDoc with a machine-readable tag — `@ew-exempt <p> ISO date (cell 1) — derived`, or `@ew-exempt all — index-driven listing, authored rows are the no-JS fallback` — so the gate whitelists it. A fourth shape — one authored paragraph rendered as N elements (a breadcrumb trail) — cannot be made editable by the block: the ENCODE side must author a `<ul>` (a list is one editable unit).

**EW6 — Card-as-link: unwrap the authored inner anchor in the live DOM** (`link.replaceWith(...link.childNodes)`) after reading its `href`; the indexed paragraph survives inside the card `<a>`, no nested anchors on the published page (`labelWrap(link, 'affordance-wrap', { unwrap: true })`). The editor re-renders the inner link while editing, so the foundation ships `a .prosemirror-editor a:any-link { color: inherit; text-decoration: none }` (Step 3 (b)).

**EW7 — Interactive containers cannot host the editor.** A `<button>` (or `<summary>`) swallows focus and clicks: an accordion title moves into a sibling `div.accordion-title`, the whole headline row takes the click handler, and the button becomes a chevron-only toggle with an `aria-label`. Content hidden at rest (collapsed panels, inactive tabs, non-active slides) is editable but only reachable after the author opens it — keep those controls working inside the workspace (link navigation is blocked there, buttons are not).

**EW8 — Section heads reabsorbed from default content MOVE the wrapper's children** (they are already editable as default content) and remove the empty wrapper (§ Section heads).

**EW9 — Re-entrancy.** `setBody()` re-runs `loadPage()` on a fresh body every time; blocks that adopt sibling sections (tabs, accordions) must move those decorated blocks whole and must not depend on module-level state from the previous run.

**EW10 — Default content styling follows the same selector rules.** Section styles on prose (`main .section.x .default-content-wrapper > p:first-child`, `p:has(picture) + p`) drift in edit mode for the same two-wrapper reason; use descendant selectors and avoid positional pseudo-classes on prose elements (Step 3).

## The EW gate

**The EW gate — run it per block, in the loop.** `block-roundtrip.mjs` runs with `--ew` on by default (below) and fails on a dead non-exempt text or a duplicated index. The standalone probe measures the same thing on a whole page, and `--simulate-editor` performs the editor swap to report font/colour/height drift per text and block height Δ:

```bash
# harness mode — no server, same technique as block-roundtrip
node skills/deploy/scripts/ew-editability-probe.mjs --content content/<page>.html --verbose --simulate-editor
# URL mode — a served page (dev server, preview origin); --blocks-dir lets it read @ew-exempt tags
node skills/deploy/scripts/ew-editability-probe.mjs http://localhost:3000/stardust/.work/harness/page.html --blocks-dir blocks --verbose --simulate-editor
```

Exit 0 = every non-exempt authored text editable, no duplicates; 1 = dead/duplicated; 2 = probe error. Fix by moving the offending element (EW1) or the offending selector to wrapper-descendant form (EW2) — never by weakening the gate. Corollary the two external write-ups missed: `cloneNode(true)` is *not* what kills editing (the clone carries the attribute — that is why clone-based blocks worked while `textContent`-based ones did not); cloning is still wrong (duplicates, stale identity), but the fix is "move", not "avoid clone".

**Sources the contract was verified against** (read them when the mechanism seems to have changed): da.live `blocks/canvas/editor-utils/editor-utils.js` (`getInstrumentedHTML` — what is stamped), `blocks/canvas/ew-editor-wysiwyg/ew-editor-wysiwyg.js`, `blocks/shared/prose2aem.js` (cells keep their `<p>`); da-nx `nx/public/plugins/quick-edit/quick-edit.js` (`setBody` → `loadPage` → `restoreBlockIndices`), `src/prose.js` (`createEditor` swap shape), `src/images.js`, `src/dom-index.js`, `src/selection.js` (cursor math on `textContent` length).

## Round-trip gate in the loop (#94)

**Prove each block's round-trip IN THE LOOP — per block, before deploy (#94).** Step 10's `content-diff` is the post-deploy proof; it must not be where defects are FOUND. After writing a block (and its authored rows), run the harness round-trip:

```bash
node skills/deploy/scripts/block-roundtrip.mjs \
  "http://localhost:8791/<prototype>.html" content/<page>.html --blocks <name>   # omit --blocks for all
```

It decorates the authored content locally with the block's own JS+CSS (the render-harness technique — no DA, no dev server), extracts the role inventory from the decorated section AND the matching prototype section with the SAME classifier as `content-diff` (`skills/deploy/scripts/content-inventory.mjs`), and diffs them. Pass `--map <name>=<selector>` when the prototype section class differs from the block name; `--styles`/`--blocks-dir` when the repo layout isn't `eds/`- or root-level. Exit 2 on any structural 🔴 (MISSING CTA/HEADING/EYEBROW, ROLE SWAP) **or any decorate error** — fix the decode (or the authored rows) and re-run; the block is done when it exits 0. Font forks are deliberately NOT checked here (the harness renders local fonts; faces are Step 4 + Step 10's business). A `decorate errors` line means the block threw mid-run or its JS never installed (the harness INLINES block JS, so a module-scope `import` cannot resolve — inline the helper, or verify that one block via the dev-server harness + Step 10); either way the raw rows can false-match the prototype, so these fail the gate on their own. Template-slotted blocks (#95) still run the gate: it catches slot-fill mistakes and authored-row drift. **With `--ew` (default on) the same run stamps the workspace's `data-prose-index` on the authored editables BEFORE `decorate()` and reports, per block, `editable N/M, dead K, duplicated D, exempt E` — a dead non-exempt text (`DEAD TEXT`) or a duplicated index (`DUPLICATED INDEX`) is a 🔴 alongside MISSING CTA/HEADING (§ contract above); `--no-ew` exists only for diagnosing the role diff in isolation.**

**Copy set for the playwright ESM rule:** when copying these gates into the project (extract SKILL.md § Setup — bundled scripts must run from the project so `import 'playwright'` resolves), copy `skills/deploy/scripts/` — it is now self-contained (the shared role classifier `content-inventory.mjs` + `diff-profiles.mjs` live there; `block-roundtrip.mjs`/`section-schema.mjs` import them locally). Only if you also run the Step-10 advisory `content-diff` do you additionally need `skills/diff/scripts/` (`content-diff.mjs` + `live-session.mjs`, which import back into `../../deploy/scripts/`).

## Runtime order — what has and has not happened when `decorate()` runs

The boilerplate calls `decorate()` at a precise moment: the section is still `display:none`, `decorateButtons` and `decorateIcons` have already run, and only the CSS of blocks authored on the page has been loaded. Seven rules follow; `node skills/deploy/scripts/block-lint.mjs blocks/ scripts/scripts.js` checks the three that are visible in source (BL-CSS 🔴, BL-MEDIA 🔴, BL-GUARD 🟡) and runs in Local QA.

1. **Never cache geometry in `decorate()`.** The section stays hidden until `data-section-status="loaded"`, so `clientWidth`, `offsetHeight`, `getBoundingClientRect()` and scroll extents all read 0 — a carousel caches a 0 page width and its chevrons do nothing; a height reservation collapses to 0 and the published page loses the band. Measure in the handler that needs the number, on `document.fonts.ready`, or from a `ResizeObserver` on the block, and guard `if (h > 0)` before writing a size. Then drive the control in Local QA (#28) — a static render cannot see this class of bug.
2. **A block that builds another block's DOM loads that block's CSS.** The runtime auto-loads `blocks/<x>/<x>.css` only for blocks authored on the page; a parallax or carousel that imports `../teaser/teaser.js` and builds teasers ships them unstyled unless it also ``await loadCSS(`${window.hlx.codeBasePath}/blocks/teaser/teaser.css`)`` (BL-CSS).
3. **Icons are already decorated.** `decorateIcons` has turned every `:name:` into `<span class="icon icon-name"><img …></span>` before your code runs — that `img` is not media. Classify media with `cell.querySelector('picture, img:not(.icon img)')`; a head row consumed as media surfaces in `block-roundtrip` as DROPPED CONTENT.
4. **Main-scope decorators re-run on chrome fragments.** `loadFragment` calls `decorateMain` on the fetched `/nav` and `/footer` documents, so any project decorator added to `decorateMain` in `scripts/scripts.js` runs on the page and again on every fragment — double icons on footer links, an extra wrapped nav row. Make it idempotent with a `data-decorated` guard (BL-GUARD 🟡).
5. **Match `picture, img` with ONE `querySelector`, never `querySelectorAll('picture, img')`.** The pipeline wraps every `<img>` in `<picture>` and the harness never shows it, so the `All` form collects each image twice on the live page only — a 12-logo grid becomes 24 (BL-MEDIA). Collect pictures when present, else imgs.
6. **Line-span splitting keeps a whitespace text node between spans.** `<span>All of</span><span>Streaming</span>` reads as one word to `textContent`, the AI-readability checker and screen readers; append `' '` (or `document.createTextNode(' ')`) between the spans.
7. **Icon colour other than black or inherit is painted by the block, not the runtime.** The runtime delivers icons as `<img>`, which cannot take `color`. Hide the delivered `img` and paint the `span.icon` with `background: currentColor; mask: url(<same icon file>) center / contain no-repeat`, or inline the SVG.

## Decode rules — lead blocks, segmentation, collectors, headings

**Lead/hero blocks: query content, don't hard-index rows (#42).** A hero that reads `rows[3]=headline, rows[4]=lede, rows[5]=CTA` breaks the moment the content shape differs — and the mandatory-metadata / single-`<h1>` SEO rework (#34/#35) actively **consolidates** the headline + lede + CTAs into ONE cell, so the fixed indices come back `undefined` and the hero `.wrap` (the LCP element and the only `<h1>`) renders EMPTY with no error. Decorate lead blocks by querying (`block.querySelector('h1,h2')`; link-bearing `<p>` = CTAs; `picture` from anywhere) so they tolerate BOTH the rich multi-row shape and the consolidated single-cell shape. **Disambiguate eyebrow vs lede by ORDER/length, not "first `<p>`" (#51):** both are link-free `<p>`s, so "first link-free paragraph = lede" swaps them (the short eyebrow comes first). The canonical lead order is **eyebrow → heading → lede**: the eyebrow is the short/uppercase line *before* the heading; the lede is the sentence-length `<p>` *after* it. Local-QA check: after decoration, assert the hero's inner wrap is non-empty and contains the `<h1>`.

**Never build your OWN heading element — MOVE the authored one (#55, EW1).** The old recipe (build a live `<h1>`, clone the cell's `childNodes` into it) produced `<h1><h1>…</h1></h1>` when the cell already carried a heading (#35/#42 encourage that), and even the "unwrap first, clone `inner.childNodes`" fix leaves a dead headline in Experience Workspace — childNodes carry no `data-prose-index`. The rule now: `const heading = cell.querySelector('h1,h2,h3,h4,h5,h6'); box.append(wrapNode(heading, 'headline'))` — the authored tag is the tag (the ENCODE side authors `<h1>` for the lead, `<h2>` elsewhere, #35/#57); the wrapper carries the class; CSS is `.headline :is(h1, h2, h3)`. Only a cell with NO heading element (off-pipeline harness content) falls back to wrapping the bare text — flag that branch in the JSDoc, it never fires on DA content. Local-QA: exactly one `<h1>`, 0 descendant headings inside `.headline`, and the EW gate shows the headline editable.

**Marker injection must be IDEMPOTENT — and must never edit the authored text node (#70, EW1).** When `decorate()` PREPENDS a fixed decorative marker to authored heading/link text (a glyph `▶`, a badge, a `CH NN` number), the author (or the #34/#35 SEO content rebuild) may already type it, so the marker doubles (`▶ ▶ Latest signal`). Resolve it on the GENERATED side: emit the marker as a separate element (`<span class="marker" aria-hidden="true">▶</span>` before the moved heading, or a CSS `::before` on the wrapper) and SKIP emitting it when the authored text already starts with the glyph (`/^\s*▶/.test(heading.textContent)`). Never `replace()` the authored text node — that changes its `textContent` length and breaks the editor's cursor offsets (EW1). Apply the SAME check at EVERY place the block injects that marker (section titles AND card links), not just some. (The deployed eyeball catches a doubled glyph `X X …`.)

**Carousel slide segmentation is HEADING-boundary driven and ORDER-AGNOSTIC (#69).** Segment slides ONLY on the heading boundary — one heading opens one slide (a leading `<picture>` before the first heading may open slide 0). Fold EVERYTHING between two headings into the open slide regardless of authored order (eyebrow/label may come AFTER the heading, not before): first non-link text run = eyebrow, links = CTAs, extra text = description. Never let a post-heading text node open a NEW slide (that steals the heading slot and the CTAs never attach — symptom: N+2 jumbled slides with 0 CTAs). Local-QA: rendered slide count == authored heading count AND each slide's CTA count == authored.

**Split/photo-overlay segmentation: BUFFER the eyebrow that PRECEDES its heading (#76).** Heading-boundary segmentation (#52/#69/#73) opens a new group ON the heading — but in split panels and photo-overlay halves the eyebrow is the small label ABOVE the title, so it arrives BEFORE the heading and a "start collecting after the heading" loop drops it entirely. Worse, the body line after the heading then falls into the now-empty eyebrow slot (inheriting its accent/uppercase paint) and the next group's eyebrow bleeds into the prior group's teaser. Fix: keep a `pendingEyebrow` — any text seen before a heading is buffered and attached to the group that heading opens; once a group already has its body/CTA, further bare text re-buffers as the NEXT group's pending eyebrow (not this group's teaser). This complements #69 (carousel eyebrow may come AFTER the heading): don't hard-assume either order — buffer pre-heading text, classify post-heading text by what's already filled. The content is all in the DOM, so a count check passes while the render is scrambled — Local-QA: assert each group's eyebrow/heading/body/CTA land in their OWN slots (eyebrow text ≠ body text), not just that N groups exist. Hit on beermaker `the-people`.

**Carousel/rotator lead: exactly ONE server `<h1>` across all slides (#57).** A rotating hero authors N slide headlines; if each is an `<h1>`, the delivered HTML has N `<h1>`s (the block may rotate a single live `<h1>` post-JS, but crawlers see all N). Author the **first/primary** slide's headline as the page `<h1>` and every other slide's headline as `<h2>` — the block reads them generically (`querySelector('h1,h2…')`) so the carousel still works, and the server HTML has one `<h1>` (#35). Local-QA: count `<h1>` in the *content* file = 1.

**A multi-row head/intro must be collected whole, not just its first row (#56).** A block that takes "the first row with no image" as the head breaks when the head is authored as N separate single-cell rows (eyebrow / heading / CTA): only the eyebrow becomes the head and the section heading + CTA leak into the item grid as bogus cards (the section title then renders at card-title size). The head is **everything before the first content/image cell** — collect ALL leading no-image rows into the head. (Inverse of #52's flattening.) Local-QA: the item grid holds exactly the expected count, and the section heading renders at section-title size.

**DEFAULT to the DA-flattened single-cell contract (#62 — the root cause of most decode bugs).** When block JS and the content page are generated in the same run, they MUST agree on the row shape — and DA delivers most blocks as ONE row with ONE cell holding all elements as flat siblings, NOT the rich multi-row layout the prototype implies. A block written to a multi-row index contract (`rows[0]=eyebrow, rows[1]=title, rows[2]=cards…`) then reads its whole cell as `rows[0]` and finds `rows[1..]` undefined — rendering 1-of-N (a jumbled hero, a card grid with one card) while passing lint. So make **flatten-first the default**, via a CELL-LEVEL cascade collector (#68/#71) — NOT a single selector and NOT a block-level fallback chain. The trap (#71): a block-level chain (try `:scope>div>div>*` on the whole block, else…) succeeds on the first tier whenever ANY cell has a child element, so in a block that MIXES element cells (`img`/`h1`/`a`) with text-only cells (eyebrow, lede, count, meta, date) it returns only the element cells and **silently drops every bare-text cell** — the most common one-element-per-row DA shape. The canonical collector iterates CELLS and recovers each:
```js
function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    let kids = [...cell.children];
    // #104 — the runtime's wrapTextNodes (decorateBlock) folds any MEDIA-LED or
    // unlisted-first-child cell's ENTIRE content into ONE <p> (first child not in
    // P/PRE/UL/OL/PICTURE/TABLE/H1-6, or PICTURE followed by anything). Expand it
    // back, or every sibling after the image silently vanishes (thumbnails
    // without titles). The roundtrip harness mimics wrapTextNodes, so an
    // unexpanded collector fails the gate instead of shipping.
    if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].children.length
        && kids[0].querySelector('picture, img')) {
      const inner = [...kids[0].childNodes].map((n) => {
        if (n.nodeType === 1) return n;
        // HARNESS-ONLY fallback (EW5): a bare text node inside the wrapper <p>. In DA
        // content every text is already a <p>/<h*> (prose2aem keeps the <p> in every
        // cell), so this branch never fires there; a synthesized <p> is dead in the
        // workspace. Move the TEXT NODE into a fresh <p> (p.append(n)) — never copy
        // its textContent — so the harness and the gate see the same node.
        if (n.textContent.trim()) { const p = document.createElement('p'); p.append(n); return p; }
        return null;
      }).filter(Boolean);
      kids = inner;
    }
    if (kids.length) out.push(...kids);
    // HARNESS-ONLY fallback (EW5) — same rule: wrap the existing text nodes, never
    // synthesize from textContent. Flag the branch in the block JSDoc.
    else if (cell.textContent.trim()) { const p = document.createElement('p'); p.append(...cell.childNodes); out.push(p); }
  });
  return out.length ? out : [...block.children]; // last-ditch: direct children
}
```
`collectNodes()` returns EXISTING authored elements — that is the point: everything it returns is then MOVED into the layout (EW1). The two synthesized-`<p>` branches are harness-only fallbacks for off-pipeline content and must be commented as such; if the EW gate reports a dead text on DA-shaped content, the block is copying text somewhere downstream of the collector.
Then segment/classify the returned nodes by content; one-cell-per-row is a fallback. **Local-QA: assert every block's primary content container is non-empty post-decorate (childCount>0 / height>0)** — a 0-node selector mismatch otherwise renders a silent blank box (a blank hero only surfaces via a per-block height probe; testimonials surfaced as a CONTENT GAP). **Local-QA / Checklist assertion:** after `decorate()`, the rendered count must equal the authored count — the hero wrap is non-empty and has the `<h1>`; a card grid holds N cards (= N repeat-headings in source), never 1. Index-based contracts pass lint but silently render 1/N.

**Card grids that alternate ground: reconstruct the rhythm by INDEX when no marker survives (#61).** A prototype encodes a grid's light/dark alternation structurally (the 2nd card has `--dark`), but that marker does NOT survive into DA content. A block that flips dark only on an explicit authored "dark" cell renders every card light — the dark card's white heading/CTA go invisible (caught by the #59 `SURFACE/GROUND MISMATCH` flag). Fallback to the positional pattern: `const dark = explicitMarker ?? (i % 2 === 1)`. Then scope on-dark button/text overrides to the resulting `.card.dark` block class (#41).

**This applies to EVERY block, not just hero (#48).** The author's row/cell layout is rarely the contract the agent assumed — a block that hard-codes `rows[4] = <dl> data cell` silently drops content when the content authors one `dt|dd` pair per row instead, and a `[num]|[label]` two-cell assumption duplicates the eyebrow when the author wrote a single `"01 — Title"` cell. These are **silent**: the page still renders something, and the metrics-only diff (stretch/flush/blank) does NOT catch a dropped CTA, a duplicated eyebrow, or an empty data grid. Classify rows/cells by content — presence of a heading, a `<picture>`, a link, a number prefix (`/^\d+/`), a 2-cell `dt|dd` shape — never by `block.children[N]`. **When DA flattens content, it becomes "one line per row, delimiters carry structure" (#50) — so DECODE defensively.** (ENCODE is the opposite: when the generator controls authoring, do NOT invent delimiters — lead each sub-field with a preserved tag instead; see **The ENCODE contract**. A block parses delimiters only as a back-compat fallback.) DA/snowflake content rarely preserves the prototype's semantic `<dl>`/`<dt>`/`<dd>`/`<ol>`/`<ul>`/`<li>` — it flattens them to a sequence of single-cell `<p>` rows with INLINE delimiters: `Address: PLACEHOLDER · Brand team to supply` (key:value), `01 · Tabernacle · Imp. Stout · 6.5%` (`·`-delimited spec line), `Heber Valley · Utah · Est 1996` (a plain foot line). So a block that `querySelector('dl, dt')` or `'ol, ul, li'` finds NOTHING and silently drops the whole data table / spec list / menu. **Parse by delimiters, not tags:** split `Key: value` on the first colon into `dt`/`dd`; split `·`-delimited lines into spans; detect a list's start by its preceding heading (`On tap this week`), not an `<ol>`. (Even #48's "one `dt|dd` pair per row" misses this — the row is ONE cell, not two.) Checklist: for any table/spec-list/menu block, assert post-decorate that the data container has the expected non-zero row count.

**Consume EVERY authored element type, or content silently vanishes (the DROPPED CONTENT class).** A decorate() that moves headings, paragraphs and CTAs but not `<ul>` renders authored benefit lists as NOTHING — no error, lint green (the CONTENT was valid; the DECODER dropped it), recorded on two sections. Handle the full default-content set — `h1–h6`, `p`, `ul`/`ol`, `picture`, `table`, `blockquote` — in every block, or end decorate() with a leftovers pass that appends any authored element no named slot consumed (so a dropped type degrades to visible default styling instead of disappearing). The gate: `block-roundtrip` (default `--ew`) reports an authored text whose words are absent from the decorated unit as **DROPPED CONTENT** 🔴, distinct from DEAD TEXT (rebuilt, EW1); both fail the block.

**Repeating card/tile grids: DA flattens N units into ONE cell — segment, don't iterate rows (#52).** A section that is a grid/band of N similar units (a 3-up card grid, a 2-up tile band, a logo row, a team grid) is very often collapsed by DA into a SINGLE cell of a SINGLE row, with each unit's elements (heading, picture, paragraphs, link) as flat siblings. A block written one-DOM-row-per-card then renders **0 cards** (the whole grid collapses into the section header) or **1** — silently dropping every other product/tile. Detect the flattened shape (`rows.length === 1` with multiple headings in the cell) and **segment the flat sibling list into one group per repeating heading**. The repeat-unit boundary is the **most frequent heading tag** in the cell (cards are `h3`; the lone section title is `h2` one level up) — segmenting on "any heading" turns the section title into a phantom first card. Support BOTH the flat-single-cell and the one-row-per-unit shapes. **Segmentation order (#63, #73):** (0) **one-row-per-card** — if ≥2 `:scope > div` ROWS each contain a card heading (`h3`/`h4`), build one group per ROW from `[...row.children]` in AUTHORED field order (treat leading non-card-heading rows as the section head); never assume a `tag → media → heading` field order — content authored `media → tag → heading` otherwise attributes each card's image to the PREVIOUS card and drops the first card's (a 1-of-N image shift that passes a card-COUNT check, #73); ELSE (1) per-card heading boundary if present; ELSE (2) **one card per delimited `<p>` line** — when the cards carry no per-card heading (only the section title), each card is a single `Name · meta · meta · Badge` line (the natural way to author a short card): split on the unit delimiter (`·`), first segment = name, a trailing keyword (`New`/`Limited`/`Sold out`…) = badge, the middle = meta; ELSE (3) one-row-per-unit. This unifies #50 (delimiter parsing) and #52 (card segmentation) for the headingless card/tile rail that falls between them (it silently renders 0 cards otherwise — the section heading still shows, so only the #49 CONTENT GAP / a card-count assert catches it). Local-QA: assert the grid count EVEN WHEN the block found no per-card headings (that's the case that returns 0), AND that each card's image src matches its OWN title (#73 — an image shifted by one passes a count-only check). **Never use `<picture>` as the PRIMARY card boundary (#64):** image-led prototypes tempt "the picture leads each card", but claude-design content is usually image-less (#2), so a picture-keyed split collapses N cards into 1. Segment on the per-card heading first; treat the picture only as a hint for which segment owns the media. (If a grid renders 1-of-N, suspect a picture-keyed boundary with no heading fallback.)

**Classifiers must match the element ITSELF or a descendant (#53), and media must match `picture, img` (#72).** In the flattened shape the segmented "cells" are bare sibling elements (an `<img>`, an `<a>`, an `<h3>`), so `cell.querySelector('img')` returns null and the content silently vanishes. Classify with `el.matches(sel) || el.querySelector(sel)`. For MEDIA, always test `picture, img` (not just `picture`) — un-pipelined/harness content and pasted external URLs deliver a bare `<img>` with no `<picture>` wrapper: `const media = el.matches('picture, img') ? el : el.querySelector('picture, img')` — with ONE `querySelector`, never `querySelectorAll('picture, img')`, which counts each pipelined image twice (§ Runtime order 5). (Likewise A / `Hn`.)

Always pair with a per-section screenshot eyeball (#23) and the `CONTENT GAP` probe flag (#49) — a heading/contentBox-count or main-height delta vs the proto means content was dropped or duplicated.

**Headings — exactly one `<h1>` per page + a real outline (#35).** Prototype headlines are usually styled `<div>`/`<span>`s with no heading semantics. Promote them: the hero/lead block renders its headline as the page's **single `<h1>`**; every other section title renders as `<h2>` (sub-items `<h3>`). Never leave a headline as a bare `<div>` — the `<h1>` is the strongest on-page relevance signal, it's the source of the page `<title>` (#34), and the outline drives crawlers, AI answer engines, and screen readers (WCAG). This applies to **interactive blocks too**: a flow/quiz/dashboard renders its lead title as `<h1>` in its server-visible markup, not just after JS. (Symptom this prevents: a converted page with zero `<h*>` elements, or sibling `<h2>`s with no `<h1>`.)

## Interactive blocks (#28)

**Interactive blocks (#28).** When the prototype section is a stateful component (a selector, a filter, a form that mutates data, a multi-step flow), reproduce it as **one self-contained interactive block that owns the state** — block JS runs, so this is fully supported:
- **Data → keyed authorable rows.** For heterogeneous data, key each row by its first cell (`account | id | name | …`, `txn | date | desc | …`) and parse by key. Homogeneous lists are just one row per item.
- **Behavior → local state + targeted re-render.** Hold a mutable `state` object; write small `render*()` functions (e.g. `renderCards()`, `renderList()`) and re-invoke only the affected one on each interaction — the manual equivalent of a React re-render. A form that mutates data validates, updates `state`, re-renders the affected parts (cards, totals, `<option>`s), and shows a confirmation.
- This mirrors lifting state to a parent in React: if several widgets share data, put them in **one** block rather than trying to sync state across blocks. (Cross-block coordination, if ever needed, is a DOM `CustomEvent`.)
- **Sequential flow vs. addressable views — pick the right decomposition (#33).** A *sequential* flow whose views are entered from one starting point and are not independently addressable (search → results → seats → confirm; an onboarding wizard; a checkout) is **one block** with a `state.view` field and a `render()` dispatcher that `replaceChildren()`s the active view. This is the inverse of #29: *independently-addressable* views with **different chrome** become **multiple pages**. Rule of thumb — sequential-from-one-entry → one block; addressable-with-own-chrome → pages.
- **QA the behavior, not just the paint** — see Local QA: drive each control and assert the state change. (When asserting computed style right after a click, move the pointer off the element and let CSS transitions settle first, or a mid-`transition`/`:hover` read gives a false negative.)
