# Dynamic vs static — what to derive at render time

Every multi-thousand-page migration accumulates a tension between
authored static content (verbatim from the source site) and
derived dynamic content (computed at render time from URL, query-index,
or page metadata).

Getting this distinction right BEFORE Phase 4 (fill script) saves
a re-batch later. Default to dynamic for the categories below; default
to static for everything else.

## The decision tree

Author the content **dynamically** (via block JS) when it's:

1. **URL-derivable** — the content can be computed from
   `window.location.pathname` plus a small label-override map.
   - Breadcrumbs
   - Section navigation (sub-nav of current section)
   - "You are here" indicators in headers
   - Active-state highlighting on chrome verbs

2. **query-index-derivable** — the content can be computed by
   fetching `/query-index.json` and filtering.
   - Related-item lists ("more from this category")
   - Category-listing pages (all members of category X)
   - Hub pages (all sub-listings under URL prefix)
   - Recently-added rails
   - Sitemap pages

3. **Count-derivable** — the content is a number computed from a
   filtered query-index result. Use sentinel tokens like
   `<code>LISTING_COUNT</code>` for inline replacement
   (see `aem-import/reference/conventions.md` §1 "DA strips data-*
   on inline tags").
   - "X models available" labels
   - "Showing N of M" pagination strings
   - "Y branches across Z states"

4. **Constant-but-occasionally-changing** — values that apply
   site-wide and would otherwise need touching every page on
   change.
   - Headquarters address, phone, hours (in chrome footer)
   - Brand statements, value props (in chrome)
   - Standard contact CTAs

Author **statically** when content is:

1. **Page-specific prose** that has no algorithmic derivation.
   - About-this-branch paragraphs unique per location
   - Hero copy unique per landing page
   - Editorial articles, blog posts

2. **Manually-curated relationships** that the source site
   editorialized.
   - Related-attachments that the catalog publisher hand-picked
     per detail page (vs algorithmic "same category" relations)
   - Hand-curated cross-promotion strips
   - Featured items on a homepage

3. **Brand-distinctive visuals** that don't reduce to data.
   - Chrome (header / footer fragments)
   - Branded heroes with specific imagery
   - Module-shaped editorial content

## Common false positives — when "static" looks tempting but dynamic wins

### Breadcrumbs
Often authored static because they "feel" like content. **Always
dynamic.** Authoring per-page breadcrumb HTML is pure cost — they're
URL-derivable with a slug→label override map. The
`aem-import-site/reference/admin-api-and-publish-flow.md` §3
"Derive-from-URL blocks" section has the canonical pattern.

### Category-listing card grids
Often start as static rows of cards in DA. **Always dynamic** for
multi-template sites. Authoring 60 listing pages × 20 cards each =
1,200 hand-authored cards that need re-authoring on every catalog
update. The `.cards.listing.dynamic` block pattern (filter by
`category` field in query-index) eliminates all of it.

### Hub category tiles
"List all categories under /new". Often static. **Always dynamic.**
The `.cards.hub.dynamic` pattern handles arbitrary depth and updates
automatically when categories are added.

### Related-product rails
Often static when migrated from a source CMS. **Usually dynamic** unless
the source site's relationships are obviously hand-editorialized.
Same-category filtering covers 80% of relationship needs.

### Counts ("X models", "N locations")
Often hardcoded. **Always dynamic via sentinel tokens.** Hardcoded
counts go stale with every migration delta.

## Common false negatives — when "dynamic" looks tempting but static wins

### Hero copy on hub pages
Often tempting to derive from category metadata. **Static is right.**
The marketing copy on `/service` ("Heavy Equipment Repair Across
Utah") is editorial; algorithmic substitution would be flat.

### Action-page form descriptions
Pages like `/quotes`, `/request-service`. **Static.** The instructions
are page-specific editorial.

### Location-page about-this-branch paragraphs
Editorial content unique per branch. **Static.** No two branches have
the same story.

### Service-capability blurbs
Each service-detail page describes that service. **Static.** Algorithmic
boilerplate would read generic.

## The migration arc

Most projects evolve from static → dynamic over time:

1. **Phase 2 (representative)**: hand-author everything static to see
   the shape clearly. CLS hardening + design iteration happen here.
2. **Phase 3 (hubs)**: author hub pages with dynamic blocks from the
   start (they're inherently dynamic shapes).
3. **Phase 4 (fill script)**: emit dynamic placeholders for blocks
   that will derive (`<div class="breadcrumb"><div><div></div></div></div>`
   instead of authored trail), static for everything else.
4. **Phase 9 (polish)**: convert remaining static-but-derivable content
   to dynamic via the mass-edit recipe
   (`aem-import-site/reference/mass-edit-utility.md`). Common targets:
   converting authored breadcrumbs to empty shells; converting
   hardcoded counts to sentinel tokens.

The mass-edit recipe makes the static-to-dynamic conversion cheap
post-batch, but only AFTER an authored representative page proves
the structure works. Don't try to ship dynamic-everywhere on the
first batch — you'll skip the design review.

## Tradeoffs to acknowledge

**Dynamic content depends on /query-index.json being populated.** A
just-published page won't show up in the index until indexing
completes (5-10 s lag). During the lag window, dynamic blocks fall
back to empty state and self-hide. For most projects this is
imperceptible; for projects with strict pre-launch QA, schedule a
re-index pass before user testing.

**Dynamic content is invisible to authors editing in DA.** A page's
breadcrumb is empty in DA edit view; the trail only appears in the
preview. Make sure authors know which blocks are dynamic so they
don't try to add static content "to fix" the empty-looking block.

**Sentinel tokens leak if the block JS fails to run.** If
`<code>LISTING_COUNT</code>` doesn't get replaced (JS error,
block-name resolution miss), the literal text shows. Build in
defensive try/catch + a fallback "—" replacement; log to console
so editors can spot regressions.
