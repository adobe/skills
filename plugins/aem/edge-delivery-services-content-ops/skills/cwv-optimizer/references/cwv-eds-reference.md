# CWV on EDS: Reference Material

## Why EDS Sites Have Unique CWV Patterns

EDS achieves near-100 Lighthouse scores out of the box through strict architectural constraints. A vanilla EDS page with no customization typically scores at or near 100 on Performance. CWV issues are almost always caused by customizations that violate the built-in performance model: oversized images, blocks with heavy JavaScript, third-party scripts loaded in the wrong phase, or missing image dimensions. You are not fighting a slow framework — you are finding where customizations broke a fast baseline.

## The Three CWV Metrics on EDS

**LCP** — Almost always an image issue. The 100KB budget means total eager-phase transfer must stay under 100KB. Check: hero image size, number of eager blocks, font preloading, third-party scripts in the eager phase.

**CLS** — Almost always an image dimensions or font swap issue. `createOptimizedPicture()` does not set `width`/`height` attributes on the images it generates. Late consent banners and `font-display: swap` without `size-adjust` are the other common sources.

**INP** — Almost always block JavaScript. Carousels, accordions, tabs, and mega-menus that do heavy DOM manipulation on interaction cause long tasks. Forced reflows (read layout then write DOM) are the most common code-level cause.

## 100KB Budget Grading Scale

> The 100KB eager budget is the documented EDS threshold; the A–F banding below is this skill's own heuristic for triage, not an official Adobe grade. Use it to rank pages, not as a pass/fail standard.

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

- Reducing an oversized source image's dimensions (e.g. 2000px → 1000px) saves 60-75% on the delivered derivative
- Content images are already delivered as WebP by the EDS picture pipeline, so format conversion is not a lever — only source dimensions/weight are
- Adding image dimensions eliminates image CLS entirely
- Font `size-adjust` reduces font CLS by 80-95%
- Debouncing and reflow batching reduce INP by 40-60%

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Lighthouse good but OpTel poor | Lab vs. field: Lighthouse runs on fast hardware; real users are on slower devices | Trust OpTel — optimize for the p75 mobile user |
| LCP good on desktop, poor on mobile | Eager resources too heavy for mobile connections (content images already get a responsive `srcset` automatically) | Make sure the LCP block requests an appropriate width and the source image isn't oversized; target under 60KB eager for mobile |
| CLS zero in Lighthouse, non-zero in OpTel | Lighthouse measures initial load only; OpTel captures lifetime CLS | Check lazy-loaded content, late ads, and scroll-triggered shifts |
| INP cannot be measured in Lighthouse | INP requires real interaction; Lighthouse uses Total Blocking Time as proxy | Use DevTools Performance panel with manual clicks, or rely on OpTel |
| Fixing one metric degrades another | Tradeoffs (e.g., deferring fonts improves LCP but worsens CLS) | Apply `size-adjust` fallback fonts when deferring font loading |
