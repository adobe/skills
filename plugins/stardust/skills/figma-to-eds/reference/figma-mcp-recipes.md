# Figma desktop MCP — validated capture recipes

The Figma desktop MCP (`figma-desktop`) serves whatever file is open
and focused in the desktop app. These recipes were validated against a
real component web kit; follow them instead of improvising — the tool
surface has sharp edges that silently under-report if used naively.

Always pass `clientFrameworks` and `clientLanguages` on every call
(logging-only, but required by the schema).

## Connection

A no-argument `get_metadata` call is the health check. Success with no
selection returns the file's **top-level page list** (id + name) — the
inventory starting point. On error, relay to the user before anything
else: (1) paid seat with Dev Mode access, (2) file permissions,
(3) file open AND focused in the desktop app, (4) "Enable local MCP
Server" toggled in preferences (resets after some app updates),
(5) it's a `/design/` file, not FigJam/Slides. A retry after the user
selects any frame on the canvas often resolves a first-call failure.

## Quirk ledger (each one costs a wrong capture if ignored)

1. **`get_variable_defs` is usage-scoped, not collection-scoped.** It
   returns only variables *bound on the queried node*. A foundation
   page whose swatch tables bind every color variable yields the full
   color set; a typography page whose specimens use text *styles*
   (not variables) yields almost nothing. Never treat one call as
   "the variables of the file". Union calls across foundation pages
   and drill into frames until counts stop growing.
2. **Composite variables come through as pseudo-values.** Font-type
   variables serialize like
   `Font(family: "...", style: ..., size: ..., weight: 350, lineHeight: 1.15, letterSpacing: 0)`
   and effects like `Effect(type: DROP_SHADOW, color: <token>, offset: (x, y), radius: <token>, spread: 0)`.
   Parse these; they carry both token references and resolved numbers.
3. **Page-level `get_metadata` dumps are huge** (hundreds of KB) and
   the harness saves oversized results to a `tool-results/*.txt` file
   as a JSON array `[{type, text}]`. Never read them whole. Extract:
   `jq -r '.[0].text' <file> | grep -E '^\s{0,6}<(section|frame)'`
   to list near-top-level frames with ids, then target those ids.
4. **Well-built kits embed machine-readable spec tables.** Foundation
   pages often carry, as literal text per style row: a token name
   (`font.Body.Body-1.Book`), a token-reference JSON
   (`{"fontSize":"{global.font.fontSize.24}",...}`), and a **resolved
   JSON** (`{"fontSize":"24px","lineHeight":"130%",...}`) — the
   Tokens-Studio format. `get_design_context` on the spec frame
   returns them in the reference code's text nodes. Extract with:
   `jq -r '.[].text' <dump> | grep -oE '<prefix>\.[A-Za-z0-9./ -]+|\{"[a-zA-Z]+[^`]*\}'`.
   This is the primary type-ramp source; prefer it over visual
   inference every time it exists.
5. **`get_design_context` doubles as a resolved-value source.** Its
   generated code references CSS custom properties *with fallback
   values*: `var(--global\/font\/fontsize\/28,28px)` — token name and
   resolved value in one string. Use as a cross-check for recipe 4.
6. **Screenshots follow the canvas.** `get_screenshot` renders the
   node as seen on canvas; pass `contentsOnly: true` only when page
   furniture (annotations, connectors) overlaps the frame. Screenshot
   image data lands in context — capture module screenshots in
   subagents or one at a time, never as a bulk fan-in to the main
   context.

## Standard capture sequence

1. No-arg `get_metadata` → page inventory. Classify pages.
2. Per foundation page: `get_variable_defs(pageId)` → seed token set.
3. Per foundation page: `get_metadata(pageId)` → grep top-level
   frames (recipe 3) → `get_design_context` on spec/ramp frames →
   parse spec tables (recipes 4–5). Union with step 2; record the
   source node id next to every value.
4. Per module page: `get_metadata` for the variant structure,
   `get_screenshot` for the vision reference, `get_design_context`
   only when building that module (it is the most expensive call).
5. Write `_crawl-log.json` with `fetchTechnique: "figma-mcp"`, the
   app/file context, and the quirks encountered — the provenance
   contract requires saying explicitly that nothing was
   browser-rendered.

## Export traps (learned gating real modules)

- **Height caps compound**: full-frame exports of tall nodes are
  height-capped like width; a tall board's export resamples photos
  badly. Prefer scale-1 exports of the exact instance you gate.
- **Some exports bake a canvas ground** (e.g. uniform `#f9f9f9`) even
  when the node has no fill — sample the corners and match the gate
  page's section option to it; distinguish from the checkerboard case.
- **Figma strokes don't displace layout** — kit rules/dividers drawn
  as strokes must be overlays (inset box-shadow / outline), or every
  element below drifts by the stroke width.
- **Kit line boxes are floored** (22×1.3 → 28, not 28.6). For dense
  stacked rows (accordion items, tab rows) pin the line box to the
  kit's floored value or drift compounds per row.
- **`.png` asset URLs may serve JPEG bytes** — check magic bytes
  before trusting the extension.
- **Instance exports can carry a canvas offset** relative to their own
  metadata (observed 60.5px) — verify the export against the node's
  metadata box before gating, crop accordingly.

## Exactness rule

Every captured value is extracted programmatically from a dump
(jq/grep/script) — never retyped from a screenshot or from memory.
Exactness must hold by construction, because the downstream token
probe asserts byte equality.
