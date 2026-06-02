# Page-shape inventory — what to expect in any catalog/dealer migration

Most multi-thousand-page catalog/dealer/services sites cluster into a
small set of page shapes. Knowing the inventory upfront lets Phase 0
(template clustering) move faster and Phase 1 (mode-picking) pick
sensible defaults per shape.

This is the default planning inventory. When walking a source sitemap,
expect roughly these buckets in roughly these proportions:

| Shape | Typical count range | pageType | Fill-script complexity | Suggested mode |
|---|---:|---|---|---|
| **Home** | 1 | (root) | High (one-off design) | A (from prototype) |
| **Detail — product family A** | 100-10,000 | `detail` | Medium (templated extraction) | C (build direct, batch) |
| **Detail — product family B, C, …** | 100-10,000 ea. | `detail` | Low (variant of A) | C (extend A's fill script) |
| **Category listing** | 30-200 | `listing` | Low (mostly the dynamic block) | C (one fill script for all) |
| **Top-level hub** (chrome verb destination) | 5-12 | `hub` | Low (mostly the dynamic block) | A (author each manually) |
| **Sub-hub / category landing** | 10-30 | `hub` or `info` | Low | A |
| **Location / branch** | 5-100 | `location` | Low-Medium (per-page extraction) | C (one fill script for all) |
| **Industry / vertical landing** | 5-30 | `industry` | Low-Medium | C |
| **Action page** (quote / contact / request / finder) | 3-10 | `info` | Low (mostly editorial) | A |
| **Portal stub** (login / external system) | 3-10 | `portal` | Trivial (link to external URL) | A |
| **Service / capability hub + sub-pages** | 1 hub + 5-20 children | `hub` + `info` | Low | A |
| **Blog / news posts** | 10-1,000 | `info` | Low (templated) | C |
| **Generic info pages** (about, careers, terms) | 30-300 | `info` | Low | C with filter |

## Total page-count rough-cut

Sum across the inventory and you typically get:

- **Small site** (< 200 pages): home + ~5 hubs + 1-2 detail templates +
  ~50 listings + ~30 info = ~200 total
- **Medium site** (500-2,500): the wheelercat pattern: 1 home +
  ~10 hubs + ~10 action/portal + ~200 listings + ~1,500 details +
  ~250 info = ~2,000 total
- **Large site** (10,000+): inflated detail count (multiple
  100-10,000-page product families) + 500+ listings + everything
  else proportionally

## Page-shape-to-template-family mapping

Multiple page-shapes can share one template family by parameterizing
the URL pattern in the fill script. Common consolidations:

- **All "detail" shapes** under one shared template + per-family fill
  scripts. URL-path-based category extraction means the same fill
  script handles `/section-a/cat/<model>` and `/section-b/cat/<model>`
  with different category derivation rules.
- **All "listing" shapes** under one template with a category filter.
  60 category-listings = 1 listing template + 60 instantiations
  (one per category slug from the source sitemap's family page).
- **All "hub" shapes** under one template with different content.
  The dynamic-block JS varies behavior by URL prefix.

Rule: **fill scripts are template-shape concerns; pageType is
structural-role concern. They're orthogonal.** A project might have
3 detail-template fill scripts (one per product-family extraction
shape) but they all emit `pageType: detail`.

## Source sitemap structure to look for

Most WordPress / typical CMS sites split source pages across multiple
sitemaps. Look for:

```
sitemap_index.xml
├── <product-family-A>-sitemap.xml          (typically 50-10,000 URLs each)
├── <product-family-B>-sitemap.xml
├── <product-family-A>_family-sitemap.xml   (the category-listing siblings)
├── locations-sitemap.xml                   (branches)
├── page-sitemap.xml                        (everything else — info pages)
├── post-sitemap.xml                        (blog)
├── product-sitemap.xml                     (legacy / e-commerce)
└── ...
```

The `_family` suffix typically marks listing-page URLs (the listing-page
sitemap is separate from the detail-page sitemap). This shape is
nearly universal; map it once in Phase 0 and reuse for every catalog
migration.

## Default modes per shape

For each shape, default to the mode below unless overridden:

- **Home** → A (prototype-driven, brand-critical)
- **Detail (any family)** → C (build-direct, batch — too many to author each)
- **Category listing** → C (build-direct, one fill script + dynamic block)
- **Top-level hub** → A (author each by hand — each has distinct copy)
- **Location / industry / info / blog** → C (build-direct + batch)
- **Action page** (quote/contact/finder) → A (each is unique editorial)
- **Portal stub** → A (each is a 5-line stub)

## Sequencing across shapes

See `SKILL.md` Phase 2 for the hubs-first sequencing rule. The order
within a shape is less critical — within the "detail" bucket, do
the highest-traffic product family first.

## Common surprises

- **Duplicate sitemap entries with stale slug templates** (e.g., URLs
  with `%placeholder%`, `__cat_type_slug_NNN__`). Filter these out
  before counting; they're WordPress sitemap-generator artifacts that
  don't correspond to real pages.
- **Sitemap-sub-chunking** at Google's 50k-URLs cap. A
  `cat-X-sitemap.xml` may be one of many siblings (`-sitemap2.xml`,
  `-sitemap3.xml`, etc.). Walk the sitemap index first; don't grep
  one file.
- **Trailing-slash conventions** in source URLs that don't match EDS
  routing. Decide URL structure (`aem-import-site/reference/admin-api-and-publish-flow.md`
  §4) before the first batch; if mismatched after the fact, use
  `/redirects.json` (cheap fix for trailing-slash drift).
- **"Drop-box" / "pickup-location" sub-types** masquerading as full
  branches in location sitemaps. Filter by slug pattern or by source-
  page indicator; typically you don't want every parts-pickup point
  to render as a full branch page.
