# Dynamic listings: metadata contract + query-index (Phases B2, D2)

Sites have blocks that LIST other pages (directories, news/event feeds, grids,
"related" rails). Statically authoring those cards doesn't scale and goes stale —
they should read an EDS **query-index** (a published JSON of pages with per-page
properties). SKILL.md keeps the gate summary; the mechanics are here.

## Why B2 is a PRE-IMPORT gate

What a dynamic block can show is bounded by what each page emits, and an index row
carries only page-intrinsic DOM **or** authored metadata. So the metadata a block
needs must be decided **before** the batch import — emitting it per page at write
time is one extra field; retrofitting it across thousands of already-imported,
already-published pages is a second migration.

Produce two artifacts before Phase C:
1. **`dynamic-blocks-map.md`** — classify every listing-candidate block: dynamic
   (index-driven) vs static (editorial curation), and for each dynamic one, the
   index it reads and the fields its cards need.
2. **The metadata contract** — the concrete `<meta name="…">` fields each content
   TYPE must carry (e.g. a location type → `canton`/`city`/`address`/`phone`; news
   → `publishdate`/`category`; event → `eventdate`/`location`). Fields already
   intrinsic to the DOM (title, image, authored cross-links) need NO metadata —
   only what the DOM lacks.

Then make Phase C's `deploy` brief emit the contract: each authoring agent adds the
type's metadata rows to every page as it writes it. Author `helix-query.yaml` from
the same contract so selectors and emitted names line up. A block whose contract
can't be met from the source (a relationship the source doesn't express) stays
static — record that in the map, don't fake it.

### Metadata key → meta-name mechanics

A metadata-block row `<div><div>KEY</div><div>VALUE</div></div>` renders to
`<meta name="<key lowercased>">`. Use single-token capitalized keys
(`PublishDate`→`name="publishdate"`, `Canton`→`name="canton"`) and make
`helix-query.yaml`'s `select: meta[name="publishdate"]` match. Emit dates as ISO
`YYYY-MM-DD` (sortable).

## What a query-index row can carry (D2)

1. **Page-intrinsic DOM** — `h1`, `og:image`, and links the content already
   authored. Extract via CSS selectors in `helix-query.yaml` (e.g. a record's
   category from `a[href*="/category/"]`). **Zero content change.** Author
   meaningful internal links and they become free index facets.
2. **Page metadata** — anything NOT in the DOM (article/event date, address,
   phone) must be emitted as `<meta name="…">` via the metadata block. Define the
   contract per type up front (B2) and have Phase C emit it. Retrofitting metadata
   across thousands of live pages later is the expensive path.
3. **NOT relationships.** A flat index can't express many-to-many. Those need an
   explicit join field (a `treats:`/`topics:` slug list) in metadata on one side —
   and the related items must themselves BE indexed pages (a block whose cards link
   only to `tel:` has nothing to fetch). Without that, keep the block static.

## The publish gotcha (costs a debugging cycle if missed)

The query-index builds against the **PUBLISHED (live)** tree, not preview. A
preview-only rollout has an EMPTY index — `query-index.json` 404s and
`POST /index/…` returns `"requested path returned a 301 or 404"` per index (that
message means "page not published," not "bad selector"). **Publish pages
(`POST /live/…`) before expecting index rows.** Indexing is async: bulk-publish,
then poll the index `total` until it settles. Make `POST /live/…` a per-page step
of the delivery loop, not a deferred batch, so indexes populate as pages land.

## Localize internal links

Migrated content often keeps absolute source-site URLs (`https://www.source.com/…`);
the index then captures those as paths and on-site nav breaks. Rewrite internal
links to delivered local paths (a Phase C / deploy concern) so index `*Path` fields
are usable as links.

## Deliverables

`helix-query.yaml` (scoped indexes: include globs + `target`), the listing blocks
rewritten to `fetch` their index (chunked for scale, with filter/sort/paginate + an
authored fallback), and `dynamic-blocks-map.md`. Validate one flagship end-to-end
(e.g. a directory + search with a `?q=` hand-off) before converting the rest.
