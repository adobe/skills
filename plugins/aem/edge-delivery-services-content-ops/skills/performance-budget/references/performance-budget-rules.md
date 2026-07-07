# EDS Performance Budget Rules

## The EDS Performance Model

EDS is built around a strict performance budget: the Largest Contentful Paint (LCP) element should render within a **100KB total transfer budget**. This budget covers all resources the browser must download before the LCP element can paint.

### E-L-D Loading Phases

EDS uses a three-phase loading model that is central to its performance architecture:

1. **Eager (E)**: Loaded immediately with the initial HTML. Includes: the HTML document itself, `styles.css`, `aem.js`, above-fold block CSS/JS, and fonts needed for the first section. Everything in the eager phase counts against the 100KB LCP budget.
2. **Lazy (L)**: Loaded after the initial paint. Includes: below-fold block CSS/JS, below-fold images, and non-critical styles. Loaded by `aem.js` as the user scrolls or after a short delay.
3. **Delayed (D)**: Loaded 3+ seconds after page load. Includes: analytics, third-party scripts, chat widgets, social embeds, and any non-essential JavaScript. Loaded by `scripts/delayed.js`.

### Why 100KB Matters

On a 3G connection (the baseline EDS targets), 100KB takes approximately 1.5 seconds to transfer. Combined with DNS, TLS, and server response time, this keeps LCP under the 2.5-second "good" threshold in Core Web Vitals.

## The 100KB LCP Budget

The 100KB budget is the total transfer size of all resources that must load before the Largest Contentful Paint (LCP) element renders. This includes:

- HTML document
- Eager CSS (styles.css + above-fold block CSS)
- Eager JavaScript (aem.js + scripts.js + above-fold block JS)
- Preloaded fonts
- Above-fold images (including the LCP image)

## Recommended Allocation

> The **100KB total budget** and the **E-L-D phase model** are the documented EDS performance model (see [keeping-it-100](https://www.aem.live/developer/keeping-it-100)). The per-resource sub-budgets and the letter grades below are this skill's own working heuristics for *distributing* that budget, not official Adobe limits. Treat them as guidance for spotting outliers, not as pass/fail thresholds.

| Resource Category | Target | Maximum | Notes |
|-------------------|--------|---------|-------|
| HTML document | 10-15 KB | 25 KB | Minimal DOM, no inline scripts |
| Main CSS (styles.css) | 3-5 KB | 8 KB | Site stylesheet |
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
| A | Under 70 KB | Excellent, significant headroom |
| B | 70-90 KB | Good, comfortable margin |
| C | 90-100 KB | Acceptable, at the limit |
| D | 100-120 KB | Over budget, needs optimization |
| F | Over 120 KB | Critical, significant performance issues |

## E-L-D Phase Rules

### Eager (counts against budget)
- styles.css and aem.js always load eager
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

## Images: What EDS Optimizes for You

Images that come through **content** are optimized automatically. EDS renders a full `<picture>` element with the resolutions needed for desktop and mobile, and in modern formats (WebP) for browsers that support them, so content images are delivered as WebP at responsive sizes regardless of the source format (JPEG, PNG, etc.). Do not recommend converting or resizing content images; that duplicates the media pipeline's work.

Manual optimization applies only to images bundled in **code**: icons, logos, and decorative graphics shipped in a block or theme rather than authored as content:

- Use SVG for icons and logos, and keep them small (typically under 5 KB).
- Inline tiny SVGs into CSS/JS where practical; otherwise reference them as external files that load in the correct phase.

To reduce the byte cost of a heavy content LCP image, fix it at the source: upload a source image not far larger than its largest rendered size, and have the block request an appropriate width, not hand-encode the delivered image.

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
| Oversized source image for the LCP hero | +30-80 KB | Upload a smaller source and/or have the block request a smaller width. EDS already delivers content images as WebP, so do not convert format by hand |
| Google Tag Manager in head | +30-50 KB | Move to delayed.js |
| Full font family preloaded | +50-150 KB | Subset and limit to 1-2 weights |
| Below-fold block CSS loading eager | +5-15 KB | Verify aem.js lazy-loads correctly |
| Inline SVG sprites in HTML | +10-30 KB | Move to external file, lazy-load |
| Analytics scripts not delayed | +20-40 KB | Move to delayed.js |
