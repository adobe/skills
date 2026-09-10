# Eval: deploy — every generated text is editable in Experience Workspace

## Setup

A project with a renderable static prototype fixture (one page: hero with
eyebrow + `<h1>` + lede + two CTAs; a 3-up card grid whose cards are links;
a carousel/marquee band with looped slides; an accordion; a section head
authored as default content above a repeating block) and a vanilla
aem-boilerplate checkout (`styles/`, `blocks/`, `scripts/`). Impeccable
installed. Node + Playwright available. No DA token is required — the gates
run in harness mode.

## User prompt

"$stardust deploy <prototype>.html — convert this page to EDS blocks and
content, ready to push to DA"

## Expected behavior

The `stardust:deploy` skill is invoked. It:

1. Chooses a decode tier per section (Step 2b) and, for the template-slotted
   ones, writes **node-slotting** decode: the template holds empty slot
   containers and the authored elements are MOVED into them. No block copies
   authored text into a template (`textContent =`, `innerHTML =`, template
   literal interpolation of authored text).
2. Writes every block against the **Experience Workspace editability
   contract (EW1–EW10)**: authored `h*/p/ul/ol/picture` are moved with
   `append()`; wrappers carry the layout classes; block CSS styles authored
   elements as wrapper descendants (`.headline :is(h1, h2, h3)`), never via a
   class on the authored element and never through `>`/`:first-child`; CTA
   paragraphs move whole (`a.closest('p')`); carousel/marquee clones are
   passed through `stripInstrumentation()`; the accordion title lives in a
   `div`, not inside the `<button>`; the reabsorbed section head MOVES the
   default-content wrapper's children.
3. Ships the three edit-mode foundation snippets in `styles/styles.css`
   (CTA repaint from `<strong>/<em>` marks under `.prosemirror-editor`,
   `a .prosemirror-editor a:any-link` inheritance, `:where()` wrapper
   variants for every styled-text-link utility it introduces).
4. Runs `block-roundtrip.mjs` per block with `--ew` on (default) and the
   whole-page run before declaring done: **0 dead texts outside declared
   `@ew-exempt` tags, 0 duplicated indices**, alongside 0 structural 🔴.
5. Runs `ew-editability-probe.mjs --content … --simulate-editor`: 0
   font/colour/line-height drift per text, block height Δ ≤ 2 px.
6. Any text it cannot make editable is declared in the block JSDoc with an
   `@ew-exempt` tag in one of the three categories (metadata / derived /
   index-driven) and listed in the conversion log — never dropped silently.
7. Fidelity is not traded for editability: the role round-trip still closes
   (0 structural 🔴) and, where a previous version of a block exists, the
   published render is pixel-identical at 1440 (`body > header` hidden).

## Failure modes this eval pins against

- Value-slotting (copying authored text into template nodes) in any block —
  pixel-perfect and 100 % uneditable.
- Cloning the CTA anchor or `childNodes` instead of moving the paragraph.
- A layout class on the authored element (`h3.headline`, `ul.items`,
  `a.link-download`) or a `>`/`:nth-child` path to it.
- Carousel/marquee clones keeping `data-prose-index` (editor attaches to a
  hidden copy).
- Authored text inside a `<button>`/`<summary>`.
- Declaring the page done with `--no-ew`, without the probe, or with dead
  texts that are not declared `@ew-exempt`.
- Passing the EW gate by rendering less (a dropped CTA/heading also removes
  its dead text — the role round-trip must still be 0 🔴).
