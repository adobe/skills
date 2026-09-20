# Per-page JSON schema

## When to read what

- § Top-level shape — before writing a page record: the required keys and provenance block.
- § Headings · § Hero headline — when recording document-order headings and the resolved hero copy on JS-rendered pages.
- § Landmarks · § Widgets · § Components — when mapping IA structure, interactive ARIA widgets and the closed-list component inventory; three separate concerns.
- § CTAs · § Links — when capturing button-like elements and de-duplicated internal/external links.
- § Media · § Forms — when recording images, video and form fields.
- § Dynamic — only on migration-bound runs with `--dynamics`: per-page reach evidence of what was fetched and how it rendered.
- § Embed dominance — when a page's primary content lives inside a cross-origin iframe.
- § Signals — before the Phase 2.5 vision pass: the crawler's own capture-quality flags (`_signals`) and what `screenshotMode` / `screenshotMobile` mean.
- § CSS custom properties · § Per-section style — when capturing `:root` tokens and the per-section style summaries that feed brand-surface aggregation.
- § Required vs optional · § Versioning — when a key has no data (empty, never omitted) or the schema evolves; § 0.24.x aliases lists the legacy names written beside the schema names.
- § Schema gate — before marking a page `extracted`: what `validate-page.mjs` fails, warns and never weakens.
- § Live-render evidence — before any write: why a synthesized page record is forbidden and how the guard refuses it.

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
    "schemaVersion": 2,              // REQUIRED. the per-page schema this record follows (see § Versioning)
    "script": "crawl.mjs",           // the writer
    "renderedBy": "playwright",      // REQUIRED. "playwright" only — synthesis is forbidden (see § Live-render evidence)
    "fetchedAt": "2026-04-25T13:41:58Z",  // ISO 8601 timestamp of the live fetch (distinct from writtenAt)
    "waitMode": "networkidle",       // configured mode: fast | medium | spec | networkidle | domcontentloaded(fallback)
    "waitMs": 3820,                  // actual wait time, including grace and scroll pass — must be > 0
    "httpStatus": 200,               // final response status after redirects
    "contentType": "text/html",      // final response content-type (without charset)
    "heroSource": "dom",             // "dom" | "meta-fallback" — which source heroHeadline/heroLede came from (see § Hero headline)
    // capture-condition fields — same names as the replica capture sidecar (../../replica/scripts/capture-sidecar.mjs)
    "width": 1440,                   // viewport width the page was captured at
    "dpr": 1,                        // devicePixelRatio of the capture
    "technique": "headless",         // bot-management tier that captured: "headless" | "chrome-headless" | "chrome-headed-offscreen"
    "storageState": false,           // true when an admitted session (cookies/storage) was reused for the capture
    "variants": [],                  // A/B / geo / personalisation markers observed at capture — { kind: "cookie"|"attribute"|"global", name, value? }
                                     // from experiment cookies (optimizelyEndUserId, mbox, _vwo_uuid), [data-experiment*] attributes, testing globals
    "compatMode": "CSS1Compat"       // document.compatMode — "BackCompat" = quirks mode: the replica mirrors the (missing) doctype (../../replica/reference/recreation-procedure.md § CSS lifting)
  },
  "slug": "about",
  "url": "https://example.com/about",
  "finalUrl": "https://example.com/about/",
  "title": "About Example",
  "metaDescription": "...",
  "heroHeadline": "Designed for the way you actually work",   // see § Hero headline
  "heroLede": "One platform for your whole team, from intake to delivery.",
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
  "dynamic": { /* see § Dynamic — script-captured evidence of the page's dynamic surface */ },
  "components": { /* see § Components */ },
  "perSectionStyle": [ /* see § Per-section style */ ],
  "embedDominance": { /* see § Embed dominance */ },
  "cssCustomProperties": [ /* see § CSS custom properties */ ],

  "screenshot": "assets/screenshots/about.png",         // relative to stardust/current; 1440-wide; band 1 when _signals.screenshotMode is "banded"
  "screenshotMobile": "assets/screenshots/about-360.png", // 360×900 re-layout of the same page (`--mobile entry|all|none`, default entry); absent when not taken
  "_signals": { /* see § Signals — crawler capture-quality flags, never content */ },

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

Document order, light DOM and open shadow roots together (`shadow: true`
on a heading that lives inside one). Computed style snapshot of the
heading itself. A block element styled as a display head — at least
24 px and 1.6× the body size, ≤ 120 chars of its own text, outside every
real heading, link and button — is emitted once with `inferred: true`
(`tag` = its element; `level` 1 or 2 by size): div-styled hero titles no
longer vanish behind card `h3`s. `_signals.inferredHeadings` counts them.

```json
{
  "tag": "h2",
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

## § Hero headline

Two resolved convenience fields for the page's hero copy, computed per
`playwright-recipe.md` § Capture list (5-bis). They exist because
document-order heuristics (`headings[0]`) are unreliable on
JS-rendered enterprise CMSes, where the visually-dominant tagline is
buried among many `<h2>`s and the DOM carries hidden modal / promo /
count states.

- `heroHeadline` — the largest-font-size heading in the hero band
  (top ≤ ~820 px), after the junk-state filter; or, when that is
  empty / junk, the first sentence of `metaDescription`.
- `heroLede` — the first substantial paragraph in the top ~1300 px,
  after the junk filter; or the full `metaDescription` as fallback.
- `_provenance.heroSource` records `"dom"` or `"meta-fallback"`.

Both are **required** (emit `""` only when even the meta-description
fallback is empty). `headings[]` remains the full, unfiltered outline;
these fields do not replace it. Downstream `prototype` / `migrate`
prefer `heroHeadline` / `heroLede` over re-deriving from `headings[]`.

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
  "innerText": "...",                  // FULL innerText, no truncation
  "children": [
    {
      "tag": "section",
      "role": null,
      "id": "hero",
      "classes": ["hero", "hero--dark"],
      "purpose": "hero",          // heuristic: "hero" | "feature-list" | "social-proof" | "cta-band" | "footer-nav" | "form" | "rich-text" | "unknown"
      "headlineRef": 0,            // index into headings[] if any
      "innerTextSummary": "first 240 chars",
      "wordCount": 87,
      "body": [                    // structured paragraphs, in DOM order
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
      ],
      "lists": [
        { "ordered": false, "items": ["Item one", "Item two", "Item three"] }
      ],
      "qa": [                      // populated when an accordion is detected
        { "q": "How do I cancel?",  "a": "From settings → billing → cancel." }
      ],
      "quotes": [                  // populated when testimonials / blockquotes detected
        { "text": "Best tool we ship.", "attribution": "Jane Doe, Acme",
          "rating": 5 }
      ],
      "richtext": "<h2>Our story</h2><p>Lorem…</p><ul><li>…</li></ul>",   // sanitised prose: p ul ol li a(href) strong em b i u br h2-h4 only
      "rect": { "x": 0, "y": 1180, "width": 1440, "height": 640 },       // live rect at 1440; 0×0 = placeholder / unhydrated module
      "domPath": "main > section#story"
    }
  ]
}
```

`domPath` is selector-shaped (`tag#id` | `tag.firstClass` |
`tag:nth-child(n)` segments; ` >>> ` marks a shadow boundary), stable
enough to find the node again in the sidecar, not guaranteed unique.
`body[]` holds the section's `p`/`blockquote` text outside list items
(list items live in `lists[]`, so a `li > p` is never doubled).

`innerText` is captured in **full** — no length cap. The
`innerTextSummary` field stays as a 240-char preview for cheap
display in reports; consumers that need the full body read
`innerText` directly or use the structured fields below.

`purpose` is a **heuristic guess**, not ground truth. Helps `direct`
and `prototype` reason about IA without re-parsing. When unsure, emit
`"unknown"` — never invent.

`body[]`, `lists[]`, `qa[]`, `quotes[]` are required; emit `[]` when
the section has none of that shape (a hero card with one heading and
one CTA legitimately has no paragraphs / lists / accordion / quotes).

`codeBlocks[]` (page-level, sibling of `body`) captures every visible
`<pre>`'s `innerText` verbatim, in document order. On developer-tool
sites the install commands are the single most load-bearing content
and the prose capture skips them (stardust-style e2e finding); every
downstream phase that needs a command literal reads it from here, not
from `body[]`. Emit `[]` when the page has no code blocks. Capture
rule: `playwright-recipe.md` § Capture list 7-ter.
Capture rules in `playwright-recipe.md` § Capture list (7-bis). These
fields are what migrate consumes to render real body copy under
each section heading; without them every body region falls back to
the placeholder-with-signature treatment (per `prototype/reference/
proposed-file-shell.md` § Content sourcing hierarchy) even when the
source page had real prose to reuse.

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
  "appearsAbove": "fold",         // "fold" | "below-fold"
  "buttonLike": true              // recipe 8 test (opaque background, radius, padding) or a real button — brand-surface filters on it
}
```

## § Links

Two arrays: `internal` (same host) and `external`. Each entry:

```json
{ "href": "/pricing", "text": "Pricing", "domPath": "header > nav > a:nth-child(2)" }
```

De-duplicate by `(href, text)`, fragment dropped. Keep the first
occurrence's `domPath`. Internal `href` is path + query; external is
absolute; `mailto:`/`tel:`/`javascript:` are not links here.

## § Media

```json
{
  "images": [
    {
      "src": "https://cdn.example.com/connect/9f.../hero.jpg?MOD=AJPERES&CACHEID=...",
      "currentSrc": "https://cdn.example.com/connect/9f.../hero.jpg?MOD=AJPERES&CACHEID=...",
      "srcset": "...",
      "sources": [ { "media": "(min-width: 1200px)", "srcset": "…", "type": null } ],   // <picture><source> candidates
      "alt": "Two engineers at a whiteboard",
      "naturalWidth": 2400,
      "naturalHeight": 1600,
      "rect": { "x": 0, "y": 0, "width": 1440, "height": 720 },   // live rect at 1440 (the banner wordmark's rect feeds the logo chain)
      "resolves": true,
      "localPath": "stardust/current/assets/media/hero-a3f9.jpg",
      "domPath": "main > section.hero > img"
    }
  ],
  "imgs": [ { "src": "…", "alt": "…", "w": 2400, "h": 1600 } ],   // 0.24.x alias of images[] (loaded images only)
  "inlineSvgs": [
    { "viewBox": "0 0 24 24", "domPath": "...", "markupHash": "fnv1a:8c3d9a21", "rect": { "x": 0, "y": 0, "width": 24, "height": 24 }, "inBanner": true }
  ],
  "cssBackgrounds": [
    {
      "url": "https://example.com/img/slide-1.png",
      "domPath": "main > section.hero",
      "boundingClientRect": { "x": 0, "y": 0, "width": 1440, "height": 720 },
      "backgroundSize": "cover",
      "backgroundPosition": "center center",
      "backgroundRepeat": "no-repeat",
      "pseudo": null,                  // "::before" | "::after" when the image sits on generated content (domPath ends the same way)
      "localPath": "stardust/current/assets/media/slide-1-b7c4.png"
    }
  ],
  "videos": [ { "src": "…", "poster": "…", "autoplay": true, "loop": true, "muted": true, "rect": {}, "domPath": "…" } ],
  "iframes": [
    { "src": "https://www.youtube.com/embed/...", "title": "Demo", "rect": {}, "crossOrigin": true, "domPath": "…" }
  ]
}
```

`localPath` (relative to `stardust/current`, like `screenshot`) is set
only for bodies the harvest kept — by default the render's own responses
(`--assets intercept`), plus capped in-page fetches under `--assets full`.
Failed or never-requested candidates have `localPath: null` and a
`downloadError` (`HTTP 404`, `not-requested`, …). `mime` is sniffed from
the bytes; `transformSuspect: true` marks a body whose format differs
from the URL's extension (a CDN transform) — recorded, never "fixed".
`assets/_media-manifest.json` holds the same rows per URL across runs
(`pages[]`, `status`, `bytes`); `assets/_fonts-manifest.json` the font
files with their `@font-face` descriptors, `licensingFlag` and the
`iconFonts[]` table; `assets/favicon-set.json` every icon with `sizes`.

`src` / `currentSrc` are captured **with the query string intact**
(enterprise DAM/CDN URLs carry load-bearing `?MOD=…&CACHEID=…`
params; stripping them 404s). `resolves` is read from the **rendered
state** of the same settled page — `true` when the image completed with
a natural width, `false` when it completed empty (the broken-image
icon), `null` while still loading — never a second request to the
source origin. `migrate` omits or repairs (never authors) any image
whose `resolves` is `false`, which is how `about:error` is prevented
before it ships.

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
  "thirdParty": null,              // or "stripe" | "calendly" | "typeform" | "mailchimp" | ...
  "domPath": "main > section#contact > form"
}
```

Always present (empty `[]` without forms). The `--dynamics` reach shape
(`dynamic.forms[]`: `sameOrigin`, `search`, `fieldNames`) comes from the
same walk — one query, two shapes, no classification.

## § Widgets

```json
{
  "modals": [{ "trigger": "button.open-pricing", "domPath": "..." }],
  "accordions": [{ "domPath": "...", "itemCount": 6 }],
  "tabs": [{ "domPath": "...", "tabCount": 3 }]
}
```

Empty arrays are valid; missing keys are not.

## § Dynamic

Script-captured by `crawl.mjs` **only with `--dynamics`** (migration-bound:
prepare-migration, replica and migrate set it) — **per-page reach evidence
of what the page fetched and how it was rendered, never a classification.**
The network side is recorded by a response listener attached before
navigation; the DOM side is read from the settled document. The
stardust `dynamics` sub-skill probes archetypes in depth
(`_dynamics.json`) and folds these sections into each finding's reach;
decisions live in `stardust/dynamic-features.md`. Absent section = the
crawl ran without the flag (redesign-only work).

```json
{
  "endpoints": [                       // xhr/fetch/eventsource responses + anything JSON, deduped by METHOD + host + path pattern
    {
      "method": "GET",
      "host": "www.example.com",
      "path": "/api/news/{n}",          // ids collapsed: /{n} numeric, /{uuid}, /{hash} (16+ hex)
      "query": ["page", "sort"],        // query KEY names only, sorted — values are never recorded
      "resourceType": "fetch",          // playwright resourceType: xhr | fetch | eventsource | other (when matched by JSON content-type)
      "contentType": "application/json",
      "status": 200,
      "bytes": 4812,                    // content-length header; null when chunked
      "hits": 2,                        // calls collapsed into this row on this page
      "example": "https://www.example.com/api/news/1234",
      "sameSite": true                  // loose eTLD+1 match against the page's host
    }
  ],
  "thirdPartyScriptHosts": [{ "host": "js.vendor.com", "count": 3 }],   // script responses from other sites; same-site scripts are not listed
  "truncated": false,                  // true when the 150-endpoint cap was hit — treat the list as a sample
  "inlineData": [                      // <script type="application/json"> blobs (ld+json excluded — that's metadata)
    { "id": "__NEXT_DATA__", "type": "application/json", "bytes": 48213, "topLevelKeys": ["props", "page", "buildId"] }
  ],
  "globalState": ["__NEXT_DATA__"],    // well-known hydration globals present on window (dataLayer counts as evidence, not hydration)
  "frameworkHints": ["next"],          // DOM fingerprints: next | gatsby | nuxt | react | angular | vue | sveltekit | astro | turbo | webflow | wordpress | shopify | hubspot-forms | marketo-forms | aem-sites
  "forms": [                           // visible forms, ≤20; complements § Forms (which carries the field schema)
    { "action": "https://www.example.com/search", "hasAction": true, "method": "get", "sameOrigin": true, "fieldCount": 1, "fieldNames": ["q"], "search": true }
  ],
  "ariaLiveRegions": 0,
  "triggers": [{ "marker": "aria-haspopup=dialog", "href": null }],   // modal-trigger markers per page (reach for M findings)
  "mediaIds": ["987654"],                                             // player ids / player iframe srcs per page (reach for V findings)
  "tabs": { "tablists": 1, "expanders": 4 },                          // [role=tablist] count + [aria-expanded] outside page chrome (tabs / accordions)
  "shadowHosts": [{ "tag": "my-widget", "cls": "product-finder" }],   // open shadow roots with > 40 chars of text, ≤10 (web-component islands)
  "emptyConfigContainers": [{ "tag": "div", "attrs": ["data-component", "data-endpoint"] }],  // childless, text-less data-* config mounts, ≤10 — a client app renders here
  "controlGroups": [{ "container": "section.filters", "controls": 3 }],  // ≥2 visible form-less inputs per container, ≤10 (JS-driven filters / calculators)
  "searchShell": false,                                               // search URL or input[type=search] on a near-empty <main> — results render client-side
  "players": [{ "vendor": "kaltura", "id": "12345678" }],             // vendor players by DOM fingerprint (kaltura | brightcove | wistia), ≤20
  "chatLoaders": ["widget.intercom.io"],                              // chat vendor script hosts or launcher markers, ≤6 (DOM side; network side is thirdPartyScriptHosts)
  "federated": { "remoteEntries": [], "registerCalls": 0 },           // module-federation remoteEntry.js srcs (≤6) + registerFederatedComponent( calls
  "quiz": { "markers": 0, "radioFieldsets": 0 },                      // quiz / questionnaire class markers + fieldsets with ≥3 radios
  "summary": {
    "sameSiteEndpoints": 2, "thirdPartyEndpoints": 1, "thirdPartyScriptHosts": 1,
    "inlineDataBlobs": 1, "forms": 2, "searchForms": 1,
    "hydrated": true,                  // frameworkHints or a hydration global present — the page was (at least partly) client-rendered
    "tabs": 5, "players": 1, "controlGroups": 1, "chatLoaders": 1, "federated": 0, "quiz": 0,   // reach-signal counts (tablists+expanders, players, groups, loaders, remoteEntries+registerCalls, markers+radioFieldsets)
    "searchShell": false
  }
}
```

Rules:

- `hasAction: false` means the form has no `action` attribute — the
  `action` value shown is the page URL by HTML default and the form is
  almost certainly JS-submitted; look for a matching POST in
  `endpoints`.
- `search: true` is a heuristic (`role=search`, `type=search`, a
  `q|s|query|search|keyword(s)|term` field, or `/search` in the action).
- Empty arrays are valid. A page crawled with `--dynamics` and no
  dynamic surface still carries the section with zeroed `summary`
  counts; a missing section means the crawl ran without the flag.

### `_crawl-log.json#dynamicSurface`

The site-level roll-up, written once per crawl: the same rows keyed
across pages with `pages` (how many pages hit it) and `examples[]`
(≤3 slugs). Sections: `endpoints` (≤300), `thirdPartyScriptHosts`,
`frameworkHints`, `globalState`, `formTargets`, plus the counters
`pages`, `pagesWithSameSiteData`, `pagesWithSearchForm`,
`pagesHydrated`, `truncatedPages` and the reach-signal counters
`pagesWithTabs`, `pagesWithPlayers`, `pagesWithLooseControls`,
`pagesWithChat`, `pagesWithFederated`, `pagesWithQuiz`,
`searchShellPages` (one per page whose `summary` count is non-zero /
`searchShell` is true). This is the view Phase 4.5 reads first;
per-page `dynamic` is for drilling into one row.

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

## § Signals

`_signals` is written by `crawl.mjs` per page: cheap instrument-side flags
the Phase 2.5 vision pass reads **before** looking. They describe the
capture, never the site; none of them alone marks a page `suspect`.

```json
"_signals": {
  "filteredInterstitials": 1,      // nodes dropped by the interstitial/consent text filter
  "distinctHeadings": 7,
  "mainTextLen": 4120,             // innerText length of <main> (or body)
  "realImageCount": 9,             // <img> > 2 px that are not tracking pixels
  "trackingOnlyMedia": false,
  "spaShellSuspect": false,        // < 2 headings, tiny text, no media — SPA shell captured before render
  "duplicateOf": "listing",        // post-pass: same content hash as an earlier-queued page (detail == listing)
  "emptyMain": false,              // a <main>/[role=main] exists, < 50 chars of text, no real image — unhydrated shell
  "brokenImages": 0,               // <img src> with complete && naturalWidth === 0
  "subResourceBlock": false,       // brokenImages ≥ max(3, 30 % of <img src>) — the edge 403'd images while the document loaded
  "overlayCoverPct": 4,            // position:fixed elements ∩ first viewport, % of the viewport; > 30 prints OVERLAY? on the page line
  "shadowRoots": 1,                // open shadow roots carrying text — descended by every query and serialised into the sidecar
  "shadowTextLen": 115,            // characters pierced from them (0 with shadowRoots > 0 = a WARN in the schema gate)
  "inferredHeadings": 1,           // display heads emitted with inferred: true (§ Headings)
  "iconFont": [ { "family": "atlas-icon", "classes": ["ecs-glyph"], "codepoints": 67, "glyphs": ["U+E001"] } ],   // family-first ::before/::after glyph walk (recipe 17)
  "captureQuality": "ok",          // "ok" | "degraded" (emptyMain or subResourceBlock) — degraded is recorded, never thrown
  "screenshotMode": "fullPage",    // "fullPage" | "banded" (> 16,000 px: <slug>.png + <slug>.part2.png…) | "clipped" (raster threw; first viewport only) | "failed"
  "screenshotBands": 3,            // banded only
  "docHeight": 21622,              // document scrollHeight at capture
  "screenshotMobileMode": "fullPage", // same vocabulary for <slug>-360.png; the 360 layout is taller, so banding fires here first
  "screenshotMobileBands": 2
}
```

Reading rules (Phase 2.5): `degraded` is `suspect` until the page is
re-crawled (`--refresh <slug>`, one tier up when the cause is an edge
block); `OVERLAY?` pages are re-captured **before** they are looked at;
a `banded` page is read band by band; `clipped` means the tail is
missing by instrument — never `suspect` for that reason alone.
`plugins/stardust/evals/lint/crawl-log-lint.mjs --dir stardust/current` fails a run whose
`visionCheck[]` says `ok` on a degraded page or with an overlay in the note.

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
omit the key; emit `[]` explicitly. `customProps` (the same pairs as one
object) is the 0.24.x alias.

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

Colours are **area-weighted** over the section's rendered descendants
(background by painted area, text by character count); spacing is the
section's own padding plus the most frequent flex/grid `gap`.
`stats.motifs {radii, shadows, gradients}` carries the page-wide
element counts per value that brand-surface's motif mode reads.

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

`_provenance.schemaVersion` (integer, written by the script) is the
schema version; a project-copied script cannot know the plugin version,
so `stardustVersion` is not the carrier. Consumers branch on it;
backward-compatible additions do not bump it. Records without the field
are schema 1 (0.23 and earlier) — `validate-page.mjs --legacy` admits
them with a WARN per absent key.

### 0.24.x aliases

Code follows the schema names; the crawl-only names of schema 1 are
written beside them for one release and dropped in 0.25:

| schema name | alias written | shape of the alias |
|---|---|---|
| `metaDescription` | `description` | same string |
| `media.images[]` | `media.imgs[]` | `{ src, alt, w, h }`, loaded images only |
| `cssCustomProperties[]` | `customProps` | one object `{ "--name": "value" }` |
| `headings[].level` | `headings[].tag` | the element name (kept, not an alias to drop) |
| `landmarks[].children[].body[]` | page-level `body[]` | flat `p`/`blockquote`/`li` text of `<main>` |

Not aliased: `links` changed from a flat array to `{ internal, external }`
(no plugin script read the flat form) and `cssBackgrounds[]` from URL
strings to objects.

## Schema gate

`crawl.mjs` runs `validateRecord()` on every record it writes and
`skills/extract/scripts/validate-page.mjs` re-runs it offline over
`pages/*.json` (`--dir`, `--file`, `--legacy`, `--json`; exit 0 pass ·
1 FAIL · 2 usage). Eval: `evals/fixtures/validate-page.test.mjs` and
`evals/fixtures/crawl-capture.test.mjs` (the emitted record passes).

- **Condition (FAIL, exit 1).** A required top-level key of § Required vs
  optional is absent (empty passes), a provenance field of § Live-render
  evidence is missing or `renderedBy` is not `playwright`, or
  `schemaVersion` is missing or newer than the validator. Keys are named
  per slug. **WARN (exit 0):** empty `headings`/`landmarks`/`ctas`,
  `captureQuality: "degraded"`, shadow roots with no pierced text.
- **Blocks.** Marking the page `extracted` in `state.json`. The record and
  its sidecar stay on disk as evidence; the crawl log lists the slug under
  `crawl.failures` with `errorClass: "SchemaError"`.
- **Escape.** `--legacy` for pre-schema-2 records only; no hatch for the
  provenance fields; no threshold to tune.
- **Hands-off.** A FAIL is an instrument fact: re-crawl the slug once with
  `--refresh <slug>`; a second FAIL appends `event: "blocked"` naming the
  keys and leaves the page unmarked. The condition is the same in every
  mode.

## Live-render evidence (synthesis is forbidden)

Every per-page JSON file is the result of a Playwright (or
Playwright MCP) live render against the source URL. Synthesizing
a page record from `_brand-extraction.json` + URL patterns +
captured photo IDs is **forbidden**, even when the synthesized
shape would be plausible. The 2026-04-30 e-commerce cascade ran
"successfully" for four phases on a 25-page inventory where 20
pages had been synthesized this way; the failure was invisible
until a meta-question exposed the missing live-render evidence.

The forbidden shortcut is signed for in `_provenance`:

| field | required value | enforced where |
|---|---|---|
| `renderedBy` | `"playwright"` | `extract` write-time + `validateProvenance()` at every downstream phase |
| `waitMs` | integer `> 0` | same |
| `fetchedAt` | ISO 8601 timestamp string | same |
| `httpStatus` | integer (the *final* response status after redirects) | same |
| `waitMode` | one of `fast` / `medium` / `spec` / `networkidle` / `domcontentloaded` / a `<mode>(fallback)` form | same |

`extract` (and `extract --prep`) **must refuse to mark a page
`extracted` in `state.json`** without these five fields populated
from a real Playwright render. Sub-agents delegated to perform
extraction must return a per-page evidence table (slug / waitMode
/ waitMs / fetchedAt) and explicitly forbid synthesis in their
prompt — *"must actually invoke Playwright per page"* alone is
not sufficient; spec-level prompts must list the synthesis
shortcut by name and forbid it.

Downstream phases (`direct --prep`, `prototype`, `migrate`,
`prepare-migration` orchestrator) call
`validateProvenance(page)` per
`skills/stardust/reference/state-machine.md` § Provenance
validation **on entry, before any work**, and abort with a clear
error if any page in scope has missing or fabricated provenance.
The double-guard (write-time refusal at extract + read-time
validation at every consumer) is intentional defense-in-depth:
single-layer guards have already missed at least one synthesis
failure mode in production.
