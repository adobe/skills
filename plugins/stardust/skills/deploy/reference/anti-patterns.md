# Anti-patterns (lessons paid for the hard way) — full text

Full text of the deploy skill's anti-patterns. Read:
- § Structure and decisions (1–8) — before Step 2 and whenever tempted to abstract, merge grounds or add a parallel style system;
- § Assets and fonts (9–11) — before Step 3/4 and before any `head.html` or block-asset URL edit;
- § Blocks and content (12–17) — while writing block JS/CSS (containers #13/#37/#74, placeholders, reveals, `<main>`);
- § Editability (18–19) — whenever the EW gate or `--simulate-editor` reports a dead text or drift.

## Anti-patterns (lessons paid for the hard way)

These look reasonable. They will cost a full reset.

## Structure and decisions (1–8)

**1. Abstracting prototype sections into "blocks with variants."**
Building one `hero` block with five class-variant treatments (`dark` / `light` / `image` / `full-bleed` / `with-wave`) seems DRY. In practice the variants don't share enough markup or CSS to compress; the JS forks too many ways; CSS gets brittle. **Build one block per distinct prototype section.** Reuse only when sections are byte-identical.

**1b. Merging two prototype bands that have different `data-ground`/surfaces (#58).**
A cinematic/editorial prototype often alternates ground bands — a light `data-ground="dust"` intro (dark heading) followed by a dark `data-ground="ink"` scene (light heading). Fusing them into one block rendered on a single ground silently **inverts** the lost band (its heading flips dark↔light, the design beat vanishes) — lint passes, all content present, only an eyeball or the `SURFACE/GROUND MISMATCH` probe flag (#59) catches it. If one block must span >1 ground, reproduce EACH ground as a distinct full-bleed sub-band inside it (a `.loop-head` light sub-band + the dark scene), never collapse to one. Audit cue: note each section's `data-ground` before merging; a cross-ground merge must preserve both.

**2. Section-metadata style classes that parallel block variants.**
Defining `.section.dark`, `.section.prose-2col`, `.section.eyebrow`, etc. as a styling system for BLOCK sections adds a second path that overlaps with block CSS — authors don't know whether to set `dark` on the section or on the block. The split is by CONTENT KIND, not preference: **block-owned sections are painted entirely by per-block CSS** (variants ride the block's own class); **default-content sections (D1) use the small closed `style` vocabulary from Step 3** — that vocabulary exists ONLY because a prose section has no block to paint it. Never both on one section.

**3. Shared utility modules (waves, animation primitives).**
A wave SVG that all blocks import seems reusable. But each prototype section uses its wave differently (different dimensions, colors, animation). Inlining the SVG inside the owning block is more code on paper but eliminates a coupling and makes each block self-contained.

**4. Manually creating button anchors in block JS.**
Code like `cta.className = 'btn-loud'; cta.innerHTML = '<span>…</span>' + ARROW_SVG;` duplicates the EDS button decorator's job, fights its class-application order, and ties block JS to specific button classes. **Move the CTA's paragraph (`a.closest('p')`) — `decorateButtons()` already classed the anchor before your block ran, and the paragraph carries the workspace's editor index (EW3).** Block CSS overrides the global button style only when something is actually different (size, hover variant).

**5. Reconstructive parsing of chrome content.**
Chrome blocks that heuristically re-classify arbitrary authored content ("first list = nav, second link = CTA, guess the rest") are fragile and lossy — one authored change scrambles the header. Chrome is **template-slotted** (Step 6): the block holds the prototype's chrome DOM and fills fixed role slots from the `/nav`/`/footer` documents' fixed section contract (brand / links / tools). If you find yourself writing open-ended parsing heuristics for header/footer, stop and pin the document contract instead.

**6. Guessing EDS's section DOM instead of inspecting it.**
The vanilla shape is `<div class="section <name>-container"><div class="default-content-wrapper">…</div><div class="<name>-wrapper"><div class="<name> block">…</div></div></div>` — but clones drift. Confirm by inspecting a rendered page in the browser before designing CSS that relies on the wrapping shape, and record it in `runtime-contract.json`.

**7. Doing the audit in too much depth.**
A 22-pattern audit produces abstractions. You only need a per-page section list. Pattern reuse emerges organically when you find two byte-identical sections.

**8. Building before locking decisions.**
Naming + reuse decisions look small but ripple through every block and content page. **Surface 3–5 naming questions to the user up front.** Lock answers in writing before any block code.

## Assets and fonts (9–11)

**9. Generic placeholder image paths.**
`/img/case-studies/foo.jpg` will 404 unless those images are uploaded. Use the prototype host URL so what you author renders correctly in EDS preview from day one.

**9b. Absolute-origin URLs baked into block CODE — JS string literals AND CSS `background-image: url(...)` (#44, #67).**
ANY fixed brand asset referenced from block code — a JS string literal (logo/icon/watermark/fallback) OR a CSS `background-image: url("…")` (a full-bleed section wash) — must be root-relative `/img/<brand>/x.png`, NEVER an absolute origin (`http://localhost:3000/img/...`, a branch `--…aem.page/img/...` host). An absolute origin passes local QA (the dev server *is* localhost:3000, so it loads) but 404s on every real environment. **This directly overrides anti-pattern #9 / the Step-9 "fully-qualified host URL" rule for fixed block assets (#67):** that rule applies ONLY to AUTHORED content `<img src>` for *uploaded/Media-Bus* assets — fixed imagery in block CSS/JS (section backgrounds, watermarks, CSS fallbacks) is always root-relative. (Cinematic prototypes lean on CSS background washes, so this is common.) Gate before deploy: `grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` must be empty (it scans CSS too).

**10. Touching `head.html` for fonts (preload included).**
Google Fonts `<link>` tags, Adobe Fonts script tags, any CDN-hosted stylesheet, AND `<link rel="preload" as="font">` lines all belong out of `head.html`. The first three add DNS/handshake hops and external coupling; the preload looks helpful but it's not — the metric-matched `-fallback` pattern (principle 3) makes preload irrelevant for CLS, and adding it splits font discovery between two files. Declare brand `@font-face` in `styles/fonts.css` and the `-fallback` faces in `styles/styles.css` — nowhere else. Self-host proprietary brand faces too (for fidelity) and raise the licensing alert (#80) — only keep a CDN load when you genuinely cannot obtain the font files, and then document the CDN coupling + CLS trade-off.

**11. Skipping the metric-matched fallback `@font-face`.**
Without `size-adjust` + `ascent-override` + `descent-override` on a system-font fallback, the swap from system font → brand font shifts every line of text on the page when the woff2 lands. For a variable brand, lift the calibration from the matching `@fontsource-variable/<name>` package; for a **non-variable** brand (static weights only, no published Fallback face), compute it from the woff2 with fonttools (Step 4, #11). Declare it as the `<brand>-fallback` face in `styles/styles.css` (the stock `roboto-fallback` convention) and name it SECOND in every stack that uses the brand family.

## Blocks and content (12–17)

**12. Over-applying the button convention.**
Not every link is a button. Whole-card tile anchors, tel:/mailto: channel values, and styled text links (e.g. wavelength-underlined "How we work →") are NOT buttons. Authors leave these as plain `<a>`; per-block CSS styles them. **The convention is for chips with a clickable boundary; if it's not that, don't apply it.**

**13. Dropping the prototype's max-width container.**
The prototype wraps section content in a centered max-width container (`.wrap` / `.container`) while the section background bleeds full-width. If your block appends content straight to the block root, the content runs edge-to-edge at wide viewports. **Recreate the container** (`block.replaceChildren(wrap)`, or a CSS `max-width: var(--maxw); margin: 0 auto; padding: 0 24px` on the content). This is the easiest bug to miss because it's invisible at ≤1440px — QA wide (see Local QA). Parallel block agents are especially prone to this: state the rule in each brief. **The trap is worst on plain-background sections (#37):** agents reliably keep the wrap on full-bleed *banded* blocks (the colored background makes the edge obvious) but drop it on sections whose background is the page background — there the missing constraint is invisible until you measure. EVERY block constrains content to `--maxw`; the only thing that stays full-bleed is a section *background* (e.g. keep the wrap on the inner grid so a hero's wash background still spans the viewport). **And the wrapper must be STYLED, not just emitted (#74):** a block whose JS writes `class="wrap"` but whose CSS never defines `.{block} .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px }` flushes left exactly the same — the markup looks right, the rule is just absent (it only shows when no inner card supplies its own padding). Gate: for every block whose JS emits a `.wrap`/container class, grep its CSS for the matching rule.

**14. Forgetting `<image-slot>` placeholders have no real assets.**
Claude-design prototypes use `<image-slot>` drop-targets, not `<img>` with real `src`. Don't hard-code a prototype image URL (it 404s) and don't ship a broken `<img>`. Treat the image as an **optional** cell and give the block a CSS background fallback so the empty state still looks right.

**15. (Retired.)** Applied only to the legacy AuthorKit runtime (double footer load); vanilla EDS has a single chrome path. Number kept so cross-references stay stable.

**16. Lifting a JS-toggled `opacity:0` reveal.**
Prototypes often hide sections with `.reveal { opacity:0 }` and reveal them via an inline-`<script>` IntersectionObserver. That script doesn't run in EDS, so the lifted `opacity:0` makes the content **permanently invisible** — and it looks fine in the prototype, so it's easy to miss. Render content visible; drop the reveal (or re-wire it in the owning block's `decorate()` — block JS runs). Root cause: prototype `<script>` never executes after conversion (D15 — no code in content).

**17. Injecting a `<main>` element from block JS.**
A block that builds its own layout/view wrapper (common for interactive blocks that swap views, #33) must NOT use `<main>`. The page already has one `<main>` — a second is invalid HTML and a duplicated landmark, and any runtime or probe code that does `document.querySelector('main')` (the runtime's own `loadSections`, the diff probes' inventory extraction) can bind to the WRONG one, silently skipping or double-processing sections. Structural CSS scoped to `main .section`/`main > .section` can also start matching injected DOM it was never meant for. Use a `<section>` (or keep injected nodes scoped under the block element). Don't port a prototype's `<main>` wrapper literally into block-injected DOM.

## Editability (18–19)

**18. Value-slotting: copying authored text into template nodes.**
`slot.textContent = cell.textContent`, `h.innerHTML = heading.innerHTML`, `` `<h2 class="t">${text(cell)}</h2>` `` — every template-slotted and reconstructive block on a real site did this because the old scaffold taught it. It looks perfect on the published page, is **100 % uneditable in Experience Workspace** (the authored element carrying `data-prose-index` was discarded), and no fidelity gate catches it — role round-trip, content-diff and pixel diff all pass. Found by the customer clicking text in the canvas. Node-slot instead: empty slot containers in the template, authored elements MOVED into them (Step 2b, EW1). The `--ew` gate now fails it in the loop.

**19. A class on the authored element (`h3.headline`, `ul.items`, `a.link-download`, `a.button`).**
Editable, but the look collapses the moment the author clicks: the editor re-renders the same tag with no classes and two wrapper divs above it. Wrappers carry the classes; style the authored element as a descendant of the wrapper (`.headline :is(h2, h3)`), by element (`.icon-list ul`) or by attribute (`a[href*=".pdf"]`); repaint buttons from their `<strong>`/`<em>` marks under `.prosemirror-editor` (Step 3, EW2/EW3). The `--simulate-editor` probe measures the drift.
