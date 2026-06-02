# pageType taxonomy

Every page in an aem-import-site migration belongs to one of a small
fixed set of `pageType` values. The discriminator drives every
dynamic block, every cross-page filter, and every navigation
relationship — declare it in `helix-query.yaml` from Day 1 and emit
it in every fill script's `renderDA`.

Inventing this discriminator mid-migration (as the wheelercat run
did) forces a full re-index of every published page and risks
inconsistency across templates. Don't.

## The 7 canonical pageType values

| pageType | What it represents | Example URLs |
|---|---|---|
| `detail` | One specific product / unit / SKU / item — the leaf of any catalog tree | `/new/machines/<cat>/988-wheel-loader`, `/used-equipment/<cat>/2024-cat-X`, `/attachments/<cat>/<product>` |
| `listing` | Lists every member of a single category | `/new/machines/large-wheel-loaders` |
| `hub` | Top-level entry; lists sub-listings (or sub-hubs) | `/new`, `/used-equipment`, `/service`, `/parts`, `/rental` |
| `location` | A physical branch / store / dealership | `/about/locations/cedar-city` |
| `info` | Static editorial content (no catalog children) | `/about/services-commitment`, `/blog/<post>` |
| `industry` | Industry-vertical landing (sub-flavor of info) | `/industries/heavy-construction` |
| `portal` | Stub redirecting to an external system (vendor portal, login) | `/login`, `/sis2`, `/visionlink` |

Treat the empty string and missing values as `detail` (the most
common case; reduces fill-script boilerplate). Every fill script's
`renderDA` should emit:

```html
<div class="metadata">
  <div><div>title</div><div>...</div></div>
  <div><div>description</div><div>...</div></div>
  <div><div>template</div><div>wheelercat-<template>-v2</div></div>
  <div><div>category</div><div>...</div></div>          <!-- if applicable -->
  <div><div>pageType</div><div>listing</div></div>     <!-- explicit -->
</div>
```

And `helix-query.yaml` must include the field — **note the lowercase
DOM-side name**:

```yaml
pageType:
  select: head > meta[name="pagetype"]   # DA lowercases the field name
  value: |
    attribute(el, "content")
```

(Yaml key stays camelCase to keep `r.pageType` in the JSON; the
`select` expression matches what DA emits.)

## How each pageType drives dynamic blocks

This is the load-bearing reason for the taxonomy:

| Block variant | Filters by | Selects pages with pageType |
|---|---|---|
| `.cards.related.dynamic` (on detail pages) | same `template` + same `category` + not-self | `detail` (or any non-listing) |
| `.cards.listing.dynamic` (on category-listing pages) | same `category` + same URL prefix | `detail` only |
| `.cards.hub.dynamic` (on hub pages) | URL nested under this hub | `listing`, `location`, `info`, `industry` — i.e. SUB_TYPES (anything that's not detail and not hub) |
| `.cards.locations` (rare custom) | path prefix match | `location` |

The hub block uses a `SUB_TYPES` set that explicitly enumerates the
"non-detail page types eligible to appear in a hub" — keep it
declarative:

```js
const SUB_TYPES = new Set(['listing', 'location', 'info', 'industry']);
```

## Choosing pageType during Phase 1 (mode-pick)

When the orchestrator does template clustering in Phase 0 and
mode-picking in Phase 1, also assign the pageType per template:

```json
{
  "name": "equipment-detail-new",
  "pageType": "detail",
  "count": 249,
  "mode": "C",
  ...
},
{
  "name": "category-listing-new",
  "pageType": "listing",
  "count": 60,
  ...
},
{
  "name": "new-equipment-hub",
  "pageType": "hub",
  "count": 1,
  ...
}
```

A template's pageType determines which fill-script pattern applies
and which dynamic blocks the rendered pages will have.

## Why "industry" is separate from "info"

In practice, industries pages are often dynamic — they list relevant
equipment categories per industry. That's a hub-shape behavior, not
info. Keeping them tagged as `industry` (not `info`) makes future
"list all industries" hubs possible without re-tagging.

Same logic applies if a project has, e.g., `event` pages with their
own listing/calendar shape — add a new pageType.

## Don't over-fragment the taxonomy

Resist the urge to add a pageType per template family (e.g.,
`detail-new`, `detail-used`, `detail-attachment`). The `template`
field already discriminates those; `pageType` is the structural
role, orthogonal to the design treatment.

Rule of thumb: if two templates would use the same dynamic blocks
in the same filter shape, they should share a pageType.
