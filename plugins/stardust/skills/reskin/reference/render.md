# Programmatic render — renderer rules

The page is **generated** from `content-model.json`, never retyped by
hand. Write a renderer script per archetype
(`stardust/reskin/renderers/<archetype>.mjs`, modeled on the
experiment's `render-reskin.mjs`) that:

- reads the page's `content-model.json` and interpolates **every**
  visible string, href, and image URL from the model (HTML-escaped) —
  if a string appears in the output HTML but not in the model, the
  renderer is wrong;
- takes each slot's structure from the **ordered stream**
  (`sections[].ordered`, `content-model.md` § The ordered stream):
  kind-tagged nodes in document order, nesting preserved (a CTA
  wrapping its heading and vice versa), `sep` flags marking
  zero-separator inline joins. The stream is **innerText-consistent by
  construction** (its text nodes are sliced from the parent's rendered
  `innerText` — the byte-gate basis), so emitting it verbatim is safe.
  Emit nodes in stream order; emit `sep: ""` neighbours with no
  whitespace between them (inline); never reorder, and never
  reconstruct **order or separators** from `visibleText` — the first
  field run did exactly that (per-type arrays matched greedily against
  `visibleText` as an oracle) and burned three debug rounds on
  duplicate identical strings, both directions of CTA/container
  nesting, and zero-separator inline `li` runs, all of which the stream
  now captures structurally;
- renders `formControl` nodes as **equivalent controls**, not text: a
  `<select>` carrying the captured option texts **verbatim, in order**;
  inputs/textareas carrying value/placeholder — restyled with donor
  tokens (the new-module composition rules apply), never flattened to
  prose and never dropped. A select's option text is part of the
  source's `innerText`, so dropping the control fails the byte gate
  with nothing structured to render from (`content-model.md` § Slot
  taxonomy, formControls);
- carries the metadata block verbatim into `<head>` (title,
  description, canonical, OG, Twitter, JSON-LD — including source
  garbage like broken JSON-LD URLs: fidelity over repair; **flag** such
  items for the human in the run report, never silently fix or
  silently keep);
- takes its surface exclusively from `donor-tokens.json` (emitted as
  CSS custom properties) + the donor module patterns assigned in
  `mapping.md`. Use the rendered-page conventions the Phase 5 probe
  asserts against: content in `<main>`, `.container` for the measure,
  `.btn` for the donor primary button (`gates.md` § Rendered-page
  conventions);
- writes `stardust/reskin/pages/<slug>.html`, self-contained.

## Parsing a node, and unverified slots

Renderers may parse a single node's text apart (split a list-item row
into kicker/date/title) but must **fail loudly** (throw) when a parse
doesn't reproduce the node's text — a silent partial parse is a silent
content drop.

A slot whose `orderedVerified` is `false` is inspected before
rendering, never trusted blind. When inspection shows stream text
genuinely absent from the slot's `visibleText`, the **sanctioned
fallback** is to drop that text before rendering and record the drop in
the model's provenance — filtering ghosts against `visibleText` is the
documented resolution, distinct from the forbidden order-reconstruction
move (`content-model.md` § When `orderedVerified` is false).
