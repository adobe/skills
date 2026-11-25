# stardust:extract: phase 6, report

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 6 — Update state and report

2. Print a one-screen summary:
   ```
   Extracted https://example.com (5/38 pages, sitemap.xml)

   stardust/current/
     PRODUCT.md, DESIGN.md, DESIGN.json, brand-review.html,
     pages/ (5), assets/logo.svg, _brand-extraction.json, _crawl-log.json

   Per-page evidence:
     slug         live  waitMode               waitMs   status  media(img/bg)
     /            yes   medium                 2380     200     38/6
     /pricing     yes   medium                 1940     200     9/0   ⚠ low-media
     /contact     yes   domcontentloaded(fb)   8000     200     3/0
     ...

   Wait summary: 4 resolved at medium (avg 2.4s), 1 fallback (timed out at 8s)
     → /contact may be under-captured; consider --refresh
   Media summary: 1 page flagged low-media (/pricing) — see media-coverage check
   Vision check: 4 ok, 1 recaptured (/pricing) — _crawl-log.json#visionCheck

   Open stardust/current/brand-review.html to verify the extraction
   before running $stardust direct.

   Coverage note: extracted 5 of 38 discovered pages; 5 pages
   covering distinct templates is usually sufficient for the
   cross-page brand surface. Widen with --cap <N> or --pages.

   Next: $stardust direct  (resolve a redesign direction)
   ```

   The **per-page evidence table** is mandatory. The `live` column
   is `yes` when `_provenance.renderedBy === "playwright"` AND
   `waitMs > 0`, else `no`. A `no` row means the page record was
   not produced by a live Playwright render — the visible column
   is the defense-in-depth signal for the failure mode the
   write-time guard exists to prevent (2026-04-30 e-commerce run). A
   maintainer scanning the summary should see `yes` on every row.

   Compute the wait summary by grouping each page's `_provenance.waitMode`
   and averaging `waitMs`. List slugs whose `waitMode` ends in
   `(fallback)` (rendered as `(fb)` in the table for width) as
   candidates for `--refresh`.

   The **`media(img/bg)` column** is the analogous defense-in-depth
   signal for imagery. It prints `<count of media.imgs> / <count of
   media.cssBackgrounds>`. Flag a row `⚠ low-media` when the page
   reads as brand/marketing (register `brand`, or a landing/solution/
   product template) yet has `cssBackgrounds: []` **and** few large
   rasters (no `media.imgs` entry with intrinsic width ≥ 600). That
   combination is the signature of a silently-failed background /
   lazy-media walk — a capture pass that specs the full background
   walk (`playwright-recipe.md` § Capture list 11) yet silently
   produces nothing still ships an image-less capture (2026-06-26
   a SaaS site: `cssBackgrounds: []` on every page, all product
   imagery lost). A flagged row is the cue to re-run that page with
   `--refresh` (and, if it persists, to fall back to headed Chrome per
   § Bot-management fallback). A maintainer scanning the summary should
   treat a `brand`-register site with all-zero `bg` counts as suspect,
   not as "this site uses no background images."
