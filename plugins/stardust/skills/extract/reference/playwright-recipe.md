# Playwright recipe

The exact browser configuration and capture list every page extraction
must use. Carried forward from stardust v1's brand-extract recipe with
adjustments for multi-page operation.

The agent invokes Playwright via the Playwright MCP server if available,
otherwise via `npx playwright` from the Bash tool. Either way, the
parameters below are mandatory.

---

## Browser configuration

```
browser:        chromium
viewport:       1440 × 900
deviceScaleFactor: 2
colorScheme:    light       (capture again with "dark" only if direction.md needs it later)
locale:         en-US       (override per-page if site Content-Language differs)
reducedMotion:  reduce      (so animation transforms don't pollute computed styles)
javaScriptEnabled: true
ignoreHTTPSErrors: true     (some staging hosts ship invalid certs)
```

## Wait modes

The wait strategy is configurable per `extract` invocation via
`--wait fast|medium|spec`. Default: `medium`.

| mode | `goto` waitUntil | grace | hard cap | when to use |
|---|---|---|---|---|
| `fast` | `domcontentloaded` | 500 ms | 4 s | known SSR sites where speed matters and DOM is in the initial response |
| `medium` (default) | `domcontentloaded` | 2000 ms | 8 s | server-rendered marketing sites — the common case |
| `spec` | `networkidle` | 1500 ms | 30 s | JS-driven SPAs, dashboards, anything where content paints after `domcontentloaded` |

If the configured `waitUntil` does not resolve within the hard cap,
fall back to `domcontentloaded` and capture whatever is rendered.
Record the actual `waitMs` and resolved `waitMode` (e.g.
`"networkidle"` or `"domcontentloaded(fallback)"`) in the per-page
`_provenance` and in `_crawl-log.json` under `crawl.failures` only if
the fallback indicates a likely under-capture.

### Auto-detect (optional optimisation)

Before the first Playwright navigation, the agent may issue a plain
`fetch()` of the entry URL and inspect the raw HTML. If the response
already contains `<main>`, `<h1>`, or recognisable nav landmarks, the
site is server-rendered and `medium` is appropriate. If the body is a
near-empty shell (`<div id="root">`, `<div id="app">`, no headings),
the site is JS-driven and `spec` is appropriate. Record the chosen
mode and the auto-detect basis in `_crawl-log.json` under
`discovery.waitMode`.

The default remains `medium` regardless of auto-detect until the
heuristic is validated across more sites; auto-detect is opt-in via
`--wait auto`.

## Navigation

```
goto(url, { waitUntil: <mode>, timeout: <hardCap> })
wait <grace> ms              // grace period for late JS paints
scroll the page to bottom in 4 viewport-height steps with 300 ms pauses
scroll back to top
```

The grace period catches lazy-loaded hero media, fonts that swap after
the wait resolves, and analytics-blocked late paints. The
scroll-to-bottom pass triggers IntersectionObserver-driven content
(carousels, fold-in sections, lazy images) so it lands in the captured
DOM. **Skipping the scroll pass is a recipe violation** — even
server-rendered sites use lazy images.

## Capture list

For each page, capture:

1. **Final URL after redirects** — the resolved canonical URL.
2. **Document title** and `<meta name="description">`.
3. **OpenGraph tags** — `og:title`, `og:description`, `og:image`,
   `og:type`, `og:site_name`.
4. **Theme color** — `<meta name="theme-color">`, both `media="(prefers-color-scheme: light)"` and `dark` if present.
5. **Heading outline** — every `h1`-`h6` in document order with text
   and computed font-family, font-weight, font-size, line-height,
   letter-spacing, color.
6. **Landmark structure** — every `header`, `nav`, `main`, `aside`,
   `footer`, plus elements with `role="banner|navigation|main|complementary|contentinfo|region"`. For each: tag, role, id, class, child element count.
7. **Visible text per landmark** — innerText, normalised whitespace.
8. **CTA inventory** — every `button`, `[role="button"]`, and `<a>`
   that visually presents as a button (background-color != transparent,
   `border-radius > 2px`, padding > 4 px). Capture: label, href if any,
   computed background-color, color, font-family, font-weight,
   border-radius, padding, box-shadow.
9. **Link inventory** — every `<a href>`. Classify internal vs
   external by host. Strip query and fragment for de-dup.
10. **Per-section style summary** — for each landmark, compute:
    - dominant background-color (most pixels weighted)
    - dominant text color
    - aggregate spacing (mode of `padding-block`, `padding-inline`,
      `gap`, `margin-block`)
    - dominant border-radius (mode of non-zero values across direct
      children)
11. **Media inventory** — for every `<img>`: src, srcset, alt,
    naturalWidth, naturalHeight. For every inline SVG: serialized
    markup hash + viewBox. For every `<video>` and `<iframe>`: src and
    poster.
    For each cross-origin `<iframe>` (host different from page host),
    additionally capture: `boundingClientRect` after layout settles,
    `viewportCoveragePct` (its rect area divided by 1440×900), and
    `mainHeightCoveragePct` (its rect height divided by `<main>`'s
    rendered height, or `<body>` if no `<main>`). These feed the
    per-page `embedDominance` field — see
    `current-state-schema.md` § Embed dominance.

    **CSS background-images.** For every element where
    `getComputedStyle(el).backgroundImage` resolves to a non-`none`
    value containing one or more `url(...)` references, capture:
    the resolved URL(s), the element's `domPath`, its
    `boundingClientRect` after the wait+scroll pass settles,
    `backgroundSize`, `backgroundPosition`, and `backgroundRepeat`.
    Filter by visible size: only include elements whose rect is
    **≥100 × 80 px** at the captured viewport — smaller elements are
    almost always icon backgrounds (chevrons, sprite glyphs, list
    bullets) that don't carry brand or content meaning. Save into
    the per-page `media.cssBackgrounds[]` field — see
    `current-state-schema.md` § Media. The brand-surface pass
    aggregates cross-page repeats into `_brand-extraction.json`'s
    `systemComponents` so backgrounds reused across pages (a
    section-background image used on home AND about, a banner
    image used on multiple inner pages) surface as system motifs
    rather than per-page noise. Without this capture, hero photos
    applied via `background-image` (parallax sections, full-bleed
    sections) are silently invisible to extract — `STARDUST-FEEDBACK.md
    F-018 / X-1`.
12. **Form inventory** — for every `<form>`: action, method, list of
    fields with type and name; whether it's wired to an obvious
    third-party (Stripe, Calendly, Typeform, Mailchimp).
13. **Interactive widgets** — modals (open `<dialog>`, `[role="dialog"]`),
    accordions (`<details>`, ARIA-driven), tabs (`role="tablist"`).
14. **Page screenshot** — full-page PNG saved as
    `stardust/current/assets/screenshots/<slug>.png`. Used by `direct`
    later when the user wants to point at a specific section.
15. **CSS custom properties** — read `getComputedStyle(document.documentElement)`
    and enumerate all property names starting with `--`. Capture as
    `{ name, value }` pairs. Used by the Tensions detector
    (`brand-review-template.md` § Detectors) to flag sites that ship
    no design tokens. An empty list across all extracted pages is the
    signal "no tokens defined."

## Logo locator chain

For the brand-surface pass (Phase 3 of `extract`), find the logo in
this exact priority order. Stop at the first hit.

1. **Inline SVG** — first `<svg>` inside `header`, `[role="banner"]`,
   or `nav` that is not an icon (heuristic: width or viewBox-derived
   width ≥ 60 px and contains `<text>` or has `aria-label` matching
   the brand name).
2. **`<img>` with logo-ish identifier** — `img` whose `src`, `alt`,
   `class`, or `id` contains `logo`, `brand`, or the brand name slug
   (case-insensitive). Inside `header`, `[role="banner"]`, or `nav`.
3. **`apple-touch-icon`** — `<link rel="apple-touch-icon">` href.
   Resolve relative to base URL.
4. **`og:image`** — `<meta property="og:image">` content.
5. **Favicon** — `<link rel="icon">` href, then `/favicon.ico`,
   then `/favicon.svg`. Skip if dimensions ≤ 32 × 32 (too small to
   serve as logo).
6. **Synthesized placeholder** — final fallback. A 256 × 256 SVG
   containing the brand-name initials in the dominant text color on
   the dominant background. Mark `synthesized: true` in
   `_brand-extraction.json` with a one-line basis.

For each non-synthesized hit, save the asset to
`stardust/current/assets/logo.<ext>` preserving its original format
(SVG > PNG > JPG > ICO). If the hit is inline SVG, serialize and save
as `logo.svg`.

Logo variants (`logo-white.svg`, `logo-mono.svg`) are not extracted in
v2 — they are derived later by `direct` if the redesign needs them.

## What NOT to capture

- Per-element computed styles for every node. Too noisy. Only the
  per-section summary in (10) above.
- Screenshots of every viewport size. Just 1440 × 900 in this phase;
  responsive checks happen in `prototype` and `migrate`.
- Network HAR. Out of scope.
- Cookies, localStorage, sessionStorage. Out of scope.
- Anything that would require authentication.

## Response validation

`page.goto()` resolves on **any** HTTP response, not just 2xx. A naive
implementation captures HTTP 4xx/5xx pages as empty
`pages/<slug>.json` files (no title, no headings, no body) and
classifies them as success — propagating wrong data to `direct` and
`prototype`. The agent **must** validate the response before treating
the page as captured.

Capture the navigation response and apply these checks in order:

1. **Status code.** If `response.status() >= 400`, treat as a Phase 2
   failure: do not write `pages/<slug>.json`; record under
   `_crawl-log.json#crawl.failures[]` with
   `errorClass: "HTTPError"` and `message: "HTTP <status>"`.
2. **Content type.** Read `response.headers()['content-type']`. If
   it does not start with `text/html` or `application/xhtml+xml`,
   treat as a Phase 2 failure with
   `errorClass: "ContentTypeError"` and
   `message: "unexpected content-type: <type>"`. Catches sites that
   serve JSON, plain text, or PDFs at HTML-looking URLs (common with
   misconfigured WAFs and API endpoints that slipped past the
   filter).
3. **Final URL after redirects.** If `page.url()` differs from the
   requested URL, record it as `finalUrl` in the per-page
   `_provenance`. The slug stays bound to the requested URL, but
   downstream consumers reason about content origin from `finalUrl`.
   3xx chains are followed normally — only the *final* response is
   validated.
4. **Soft-404 / empty page.** After capture, if the rendered page
   has **all** of: zero visible text in `<body>`, zero headings,
   zero images, zero form fields, **and** zero iframes, treat as a
   Phase 2 failure with `errorClass: "EmptyPageError"` and
   `message: "empty page — possibly soft-404"`. The conjunction is
   deliberately tight: legitimate minimal pages (a Calendly embed
   landing, a single-iframe contact widget) have at least one of
   those signals.

Failed pages do **not** appear in `state.json` as `extracted`. They
appear only in `_crawl-log.json#crawl.failures[]`. The user can
re-run with `--refresh <slug>` once the underlying issue is fixed.

## Failure isolation

A failure on one page must not abort the crawl. Record the error
(URL, error class, error message, timestamp) in `_crawl-log.json`
under `failures[]` and continue with the next page. The skill's final
state report counts successes vs failures, and surfaces the failure
classes (`HTTPError`, `ContentTypeError`, `EmptyPageError`,
`TimeoutError`) so the user can diagnose at a glance.
