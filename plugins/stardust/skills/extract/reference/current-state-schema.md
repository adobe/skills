# Per-page JSON schema

The shape of `stardust/current/pages/<slug>.json`. Every page extracted
by Phase 2 of `extract` writes one of these. Downstream sub-commands
(`direct`, `prototype`, `migrate`) consume it.

The file is JSON because every consumer is non-human. It carries a
`_provenance` first key per the artifact-map convention.

---

## Top-level shape

```json
{
  "_provenance": {
    "writtenBy": "stardust:extract",
    "writtenAt": "2026-04-25T13:42:00Z",
    "readArtifacts": ["https://example.com/about"],
    "synthesizedInputs": [],
    "stardustVersion": "0.2.0",
    "waitMode": "networkidle",       // configured mode: fast | medium | spec | networkidle | domcontentloaded(fallback)
    "waitMs": 3820,                  // actual wait time, including grace and scroll pass
    "httpStatus": 200,               // final response status after redirects
    "contentType": "text/html"       // final response content-type (without charset)
  },
  "slug": "about",
  "url": "https://example.com/about",
  "finalUrl": "https://example.com/about/",
  "title": "About Example",
  "metaDescription": "...",
  "og": {
    "title": "...",
    "description": "...",
    "image": "https://example.com/og-about.jpg",
    "type": "website",
    "siteName": "Example"
  },
  "themeColor": { "light": "#ffffff", "dark": "#0a0a0a" },
  "language": "en",

  "headings": [ /* see § Headings */ ],
  "landmarks": [ /* see § Landmarks */ ],
  "ctas": [ /* see § CTAs */ ],
  "links": { "internal": [], "external": [] },
  "media": { /* see § Media */ },
  "forms": [ /* see § Forms */ ],
  "widgets": { /* see § Widgets */ },
  "components": { /* see § Components */ },
  "perSectionStyle": [ /* see § Per-section style */ ],
  "embedDominance": { /* see § Embed dominance */ },
  "cssCustomProperties": [ /* see § CSS custom properties */ ],

  "screenshot": "stardust/current/assets/screenshots/about.png",

  "stats": {
    "wordCount": 612,
    "ctaCount": 4,
    "internalLinkCount": 18,
    "externalLinkCount": 3,
    "imageCount": 7
  }
}
```

---

## § Headings

Document order. Computed style snapshot of the heading itself.

```json
{
  "level": 2,
  "text": "Our story",
  "id": "story",
  "domPath": "main > section:nth-child(2) > h2",
  "style": {
    "fontFamily": "Inter, system-ui",
    "fontWeight": 600,
    "fontSize": "clamp(2rem, 5vw, 3.5rem)",
    "lineHeight": 1.1,
    "letterSpacing": "-0.02em",
    "color": "rgb(15, 18, 23)"
  }
}
```

## § Landmarks

One entry per `header`, `nav`, `main`, `aside`, `footer` plus
ARIA-role'd equivalents. The structure each landmark contains is in
`children[]` with a flat list of section-level descendants — not the
full DOM tree, just enough to map IA.

```json
{
  "tag": "main",
  "role": "main",
  "id": null,
  "classes": [],
  "innerText": "...",
  "children": [
    {
      "tag": "section",
      "role": null,
      "id": "hero",
      "classes": ["hero", "hero--dark"],
      "purpose": "hero",          // heuristic: "hero" | "feature-list" | "social-proof" | "cta-band" | "footer-nav" | "form" | "rich-text" | "unknown"
      "headlineRef": 0,            // index into headings[] if any
      "innerTextSummary": "first 240 chars",
      "wordCount": 87
    }
  ]
}
```

`purpose` is a **heuristic guess**, not ground truth. Helps `direct`
and `prototype` reason about IA without re-parsing. When unsure, emit
`"unknown"` — never invent.

## § CTAs

Every visually-button-like element. Captured per `playwright-recipe.md`
§ Capture list (8).

```json
{
  "label": "Start free trial",
  "href": "/signup",
  "tag": "a",
  "domPath": "main > section.hero > a.btn-primary",
  "style": {
    "backgroundColor": "rgb(20, 122, 255)",
    "color": "rgb(255, 255, 255)",
    "fontFamily": "Inter, system-ui",
    "fontWeight": 600,
    "borderRadius": "8px",
    "padding": "12px 24px",
    "boxShadow": "0 1px 2px rgba(0,0,0,0.06)"
  },
  "appearsAbove": "fold"          // "fold" | "below-fold"
}
```

## § Links

Two arrays: `internal` (same host) and `external`. Each entry:

```json
{ "href": "/pricing", "text": "Pricing", "domPath": "header > nav > a:nth-child(2)" }
```

De-duplicate by `(href, text)`. Keep the first occurrence's `domPath`.

## § Media

```json
{
  "images": [
    {
      "src": "https://example.com/img/hero.jpg",
      "srcset": "...",
      "alt": "Two engineers at a whiteboard",
      "naturalWidth": 2400,
      "naturalHeight": 1600,
      "localPath": "stardust/current/assets/media/hero-a3f9.jpg"
    }
  ],
  "inlineSvgs": [
    { "viewBox": "0 0 24 24", "domPath": "...", "markupHash": "sha256:..." }
  ],
  "cssBackgrounds": [
    {
      "url": "https://example.com/img/slide-1.png",
      "domPath": "main > section.hero",
      "boundingClientRect": { "x": 0, "y": 0, "width": 1440, "height": 720 },
      "backgroundSize": "cover",
      "backgroundPosition": "center center",
      "backgroundRepeat": "no-repeat",
      "localPath": "stardust/current/assets/media/slide-1-b7c4.png"
    }
  ],
  "videos": [],
  "iframes": [
    { "src": "https://www.youtube.com/embed/...", "title": "Demo" }
  ]
}
```

`localPath` is set only for media stardust successfully downloaded.
Failed downloads have `localPath: null` and a `downloadError` field.

`cssBackgrounds[]` captures every element whose computed
`backgroundImage` resolves to one or more `url(...)` references
**and** whose rendered `boundingClientRect` is ≥100×80 px at the
captured viewport. Smaller elements are filtered as icon backgrounds
(chevrons, sprite glyphs, list bullets) — see
`playwright-recipe.md` § Capture list (11). When an element declares
multiple background-image layers (`url(a.png), linear-gradient(...)`),
emit one entry per `url(...)` layer; gradients are not captured here
(they live in `_brand-extraction.json#motifs.gradients`).

This is the field that lets hero images applied via CSS — full-bleed
hero sections, parallax banners, section backgrounds — surface in
extract output. Without it, `<img>`-only capture silently misses
the visual hero on most page-builder / WordPress / Squarespace
sites.

## § Forms

```json
{
  "action": "/api/contact",
  "method": "post",
  "fields": [
    { "type": "email", "name": "email", "label": "Your email", "required": true },
    { "type": "textarea", "name": "message", "label": "Message", "required": true }
  ],
  "thirdParty": null               // or "stripe" | "calendly" | "typeform" | "mailchimp" | ...
}
```

## § Widgets

```json
{
  "modals": [{ "trigger": "button.open-pricing", "domPath": "..." }],
  "accordions": [{ "domPath": "...", "itemCount": 6 }],
  "tabs": [{ "domPath": "...", "tabCount": 3 }]
}
```

Empty arrays are valid; missing keys are not.

## § Components

A closed-list inventory of recognisable component types per page.
This is **separate from** § Widgets (which captures interactive ARIA
roles) and § Landmarks (structural). Components fills the gap: visual
patterns the site repeats that aren't necessarily ARIA-tagged.

The vocabulary is fixed — do not invent new keys. If a page uses
something the vocabulary doesn't cover, log it under `components.other`
with a free-form `kind` label.

```json
{
  "cards":           { "count": 12, "examples": [".team-member", ".story-card"] },
  "grids":           { "count": 4,  "examples": ["main > section.team .row", ".stories .grid"] },
  "accordions":      { "count": 1,  "examples": ["details.faq"] },
  "tabs":            { "count": 0,  "examples": [] },
  "tables":          { "count": 2,  "examples": ["table.data"] },
  "modals":          { "count": 1,  "examples": ["[role=\"dialog\"].newsletter"] },
  "carousels":       { "count": 0,  "examples": [] },
  "videos":          { "count": 1,  "examples": ["video.hero-bg"] },
  "iframes":         { "count": 1,  "examples": ["iframe[src*=\"datawrapper\"]"] },
  "dataVizEmbeds":   { "count": 1,  "examples": ["iframe[src*=\"datawrapper\"]", "[class*=\"chart\"]"] },
  "teamTiles":       { "count": 8,  "examples": [".team-member"] },
  "pricingTiles":    { "count": 0,  "examples": [] },
  "testimonialCards":{ "count": 3,  "examples": [".testimonial"] },
  "logoStrip":       { "count": 1,  "examples": [".partner-logos"] },
  "timeline":        { "count": 0,  "examples": [] },
  "breadcrumbs":     { "count": 1,  "examples": ["nav.breadcrumb"] },
  "statRow":         { "count": 1,  "examples": [".impact-stats"] },
  "ctaBand":         { "count": 1,  "examples": ["section.cta-band"] },
  "formFields":      { "count": 6,  "examples": ["form input", "form textarea"] },
  "other":           []
}
```

Detection selectors (apply in order; first match wins per element):

| key | selector heuristic |
|---|---|
| `cards` | `.card`, `[class*="card"]:not([class*="card-grid"])`, `article` inside a grid |
| `grids` | parent of ≥3 visually-equal-width siblings (CSS grid or flex with wrap) |
| `accordions` | `details`, `[role="region"][aria-labelledby]` paired with `[aria-expanded]` |
| `tabs` | `[role="tablist"]`, `.tabs` containing `[role="tab"]` |
| `tables` | `table` (skip layout tables: `[role="presentation"]`) |
| `modals` | `dialog`, `[role="dialog"]` |
| `carousels` | `[class*="carousel"]`, `[class*="swiper"]`, `[class*="slick"]` |
| `videos` | `video` element |
| `iframes` | every `iframe` |
| `dataVizEmbeds` | `iframe[src*="datawrapper"]`, `iframe[src*="flourish"]`, `iframe[src*="tableau"]`, `[class*="chart"]`, `canvas[class*="chart"]` |
| `teamTiles` | `[class*="team"] [class*="member"]`, `[class*="staff"]`, repeated card with `<img>` + name + role |
| `pricingTiles` | `[class*="pricing"] [class*="tier"]`, repeated card containing currency symbol + CTA |
| `testimonialCards` | `[class*="testimonial"]`, `blockquote` with `cite` |
| `logoStrip` | container with ≥4 sibling `img`/`svg` of similar height, no text |
| `timeline` | `[class*="timeline"]`, `ol[class*="step"]` |
| `breadcrumbs` | `nav[aria-label*="breadcrumb" i]`, `[class*="breadcrumb"]` |
| `statRow` | container with ≥3 siblings each containing a number ≥10 + label |
| `ctaBand` | full-width section whose content is dominated by a heading + 1–2 CTAs |
| `formFields` | every form field across all forms on the page |

`count` is the number of matching elements; `examples` is the first 2
distinct CSS selectors (sufficient to find them again, not always
unique). Empty arrays are valid.

## § Embed dominance

Cross-origin iframes that carry a page's primary content. When the
site CSS doesn't reach inside, the brand-surface extraction silently
misses what is in fact the entire visual identity of these pages.

```json
{
  "dominated": true,
  "iframeSrc": "https://app.datawrapper.de/...",
  "viewportCoveragePct": 78,         // % of viewport occupied by the iframe at 1440x900
  "mainHeightCoveragePct": 88,       // % of <main> height occupied
  "screenshot": "stardust/current/assets/screenshots/data-dashboard.png"
}
```

Set `dominated: true` when **either** `viewportCoveragePct > 50`
**or** `mainHeightCoveragePct > 80`. When `dominated: false`, the
other fields can be `null`.

The screenshot is already captured by every page (per
`playwright-recipe.md` § Capture list (14)); for embed-dominated
pages, surface it explicitly here so `direct` and `prototype` know to
reason from the screenshot rather than the (empty) computed-style
data.

## § CSS custom properties

Every CSS custom property defined at `:root` (read via
`getComputedStyle(document.documentElement)` and filtered to names
starting with `--`).

```json
[
  { "name": "--color-primary", "value": "#147aff" },
  { "name": "--space-md", "value": "16px" }
]
```

An **empty array** is itself a meaningful signal — it means the site
ships no design tokens, which the Tensions detector flags. Do not
omit the key; emit `[]` explicitly.

## § Per-section style

One entry per direct child of `main` (or per section landmark for
non-`main`-using sites). The numbers feed `_brand-extraction.json` so
brand-surface aggregation has a stable input.

```json
{
  "sectionRef": "main > section:nth-child(1)",
  "purpose": "hero",
  "background": { "color": "rgb(8, 12, 20)", "hasImage": true, "hasGradient": false },
  "text": { "dominantColor": "rgb(255, 255, 255)" },
  "spacing": { "paddingBlock": "96px", "paddingInline": "48px", "gap": "24px" },
  "borderRadius": "12px",
  "fontFamilies": ["Inter", "Söhne"],
  "shadowsUsed": ["0 4px 16px rgba(0,0,0,0.12)"]
}
```

---

## Required vs optional

Every top-level key listed above is **required** to be present in the
JSON. Missing data within a key is represented by an empty array,
empty object, or explicit `null` — never by omitting the key. This
keeps consumers simple.

The exceptions: `og`, `themeColor`, `forms`, `widgets` may be empty
objects. Empty arrays for `headings`, `landmarks`, `ctas`, `links.*`
are valid (and unusual — log a warning).

## Versioning

The schema version is implicit in
`_provenance.stardustVersion`. If the schema evolves, downstream
consumers branch on the version. Backward-compatible additions do not
require a version bump.
