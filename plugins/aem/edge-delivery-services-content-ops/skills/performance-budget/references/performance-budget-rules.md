# EDS Performance Budget Rules

## The EDS Performance Model

EDS is built around a strict performance budget: the Largest Contentful Paint (LCP) element should render within a **100KB total transfer budget**. This budget covers all resources the browser must download before the LCP element can paint.

### E-L-D Loading Phases

EDS uses a three-phase loading model that is central to its performance architecture:

1. **Eager (E)** — Loaded immediately with the initial HTML. Includes: the HTML document itself, `aem.css`, `aem.js`, above-fold block CSS/JS, and fonts needed for the first section. Everything in the eager phase counts against the 100KB LCP budget.
2. **Lazy (L)** — Loaded after the initial paint. Includes: below-fold block CSS/JS, below-fold images, and non-critical styles. Loaded by `aem.js` as the user scrolls or after a short delay.
3. **Delayed (D)** — Loaded 3+ seconds after page load. Includes: analytics, third-party scripts, chat widgets, social embeds, and any non-essential JavaScript. Loaded by `scripts/delayed.js`.

### Why 100KB Matters

On a 3G connection (the baseline EDS targets), 100KB takes approximately 1.5 seconds to transfer. Combined with DNS, TLS, and server response time, this keeps LCP under the 2.5-second "good" threshold in Core Web Vitals.

## The 100KB LCP Budget

The 100KB budget is the total transfer size of all resources that must load before the Largest Contentful Paint (LCP) element renders. This includes:

- HTML document
- Eager CSS (aem.css + above-fold block CSS)
- Eager JavaScript (aem.js + scripts.js + above-fold block JS)
- Preloaded fonts
- Above-fold images (including the LCP image)

## Recommended Allocation

| Resource Category | Target | Maximum | Notes |
|-------------------|--------|---------|-------|
| HTML document | 10-15 KB | 25 KB | Minimal DOM, no inline scripts |
| Core CSS (aem.css) | 3-5 KB | 8 KB | Framework styles only |
| Block CSS (eager) | 1-3 KB per block | 5 KB total | Only first-section blocks |
| Core JS (aem.js) | 5-8 KB | 12 KB | Framework scripts only |
| Custom JS (scripts.js) | 3-5 KB | 8 KB | Site-level customization |
| Block JS (eager) | 1-3 KB per block | 5 KB total | Only first-section blocks |
| Fonts | 15-25 KB | 30 KB | 1-2 weights maximum |
| LCP image | 20-40 KB | 50 KB | WebP or AVIF preferred |
| **Total** | **60-100 KB** | **100 KB** | |

## Grading Scale

| Grade | Total Eager Bytes | Assessment |
|-------|-------------------|------------|
| A | Under 70 KB | Excellent — significant headroom |
| B | 70-90 KB | Good — comfortable margin |
| C | 90-100 KB | Acceptable — at the limit |
| D | 100-120 KB | Over budget — needs optimization |
| F | Over 120 KB | Critical — significant performance issues |

## E-L-D Phase Rules

### Eager (counts against budget)
- aem.css and aem.js always load eager
- Block CSS/JS for blocks in the first visible section
- Images with loading="eager" (first-section images)
- Preloaded fonts

### Lazy (does not count against budget)
- Block CSS/JS for blocks below the first section
- Images with loading="lazy" (below-fold images)
- Non-critical styles

### Delayed (does not count against budget)
- All third-party scripts (analytics, tag managers, chat)
- Social media embeds
- Non-essential JavaScript
- Loads 3+ seconds after page load via scripts/delayed.js

## Image Optimization Targets

| Format | Quality | Use Case | Expected Size (hero) |
|--------|---------|----------|---------------------|
| WebP | 80 | General photos | 25-40 KB |
| AVIF | 60 | Modern browsers | 15-30 KB |
| JPEG | 80 | Fallback | 35-60 KB |
| PNG | — | Graphics with transparency | Varies widely |
| SVG | — | Icons, logos | Under 5 KB |

## Font Optimization Rules

1. Use woff2 format exclusively (30% smaller than woff)
2. Subset to the needed character range (Latin: ~15KB, full Unicode: ~100KB+)
3. Preload at most 2 font files (1 heading weight + 1 body weight)
4. Always use font-display: swap
5. Define size-adjust fallback fonts to minimize CLS during font swap
6. Consider variable fonts if using 3+ weights of the same family

## Common Budget Violations

| Violation | Typical Cost | Fix |
|-----------|-------------|-----|
| Unoptimized hero image (PNG/JPEG) | +30-80 KB | Convert to WebP, resize to viewport width |
| Google Tag Manager in head | +30-50 KB | Move to delayed.js |
| Full font family preloaded | +50-150 KB | Subset and limit to 1-2 weights |
| Below-fold block CSS loading eager | +5-15 KB | Verify aem.js lazy-loads correctly |
| Inline SVG sprites in HTML | +10-30 KB | Move to external file, lazy-load |
| Analytics scripts not delayed | +20-40 KB | Move to delayed.js |
