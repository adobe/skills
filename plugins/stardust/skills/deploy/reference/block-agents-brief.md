# Step 7 — Blocks (parallel agents): brief size and the brief template (full text)

Full text of deploy Step 7. Read:
- § 7 and § Brief size and reading discipline — before dispatching any block agent (cluster split, file-pointer briefs, background waits);
- § The brief template — when writing a brief: copy it, fill the lists and the ownership table, keep every pointer as a file + heading (never inline a chapter);
- § Shared cores and variants — before fan-out: what the serial steps must have built, and why variants are classes, not `import()`ed plugins.

## 7. Blocks (parallel agents)

Dispatch one agent per page-archetype cluster (utility pages, services, case studies, etc.). Each agent owns a non-overlapping set of new blocks and content pages. Three to four parallel agents is the sweet spot.

## Brief size and reading discipline

**Brief size and reading discipline.** The brief points at files — `stardust/eds-schema/<page>.json`, the conversion log's triage rows for its pages, this document's §§ 7–8, `davids-model.md` — and never pastes reference text into the prompt. Each agent reads by section (list the headings, then read the range it needs), not the whole file: across twelve field migrations this document (~27k words) was read end to end about twenty times per run, once per dispatched agent; in one recorded run the two conversion agents the harness's no-progress watchdog killed carried the fattest briefs, while a re-dispatch with a lean brief and line-ranged reads finished the same pages. Long-running steps (captures, gates, batch pushes) run in the background with a progress file the agent appends to per page, so the coordinator can read progress instead of waiting blind. The coordinator's own waiting follows the master skill's wait discipline: nothing runs in the foreground past ~2 minutes, no single `sleep` reaches 5 minutes (the prompt-cache window — at deploy-phase context sizes each expiry re-writes the whole prefix), and progress is read from the file at most every 4 minutes.

## The brief template

The brief template:

> Per the project's locked direction: each prototype `<section>` becomes its own EDS block. Lift the prototype's `<style>` for that section verbatim, scope it under the block class (`.block-name .x` instead of `section.x .y`), and rebuild the prototype's DOM through a `decorate(block)` function that consumes EDS table-block input.
>
> **Ownership** — prototypes [list], content pages [list], sections [list]. You create or edit only what the table grants; everything else is read-only, and a change you need elsewhere is a request to the coordinator, never an edit.
>
> | You may create / edit | Read-only |
> |---|---|
> | `blocks/<name>/` for the block names you claimed | every other agent's blocks; shared cores (hero, cards, columns, header, footer) — additive-only: a new variant class, never a rewrite of the core decode |
> | your content pages | `styles/styles.css`, `scripts/*`, `head.html`, `content/nav.html`, `content/footer.html` |
> | `styles/styles-<group>.css` when the coordinator assigned your cluster its own stylesheet | other clusters' stylesheets |
> | helpers and probes prefixed `_<id>-*` (your agent id) | unprefixed helpers — another agent's `_dump.mjs` is not yours to overwrite |
>
> **Block names claimed**: before creating any file, append the block names you intend to create to `stardust/eds-conversion-log.md` § inventory with your agent id; a name already listed there belongs to someone else — reuse that block or choose another name, never overwrite. Write your own rows to `stardust/eds-conversion-log-<id>.md`; the coordinator merges the per-agent logs into the main log when the wave closes (progress goes to the shared ledger, `reference/fan-out.md`).
>
> **Generated content**: a page a generator produced is fixed through the generator, or the hand edit is committed at once — never `git checkout -- content/` to reset pages another agent may have edited since.
>
> **Existing blocks — REUSE, do not recreate**: [list with one-line authoring shape per block].
>
> **Brand tokens** are global in `styles/styles.css`; do not redefine.
>
> **Round-trip contract (#93/#94)**: the page's authored rows AND your block's decode are both written from `stardust/eds-schema/<page>.json` (roles + repeat units — Step 2b); cite the schema path in the block JSDoc. After writing each block, run `node skills/deploy/scripts/block-roundtrip.mjs "<protoURL>" content/<page>.html --blocks <name>` — the block is NOT done until it exits 0 (0 structural 🔴).
>
> **Section layout — reproduce the prototype's max-width container (#13)**: if the prototype section wraps its content in a centered max-width container (`<div class="wrap">` / `.container` / `.inner`), your block MUST recreate it — build the content into a `.wrap` div (`block.replaceChildren(wrap)`), so the colored/section background bleeds full-width but the **content** stays within the page max-width. Only render content edge-to-edge where the prototype section itself is full-bleed (no inner wrapper). Getting this wrong is invisible at ≤1440px and only shows at wide viewports.
>
> **Mobile overrides must match variant specificity (#109)**: a generic mobile rule (`.cards .card-list`) loses to a desktop variant rule (`.cards.color .card-list`) in ANY media query — the media query changes *when* a rule applies, never *how strongly*. Write every mobile override at the variant's own specificity (one override per variant, or `:where()` the variant selectors down). The trap is silent on single-variant blocks and bites the moment a rollout adds variants. Two more mobile/CSS traps: **un-floating columns in a media query loses the float's BFC margin containment (#113)** — the last child's margin escapes (mobile-only, a few px); add `display: flow-root` to the un-floating override. And **a wrapper reset can out-specify the block's own rules (#114)** — `footer .footer > div { padding: 0 }` beats `footer .f-root { padding: … }` silently; keep resets at LOWER specificity than the rules they might shadow (`:where()` them down).
>
> **Flex/grid children — no `<br>`, no bare child rules**: inside a flex or grid container an authored `<br>` becomes a SIZED flex item (recorded: a two-line label splayed across a 120px tile by a ~26px `<br>` item) — emit separate elements instead. And never write a bare `.label > span { display: block }`-style child rule in variant CSS: it out-specifies a lower-specificity `.explore { display: none }` and resurrects hidden elements — scope with `:not()` against every state class the block owns, and verify with a computed-style dump of the child list, not by eye.
>
> **Images — `<image-slot>` placeholders (#2)**: claude-design prototypes use `<image-slot>` custom elements as image drop-targets; there are usually NO real image assets. Treat each image as an **optional** authored cell holding a `<picture>`/`<img>` (`const pic = cell.querySelector('picture, img'); if (pic) …`). When the cell is empty, fall back to the prototype's background treatment (e.g. dark `--ink`, or a placeholder rectangle) via the block CSS so the section still looks right with no image. Leave image cells EMPTY in the authoring snippet. Every content image is an authored `<img src>` — a verified source CDN URL is acceptable, the preview ingester re-hosts it (`reference/encode-contract.md` § Images); an image that varies per row never moves into block JS (`block-lint.mjs` IMG-HARDCODED 🔴).
>
> **Scroll-reveal / JS-hidden content (#14)**: if the prototype hides content behind a class an inline `<script>` toggles on scroll (`.reveal { opacity:0 }` + an IntersectionObserver that adds `.in`), do NOT lift the `opacity:0` — the prototype script does not run in EDS, so the content would be **permanently invisible**. Render it visible; drop the reveal (keep only hover/`:hover` transitions). Honor `prefers-reduced-motion`.
>
> **Interactive / component-driven sections (#17)**: when a section is driven by a component (state, a list loop like `<sc-for>`, conditionals like `<sc-if>`, `{{ }}` bindings, a `data-count` counter, a tab/selector), split it: **data → authorable rows** (one row per list item, with the item's fields as cells) and **behavior → block JS**. Unlike static *fragments*, **block JS runs** — so `decorate()` is the right place to wire click handlers, an IntersectionObserver count-up, tab switching, etc. Render the default/active state in markup; drive the rest from JS-held local state. `{{ }}`/`<sc-for>`/`<sc-if>` are NOT EDS syntax — read them as "loop these rows" / "show one state". **The same split applies to blocks whose data arrives at runtime** — `stardust/dynamic-features.md` rows with disposition `data-fed` or `index-backed`: the block's authored rows ARE the fallback (rendered before any fetch resolves, and what ships if it never does), `decorate()` fetches the `Source` / index and re-renders, and the brief names the endpoint, the fields the cards need, and the failure behaviour. Never author a block whose only content arrives by fetch. The inventory is brief input for every page: `#modal` link markers, player URLs, per-page form endpoints in `scripts/site-config.js`. Patterns: `skills/dynamics/reference/patterns.md`.
>
> **David's Model (the authored-structure contract — `davids-model.md`)**: a prose section with no repeating units and no bespoke structure is DEFAULT CONTENT, not a block (D1 — the Step-2 triage in the conversion log says which of your sections these are); no nested block tables (D2); blocks stay ≤4 columns (D10); if your section matches a Block Collection pattern the conversion log names, follow that block's authoring shape (D11); no code visible as text in cells (D15). Your pages must pass `node skills/deploy/scripts/davids-model-lint.mjs content/<page>.html` with 0 🔴.
>
> **Buttons**: do NOT manufacture button anchors. Author CTAs paragraph-wrapped as `<strong><a>` (primary) or `<em><a>` (secondary) in the content page — `decorateButtons()` classes them (`a.button.primary`/`.secondary`) BEFORE your `decorate()` runs; in block JS, MOVE the CTA paragraph into a `.actions` wrapper (`actions.append(a.closest('p') || a)`) — never clone it (EW3). Block CSS only overrides global button styles when something is genuinely different (e.g. larger size). Text links with flourish (wavelength underline) are NOT buttons — leave as plain `<a>` and style per-block.
>
> **Experience Workspace editability contract (Step 8, EW1–EW10) — every block you write obeys it and passes the EW gate before it is done.** MOVE authored `h1–h6/p/ul/ol/picture` into generated wrappers (`wrap.append(heading)`); never rebuild from `textContent`/`innerHTML`, never `cloneNode` + discard, never retag, never `.trim()` displayed text (EW1). Wrappers carry the layout classes; style the authored element through the wrapper with DESCENDANT selectors (`.headline :is(h2, h3)`), never a class on the authored element and never `>`/`:first-child`/`:nth-child` on the path to it (EW2). CTAs move as their `<p>` (EW3). Presentational clones (loop slides, marquee copies) get `stripInstrumentation()` (EW4). Text you cannot make editable is declared with an `@ew-exempt` JSDoc tag, never dropped silently (EW5). A `<button>`/`<summary>` cannot host the editor (EW7). `block-roundtrip` runs with `--ew` by default: a dead non-exempt text or a duplicated index is a 🔴.
>
> **Runtime order** (`reference/block-js-scaffold.md` § Runtime order): nothing measured inside `decorate()` (the section is hidden — 0 px), `loadCSS` for any block whose builder you import, icons are already `span.icon > img` (not media), one `querySelector('picture, img')` never the `All` form, whitespace between line spans; `node skills/deploy/scripts/block-lint.mjs blocks/` exits 0.
>
> **Served-asset checks** go through `node skills/deploy/scripts/served-check.mjs <url> --grep <marker>` (served CSS/JS/HTML is gzip; a bare `curl | grep` matches nothing and reads as "the fix is not live").
>
> **EDS block convention**: each block at `blocks/<name>/<name>.{js,css}`. JS exports `default async function decorate(block)`. Block input is `<div class="block-name"><div>row<div>cell</div></div>…</div>` (the runtime adds `.block` + `data-block-name` and nests it in `.<name>-wrapper` before your JS runs). CSS scoped under `.block-name`. Inline SVG markup per-block (no shared utility). Honor `prefers-reduced-motion`.
>
> **EDS content page format**: NO `<head>` element (project `head.html` is injected by EDS), empty `<header></header>`/`<footer></footer>`, each top-level `<div>` inside `<main>` is one section holding one block OR default content, section-metadata only as a Step-3 `style` value on default-content sections, no `<style>`/`<script>`, fully-qualified image URLs.
>
> **Done criteria**: [list of paths]; the whole-page `block-roundtrip` on the foundation archetype page (`content/<foundation-page>.html`) still exits 0 after your changes — a regression there is yours to fix before you return. Return a list of new blocks + one-line summary per page.

## Shared cores and variants

Shared cores — hero, cards, columns and the chrome blocks — are built in the serial steps before fan-out (Steps 3–6), so every agent inherits them read-only and extends them additively. A variant is a CSS class on the one block (`.cards.compact`), never a per-variant JS file loaded with `import()` from the core: the gates decode the core only, so a variant plugin's behaviour is invisible to `block-roundtrip` and the QA harness, and one agent's core rewrite silently drops every other agent's variant. When a wave must write code outside blocks (converter encoders, per-group stylesheets, helpers), the ownership table and the block-name claim above are what keep parallel writers apart; the rollout skill's author-only waves point here for that case.
