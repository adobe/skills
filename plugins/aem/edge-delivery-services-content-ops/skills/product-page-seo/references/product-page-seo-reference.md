# Product Page SEO Reference

## Product Schema (JSON-LD) Properties

Required and recommended properties for Google Product rich results:

| Property | Source | Required? |
|----------|--------|-----------|
| `@type` | `Product` | Yes |
| `name` | Product name from Catalog Service | Yes |
| `image` | Primary product image URL(s) | Yes |
| `description` | Product short or full description | Recommended |
| `sku` | Product SKU | Recommended |
| `brand.name` | Brand attribute from catalog | Recommended |
| `offers.@type` | `Offer` | Yes (for price display) |
| `offers.price` | Product final price | Yes |
| `offers.priceCurrency` | Currency code (e.g., USD) | Yes |
| `offers.availability` | `InStock`, `OutOfStock`, etc. | Yes |
| `offers.url` | Canonical product URL | Recommended |
| `aggregateRating` | Average rating and review count | Recommended (if reviews exist) |

## Image SEO Checks

| Check | Priority | Fail condition |
|-------|----------|----------------|
| Alt text contains product name | P1 | Generic alt like "product image" or "IMG_001" |
| Alt text quality from catalog | P1 | API returns empty/generic alt for every product |
| `width`/`height` set (CLS) | P1 | Dimensions missing |
| LCP image not lazy-loaded | P0 | Primary image has `loading="lazy"` |
| LCP image `fetchpriority="high"` | P1 | Attribute absent on primary image |
| Modern format (WebP) | P2 | Only JPEG/PNG served |
| Descriptive image file names | P3 | Hashed Commerce filenames only |

## Crawlability Strategy Tiers

| Tier | What is in initial HTML | Risk | When to use |
|------|-------------------------|------|-------------|
| 1 - JavaScript-dependent | Template only; all product data via JS | High | Small catalogs, low search-traffic needs (default for most EDS commerce) |
| 2 - Hybrid (recommended minimum) | Critical meta tags + JSON-LD pre-populated/edge-injected; body via JS | Medium | Most storefronts that care about search |
| 3 - Pre-rendered (recommended for large catalogs) | Name, price, description, primary image pre-rendered; JS enhances | Low | Large catalogs, high search-traffic importance |

## Dynamic Meta Tag Strategies

When meta tags are set only via JavaScript (not visible to non-JS crawlers), apply one of:

1. **Pre-populate from catalog at build time** - generate product-specific meta in `head.html` from URL patterns via a build-time script.
2. **Edge-side injection** - inject product meta into the HTML response with an edge worker before it reaches the crawler.
3. **Metadata mapping** - some EDS commerce setups map product metadata to page-level metadata via `configs.xlsx`; verify if configured.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pages show "Discovered - currently not indexed" in Search Console | Googlebot has not rendered the JS yet, or rendered content was insufficient | Move to Tier 2 or 3: add product content to the initial HTML |
| Structured data errors in Rich Results Test | JSON-LD properties missing or malformed | Validate against Google's Product requirements; ensure price and availability are accurate |
| Product images missing from Google Images | Images lack descriptive alt text or are lazy-loaded | Set alt from product name in the PDP block; eager-load the primary image |
| Canonical points to preview domain | `.aem.page`/`.aem.live` set as canonical instead of production | Fix canonical logic in `head.html` or `scripts.js` to use the production domain |
| Sitemap missing product URLs | No custom sitemap generation for route-based pages | Build a sitemap generator that queries the Catalog Service for active products |
| Price in JSON-LD differs from displayed price | Caching or currency mismatch | Source both from the same Catalog Service response; never hardcode price |
