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

**Retry rule.** Two distinct reject modes must both trigger the
fallback — validate the *response*, not just that the navigation
resolved:

1. **Network fingerprint block** — the first navigation *throws*
   `ERR_HTTP2_PROTOCOL_ERROR`, `ERR_QUIC_PROTOCOL_ERROR`, or hangs
   for the entire hard-cap on a connection that doesn't fingerprint
   cleanly.
2. **Challenge / edge block** — the navigation *succeeds*
   (`domcontentloaded` fires, no throw) but the response is a
   **403/429/503 interstitial**, not the page. Cloudflare's managed
   challenge is the canonical case: `cf-mitigated: challenge` +
   HTTP 403. Because the goto resolves, a probe that only catches
   throws sails straight past it and the block only surfaces later
   as a fatal capture-time `HTTPError`. Detect it by inspecting the
   probe response status/headers (`cf-mitigated`, `cf-ray`,
   `server: cloudflare`/`akamai`, edge 403/429/503).

On either: do **not** retry headless. Switch to
`headless: false, channel: 'chrome'` immediately and record the
switch in `_crawl-log.json#discovery.fetchTechnique` (with
`#discovery.botBlock` = `fingerprint | challenge`) so re-runs start
in headed mode without rediscovering the issue.

**Clearing a managed challenge.** Headed real Chrome alone clears
the *fingerprint* block, but Cloudflare's managed challenge also
probes for automation signals — clearing it additionally needs the
automation flags stripped: launch with
`args: ['--disable-blink-features=AutomationControlled']` +
`ignoreDefaultArgs: ['--enable-automation']`, and spoof
`navigator.webdriver → undefined` via `context.addInitScript` on
**every** context (the challenge re-fires per context — no
cross-context cookie sharing — so a worker that skipped the spoof
is re-challenged even after the probe cleared it). The
non-interactive challenge serves the interstitial, runs its JS,
sets a clearance cookie, then the page becomes reachable: wait
~4s and `reload()` to pick up the cookie before validating the
status. If headed + stealth + the solve window still can't clear
it, the site requires an *interactive* solve — surface that as a
hard failure (`BotChallengeError`) rather than capturing the
interstitial as content.

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

#### Route-fulfiller pattern (unattended-pipeline alternative)

When headed real Chrome is unacceptable (CI, scheduled job,
sandbox without a display), an alternative bypass uses the
Playwright `request` API as a **route fulfiller** instead of a
direct browser navigation. The bare `request` API, called with no
browser-context headers forwarded, presents a default Node TLS/H2
fingerprint that some Akamai configurations accept where the
bundled-chromium fingerprint is rejected.

The pattern:

```js
const apiCtx = await request.newContext({
  // Do NOT forward browser context headers; bare Node fingerprint
  // is the load-bearing detail.
  extraHTTPHeaders: { 'user-agent': '<bare-ua-string>' },
});

// Intercept every request the page makes and fulfill from the
// API context.
await context.route('**/*', async (route, req) => {
  try {
    const response = await apiCtx.fetch(req.url(), {
      method: req.method(),
      headers: req.headers(),
      data: req.postData() || undefined,
    });
    const body = await response.body();
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body,
    });
  } catch (e) {
    await route.abort();
  }
});

await page.goto(url, { waitUntil: 'networkidle' });
```

The browser context still drives DOM construction, JavaScript
execution, scroll, screenshot — but every network request is
proxied through the API context, which carries a different TLS
fingerprint.

**When the route-fulfiller pattern works.** Some Akamai bot-
management configurations gate only on the initial connection's
TLS handshake fingerprint; once a request is accepted, subsequent
requests on the same connection inherit the verdict. Other
configurations re-evaluate per-request based on full request
shape (headers, order, cookies). The route-fulfiller bypass works
for the first class; not the second. Worked example:
adobe.com / business.adobe.com — both classify as the first
class as of 2026-05.

**When it fails.** When the route-fulfiller path also returns
`ERR_HTTP2_PROTOCOL_ERROR` or hangs, escalate to headed real
Chrome (the documented fallback above). Do not chain bypasses
silently — record each attempt in `_crawl-log.json#discovery.fetchTechnique`
so re-runs start at the first technique that worked.

**Sub-resource caveat.** When the route-fulfiller pattern is
active, the page's in-page `fetch()` calls also flow through the
route handler — they inherit the API context's fingerprint
automatically. The "in-page evaluate" pattern documented above
for headed-Chrome runs is not needed under route-fulfiller; both
top-level navigations and sub-resources use the same bypass
path.

**Order of techniques (refined).** When the agent encounters
`ERR_HTTP2_PROTOCOL_ERROR` on the first navigation, try in this
order:

1. Route-fulfiller pattern (above). Unattended, no display
   required, no third-party plugin.
2. Headed real Chrome (`headless: false, channel: 'chrome'`).
   Requires a display; works for interactive sessions.
3. `playwright-extra` + stealth plugin. Non-standard; last
   resort.

Record the technique that worked in
`_crawl-log.json#discovery.fetchTechnique` so the next run starts
at the same step.

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
context — but **not across contexts**: with concurrent capture
(`extract/SKILL.md` § Concurrency) each worker context re-runs
the dismissal on its first page, or clones the probe context's
`storageState`. Cost: one extra navigation per context.

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

**Enterprise-CMS caveat.** A near-empty-shell test under-detects the
common hard case: enterprise CMSes (React / SPA layers over WebSphere,
AEM, Sitecore, or bespoke app shells) ship *some* server markup that
then re-renders / hydrates client-side, so the raw HTML is not empty
yet the meaningful content paints after `domcontentloaded`. Treat as
JS-driven (→ `spec`, and the scroll + reveal passes are non-optional)
when the raw HTML shows any of: a framework bootstrap
(`window.__INITIAL_STATE__`, `data-reactroot`, `ng-version`,
`<div id="__next">`), a vendor app marker, or a body whose visible
headings don't match the `<title>` / `og:title`. On these sites the
hero copy and child links arrive late and the DOM carries hidden
modal / promo / count states — which is exactly what § Capture list
(5-bis) `heroHeadline` + the junk filter exist to survive.

The default remains `medium` regardless of auto-detect until the
heuristic is validated across more sites; auto-detect is opt-in via
`--wait auto`.

## Navigation

```
goto(url, { waitUntil: <mode>, timeout: <hardCap> })
wait <grace> ms              // grace period for late JS paints
scroll the page to bottom in 4 viewport-height steps with 300 ms pauses
scroll back to top
reveal interactive content   // open every closed <details>, click [aria-expanded="false"] disclosure triggers, surface non-active tab panels
```

The grace period catches lazy-loaded hero media, fonts that swap after
the wait resolves, and analytics-blocked late paints. The
scroll-to-bottom pass triggers IntersectionObserver-driven content
(carousels, fold-in sections, lazy images) so it lands in the captured
DOM. **Skipping the scroll pass is a recipe violation** — even
server-rendered sites use lazy images.

The **reveal pass** is the analogous requirement for content gated
behind interaction rather than scroll. Sites routinely defer FAQ
answers, tabbed feature panels, and "read more" bodies until a click,
and the disclosed DOM is frequently *injected on demand* — so it is
absent (not merely hidden) until the trigger fires. Before the capture
list runs, set `open` on every closed `<details>`, click each
`[aria-expanded="false"]` / `[role="button"][aria-controls]`
disclosure trigger, and activate every non-active `role="tab"` once,
re-reading content afterward. Guard against dialogs (skip triggers
inside `[role="dialog"]` and anything whose click navigates away).
**Skipping the reveal pass is a recipe violation** on any page with
accordions or tabs. The 2026-06-26 knack.com run captured only 1 of 6
FAQ answers without it — the five collapsed answers were never in the
DOM, so they were absent from `qa[]` and from the prototype, which
then had to placeholder them.

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

5-bis. **Hero headline + lede (resolved) — JS-rendered robustness.**
   On semantic / SSR sites the first `<h1>`/`<h2>` *is* the hero
   headline. On **JS-rendered enterprise CMSes** (React / SPA layers
   over WebSphere, AEM, Sitecore, Salesforce, and bespoke "SNAPS" /
   "FUZE"-style shells) the real tagline is buried among many `<h2>`s,
   and the DOM also carries hidden modal / error / promo / count states
   that a document-order heuristic grabs as the headline (observed on a
   3m.com run: `"Thank You!"`, `"Our Apologies…"`, `"629 products"`,
   `"Limited-time offer…"` all out-ranked the real hero line). Resolve
   two dedicated fields instead of trusting `headings[0]`:

   - **`heroHeadline`** — among `h1, h2, h3` whose post-layout
     `getBoundingClientRect().top` is within the hero band (≤ ~820 px)
     and `width ≥ 120 px`, pick the element with the **largest computed
     `font-size`**, after dropping any text caught by the junk-state
     filter below. That is the visually-dominant hero line, which is
     what `prototype` / `migrate` actually need.
   - **`heroLede`** — the first `<p>` in the top ~1300 px with
     `40 ≤ textLength ≤ 400` that is not caught by the junk filter.
   - **Clean fallback (load-bearing).** When either resolves to empty
     or junk, fall back to the editor-written
     `<meta name="description">` — first sentence → `heroHeadline`,
     full text → `heroLede`. Meta descriptions are present and clean
     on virtually every enterprise page and are the single most
     reliable recovery; without this fallback roughly half of
     JS-rendered pages yield a junk or empty hero. Record which source
     won in `_provenance` (`heroSource: "dom" | "meta-fallback"`).

   Record both fields per `current-state-schema.md` § Hero headline.
   The full `headings[]` list is unchanged — these are an additional
   resolved convenience, not a replacement.

   **Junk / hidden-state filter (shared).** JS frameworks inject hidden
   modal, error, newsletter, promo, and result-count nodes that are
   absent from the *rendered* page but present in the *tree*. Drop any
   candidate heading / lede / CTA-label whose normalised text matches
   (case-insensitive):
   - status / modal chrome: `thank you`, `our apologies`, `sign in`,
     `sign up`, `subscribe`, `newsletter`, `follow us`, `share this`,
     `related`, a bare `contact us` heading
   - merchandising chrome: `featured products`, `limited-time offer`,
     `% off`, `save \d+%`
   - faceted-listing counts: `^\d[\d,]*\s*(products?|results?|items?)$`
     and a bare number `^\d[\d,]*$`
   - leaked CSS / script text: any value containing `{` or `}`

   Apply this filter wherever `headings[]` / `ctas[]` text is reused
   downstream as a label (module detection, section heads, card titles)
   — not only for `heroHeadline`.

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
     Read `a` from `textContent`, **not** `innerText`: the disclosure
     is captured after the Navigation reveal pass has expanded it, but
     a panel whose CSS still resolves to `display:none` yields empty
     `innerText`, silently dropping the answer. `textContent` survives
     that. If a trigger has no resolvable answer after the reveal pass
     (genuinely click-injected and not yet present), emit the entry
     with `a: null` rather than omitting it — a recorded gap is
     auditable downstream; a missing entry is not.
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
7-ter. **Code blocks (`codeBlocks[]`, page-level)** — every **visible**
   `<pre>`'s `innerText` verbatim, in document order (schema:
   `current-state-schema.md`). Prose capture skips code blocks, and on
   developer-tool sites the install commands are the most load-bearing
   content on the page — without this field they never reach
   `pages/<slug>.json` and downstream phases fabricate or omit them
   (stardust-style e2e finding). Preserve line structure; emit `[]`
   when the page has none.
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
11. **Media inventory** — for every `<img>`: `currentSrc || src`
    captured **with its query string intact** (see § Source-URL
    fidelity below), `srcset`, `alt`, `naturalWidth`, `naturalHeight`,
    and a `resolves` boolean. For every inline SVG: serialized markup
    hash + viewBox. For every `<video>` and `<iframe>`: src and poster.

    **Source-URL fidelity (enterprise CDNs).** The #1 way migration
    ships `<img src="about:error">` is re-using a source image URL that
    doesn't actually resolve. Two capture-time rules prevent it:
    - **Never truncate the URL, and prefer `currentSrc`.** Enterprise
      DAM / CDN URLs carry load-bearing query strings
      (`…/connect/<uuid>/file.jpg?MOD=AJPERES&CACHEID=…`); dropping the
      query (or reading `src` instead of the resolved `currentSrc`)
      yields a 404. An early reference that sliced `src` to a fixed
      length produced exactly this on a 3m.com run.
    - **Record a `resolves` flag.** After capture, issue a `HEAD`
      (fall back to `GET`) for each `<img>` src and set
      `resolves: true` only on a 2xx with an image `content-type`.
      On a bot-managed origin issue it through the page context (the
      in-page `fetch` / route-fulfiller path that carries the accepted
      fingerprint, per § Bot-management fallback) **and** with a
      browser `User-Agent` + `Referer: <page-url>` — bare requests are
      frequently rejected by enterprise CDNs even when the asset
      exists. `migrate` must omit or repair (never author) any image
      whose `resolves` is `false`.
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

## Capture hygiene — visibility, interstitials, SPA shells, modals (#7)

The capture list above describes WHAT to read; this section describes what to
**exclude or flag** so transient and hidden DOM doesn't pollute the record. The
bundled `extract/scripts/crawl.mjs` implements all of these; a hand-rolled crawl
must apply them too. They exist because real enterprise/SPA sites routinely
render non-content DOM that, captured verbatim, propagates wrong headings, fake
sections, and silent duplicate pages downstream.

1. **Visibility filter (headings, body, CTAs).** Only capture a node if it is
   actually visible: skip any element that is `display:none`,
   `visibility:hidden`, `opacity:0`, `[hidden]`, inside `[aria-hidden="true"]`,
   zero-area, or rendered far off-screen. A captured heading that the user never
   sees is not page content. (Exception: modal detail — see 4.)
2. **Interstitial / error-state heuristic.** Drop — and COUNT in a per-page
   `filteredInterstitials` field — headings/CTAs/paragraphs whose text matches
   known overlay copy: consent banners ("this site uses cookies", "accept all
   cookies", "change cookie settings", "privacy notice"), language gates
   ("continuing to a page", "continue in english", "go back to Spanish"), and
   soft-error overlays ("temporarily unavailable", "page unavailable"). These
   sit in the DOM at capture time and otherwise become `h2`s and fake sections
   (the bankofamerica run authored a "Page unavailable" section from one).
   Dismissing consent (§ Pre-flight) handles the common case; this is the
   backstop for custom banners the selector list misses.
3. **Content-substance / SPA-shell check.** After capture, flag a page
   `spaShellSuspect` when it has **< 2 distinct in-`<main>` headings AND**
   tiny `<main>` innerText (< ~200 chars) **AND** zero real media. A
   client-rendered route that returns the app shell (global `h1` + chrome + a
   tracking pixel) is otherwise indistinguishable from a real capture and
   silently ships a wrong title + empty body. Crucially, a **lone off-origin
   tracking pixel does NOT count as media** (`<= 2px`, or src matching
   `1x1|pixel|track|beacon|/p?|/b?`) — so the low-media flag fires on a shell
   instead of being suppressed by the pixel. Re-capture a flagged page with a
   longer wait or an explicit content selector before trusting it.
4. **Modal / AJAX-addressable detail.** When a detail route renders its content
   into a `[role="dialog"]` / `[aria-modal]` / `.modal` container populated by an
   XHR (and often left `display:none` until opened), `body.innerText` captures
   none of it — so the page captures byte-identical to its listing (the
   sycamorepartners `/investment-info/<slug>` case: 35 "identical" detail
   records). Read such containers via **`textContent` even while hidden**, and
   when a URL deep-links to a modal, wait for its XHR to settle before capture.
5. **Cross-page duplicate detection.** Hash each page's main content
   (`headings ++ main innerText`); if two pages hash equal, flag the later one
   `duplicateOf: <slug>`. A detail page that equals its listing page is the
   signature of an under-captured modal/SPA route (4/3), not real duplication —
   surface it rather than shipping N identical pages.

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
   those signals. A page that is non-empty but thin — the SPA-shell
   case — is NOT failed here; it is captured and flagged
   `spaShellSuspect` (§ Capture hygiene 3) for review, because a wrong
   title on a shell is worse than a recorded gap.

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
