# Architecture — Static-to-EDS Overlay

## Problem statement

AI codegen tools (Stardust, Mobirise, Relume, Lovable, v0, etc.) produce
polished static HTML+CSS+JS sites. They are great for launch but painful
for non-technical authors to update. We want to keep the generated DOM
exactly as-is while making the editable parts (texts and images)
authorable in Document Authoring.

Constraint: this must work for arbitrary static input, not one specific
generator's output.

## Solution shape

Every artifact is **template-keyed** so multiple templates coexist in
one EDS repo without colliding.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ONE-TIME CONVERTER  (per static page → five kinds of artifact)      │
│                                                                      │
│  static page.html ─┬─► /fragments/<template>/header.html  (code bus) │
│                    ├─► /fragments/<template>/footer.html  (code bus) │
│                    ├─► /templates/<template>.html         (code bus) │
│                    │     ↳ original <main> with [data-slot]          │
│                    │       markers where texts and images sat        │
│                    ├─► /styles/<template>.css             (code bus) │
│                    ├─► /scripts/<template>-animations.js  (optional) │
│                    └─► DA doc (pushed via admin API)                 │
│                          ↳ divs-with-class shape, body fragment      │
│                          ↳ one <div class="blockname"> per block     │
│                          ↳ rows: slot-name | value (paired divs)     │
│                          ↳ <div class="metadata"> in <main> for       │
│                            template/title/og:* meta tags              │
└──────────────────────────────────────────────────────────────────────┘

                      AT REQUEST TIME (browser)

  GET /<path>  →  pipeline serves DA-stored body (divs-with-class)
                  with <meta name="template"> populated from the
                  Metadata block
                       │
                       ▼
       scripts.js loadEager — overlay step:
         1. resolveTemplateName():
              <meta name="template"> || body[data-template] || null
         2. readBlockSlots(main): walk DA-shape divs →
              { blockClassName: { slotName: html, ... } }
         3. start loadCSS('/styles/<template>.css') and
            fetch('/templates/<template>.html') in parallel
         4. applySlotsToTemplate(newMain, slots): for each
              section[class], find [data-slot] elements and
              writeSlot() with element-typed semantics
              (text→innerHTML, img→src/alt, a→href+innerHTML)
         5. main.innerHTML = newMain.innerHTML
         6. main.dataset.overlay = templateName  ← sentinel
         7. await cssLoaded
         8. body.appear → first paint
                       │
                       ▼
       loadLazy:
         - blocks/header/header.js reads main.dataset.overlay,
           fetches /fragments/<template>/header.html
         - blocks/footer/footer.js — same for footer
         - loadSections(main) runs unconditionally (harmless no-op
           on overlay pages — see note below)
                       │
                       ▼
       loadDelayed:
         - if main.dataset.overlay set: load CDN motion deps in
           parallel (Promise.allSettled), then attempt
           /scripts/<template>-animations.js (404 is silent —
           templates without animations don't need it)
                       │
                       ▼
       Final rendered DOM == original static page DOM ✅
```

## Why `loadLazy` needs no overlay guard for `loadSections`

`loadSections(element)` in `aem.js` queries `element.querySelectorAll('div.section')`.
The overlay template (`/templates/<template>.html`) contains the original static page's
`<main>` markup — plain design elements (`<section>`, `<header>`, etc.), **not** EDS
wrapper `<div class="section">` elements. Therefore `loadSections(main)` finds zero
matching nodes and returns immediately: it is a harmless no-op on overlay pages.

The old woven `scripts.js` wrapped this call in `if (!main.dataset.overlay) { ... }` as
a defensive guard, but the guard is unnecessary. The new hook-based approach deliberately
omits it: `loadEager` injects the overlay logic and sets the sentinel, while `loadLazy`
calls `loadSections(main)` unconditionally — with no ill effect on overlay pages.

## Path conventions

| Artifact                | Path                                          |
|-------------------------|-----------------------------------------------|
| Template HTML           | `/templates/<template>.html`                  |
| Page-scoped CSS         | `/styles/<template>.css`                      |
| Header fragment         | `/fragments/<template>/header.html`           |
| Footer fragment         | `/fragments/<template>/footer.html`           |
| Animation engine        | `/scripts/<template>-animations.js`           |
| Local test (drafts)     | `/drafts/<page-slug>.html` (post-pipeline shape) |
| DA content              | `/<da-root>/<page-slug>.html`                 |

Nothing in `head.html` references a specific template. The overlay
engine resolves the template at runtime and loads everything scoped
under that name.

## Where decisions live

| Decision                     | Who decides         | Encoded as                          |
|------------------------------|---------------------|-------------------------------------|
| Which template a page uses   | Author (via DA)     | `<meta name="template">` in DA doc  |
| Page structure / classes     | Original generator  | `/templates/<template>.html`        |
| Header & footer markup       | Original generator  | `/fragments/<template>/header.html` |
| Editable text/image values   | Author              | DA block-table rows                 |
| Block grouping (semantics)   | Converter (LLM)     | `<div class="blockname">` in DA     |
| Slot naming                  | Converter (LLM)     | `data-slot` in template, row key    |

## Why this shape

- **EDS-native.** Templates and fragments are plain HTML files served by
  the code bus. No build step, no edge worker, no extra infra.
- **Single hook point.** Everything custom happens inside `loadEager`,
  before `body.appear` flips. EDS's body-hidden-until-`appear`
  invariant gives a free no-flicker window.
- **EDS decoration is bypassed on overlay main**, not interleaved with
  it. Standard `decorateSections` / `decorateBlocks` assume an
  EDS-shape main (`main > div > div.classname`) and would mis-decorate
  the template (`main > section.classname`). The overlay sets
  `main.dataset.overlay = <name>` as the sentinel; `loadEager` /
  `loadLazy` skip EDS decoration when it's present.
- **Header/footer fragments are raw HTML, fetched directly.** The
  block decorators in `blocks/header/header.js` and
  `blocks/footer/footer.js` `fetch` the static fragment and inject it
  (no DA-shaped table parsing).
- **Cleanly portable to edge.** If raw-HTML parity is later required
  (so `curl` and view-source match the original DOM too), the same
  merge function moves into a Cloudflare worker / pipeline transform
  with minimal change.

## DOM-equality contract

Equality is checked **on the rendered DOM after `loadEager` completes**,
not on the initial HTML response. EDS hides `<body>` until decoration
completes, so users see no intermediate state; humans rendering the
page get pixel-perfect parity; only `curl` / view-source see the
EDS-flavored HTML.

If a future requirement demands raw-HTML parity (SEO crawlers without
JS, view-source inspection workflows, etc.), promote to a
publish-time / edge-merge implementation. The merge logic is identical.

## Slot semantics

Five writer cases in `writeSlot()` (dispatch by target element).
Each branch returns early; cases are checked in this order:

- **Image slots**: `[data-slot]` on `<img>`. Runtime parses an
  `<img>` from the cell value and copies its `src`/`alt`.
- **Picture slots**: `[data-slot]` on `<picture>`. Runtime parses
  a `<picture>` from the cell and replaces the template element
  entirely with it.
- **Link slots**: `[data-slot]` on `<a>`. Runtime parses an `<a>`
  from the cell and copies `href` + `innerHTML`. Falls back to
  setting `innerHTML = value` if the cell has no `<a>`.
- **Background-image slots**: `[data-slot]` on any element with an
  inline `style="background-image:url(…)"`. Runtime parses an
  `<img>` from the cell, extracts its `src`, and writes it back
  into `el.style.backgroundImage`, preserving any other inline
  styles on the element. Use for CSS-driven photos without
  restructuring source markup. Bonus: EDS Media Bus rewrites the
  `<img>` URLs in DA cells to optimised paths
  (`./media_<sha>.jpg?width=…&format=…&optimize=…`), so overlay
  pages get image optimisation for free.
- **Text slots** (default fall-through): any other element with
  `[data-slot]`. Runtime sets `el.innerHTML = value`. Preserves
  inline HTML the pipeline keeps (`<strong>`/`<em>`/`<a>`/`<img>`/
  `<picture>`/`<h*>`/`<p>`); avoid `<b>`/`<i>`/`<u>`/`<mark>`/
  `<br>`/`<span class>` per the preserve-list rules in
  `methodology.md` Generate phase.

- **`data-slot-skip="placeholder"`**: not a slot. Used to mark
  generator-emitted placeholder UIs (e.g. Stardust 0.3.0's
  `data-placeholder="true"` elements, 0.2.0's
  `<span class="placeholder-tag">` markers) that should stay
  visible in the rendered DOM but never appear as authorable
  rows in DA.

## Repeating items

The default pattern for repeating children is **flat indexed slot
names**: `card-1.label`, `card-1.tagline`, `card-2.label`,
`card-2.tagline`, etc. This works for fixed counts but doesn't let
authors add/remove items.

A repeating-table pattern is worth considering when:
- the section has structurally identical items (e.g. stat cards)
- authors are expected to actually add/remove (not just edit copy)

## Design constraints

- **Slot granularity** — text in headings/paragraphs/buttons/links
  plus `<img>`/`<picture>` and background-image elements. Attribute
  slots (`aria-label`, `title`, `alt`, form-input placeholders) are
  not currently exposed as authorable slots.
- **Block boundary detection** — the converter LLM uses semantic
  `<section>` tags as the primary boundary signal. Less-tagged
  inputs require the LLM to segment from layout cues alone.
- **Slot uniqueness** — slot names are block-scoped, with no
  namespacing. The same slot name (e.g. `title`, `eyebrow`) can
  appear in multiple blocks; the runtime matches by `section[class]`
  first, then `[data-slot]` within.
- **CSS strategy** — the original inline `<style>` is extracted to a
  per-template CSS file (`/styles/<template>.css`), loaded
  dynamically by the overlay engine.
- **`<head>` content** — common content (CSP, viewport, project
  scripts) lives in `head.html`. Per-page metadata (title, og:*,
  template) is authored in a DA Metadata block and emitted as
  `<meta>` tags by the pipeline.
