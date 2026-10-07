# Judgement: mapping, catalog, verdicts

The judgement turns measured component trees into EDS blocks. It is the part a spec cannot automate, and the part
that decides whether the spec is right. Work from crops and data, write the rationale next to every decision.

## The blind rule
Judge from the source site only. A context that has worked on a migration of the same site (its block names, its
fixes) must not write `mapping.json` or `catalog.json`: hand the judgement to a fresh context with read bans on the
migration's files. One measured case: the informed judge scored about 2 points of precision above a blind one —
small, but enough to make an evaluation look better than it is (reference/evaluation.md).

## mapping.json (spec-map rules)
```json
{
  "direct": { "<component>": { "kind": "block|dynamic|default|metadata|drop", "block": "<name>", "variant": "<v>",
              "dropIfEmpty": true, "keepEmpty": false, "whenKids": false } },
  "layout": ["<wrapper flattened into its children>"],
  "sections": { "<styled wrapper>": { "block": "section-style", "modsMatch": "^(bg-|.*background)" } },
  "nesting": { "<tabs or accordion component>": "tabs" },
  "carousels": { "<carousel>": { "single": { "block": "hero", "variant": "image-slide" }, "multi": { "block": "carousel" } } },
  "rows": { "cards": "cards", "columns": "columns", "video": "video", "form": ["<form component that dominates a row>"] }
}
```
- **default** = authored text, headings, images, buttons, separators: not a block. Runs merge into one row.
- **dynamic** = rendered from data or client code (listings, search, people, calculators, client-rendered slots).
- **rows** (grid rows / column controls): ≥ 3 columns with media → cards; image|text → columns with ratio; text-only →
  columns; a form inside → the form block with aside; a column holding another block → layout only.
- **Empty components** are authoring noise unless the rule says otherwise; client-rendered ones are kept (`dynamic`).
- Iterate: `spec-map.mjs` until no component is unmapped; check the block page counts against `spec-profile.mjs`.

## Deciding ambiguous components
`spec-profile.mjs` gives pages, median text/images/links/forms, parents, children and an example URL.
`spec-sheet.mjs <component>` shows real instances. Typical calls: a one-slide carousel is a hero; a styled
full-width wrapper is a section style; a freeform-HTML component that always renders tiles is cards; an empty
server-rendered slot filled by script is a dynamic block whose content needs capture.

## catalog.json
```json
{ "blocks": { "<block>": { "kind": "block|dynamic|global", "family": "<family>", "description": "…", "aem": ["<components>"],
  "reference": "<existing block or null>", "verdict": "reuse|variant|new", "rationale": "…",
  "variants": { "<variant>": { "verdict": "…", "rationale": "…" } } } } }
```
**Families** (the neutral naming contract shared with the migration and the evaluation): hero, grid, marketo-form,
contact-form, tag-links, sticky-nav, accordion, tabs, video, product-grid, table, map, news-cards, news-list,
event-detail, event-list, statistics, panel, people, location-selector, embed, media-gallery, chart, social-share,
promo-tile, contact-details, featured-product, search, other. Name blocks freely; the family is what scores compare.

**Verdicts** compare with `referenceBlocks`: reuse = the existing block as-is; variant = the existing block plus a
variant class; new. Structural reuse is not visual parity: under a pixel-parity target, "reuse" often becomes
"variant" — say which target the verdict assumes.
