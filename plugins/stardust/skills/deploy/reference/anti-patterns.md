# Anti-patterns — full narratives (lessons paid for the hard way)

Companion to SKILL.md § Anti-patterns. The numbered one-line list inline in SKILL.md is the
contract; this file carries the full story behind each entry. These look reasonable. They
will cost a full reset.

**1. Abstracting prototype sections into "blocks with variants."**
Building one `hero` block with five class-variant treatments (`dark` / `light` / `image` /
`full-bleed` / `with-wave`) seems DRY. In practice the variants don't share enough markup or
CSS to compress; the JS forks too many ways; CSS gets brittle. **Build one block per distinct
prototype section.** Reuse only when sections are byte-identical.

**1b. Merging two prototype bands that have different `data-ground`/surfaces (#58).**
A cinematic/editorial prototype often alternates ground bands — a light `data-ground="dust"`
intro (dark heading) followed by a dark `data-ground="ink"` scene (light heading). Fusing
them into one block rendered on a single ground silently **inverts** the lost band (its
heading flips dark↔light, the design beat vanishes) — lint passes, all content present, only
an eyeball or the `SURFACE/GROUND MISMATCH` probe flag (#59) catches it. If one block must
span >1 ground, reproduce EACH ground as a distinct full-bleed sub-band inside it (a
`.loop-head` light sub-band + the dark scene), never collapse to one. Audit cue: note each
section's `data-ground` before merging; a cross-ground merge must preserve both.

**2. Section-metadata style classes that parallel block variants.**
Defining `.section.dark`, `.section.prose-2col`, `.section.eyebrow`, etc. and applying them
via section-metadata adds a second styling system that overlaps with block CSS. Authors don't
know whether to set `dark` on the section or on the block. Pick one path: **per-block CSS
that paints the entire section.** No section-style classes.

**3. Shared utility modules (waves, animation primitives).**
A wave SVG that all blocks import seems reusable. But each prototype section uses its wave
differently (different dimensions, colors, animation). Inlining the SVG inside the owning
block is more code on paper but eliminates a coupling and makes each block self-contained.

**4. Manually creating button anchors in block JS.**
Code like `cta.className = 'btn-loud'; cta.innerHTML = '<span>…</span>' + ARROW_SVG;`
duplicates the EDS button decorator's job, fights its class-application order, and ties block
JS to specific button classes. **Clone the cell anchor; let `decorateButton()` apply the
class.** Block CSS overrides the global button style only when something is actually
different (size, hover variant).

**5. Building complex block JS to parse and rebuild header/footer.**
The old pattern (fetch flat DA fragment → parse structurally → rebuild DOM) is fragile and
lossy. Static fragments (`fragments/header.html`, `fragments/footer.html`) are injected
verbatim — no parsing, no rebuild. If you find yourself writing block JS for header/footer,
stop. Extract the prototype's header/footer as-is.

**6. `.default-content-wrapper` (or any guess about EDS's section DOM).**
The actual EDS shape is `<div class="section"><div class="default-content">…</div><div
class="block-content">…</div></div>`. Confirm by inspecting a rendered page in the browser
before designing CSS that relies on the wrapping shape.

**7. Doing the audit in too much depth.**
A 22-pattern audit produces abstractions. You only need a per-page section list. Pattern
reuse emerges organically when you find two byte-identical sections.

**8. Building before locking decisions.**
Naming + reuse decisions look small but ripple through every block and content page.
**Surface 3–5 naming questions to the user up front.** Lock answers in writing before any
block code.

**9. Generic placeholder image paths.**
`/img/case-studies/foo.jpg` will 404 unless those images are uploaded. Use the prototype host
URL so what you author renders correctly in EDS preview from day one.

**9b. Absolute-origin URLs baked into block CODE — JS string literals AND CSS
`background-image: url(...)` (#44, #67).**
ANY fixed brand asset referenced from block code — a JS string literal
(logo/icon/watermark/fallback) OR a CSS `background-image: url("…")` (a full-bleed section
wash) — must be root-relative `/img/<brand>/x.png`, NEVER an absolute origin
(`http://localhost:3000/img/...`, a branch `--…aem.page/img/...` host). An absolute origin
passes local QA (the dev server *is* localhost:3000, so it loads) but 404s on every real
environment. **This directly overrides anti-pattern #9 / the Step-9 "fully-qualified host
URL" rule for fixed block assets (#67):** that rule applies ONLY to AUTHORED content
`<img src>` for *uploaded/Media-Bus* assets — fixed imagery in block CSS/JS (section
backgrounds, watermarks, CSS fallbacks) is always root-relative. (Cinematic prototypes lean
on CSS background washes, so this is common.) Gate before deploy:
`grep -rn "http://localhost\|aem\.page/img\|aem\.live/img" blocks/` must be empty (it scans
CSS too).

**10. Touching `head.html` for fonts (preload included).**
Google Fonts `<link>` tags, Adobe Fonts script tags, any CDN-hosted stylesheet, AND
`<link rel="preload" as="font">` lines all belong out of `head.html`. The first three add
DNS/handshake hops and external coupling; the preload looks helpful but it's not — the
metric-matched `body.session` pattern makes preload irrelevant for CLS, and adding it splits
font discovery between two files. Declare `@font-face` in `styles/styles.css` only. Self-host
proprietary brand faces too (for fidelity) and raise the licensing alert (#80) — only keep a
CDN load when you genuinely cannot obtain the font files, and then document the CDN coupling
+ CLS trade-off.

**11. Skipping the metric-matched fallback `@font-face`.**
Without `size-adjust` + `ascent-override` + `descent-override` on a system-font fallback, the
swap from system font → brand font shifts every line of text on the page when the woff2
lands. For a variable brand, lift the calibration from the matching
`@fontsource-variable/<name>` package; for a **non-variable** brand (static weights only, no
published Fallback face), compute it from the woff2 with fonttools (see
reference/font-strategy.md, #11). Rename the override `@font-face` after the system font
(`"Arial"`, `"Times New Roman"`) so any reference to that family in a font stack picks up the
adjusted metrics automatically.

**12. Over-applying the button convention.**
Not every link is a button. Whole-card tile anchors, tel:/mailto: channel values, and styled
text links (e.g. wavelength-underlined "How we work →") are NOT buttons. Authors leave these
as plain `<a>`; per-block CSS styles them. **The convention is for chips with a clickable
boundary; if it's not that, don't apply it.**

**13. Dropping the prototype's max-width container.**
The prototype wraps section content in a centered max-width container (`.wrap` /
`.container`) while the section background bleeds full-width. If your block appends content
straight to the block root, the content runs edge-to-edge at wide viewports. **Recreate the
container** (`block.replaceChildren(wrap)`, or a CSS `max-width: var(--maxw); margin: 0 auto;
padding: 0 24px` on the content). This is the easiest bug to miss because it's invisible at
≤1440px — QA wide. Parallel block agents are especially prone to this: state the rule in each
brief. **The trap is worst on plain-background sections (#37):** agents reliably keep the
wrap on full-bleed *banded* blocks (the colored background makes the edge obvious) but drop
it on sections whose background is the page background — there the missing constraint is
invisible until you measure. EVERY block constrains content to `--maxw`; the only thing that
stays full-bleed is a section *background* (e.g. keep the wrap on the inner grid so a hero's
wash background still spans the viewport). **And the wrapper must be STYLED, not just emitted
(#74):** a block whose JS writes `class="wrap"` but whose CSS never defines
`.{block} .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px }` flushes left
exactly the same — the markup looks right, the rule is just absent (it only shows when no
inner card supplies its own padding). Gate: for every block whose JS emits a
`.wrap`/container class, grep its CSS for the matching rule.

**14. Forgetting `<image-slot>` placeholders have no real assets.**
Claude-design prototypes use `<image-slot>` drop-targets, not `<img>` with real `src`. Don't
hard-code a prototype image URL (it 404s) and don't ship a broken `<img>`. Treat the image as
an **optional** cell and give the block a CSS background fallback so the empty state still
looks right.

**15. Loading the footer twice (block + static fragment).**
The AuthorKit `lazy.js` lazy-loads `utils/footer.js` → `loadBlock(footer)`. With static
chrome fragments (this skill) and no `blocks/footer`, that throws and renders a visible
"Error" box between the last section and the footer. Remove the `utils/footer.js` import from
`lazy.js` during Runtime bootstrap.

**16. Lifting a JS-toggled `opacity:0` reveal.**
Prototypes often hide sections with `.reveal { opacity:0 }` and reveal them via an
inline-`<script>` IntersectionObserver. That script doesn't run in EDS, so the lifted
`opacity:0` makes the content **permanently invisible** — and it looks fine in the prototype,
so it's easy to miss. Render content visible; drop the reveal. (Same root cause as
anti-pattern 5 and the fragment-JS rule: prototype `<script>` never executes after
conversion.)

**17. Injecting a `<main>` element from block JS.**
A block that builds its own layout/view wrapper (common for interactive blocks that swap
views, #33) must NOT use `<main>` — or a bare top-level `<div>` that the foundation reset
matches. The reset hides undecorated sections with `main > div { display:none }`; an injected
`<main>` makes its child `<div>`s direct children of *a* `main`, so they get `display:none`
and the view renders **blank/partial**. It's **silent** — lint passes, no console error; only
the missing content shows it. Use a `<section>` (or keep injected nodes scoped under the
block element, which never trips `main > div`). Don't port a prototype's `<main>` wrapper
literally into block-injected DOM.
