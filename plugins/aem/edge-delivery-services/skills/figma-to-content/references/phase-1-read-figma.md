# figma-to-content: phase 1, read the Figma design

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 1 — Read the Figma design (Figma MCP)

Use a Figma MCP (Claude desktop / IDE / external). **Introspect the actual tool
schemas** — signatures differ between MCP implementations (the local Dev Mode
server often works off the current selection and may not take a `fileKey`; the
remote/desktop server takes `fileKey` + optional `nodeId`). The tools you need,
by capability:

- **Structure** (e.g. `get_metadata`) — the frame's section/layer tree; node
  ids, names, positions, sizes. Derive the section list from the **content
  groups** in visual order (sort by `y`) — **not** the raw child list: full-
  bleed background rectangles, overlays, and decorative shapes are *part of* a
  section (its background), not sections of their own, and a single visual
  section is often split across sibling nodes (e.g. a background rect + a tab
  strip + a text group). Ignore the decorative layers and group the rest into
  sections by position. Usually `fileKey` required, `nodeId` optional. **Some
  MCP servers cap response size — even a single frame's structure dump can
  exceed it; scope the call to the frame or, if that still fails, one section
  at a time. A truncated, garbled, or JSON parse-error response *is* the cap
  being hit — retry narrower; do not read it as "no structure."**
- **Visual** (e.g. `get_screenshot`) — a per-section reference image to
  sanity-check the block/content mapping.
- **Content & assets** (e.g. `get_design_context`) — text, links, and image
  asset download URLs for a node. For the content+code path this also provides
  the layout/structure a new block must reproduce. **Request the lean form** —
  exclude the screenshot from the context call (fetch visuals separately with
  the screenshot tool) and disable any Code Connect lookup (e.g.
  `excludeScreenshot` / `disableCodeConnect`-style options) unless you are
  mapping to a real component library; both add payload and round-trips and can
  push a large response over the transport cap. Icons are usually **component
  instances**, not raster fills — obtain their **SVG** (export/copy as SVG),
  never a PNG, for the `/icons` or DA `/media` reference in Phase 4.
- **Design tokens** (e.g. `get_variable_defs`) — colors, spacing, type. Read
  annotation values and, for new blocks, source token values.

**Call budget & order — Figma MCP calls are rate-limited and payload-capped, so
spend them deliberately rather than re-fetching:**

1. **`get_metadata` first** (scoped to the frame) — the structure/section tree.
   The cheapest orienting call; every later call keys off the node ids it returns.
2. **`get_screenshot` of the whole frame early** — one full-frame reference image
   up front is the anchor you reconcile the section count against (segmentation
   heuristic) and, later, compare the rendered page to (Phase 5 Stage B). Take
   per-section crops afterwards, only for the sections you actually build.
3. **`get_design_context` targeted and lean, per section** — request the lean
   form (exclude the screenshot, disable Code Connect) and scope it to **one
   section's node at a time**. A whole-frame context dump is the single call most
   likely to blow the transport cap.
4. **Asset download last** (`download_assets` / export-as-SVG) — only for the
   assets the **confirmed** plan references, after Phase 2. Don't pull binaries
   for sections that end up reusing an existing block or being cut.

A `429`/rate-limit or a truncated/garbled response is a **budget/cap signal, not
"no data"**: back off, narrow the scope (frame → section), and retry — never read
it as an empty design or as missing access (Phase 0 step 2 draws the same line).

Produce an ordered **section inventory**: `{ sectionNodeId, annotation,
screenshot, content, background }` — capture each section's **background /
theme** (e.g. alternating light and dark sections), because the global token
retheme (Guardrails) recolors blocks but does **not** switch a section's
background: that carries via a `section-metadata` `Style` class or a block's
own defined dark/light variant (Phase 4). Read annotations per
[references/annotation-contract.md](./annotation-contract.md).

> **Segmentation heuristic** — when the frame has no explicit grouping, derive
> the section list like this, not from the raw child order:
> 1. Sort the frame's direct children by `y` (top to bottom).
> 2. **Drop pure-decoration layers** from the section list — full-bleed
>    background rectangles, gradients, blurs, absolutely-positioned shapes with
>    no text or interactive child. Record each as the *background* of the
>    content it sits behind (→ Phase 4 `section-metadata`); don't emit it as a
>    section of its own.
> 3. **Merge siblings that form one visual band** — nodes whose vertical
>    extents overlap or sit within ~one line-height of each other (a background
>    rect + a heading group + a button row are *one* section, not three).
> 4. **Reconcile the count against the screenshot** before resolving: the eye
>    sees the real sections; a mismatch means you over- or under-split — fix it
>    before Phase 2.

> **Placeholder content is common — don't ship it.** Designs routinely contain
> dummy copy (`Lorem ipsum`, a CTA literally labelled "Button" or "Lorem
> Ipsum", the same card title repeated across every card) and unfilled slots
> (empty or transparent image cells, blank stat boxes). Author from the **real
> text and media in the design context** — not from the placeholder and not from
> invented filler. Where it's clearly placeholder, **flag it in the plan and
> confirm the real copy/media with the user** rather than publishing "Lorem
> Ipsum" to a live page. Distinct items (cards, tabs, news entries) need
> **distinct** copy and images — repeated-identical content is itself a
> placeholder smell. If the design *itself* carries only placeholder, you cannot
> manufacture the real content: stop and get it from the user before publish.

> Site chrome (nav bar, footer) is usually **not page body** — in EDS it is
> sourced from separate `/nav` and `/footer` documents via the header/footer
> blocks. Don't author it into the page unless the user asks.
