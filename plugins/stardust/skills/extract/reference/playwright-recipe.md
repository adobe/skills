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

### Bot-management fallback (Akamai / Cloudflare / F5 / Imperva)

Bundled-chromium-default headless mode (no `channel`,
`headless: true`) emits a TLS/H2 fingerprint that Akamai and
several other bot-management products reject outright — the
first navigation returns `net::ERR_HTTP2_PROTOCOL_ERROR` or
`net::ERR_QUIC_PROTOCOL_ERROR` immediately, before any JS runs.
The bare Playwright `request` API hits the same fingerprint and
fails identically; passing `--disable-http2` flips the failure
mode to a 30-second `TimeoutError` (connection accepted, no
content) but doesn't recover.

The known-working fallback is **headed real Chrome**:

```
chromium.launch({ headless: false, channel: 'chrome' })
```

This pops a visible browser window during the run, which is
acceptable for a local dogfood / interactive session and
unacceptable for an unattended pipeline. The trade-off is the
correct one for stardust's primary use case (presales redesign
of an existing commercial site, agent-driven from a developer's
machine) — the alternative is silently failing on most
enterprise / large-retail / commerce origins.

**Retry rule.** When the first navigation in a run returns any
of `ERR_HTTP2_PROTOCOL_ERROR`, `ERR_QUIC_PROTOCOL_ERROR`, or
hangs for the entire hard-cap on a connection that doesn't
fingerprint cleanly: do **not** retry headless. Switch to
`headless: false, channel: 'chrome'` immediately and record the
switch in `_crawl-log.json#discovery.fetchTechnique` so re-runs
start in headed mode without rediscovering the issue.

**Sub-resource fetches.** Once a page context is open in headed
Chrome, additional fetches (sitemap, logo file, ad-hoc inspection
URLs) inherit the JA3 fingerprint when issued via
`page.evaluate(async () => fetch('/...'))` — the in-page fetch
goes through the same TLS context. The bare Playwright `request`
API does **not** inherit the page context's fingerprint and
will hit the same H2 protocol error even after cookies are
established. Use the in-page evaluate pattern for any sub-resource
fetch on a bot-managed origin.

**Escape hatch (not standard).** The `playwright-extra` plugin
plus `puppeteer-extra-plugin-stealth` works on some Akamai
configurations but is non-standard and brittle across vendor
config changes. Stardust does not depend on it; mention to the
user as a path of last resort when even headed real Chrome is
blocked.

## Pre-flight: consent dismissal

Most production-tier sites ship a consent / cookie banner
(OneTrust, Cookiebot, Didomi, Osano, TCF v2-compliant custom
implementations) that overlays the bottom 25–35% of the
viewport. With default extract behavior the banner:

- covers the hero in every screenshot — the most load-bearing
  surface for downstream `direct` and `prototype` reasoning;
- dominates `voiceTable.ctaFrequency` with cookie-modal buttons
  (`Manage Settings`, `Reject All`, `Accept All` — appearing
  once per page across an N-page crawl);
- adds a phantom modal to every page's component count;
- leaks the banner's own font stack into per-section style
  aggregation.

Pre-flight a **consent dismissal** before the per-page loop.
One dismissal in a fresh `BrowserContext` typically persists
the cookie state across every subsequent page in the same
context, so the cost is one extra navigation per crawl.

### Dismissal procedure

API-first (most reliable across vendor config changes), then
selector fallback. Stop at the first method that hides the
banner. Probe in this order:

```js
async function dismissConsent(context, originUrl) {
  const page = await context.newPage();
  await page.goto(originUrl, { waitUntil: 'domcontentloaded' });

  // 1. JS APIs — defensive (?., try/catch, short timeouts)
  const apiTried = await page.evaluate(() => {
    try { if (window.OneTrust?.RejectAll)        { window.OneTrust.RejectAll();    return 'api:OneTrust.RejectAll'; } } catch {}
    try { if (window.Cookiebot?.dismiss)         { window.Cookiebot.dismiss();     return 'api:Cookiebot.dismiss'; } } catch {}
    try { if (window.CookieConsent?.dismiss)     { window.CookieConsent.dismiss(); return 'api:CookieConsent.dismiss'; } } catch {}
    try { if (window.Didomi?.notice?.hide)       { window.Didomi.notice.hide();    return 'api:Didomi.notice.hide'; } } catch {}
    try { if (window.osano?.cm?.dismiss)         { window.osano.cm.dismiss();      return 'api:osano.cm.dismiss'; } } catch {}
    return null;
  });

  // 2. Selector fallbacks — clicked in order; first that
  //    dismisses the banner wins.
  const selectorChain = [
    '#onetrust-reject-all-handler',
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonAccept',
    '[data-testid="uc-deny-all-button"]',     // Usercentrics
    '[aria-label*="reject" i]',
    '[aria-label*="accept" i]'
  ];

  let methodUsed = apiTried;
  if (!methodUsed) {
    for (const sel of selectorChain) {
      try {
        await page.click(sel, { timeout: 3000 });
        methodUsed = `selector:${sel}`;
        break;
      } catch {}
    }
  }

  // 3. Wait for the most common banner containers to be hidden
  //    or 8s elapse — whichever first.
  for (const sel of ['#onetrust-banner-sdk', '#CybotCookiebotDialog',
                     '[id*="didomi"]', '[id*="osano"]']) {
    await page.waitForSelector(sel, { state: 'hidden', timeout: 8000 }).catch(() => {});
  }

  await page.close();
  return methodUsed ?? 'none-detected';
}
```

Record the chosen method in
`_crawl-log.json#consent.method`. Values:
`api:<vendor>.<call>`, `selector:<css>`, `none-detected` (no
banner present — common on small / dev / non-EU sites),
`failed` (banner detected but neither API nor selectors
hid it — surface to the user as a per-site warning, the
banner will remain visible in screenshots).

### Opt-out

`extract --no-consent-dismiss` skips the pre-flight entirely.
Useful when the user wants to capture the banner deliberately
(e.g. a redesign whose scope explicitly includes the consent
surface) or when an unattended pipeline must avoid the
side-effects below.

### Side-effect caveat

Calling `OneTrust.RejectAll()` (and equivalents) commits a
"non-essential cookies declined" state, which on some sites
**activates other scripts** that wouldn't have run otherwise —
analytics, geo-IP detection, locale-cookie writes, A/B test
slots, live-chat. The 2026-05-03 nvidia.com run observed an
expanded localization leak after the dismissal step that
wasn't present in the pre-dismissal run. The dismissal step
is therefore not behavior-neutral: cleaner screenshots come
with the possibility of script-activation deltas. When the
extract returns content that visibly differs from the live
site, run with `--no-consent-dismiss` to compare.

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
7. **Visible text per landmark** — innerText in full, normalised
   whitespace. **No truncation.** Reference scripts must not slice
   `innerText` to a fixed length (an early v0.2 reference did
   `.slice(0, 4000)`, which silently discarded most of the body on
   long-form pages — privacy / policy / docs templates routinely run
   to 6,000+ words). Storing the full innerText across a 25-page crawl
   adds ~250 KB to the per-page JSON corpus, well below any reasonable
   threshold; whatever cost is involved, the alternative is silent
   data loss that compounds into module-detection misses and missing
   body copy at migrate time. See § Capture list (7-bis) below for
   the structured-content fields that supplement innerText.

7-bis. **Section body, lists, Q&A, quotes (structured)** — innerText
   alone gives one big blob per landmark; downstream phases need the
   structure preserved. For each heading-bounded block within a
   landmark, additionally capture:
   - `body[]` — `textContent` of every direct-descendant `<p>` /
     `<blockquote>` not inside a nested heading, in DOM order. Strip
     leading/trailing whitespace, preserve internal breaks.
   - `lists[]` — for every `<ul>` / `<ol>` not nested inside a
     captured paragraph, an entry `{ ordered: bool, items: [string] }`
     where each item is `textContent` of one `<li>`.
   - `qa[]` — when an accordion (`<details>` or
     ARIA-driven disclosure) is detected within the section, capture
     each entry as `{ q: <trigger text>, a: <disclosed textContent> }`.
   - `quotes[]` — when a review-card / testimonial / pullquote
     pattern is detected (a `<blockquote>` or `[class*="testimonial"
     i]` containing prose plus an optional attribution / rating),
     capture each as `{ text, attribution?, rating? }` (rating
     numeric when available, e.g. from `aria-label="5 out of 5"`).

   These attach to the section entry in `landmarks[].children[]`
   (per `current-state-schema.md` § Landmarks). They are required
   for migrate to render production-quality body copy from captured
   data — without them, every body region under a heading falls back
   to placeholder-with-signature even when the source page had real
   prose to reuse.
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
    sections) are silently invisible to extract.

    **Pseudo-element walk.** `document.querySelectorAll('*')` does
    not reach `::before` / `::after` generated content, so a hero
    photo set on a pseudo (a common WordPress / page-builder
    pattern) silently drops out of capture. For every element
    surviving the visible-size filter, additionally check both
    `getComputedStyle(el, '::before').backgroundImage` and
    `getComputedStyle(el, '::after').backgroundImage`. When the
    pseudo carries a non-`none` value with one or more `url(...)`
    references, emit a separate `cssBackgrounds[]` entry with
    `domPath = "<host-path>::before"` (or `::after`), the host
    element's rect (the pseudo doesn't have its own rect at this
    granularity), and the pseudo's `backgroundSize` /
    `backgroundPosition` / `backgroundRepeat`. The 2026-05-04
    ups.com home dropped its hero this way: zero `cssBackgrounds[]`
    hits for the home, prototype defaulted to the `og:image`
    instead of the actual visible hero. Performance: the pseudo
    walk runs only on elements that already passed the rect-size
    filter, so the cost on a typical 4000-element page is in the
    low-millisecond range, not seconds.
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

16. **Font files (network-intercept).** Subscribe to
    `context.on('response', ...)` for the duration of the run.
    Save every response whose URL matches `\.(woff2?|ttf|otf|eot)$`
    or whose `Content-Type` starts with `font/` to
    `stardust/current/assets/fonts/<basename>`. De-dupe by URL
    across pages — the same font fetched on three pages saves
    once. Record per font in `_brand-extraction.json#type.files[]`:
    `{ url, family, weight, style, unicodeRange, localPath,
    sourceCssRule }`. Resolve `family` / `weight` / `style` by
    finding the `@font-face` block in any captured stylesheet that
    references the same URL — the rule's font descriptors are the
    authoritative metadata.

    Without this capture every prototype falls back to a `system-ui`
    / `Helvetica Neue` stack and the Mode A "brand-faithful" claim
    weakens visibly on any site whose typography is the most
    distinctive thing about it (private cuts on commercial brands,
    Google-Font-but-licenced-elsewhere combinations on agency
    sites, etc.). The 2026-05-03 jfkairport.com run had two
    private cuts (Sharp Grotesk Semibold, Helvetica Now for PANYNJ)
    visible in network responses and absent from every captured
    artifact until added by a one-off script.

    Captured fonts are sometimes private brand assets. Flag any
    font whose family name does not match a known open-license
    list (Google Fonts, Adobe Fonts free tier, fontsource.org
    catalogue) in `_brand-extraction.json#type.files[].licensingFlag`
    so the user can verify usage rights before deploying. Internal
    prototype review is generally fine — the files are already
    publicly served by the source site.

17. **Icon font detection.** Many production sites ship an icon
    font (a single woff2 carrying tens to hundreds of glyphs)
    rather than inline SVG. Without a detector for this, prototypes
    on icon-font sites render with emoji stand-ins (♿, 🔍, →, f,
    𝕏) that read as visibly amateur in a brand-faithful Mode A
    output. Detection:

    - Query every element matching
      `[class^="icon-"], [class*=" icon-"], i.icon, [data-icon]`.
    - For each matched element, read the computed `::before`
      `font-family` and `content` properties. When `font-family`
      is non-default (i.e. not in `system-ui, sans-serif, Arial`,
      etc.) and `content` is a quoted Unicode codepoint (not
      `none`, `""`, or visible text), the element uses an icon
      font.
    - Build the icon-class → codepoint table from the unique
      `(class, content)` pairs.
    - Resolve the icon font's URL via the `@font-face` rule for
      that family and save the file via the network-intercept
      from § 16.

    Record in `_brand-extraction.json#iconFont`:
    `{ family, localPath, sourceCss, glyphs: [{ class, codepoint, name? }] }`.
    Optional `name` is a heuristic guess from the class suffix
    (`icon-search` → `"search"`, `icon-arrow-right` → `"arrow-right"`).

    When `inlineSvgCount < 5` on a page but `[class*="icon-" i]`
    elements with non-default `::before` font-family are present,
    surface in the brand-review HTML: *"icon font detected
    (`<family>`, N distinct classes used) — see
    `_brand-extraction.json#iconFont` for the mapping."*

## Logo locator chain

For the brand-surface pass (Phase 3 of `extract`), find the logo in
this exact priority order. Stop at the first hit.

1. **Inline SVG** — first `<svg>` inside `header`, `[role="banner"]`,
   or `nav` that is not an icon (heuristic: width or viewBox-derived
   width ≥ 60 px and contains `<text>` or has `aria-label` matching
   the brand name).
2. **`<img>` with logo-ish identifier** — `<img>` whose `src`, `alt`,
   `class`, or `id` contains `logo`, `brand`, or the brand name
   slug (case-insensitive), inside `header`, `[role="banner"]`, or
   `nav`. **Additionally**, all of the following must hold,
   otherwise fall through to step 3:
   - rendered `height ≥ 32 px` AND rendered `width ≥ 40 px` —
     filters tiny promotional icons that happen to share the
     brand-name substring (e.g. `ups-package-ontime-box-fast.avif`
     in a UPS utility bar at 24×24).
   - `top ≤ 200 px` after the wait+scroll pass — filters images
     that happen to be inside `<header>` markup but render far
     below the visible header band.
   - rendered aspect ratio in `[0.5, 3.0]` — covers square
     wordmarks (1:1) through wide signature wordmarks (3:1)
     while excluding tall column glyphs and wide spacer SVGs.

   When multiple candidates qualify, **rank by aspect-ratio
   proximity to a 1.5 ideal** (most logos cluster between 1.0 and
   2.5; 1.5 is the centre) and pick the closest. Tie-breaker:
   highest rendered area.

   The 32 px height threshold is conservative — most real logos
   render at 40–80 px even in tight headers. Sites that intentionally
   ship sub-32 px logos on desktop fall through to step 3
   (`apple-touch-icon`), which is correct most of the time;
   surface in `_brand-extraction.json#logo._provenance.notes`
   when this happens so the user can verify.
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
`TimeoutError`, `ProvenanceMissing`) so the user can diagnose at a
glance. `ProvenanceMissing` covers the synthesis-guard refusal in
`extract/SKILL.md` § Phase 2 — a page record could not be marked
`extracted` because the Playwright evidence contract was not
satisfiable for that slug.
