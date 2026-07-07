# Collectors Reference

Detailed extraction sources, output schema, and limitations for each
`page-collect` collector.

---

## icons

### Extraction Sources

| Source | Method |
|--------|--------|
| Inline `<svg>` | `querySelectorAll('svg')` — serialized via `outerHTML` |
| `<img src="*.svg">` | Fetched via `page.evaluate` + URL resolution |
| `<img src="data:image/svg+xml,...">` | Decoded from data URI inline |
| CSS `background-image` | Computed styles scanned for `url("data:image/svg+xml,...")` |
| `<use href="#id">` sprites | Resolved by looking up the referenced `<symbol>` in the DOM |

### Classification Logic

1. Compute rendered bounding box via `getBoundingClientRect()`
2. Check ancestor chain for brand/logo signals (`class`, `id`, `alt`
   containing "logo", "brand", "wordmark")
3. If bounding box ≤ 48×48px and ancestor is `<button>`, `<a>`, or
   `<nav>` → `icon`
4. If logo signals present → `logo`
5. Otherwise → `image` (excluded from output)

### SVG Optimization Steps

1. Strip `<?xml ...?>` declarations and `<!-- ... -->` comments
2. Remove `<metadata>`, `<title>`, `<desc>` elements
3. Ensure `viewBox` is present; if absent, derive from `width`/`height`
   attributes
4. Remove hardcoded `width` and `height` attributes from the root `<svg>`
5. For `icon` class: replace all `fill` and `stroke` attribute values
   (except `"none"`) with `"currentColor"`
6. Collapse redundant whitespace and newlines

**Future improvement:** If hand-rolled SVG cleanup proves insufficient
for edge cases (complex gradients, nested groups, editor bloat from
Illustrator or Figma exports), SVGO (`svgo` npm package) is the
standard tool for SVG optimization and could replace the hand-rolled
approach.

### icons.json Schema

```ts
{
  url: string;            // source page URL
  icons: Array<{
    name: string;         // derived from aria-label / class / id
    class: "icon" | "logo" | "image";
    source: "inline-svg" | "img-src" | "img-data-uri" |
            "css-background" | "use-sprite" | "icon-font";
    file: string;         // relative path, e.g. "icons/search.svg"
    nameConfidence: "high" | "low";
    context: string;      // nearest ancestor text / role / label
  }>;
}
```

### Known Limitations

- Icon fonts: detected and flagged with `source: "icon-font"` and
  `nameConfidence: "low"` but no SVG is extracted. See
  icon-font-maps.md for future auto-conversion plans.
- Dynamically loaded SVGs (injected after JS interaction) may be missed
  unless the page is fully idle before collection runs.
- Sprites referencing external files (e.g. `<use href="/sprite.svg#id">`)
  require the sprite file to be fetchable from the page origin.

---

## metadata

### Extraction Sources

- `<meta name="...">` and `<meta property="...">` tags
- Open Graph (`og:*`) and Twitter Card (`twitter:*`) tags
- `<link rel="canonical">`, `<link rel="icon">`, `<link rel="manifest">`
- JSON-LD `<script type="application/ld+json">` blocks
- `<title>` element

### metadata.json Schema

```ts
{
  url: string;
  title: string;
  meta: Record<string, string>;   // name/property → content
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  jsonLd: unknown[];              // parsed JSON-LD objects
  canonical: string | null;
  icons: string[];                // favicon / apple-touch-icon URLs
}
```

### Known Limitations

- Multiple `og:image` tags: only the first is captured.
- JSON-LD parse errors are silently skipped (malformed JSON on page).

---

## text

### Extraction Sources

- `document.body` inner text after removing `<script>`, `<style>`,
  `<noscript>` elements
- Headings (`h1`–`h6`) extracted separately with their level

### text.json Schema

```ts
{
  url: string;
  wordCount: number;
  headings: Array<{ level: number; text: string }>;
  body: string;   // full visible text, whitespace-normalized
}
```

### Known Limitations

- Hidden elements (`display:none`, `visibility:hidden`) are excluded via
  Playwright's text extraction but `aria-hidden` content may be included.

---

## forms

### Extraction Sources

- All `<form>` elements on the page
- Each field: `<input>`, `<select>`, `<textarea>`, `<button type="submit">`

### forms.json Schema

```ts
{
  url: string;
  forms: Array<{
    id: string | null;
    action: string | null;
    method: string;
    fields: Array<{
      tag: string;
      type: string | null;
      name: string | null;
      label: string | null;   // associated <label> text
      required: boolean;
      placeholder: string | null;
    }>;
  }>;
}
```

### Known Limitations

- Multi-step or modal forms may only capture the visible step.
- ARIA-labeled controls without a `<label>` element may have
  `label: null` even when visually labeled.

---

## videos

### Extraction Sources

- `<video src="...">` and `<video><source src="..."></video>`
- `<iframe>` with YouTube, Vimeo, or Wistia embed URLs
- `data-video-id` / `data-src` attributes used by common lazy-load patterns

### videos.json Schema

```ts
{
  url: string;
  videos: Array<{
    type: "native" | "youtube" | "vimeo" | "wistia" | "iframe";
    src: string;
    poster: string | null;
    autoplay: boolean;
    muted: boolean;
  }>;
}
```

### Known Limitations

- Videos loaded via JavaScript after user interaction are not captured.
- HLS/DASH manifests (`.m3u8`, `.mpd`) are noted as `src` but not
  resolved to individual segments.

---

## socials

### Extraction Sources

- All `<a href="...">` elements whose href matches known social domains:
  `twitter.com`, `x.com`, `linkedin.com`, `facebook.com`,
  `instagram.com`, `youtube.com`, `tiktok.com`, `github.com`,
  `pinterest.com`, `threads.net`

### socials.json Schema

```ts
{
  url: string;
  socials: Array<{
    platform: string;   // e.g. "twitter", "linkedin"
    href: string;
    text: string | null;
    ariaLabel: string | null;
  }>;
}
```

### Known Limitations

- Only href-based links are detected; JS-driven social share buttons
  without an `<a>` tag are missed.
- Vanity domains (e.g. `t.co` redirects) are not followed.
