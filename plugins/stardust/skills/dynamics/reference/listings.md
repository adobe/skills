# Listings — metadata contract and query-index

Blocks that LIST other pages (directories, news/event feeds, "related" rails) read an EDS
**query-index** (a published JSON of pages with per-page properties) instead of frozen cards — when
the source is not editorially curated; that decision stays human and is recorded in the inventory.

## Why it is a PRE-IMPORT gate

What a dynamic block can show is bounded by what each page emits, and an index row carries only
page-intrinsic DOM **or** authored metadata. The metadata a block needs must be decided **before**
the batch import — emitting it per page at write time is one extra row; retrofitting it across
thousands of published pages is a second migration. `stardust/dynamic-features.md § Listings
contract` records it; `helix-query.yaml` at the EDS project root is authored from the same contract.

## What a row can carry

1. **Tier 1 — page-intrinsic DOM** (`h1`, `og:image`, authored links) via CSS selectors in
   `helix-query.yaml`. Zero content change. Meaningful internal links become free facets.
2. **Tier 2 — page metadata** (dates, locations, categories) emitted as `<meta name="…">` through
   each page's metadata block at author time. A metadata row `KEY | VALUE` renders to
   `<meta name="<key lowercased>">`: single-token capitalised keys (`PublishDate` →
   `publishdate`), selectors `meta[name="publishdate"]`, dates as ISO `YYYY-MM-DD`.
3. **NOT relationships.** A flat index cannot express many-to-many. Those need an explicit join
   field in metadata on one side, and the related items must themselves be indexed pages. Without
   that the block stays `static-snapshot` — record it, do not fake it.

## Mechanics

- Scoped indexes: include globs + `target` per index; exclude chrome and search documents; a
  `lang` property per locale tree; a `text` property when search excerpts are wanted.
- **The index builds from the PUBLISHED tree.** A preview-only rollout has an empty index;
  `POST /index/…` answering "requested path returned a 301 or 404" means "not published", not
  "bad selector". Publish per page as a delivery-loop step, then poll `total` until it settles.
- **Publish the index early.** It is the cheapest "is this path ours" oracle and silences library
  code that expects it.
- Localise internal links first, or the index captures source-site URLs as paths.

## Block contract

**Document-first.** The generator writes the listing INTO the document: for a flat listing one row
per item carrying exactly the text the card shows (title link, date, category, address, excerpt);
for a grouped listing a heading row per group, then its item rows; last, one label-list row (a
`<ul>` of the block's UI strings — filter labels, "View details", empty-state copy). The block
renders from rows and reads the index only for what is not text (images, coordinates) and to **top
up** items published after the last write, newest first, client-paged. Re-runs of the generator
recognise their own rows (a link into the listed template set, or the label list) and replace them,
so an index change is a re-run, never a merge. Curated authored rows are preserved verbatim.

Why: served words ÷ rendered words is what Adobe's readability checker scores and what non-rendering
crawlers read — a block that builds 65 cards from the index leaves ~850 words out of the document and
halves the page's score (`deploy/reference/ai-readability.md`). Index-only rendering is right for
thousands of items or per-user results; such a page needs an authored summary in the document.

**Programmatic families.** Pages generated from a dataset (routes, locations, products) are one
listing page each: the generator authors one row per card with the card's text taken from the
dataset row, and the block adds only non-text fields (images, coordinates, live values). A family
authored as an empty block serves no words. Before fanning out, run `deploy/scripts/ai-readability.mjs`
on a sibling sample (§ Verify); fan out only when every sibling reads at the gate bar.

**Verify.** `dynamics-check.mjs` type `listing-rows` on every listing page (authored rows > 0 and
not fewer than the index's first page); a newly published page appears after publish (top-up); for a
programmatic family `deploy/scripts/ai-readability.mjs` on 3–5 sibling pages before fan-out, then the
AI-readability gate on every listing page.
