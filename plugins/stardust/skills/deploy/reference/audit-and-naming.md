# Steps 1–2b — Audit, names + reuse, section schema + decode tier (full text)

Full text of deploy Steps 1, 2 and 2b. Read:
- § 1. Audit — before Step 1: input normalization (JSX pre-render, routed views), the per-page section list;
- § Fingerprint per-instance variation — before writing any block code (#90);
- § 2. Decide names + reuse — before Step 2: D1/D11 triage, naming rules, the questions to lock;
- § 2b. Section schema + decode tier — before Step 2b: `section-schema.mjs`, template-slotted vs reconstructive (#93, #95), component-model shapes.

## 1. Audit (light)

**First, normalize the input to static HTML.** If a prototype is React/JSX (an HTML shell that mounts `.jsx` into `#root`), **pre-render it to static HTML** before auditing (#24). The reliable recipe:
```bash
# 1. serve the prototype's OWN folder with a plain static server (NOT file:// —
#    babel-standalone XHRs the .jsx and file:// CORS-blocks it; the aem dev
#    server CSP-blocks the inline scripts too).
( cd samples/<proto> && python3 -m http.server 8765 & )
# 2. load in Playwright (React/babel load from unpkg — needs internet), wait for
#    mount, capture #root's innerHTML, save it for the block agents to read:
#    page.goto('http://localhost:8765/<file>.html'); waitForTimeout(4000);
#    fs.writeFileSync('stardust/.work/prerender/<proto>.html', root.innerHTML)   # never write into samples/ (user input)
```
From there it converts like an external-CSS prototype (semantic classes + the prototype's `.css`). If it's `<x-dc>` document-content, the sections are still `<section>`/`<div>` elements; just expect inline `style="…"` instead of a `<style>` block. The rest of this skill assumes a static `<main>` exists.

**View behind routing / sign-in (#27).** If the view you want is not the default render (e.g. a signed-in dashboard behind a sign-on flow), **seed the app's persisted state before it boots** rather than capturing the landing page. Many prototypes persist their route to `localStorage`: `page.addInitScript(() => localStorage.setItem('<key>', JSON.stringify({page:'dashboard', user:'Alex'})))` then navigate. Generic alternatives: drive the UI to the view (fill + submit the sign-on form, then capture) or set the router hash/URL. Capture `#root` for the view you actually intend to convert.

Read every prototype's `<main>` markup (skip the `<style>` for now) and produce a per-page section list:

```
home: hero, work, approach, team, clients, closing
approach: approach-hero, manifesto, tenets-detailed, cadence, closing
team: team-hero, team-roster, work-style, recent, careers, closing
…
```

A useful pattern: dispatch a read-only exploration subagent with this exact ask where the harness offers one (Claude Code: the `Explore` agent at thoroughness=quick); otherwise run the search inline. You don't need a 22-pattern punch list — you need filenames + section names. **Resist the urge to "find shared patterns."** Pattern reuse will emerge organically when two sections turn out to be byte-identical.

## Fingerprint per-instance variation (#90)

**Fingerprint per-instance variation BEFORE writing block code (#90).** A section-name list is
copy-level; it does NOT reveal that instances *inside* a repeated group look different — an active
filter chip vs its outline siblings, a filled accent CTA among outline CTAs, image cards vs
image-less title-cards. Those are the details a copy-driven conversion silently flattens (a whole
grid of identical cards, one CTA styled like the rest), and the mandatory gates (one `<h1>`, grids
compute `grid`) still pass. So run the proactive probe up front:
`node skills/deploy/scripts/style-fingerprint.mjs "file://<abs>/<proto>.html"`. For every group of
sibling instances it clusters each instance by a COMBINED signature — computed **style-delta**
(`background/border/color/background-image/weight/align`) AND **structural** (`hasImg`, `hasSvg`,
child count) — and reports any group with >1 cluster as a **candidate** per-instance variation for
the owning block to reproduce. It is advisory: it will also flag legitimate variation (a footer with
one bold link among plain ones), so filter false positives with judgment — but never flatten a real
variant (an active chip, an accent CTA, an image-less card) just because the block treats siblings uniformly.
The structural half is load-bearing: image-vs-image-less cards (and any `:has()`/`:not()`-driven
variant) share the same top-level computed style, so a style-only probe misses them — include the
structural signals. The manifest becomes the block author's checklist; this is the pre-block
complement to Step 10's post-deploy `content-diff` (which catches the same class of miss too late).

## 2. Decide names + reuse — LOCK BEFORE WRITING ANY CODE

Two triage questions come BEFORE naming, per section (record both in the conversion log):

1. **Is it a block at all (D1)?** No repeating units, no bespoke interactive structure → **default content** + a section-metadata `style` value. Not a block, no name needed. **Exception that overrides D1:** a section the dynamic inventory marks `client-only` (calculator, filter, comparison) or modal-bearing gets a dedicated block — flattening it into prose is the recorded way interactive structure was lost.
2. **Does it match a Block Collection pattern (D11)?** Hero, cards, columns, accordion, quote, table, embed, carousel/tabs — if yes, **mirror that block's name and content model** (the authoring shape and row semantics from `github.com/adobe/aem-block-collection`), even when the CSS stays fully bespoke. An author who has seen any EDS site can then author yours. Only sections matching no collection pattern get an invented name.

Naming rules (for the sections that ARE blocks and match no collection pattern):
- Block name = the prototype's `<section class="X">` value, kebab-cased (`hero`, `work`, `closing`, `approach`).
- **Never name a block after a reserved EDS class** (#15). `section`, `block`, `wrap`, and `button` are used by the runtime's section/decoration DOM, and names ending in `-wrapper` or `-container` collide with the wrapper/container classes `decorateBlock` derives (`.<name>-wrapper`, `.<name>-container`) — a block named `section` collides with `<div class="section">` and breaks decoration. When the prototype's section class is generic/reserved (one sample used `class="section"` twice), derive a semantic name from the section's `data-screen-label` / intent instead (`new-products`, `discover`) and carry any modifier like `tinted` as a block variant. The same applies to **variant tokens**: never `icon`, `button`, `primary`, `secondary`, `section`, `block`, `wrapper`, `container`, `appear`, `hidden`, `default-content-wrapper`, `highlight`, nor any bare single-class selector in `styles/styles.css` (`.tinted {` restyles the whole block) — lint VARIANT-COLLIDE (`--styles`).
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

## 2b. Section schema + decode tier — close the round-trip BEFORE writing code (#93, #95)

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
