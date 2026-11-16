# stardust:deploy: steps 2 and 2b, names, reuse and the section schema

The text of this part of `skills/deploy/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Two triage questions come BEFORE naming, per section (record both in the conversion log):

1. **Default content, block, or widget (D1)?** No repeating units, no bespoke interactive structure → **default content** + a section-metadata `style` value (not a block, no name needed). Otherwise: **widget when the section carries no authored content — configuration only, or everything arrives from code, index, API or user input; block when authors fill rows.** A widget (`https://www.aem.live/docs/widgets`) is code at `widgets/<path>/<name>.html|.css|.js` (+ optional `.json`), authored as ONE paragraph holding only a link whose href contains `/widgets/` — `/widgets/search/site-search.html?q=docs`, query params copied to `data-*` on the widget root; the stock loader renders `div.<name>[data-block-name="widget"][data-source="<href>"]`. Typical widgets: the dynamic inventory's `client-only` and modal-bearing rows (search box/results, calculators, filters, comparisons), copy-free forms, locators, sign-in/account UI the chrome keeps, chat/review mounts — never flattened into prose (the recorded way interactive structure was lost). Content-driven repeated structures (cards, hero, columns, accordion, a countdown with authored rows) stay blocks; a block whose only rows are key-value config is a widget smell.
2. **Does it match a Block Collection pattern (D11)?** Hero, cards, columns, accordion, quote, table, embed, carousel/tabs — if yes, **mirror that block's name and content model** (the authoring shape and row semantics from `github.com/adobe/aem-block-collection`), even when the CSS stays fully bespoke. An author who has seen any EDS site can then author yours. Only sections matching no collection pattern get an invented name.

Naming rules (for the sections that ARE blocks and match no collection pattern):
- Block name = the prototype's `<section class="X">` value, kebab-cased (`hero`, `work`, `closing`, `approach`).
- **Never name a block (or a widget file stem — it becomes the block class) after a reserved EDS class** (#15). `section`, `block`, `wrap`, `button` and `widget` are used by the runtime's section/decoration DOM, and names ending in `-wrapper` or `-container` collide with the wrapper/container classes `decorateBlock` derives (`.<name>-wrapper`, `.<name>-container`) — a block named `section` collides with `<div class="section">` and breaks decoration. When the prototype's section class is generic/reserved (one sample used `class="section"` twice), derive a semantic name from the section's `data-screen-label` / intent instead (`new-products`, `discover`) and carry any modifier like `tinted` as a block variant.
- When the same section appears on multiple pages with identical visual treatment, build ONE block and use it everywhere. The classic example: `closing` CTA at the end of every page.
- When a section appears on multiple pages but looks different (e.g. home `hero` vs case-study `case-hero` vs service `service-hero`), they are different blocks. Prefix with the page archetype.
- When two sections within one prototype share the same visual treatment but different copy (e.g. case-study `discovery` and `decisions` are both 2-col prose with eyebrow + headline), it is fine to merge into one block (`case-prose-2col`) with a single text variant cell ("tinted" / "default"). Use your judgment.

**Scale the naming ceremony to the number of pages.** For a **single-page** conversion where each `<section class="X">` has a self-evident, unique name (`hero`, `quick`, `used`, `stats`…), there are no cross-page reuse decisions to make — just lock `block name = section class` and proceed; don't pepper the user with questions. The questions below matter for **multi-page** sites, where the same-looking section recurs and you must decide reuse vs. archetype-prefixing.

**Surface 3–5 naming questions to the user before writing any block code (multi-page sites):**
- "What's the home hero called? `hero`?"
- "Are the closing CTAs across all pages identical? Same `closing` block?"
- "Should case-study discovery/decisions/solutions be one block or three?"
- "Is the per-service hero distinct from the home hero? Build `service-hero` separately?"

Lock the answers in writing (in `stardust/eds-conversion-log.md` or similar). This is the single highest-leverage step in the whole process.

### 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

The dropped-CTA / role-swap / flattened-variant class has ONE root cause: the authored rows (ENCODE) and the block's `decorate()` (DECODE) are written independently and hoped to be inverses. Two moves close the loop up front; the in-loop `block-roundtrip` gate (#94, Step 8) then proves it closed.

**Emit the section schema — the shared ENCODE/DECODE contract (#93).** Once names are locked, generate the per-section contract both sides are written FROM:

```bash
node skills/deploy/scripts/section-schema.mjs "http://localhost:8791/<prototype>.html" \
  --out stardust/eds-schema/<page>.json
```

Per section it emits the ordered role-classified inventory (heading / eyebrow / cta+href / body — the SAME classifier `content-diff` and `block-roundtrip` measure with, from `skills/deploy/scripts/content-inventory.mjs`) and the repeating-unit groups (count + per-unit composition: headings/ctas/imgs/textRuns, uniform or not). Use it on both sides:

- **ENCODE**: one row per repeat unit, fields in schema order; every schema item appears in the authored content. An item you deliberately drop is a decision recorded in the conversion log — never an accident.
- **DECODE**: the block's JSDoc cites its section's schema path; `decorate()` classifies exactly the roles the schema lists, and the schema's unit count is the post-decorate count assertion (#48/#52).

Cross-check `repeats[].uniform` against the #90 fingerprint: `uniform: false` means a per-instance variant (active chip, accent CTA, image-less card) the block must reproduce, not flatten.

**Pick the decode tier per section — template-slotted vs reconstructive (#95).** Reconstruction is where decode bugs live, so only reconstruct where authors need the structural freedom:

- **Template-slotted = NODE-slotting (fidelity by construction, editability by construction).** For fixed-composition sections whose structure never changes at authoring time (a bespoke hero, a cinematic band, a stat/countdown composition): `decorate()` holds the prototype section's inner DOM as a template literal whose text positions are **empty slot containers** (`<div class="headline"></div>`, `<div class="eyebrow"></div>`, `<div class="actions"></div>`, `<div class="media"></div>`), and MOVES the authored elements into them by role — the authored `<h1>` into `.headline`, the eyebrow `<p>` into `.eyebrow`, each CTA's `<p>` into `.actions`, the authored `<picture>` into `.media`. The wrapper carries the layout class; the authored element keeps its tag, its attributes and its identity. The decorated DOM ships structurally equal to the prototype, so the segmentation-bug class (#48/#52/#56/#76) cannot occur, AND every authored text stays inline-editable in Experience Workspace (EW1/EW2). **Value-slotting — copying authored TEXT into template nodes (`slot.textContent = cell.textContent`, `innerHTML` templates with `${text}` interpolation) — is banned:** it renders pixel-perfect and is 100 % uneditable in the workspace (every template-slotted block on a real site failed this way; anti-pattern 18). Editors still own every line of copy — the content page is unchanged and server-rendered (this is NOT client-injected chrome; #86 doesn't bite). Structure edits need a developer: the right trade for sections whose structure nobody edits.
- **Reconstructive (authorable structure).** For repeating/data sections where authors add/remove units (cards, FAQs, listings, menus): classify + segment defensively per #48/#50/#52 — and let the schema + round-trip gate carry the burden of proof.

Record the tier per block in the conversion log. Default: template-slotted for bespoke one-offs, reconstructive for repeat groups. **Both tiers are subject to the Experience Workspace editability contract (Step 8, EW1–EW10); the gate is `block-roundtrip --ew` (default on) / `ew-editability-probe.mjs`** — a block that passes the role round-trip but leaves a dead text is not done.

**Record two more things per section in the schema (D1/D11 + forward-compat):** sections triaged to default content in Step 2 carry `"defaultContent": true` (the encode side emits prose, not a table — the lint flags a block wrapping bare default content); and every block's authored shape must be expressible as one of the three component-model shapes — **simple** (one property per row), **key-value** (config), or **container** (own rows + one row per child) — so a later Universal Editor adoption needs no content migration (see aem.live "component model definitions"). A shape that fits none of the three is a signal the model is wrong, not that a fourth shape is needed.
