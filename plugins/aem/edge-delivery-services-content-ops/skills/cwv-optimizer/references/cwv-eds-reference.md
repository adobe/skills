# CWV on EDS: Reference Material

## Why EDS Sites Have Unique CWV Patterns

EDS achieves near-100 Lighthouse scores out of the box through strict architectural constraints. A vanilla EDS page with no customization scores 100 on Performance. CWV issues are almost always caused by customizations that violate the built-in performance model: oversized images, blocks with heavy JavaScript, third-party scripts loaded in the wrong phase, or missing image dimensions. You are not fighting a slow framework — you are finding where customizations broke a fast baseline.

## The Three CWV Metrics on EDS

**LCP** — Almost always an image issue. The 100KB budget means total eager-phase transfer must stay under 100KB. Check: hero image size, number of eager blocks, font preloading, third-party scripts in the eager phase.

**CLS** — Almost always an image dimensions or font swap issue. `createOptimizedPicture()` does not set `width`/`height` attributes on the images it generates. Late consent banners and `font-display: swap` without `size-adjust` are the other common sources.

**INP** — Almost always block JavaScript. Carousels, accordions, tabs, and mega-menus that do heavy DOM manipulation on interaction cause long tasks. Forced reflows (read layout then write DOM) are the most common code-level cause.

## 100KB Budget Grading Scale

| Grade | Eager-Phase Total | Assessment |
|-------|-------------------|------------|
| A | Under 70KB | Well within budget |
| B | 70-90KB | Acceptable, limited headroom |
| C | 90-100KB | At budget limit |
| D | 100-120KB | Over budget, LCP at risk |
| F | Over 120KB | Significantly over budget |

## CWV Threshold Reference

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP | < 2.5s | 2.5s-4.0s | > 4.0s |
| CLS | < 0.1 | 0.1-0.25 | > 0.25 |
| INP | < 200ms | 200ms-500ms | > 500ms |

## Projection Benchmarks

- JPEG-to-WebP saves 25-35%
- Resizing 2000px to 1000px saves 60-75%
- Adding image dimensions eliminates image CLS entirely
- Font `size-adjust` reduces font CLS by 80-95%
- Debouncing and reflow batching reduce INP by 40-60%

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Lighthouse good but OpTel poor | Lab vs. field: Lighthouse runs on fast hardware; real users are on slower devices | Trust OpTel — optimize for the p75 mobile user |
| LCP good on desktop, poor on mobile | Images not responsive or eager resources too heavy for mobile connections | Add mobile-appropriate `srcset` sizes; target under 60KB eager for mobile |
| CLS zero in Lighthouse, non-zero in OpTel | Lighthouse measures initial load only; OpTel captures lifetime CLS | Check lazy-loaded content, late ads, and scroll-triggered shifts |
| INP cannot be measured in Lighthouse | INP requires real interaction; Lighthouse uses Total Blocking Time as proxy | Use DevTools Performance panel with manual clicks, or rely on OpTel |
| Fixing one metric degrades another | Tradeoffs (e.g., deferring fonts improves LCP but worsens CLS) | Apply `size-adjust` fallback fonts when deferring font loading |
