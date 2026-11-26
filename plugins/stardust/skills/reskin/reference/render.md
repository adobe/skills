# Programmatic render — renderer rules

The page is **generated** from `content-model.json`, never retyped by
hand. The generic renderer covers any donor and site:

```bash
node stardust/scripts/reskin/stream-render.mjs --check <slug…>        # mapping.json valid; exit 0 before rendering
node stardust/scripts/reskin/stream-render.mjs <slug> --register --type <page type> [--localize-images]
```

- `--localize-images` downloads each image to `stardust/prototypes/assets/img/`
  (migrate's root) and mirrors it beside the page as `src="assets/img/…"`, so the
  page shows it from `stardust/reskin/pages/` and `migrate` bundles it with
  default flags.
- `--register` (flow `reskin` only) records the page in `state.json` through
  `state.mjs`: `prototypePath` set to the rendered file and the page advanced to
  `prototyped`, or only to `directed` for a same-type sibling of an approved
  archetype (the status `migrate` renders at the sibling tier).
- `--type <page type>` (with `--register`) writes the page's `type`, the
  archetype name its pages share and the key preflight's `archetypes` check and
  migrate's sibling tier group by. Pass it on every render of a page that has
  none, or preflight fails "no page has a type" and no sibling migrates.

Render the archetype candidates in Phase 4 and the siblings after the archetype
is approved (Phase 6), so they register as `directed`. Every later per-section
decision (a gate fix, a review note, an EDS preview finding) is made in
`mapping.json` or `donor-tokens.json`, re-rendered and re-gated, never in the page
or the EDS blocks alone.

Write a per-archetype renderer (`stardust/reskin/renderers/<archetype>.mjs`) only
where `stream-render` falls short. Either way the renderer:

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
- keeps the donor's image frames and crops each content image to the
  area the source shows: the source's `object-position` (a block option
  in EDS), the upper third where the source shows the image whole; the
  content gate fails a render that shows another area (`gates.md`
  § Image crop);
- takes its surface exclusively from `donor-tokens.json` + the donor
  module patterns assigned in `mapping.md`: it imports `rootTokens`
  from `../../scripts/reskin/render/root-tokens.mjs`, emits its `css`
  first in the first `<style>` and styles through `var(--…)` (per-module
  text styles are `--type-<kebab(key)>-*`: `cardTitle` is
  `--type-card-title-size`, and a camelCase name silently falls back);
  root names the donor does not supply (`absent`) go to the page's
  `flags[]`. Use the rendered-page conventions the Phase 5 probe
  asserts against: content in `<main>`, `.container` for the measure,
  `.btn` for the donor primary button (`gates.md` § Rendered-page
  conventions);
- renders every `mapped` or `new-module` slot as one top-level
  `<section data-slot="<slot id>" data-module="<Mn>">` (`new-module`:
  no `data-module`), in `mapping.md` order — the Figma join reads them
  (`gates.md` § (d));
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

## Header tiers

A header row with a logo and list items is zoned brand / menu /
actions (`mapping-json.md` `chrome.header`). A source list that sits
wholly above another list (content-model `listTop` / `listBottom`; the
logo may span both rows) is the utility bar: a `.utility-bar.tier` above
the row, on the palette's dark band, shown at every width. A list item
whose one link is styled as a button (`buttonLike`, or a `btn` /
`button` class) is an action `.btn`, not a menu link. The deployed gate
fails a header with fewer link rows than the source
(`gates.md` § Nav depth).

## Behaviour

A behaviour the slot's mapping keeps (`mapping-json.md` `behaviour`)
renders with the source's content unchanged; it adds no visible text.
The section gets `data-behaviour` and, per behaviour:

- `tray` — class `tray`, `--tray-height` from the capture, a sentinel
  `div` before the section, and an icon-only toggle labelled by the
  slot's heading (`aria-expanded`, `aria-controls` the flow). While the
  sentinel is below the viewport the tray is pinned to the bottom edge
  at that height; the toggle opens it to 80vh, scrollable. At the end
  of the page it docks in-flow, open.
- `tabs` — the stream before the first panel, then a tablist of the
  captured labels and one `tabpanel` per range, then the rest; the
  source's tablist nodes are not repeated. When the source hid its
  tablist at the capture width, the tablist is hidden at ≥900px and the
  panels sit in `columns` side by side, as in the source. Ignored with
  a warning when a panel range is missing or the layout is `cards`.
- `scroll` — class `scroll`; the flow scrolls past `--scroll-max`.

Under `html[data-stardust-measure]` (set by `measurePrep`) the tray is
docked and open, every tab panel shows and the scroll box is unclamped,
so the gates read the state the Figma frame draws.
