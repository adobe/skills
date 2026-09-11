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

Authored-empty → fetch the index, filter by the current path (category, author, tag), newest first,
client-paged; authored-with-rows → preserve the curated listing verbatim. One block, two modes.
Fallback rows always exist. **Verify.** Index rows equal the authored cards on the listing pages; a
newly published page appears after publish.
