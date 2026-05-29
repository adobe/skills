# EDS Performance Rules Reference

This document covers the performance constraints and patterns specific to Adobe Edge Delivery Services. Use it as a reference when auditing EDS pages for performance.

---

## Target Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Lighthouse Performance | 100 | All four categories should score 100 |
| Lighthouse Accessibility | 100 | |
| Lighthouse Best Practices | 100 | |
| Lighthouse SEO | 100 | |
| LCP (mobile) | < 1560ms | Largest Contentful Paint on a throttled 4G connection |
| CLS | < 0.05 | Cumulative Layout Shift |
| INP | < 200ms | Interaction to Next Paint |

EDS is engineered to hit Lighthouse 100/100/100/100 out of the box. If a page drops below these scores, something in the content or customization is the cause.

---

## LCP Budget

The most critical performance constraint in EDS is the LCP budget: everything that loads before the Largest Contentful Paint element must stay under approximately **100KB aggregate**.

### What Counts Toward LCP Budget

- The HTML document itself (typically 15-30KB)
- `aem.css` (the boilerplate stylesheet)
- `aem.js` (the boilerplate script)
- Any CSS/JS for blocks in the first section
- Images above the fold (before lazy loading kicks in)
- Web fonts loaded on first paint

### Rules

1. **Keep the first section lightweight.** The first visible section of the page determines LCP. It should contain minimal content — a heading, a short paragraph, and optionally one optimized image.
2. **LCP image must NOT be lazy-loaded.** The EDS boilerplate automatically sets `loading="eager"` on images in the first section. If you see `loading="lazy"` on the LCP candidate, it is a bug or an override.
3. **LCP image should have `fetchpriority="high"`.** This hints the browser to prioritize the LCP image download.
4. **Avoid large blocks in the first section.** Complex blocks (carousels, tabs, heavy cards) in the first section add CSS/JS that competes with LCP.

---

## E-L-D Loading Phases

EDS uses a three-phase loading strategy: Eager, Lazy, Delayed. Every resource on the page belongs to exactly one phase.

### Eager Phase (Before LCP)

Loads immediately with the initial page render.

**Belongs here:**
- `aem.js` — the EDS boilerplate script
- `aem.css` — the EDS boilerplate stylesheet
- `styles.css` — site-level styles (custom properties, typography, layout)
- `scripts.js` — site-level scripts (header/footer loading, section decoration)
- CSS/JS for blocks **in the first visible section only**
- The LCP image

**Does NOT belong here:**
- Third-party scripts (analytics, chat, social)
- CSS/JS for blocks below the fold
- Non-critical fonts
- Any content the user cannot see without scrolling

### Lazy Phase (After Initial Paint)

Loads after the first section renders and the LCP event fires.

**Belongs here:**
- CSS/JS for blocks in the second section and below
- Images below the fold (via `loading="lazy"`)
- Non-critical site features (search, dynamic nav elements)

**How it works:** The EDS boilerplate walks the DOM section by section. After the first section renders, it loads block CSS/JS for subsequent sections on demand.

### Delayed Phase (3+ Seconds After LCP)

Loads well after the page is interactive. Managed by `delayed.js`.

**Belongs here:**
- Analytics (Adobe Launch, Google Analytics, etc.)
- Chat widgets (Drift, Intercom, etc.)
- Social media embeds
- A/B testing scripts (Adobe Target, Optimizely, etc.)
- Any third-party JavaScript

**How it works:** `delayed.js` is loaded 3 seconds after the page load event. It then loads any third-party scripts. This ensures third-party code never competes with core page rendering.

### Common Violations

| Violation | Impact | Fix |
|-----------|--------|-----|
| Analytics script in `head.html` | Blocks LCP, adds 50-200ms | Move to `delayed.js` |
| Chat widget loaded eagerly | Adds 100-500KB before LCP | Move to `delayed.js` |
| Block CSS loaded for off-screen block | Unnecessary render-blocking CSS | Ensure block is not in the first section |
| `loading="lazy"` on LCP image | LCP delayed by 200-500ms | Remove the attribute or set to `eager` |

---

## Font Loading Strategy

EDS uses a specific font loading approach that differs from most web performance advice.

### Rules

1. **Do NOT preload fonts.** Font preloading competes with LCP resources. EDS fonts load via CSS `@font-face` declarations with `font-display: swap`.
2. **Define fallback fonts with `size-adjust`.** Every custom font must have a system font fallback with `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override` values tuned to match the custom font metrics. This prevents CLS when the custom font loads.
3. **Load fonts from the same origin.** Serve font files from the EDS domain, not from Google Fonts or other external CDNs. Cross-origin font requests add connection overhead.
4. **Limit font weights and styles.** Each additional font file is a separate download. Use no more than 2-3 font files (e.g., regular, bold, italic).

### Example Fallback Font Declaration

```css
@font-face {
  font-family: 'Brand Sans Fallback';
  src: local('Arial');
  size-adjust: 95.2%;
  ascent-override: 103%;
  descent-override: 28%;
  line-gap-override: 0%;
}
```

The fallback font is used immediately on first paint. When the real font loads, `font-display: swap` switches it in with minimal CLS because `size-adjust` ensures the metrics match closely.

---

## Image Optimization

EDS automatically optimizes images through its media pipeline, but authors and developers must follow certain rules.

### Rules

1. **Use the EDS media path.** Images served from `./media_*` paths are automatically optimized, resized, and served in WebP/AVIF formats with responsive `srcset`.
2. **First-section images must be eager.** Do not override the default eager loading on images in the first section.
3. **Below-fold images must be lazy.** The boilerplate handles this automatically. Do not add `loading="eager"` to below-fold images.
4. **Provide meaningful alt text.** This is an accessibility requirement but also an SEO signal.
5. **Use appropriate image dimensions.** The source image should be high quality (at least 2x the display size for retina). The EDS pipeline handles the rest.
6. **Avoid decorative images in the first section.** Every image in the first section competes with LCP. If an image is purely decorative, move it below the fold.

### Responsive Image Output

EDS generates responsive `<picture>` elements with multiple sources:

```html
<picture>
  <source type="image/webp"
    srcset="./media_hash.jpeg?width=750&format=webply&optimize=medium 750w,
            ./media_hash.jpeg?width=2000&format=webply&optimize=medium 2000w"
    sizes="100vw">
  <img src="./media_hash.jpeg?width=750&format=jpeg&optimize=medium"
    loading="lazy" alt="Description">
</picture>
```

---

## head.html Rules

The `head.html` file is injected into every page's `<head>`. It must be minimal.

### Allowed in head.html

- The EDS boilerplate `<script>` and `<link>` tags (aem.js, aem.css)
- `<meta>` tags for viewport, charset, theme-color
- Favicon links
- A minimal inline `<style>` for CLS prevention (hiding the page until styles load)

### NOT Allowed in head.html

- Third-party script tags (move to `delayed.js`)
- Large inline styles (move to `styles.css`)
- Font preload links
- Inline JavaScript beyond the boilerplate
- CSS for specific blocks (loaded on demand by the boilerplate)

---

## CSS Custom Properties

EDS sites should use CSS custom properties (variables) for all theme values. This enables:

- Consistent theming across blocks
- Easy theme changes without touching block CSS
- Section-level theme overrides via section metadata
- Dark mode support

### Expected Pattern

```css
:root {
  --color-brand-primary: #0045ff;
  --color-text: #2c2c2c;
  --color-background: #ffffff;
  --font-family-heading: 'Brand Sans', 'Brand Sans Fallback', sans-serif;
  --font-family-body: 'Brand Serif', 'Brand Serif Fallback', serif;
  --spacing-m: 16px;
  --spacing-l: 32px;
}
```

Hardcoded hex colors, pixel values, or font names directly in block CSS (instead of referencing custom properties) are a code smell and a P2 audit finding.
