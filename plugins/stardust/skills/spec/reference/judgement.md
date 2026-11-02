# Judgement: mapping, catalog, verdicts

The judgement turns measured component trees into EDS blocks — the part a spec cannot automate and the one that
decides whether it is right. Work from crops and data; write the rationale next to every decision.

## The blind rule
A context that has worked on a migration of the same site must not write `mapping.json` or `catalog.json`: hand the
judgement to a fresh context with read bans on the migration's files (the measured effect: reference/evaluation.md).

## mapping.json (spec-map rules)
```json
{
  "direct": { "<component>": { "kind": "block|dynamic|default|metadata|drop|widget", "block": "<name>", "variant": "<v>",
              "dropIfEmpty": true, "keepEmpty": false, "whenKids": false } },
  "layout": ["<wrapper flattened into its children>"],
  "sections": { "<styled wrapper>": { "block": "section-style", "modsMatch": "^(bg-|.*background)" } },
  "nesting": { "<tabs or accordion component>": "tabs" },
  "carousels": { "<carousel>": { "single": { "block": "hero", "variant": "image-slide" }, "multi": { "block": "carousel" } } },
  "rows": { "cards": "cards", "columns": "columns", "video": "video", "form": ["<form component that dominates a row>"] }
}
```
- **default** = authored text, headings, images, buttons, separators: not a block. Runs merge into one row.
- **dynamic** = rendered from data or client code (listings, people, client-rendered slots), authored rows around it.
- **widget** = code only (search, calculators, filters, locators, copy-free forms): one `/widgets/<path>/<name>.html`
  link. Widget when the section carries no authored content — configuration only, or everything arrives from code,
  index, API or user input; block when authors fill rows.
- **rows** (grid rows / column controls): ≥ 3 columns with media → cards; image|text → columns with ratio; text-only →
  columns; a form inside → the form block with aside (no authored copy → widget); a column holding another block → layout only.
- **nesting**: EDS blocks do not nest; blocks inside a tabs/accordion keep their own rows with `nested_in` (fragments).
- **Empty components** are authoring noise unless the rule says otherwise; client-rendered ones are `dynamic`.
- **Generic sites**: shape labels (`section.h2.list`) group look-alike markup, not proven look-alike blocks — decide
  them from contact sheets; row heuristics apply only to AEM grids.

## Deciding ambiguous components
`spec-profile.mjs` gives pages, median text/images/links/forms, parents, children and an example URL (check the
block page counts against it); `spec-sheet.mjs <component>` shows real instances. Typical calls: a one-slide carousel
is a hero; a styled full-width wrapper is a section style; a freeform-HTML component that always renders tiles is
cards; an empty server-rendered slot filled by script is a dynamic block whose content needs capture.

## catalog.json
```json
{ "blocks": { "<block>": { "kind": "block|dynamic|global|widget", "family": "<family>", "description": "…", "aem": ["<components>"],
  "reference": "<existing block or null>", "verdict": "reuse|variant|new", "rationale": "…",
  "variants": { "<variant>": { "verdict": "…", "rationale": "…" } } } } }
```
**Families** (the neutral naming contract shared with the migration and the evaluation): hero, grid, form,
tag-links, sticky-nav, accordion, tabs, video, product-grid, table, map, news-cards, news-list,
event-detail, event-list, statistics, panel, people, location-selector, embed, media-gallery, chart, social-share,
promo-tile, contact-details, featured-product, search, other. Name blocks freely; the family is what scores compare.
`search`, `map`, `location-selector`, `chart` and copy-free `form` are widgets by default; the others are blocks.

**Verdicts** compare with `referenceBlocks`: reuse = the existing block as-is; variant = the existing block plus a
variant class; new. A widget's verdict is `new` (no widget library to reuse yet). Structural reuse is not visual parity: under a pixel-parity target, "reuse" often becomes
"variant" — say which target the verdict assumes.
