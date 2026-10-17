# Cross-Cutting Concerns

## Fallback

Every failure ends at the authored default: invalid placeholder, timeout, API error, missing
fragment, runtime exception (`data-pzn-source` = `error` / `timeout` / `fallback`). The validator
rejects placeholders without `default`.

## SEO and bots

- Crawlers and performance tools (Googlebot, Bingbot, Lighthouse, PageSpeed Insights, GTmetrix,
  HeadlessChrome) get the **default** in the browser and at the edge (`botsGetDefault: true`).
  Lighthouse/PSI scores therefore measure the default; measure variants with `verify-preview.mjs`.
- Variants must be **semantically equivalent** to the default (same topic, different emphasis or
  locale). Personalized content that contradicts what crawlers see is cloaking.
- Fragments are `noindex` (bulk metadata `/fragments/**`, `da-content.md`).
- Keep the H1 in the default and every variant; the validator warns only when a variant's H1
  differs from the default's.

## Privacy and consent

- `config.hasConsent(category)` (default: always false). Wire it to the CMP, e.g. OneTrust:
  ```js
  hasConsent: () => /(^|,)C0003(,|$)/.test(window.OnetrustActiveGroups || ''),
  ```
  and call `window.hlx.personalization.refresh()` from the CMP's consent-change callback.
- Without consent: no `pzn-seen` / `pzn-vs` cookies (all visitors are `new`), no persisted state,
  no session cache, no decision API call (unless `sendWithoutConsent`).
- The runtime mirrors consent into the `pzn-consent` cookie so the edge can apply the same policy;
  revoking consent clears the `pzn-*` cookies.
- Geo comes from the CDN or IP per request and is never stored by the runtime.
- Only `utm_*` and rule-referenced URL params reach the engine. Never add PII in adapters.

## Analytics and martech

On every applied decision:
- `personalization:applied` CustomEvent on the block: `{ id, variant, source, rule, tracking }`.
- `window.adobeDataLayer.push({ event: 'personalization:applied', personalization: {...} })`
  (`analytics.dataLayer`). The array is created if missing, so Launch/Tealium loaded in the
  delayed phase still receive earlier pushes.
- RUM: `sampleRUM('audience', { source: <id>, target: <variant> })` (`analytics.rum`), the same
  checkpoint aem-experimentation uses.
- Rendered nodes carry `data-pzn-id` / `data-pzn-variant` for click attribution.

For Tealium: map the data layer event, or listen for `personalization:applied` and call `utag.link`.

## Adobe Target / Web SDK

Target applies propositions after decoration and costs LCP. Personalization and Target must not
act on the same region. If detect reports `integrations.target`, which regions Target owns is a
Step 1 choice (default: none of the requested ones); keep placeholders out of any region named. A Target-backed decision can instead come through the decision API
with an adapter (server-side delivery), which is faster and flicker-free.

## Experimentation compatibility

- Custom audiences use the aem-experimentation function signature; one registry can serve both.
- Override params do not collide: `?pzn…` here, `?audience=` / `?experiment=` there.
- Do not run an experiment and a placeholder on the same region. A future `experiment:` row will
  delegate traffic splits to aem-experimentation.

## CDN

- Client mode works on any CDN, including Adobe-managed.
- Edge mode: BYO Cloudflare. Origin cache and its key are unchanged; the personalized response is
  `private, no-cache`, so shared caches never store a variant. Fragments stay publicly cacheable.
- Pages without placeholders pass through untouched (no `x-pzn` header).

## Launch checklist

- [ ] `hasConsent` wired to the CMP and `refresh()` on consent change
- [ ] Fragments `noindex`; variants equivalent to the default; same H1 structure in the default and every variant
- [ ] Analytics consumes `personalization:applied` (data layer / Tealium / RUM)
- [ ] `overrides` is `preview` (or `never`) in `config.js`; `never` in `edge-config.js`
- [ ] `api.endpoint` is the production same-origin path (mock URL reverted)
- [ ] Engine key only as a Worker secret; worker deployed by the site owner
- [ ] `PZN_RATE_LIMITER` bound when the browser uses `/pzn/decide`; no browser-side adapters
- [ ] Target/experimentation regions are disjoint from placeholders
- [ ] Content previewed and published in DA, including all fragments
- [ ] `verify-preview.mjs` passes on `*.aem.page`; edge checked with a browser and `curl -A Googlebot`
