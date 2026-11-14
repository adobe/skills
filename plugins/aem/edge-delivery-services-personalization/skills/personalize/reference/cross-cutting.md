# Cross-Cutting Concerns (contract section 10)

## Contents

- Fallback
- SEO and bots
- Privacy
- What may be shared between visitors
- Analytics and martech
- Adobe Target, Web SDK and AEM Experimentation
- CDN
- Launch checklist

## Fallback

Every failure ends at the section's **default**:

- invalid rows;
- a timeout;
- an engine or Target error;
- an unlisted answer;
- a missing fragment;
- a code error.

`data-pzn-outcome` and `data-pzn-reason` say why (`decisions-and-measurement.md`). An `api`
section's Rule rows decide first after `no-match`, `low-confidence` or `fallback`. Keep the
default meaningful: bots and visitors without consent see it too.

## SEO and bots

- **Bots get the default.** Crawlers and performance tools (Googlebot, Bingbot, Lighthouse,
  PageSpeed Insights, GTmetrix, HeadlessChrome) get the default in the browser and at the edge
  (`botsGetDefault: true`): no engine or Target call, no split assignment, no popup.
  Lighthouse and PSI scores therefore say nothing about personalization; measure that with
  `verify-preview.mjs --perf`.
- **Variants must be semantically equivalent** to the default: different emphasis or locale, not
  different claims. Otherwise it is cloaking.
- **Fragments are `noindex`** (bulk metadata `/fragments/**`, see `da-content.md`).
- **Keep the H1** in the default and every variant. The validator warns when a variant's H1
  differs.

## Privacy

- **Consent.** Without consent nothing is personalized, stored or sent unless privacy/legal
  approved an exception (`consent.md`).
- **No personal data** anywhere: no names, emails, ids, IP addresses or profile data in
  conditions, engine requests, `tracking`, events or storage.
- **Geo** comes from the CDN or the request, and is never guessed.
- **Params.** Only `utm_*` params and params used by `param:` rules reach an engine. Adapters never
  add personal data.
- **Public rows.** `Hint` and `Description` rows are public, because they are in the page HTML.

## What may be shared between visitors

| Data | Shared cache (CDN, edge) | This visitor only |
|---|---|---|
| Authored page HTML, variant fragments | Yes | |
| Personalized page HTML (edge output) | **No**: `Cache-Control: private, no-cache` | Browser only |
| Engine answer at the edge | Only with `cacheable: true` and `ttl > 0`, under the shared key | |
| Engine answer in the browser | | sessionStorage for `ttl`, with consent |
| Answers made under the `api` exception | Only with `cacheable: true` | Not kept |
| Target answers and notification tokens | No | In memory for the page view |
| Target `tntId` | No | localStorage, with consent |
| Split assignment | No | Session, with consent or the `split` exception |

## Analytics and martech

- **Five events.** `pzn:decided`, `pzn:applied`, `pzn:seen`, `pzn:clicked` and `pzn:notified` go
  to the section (DOM event), `adobeDataLayer` and RUM (`decisions-and-measurement.md`).
- **Data layer.** The array is created if missing, so Launch or Tealium loaded later still get
  earlier pushes. The site's Tags/Analytics rules map the events. For Tealium, map the data
  layer event, or listen for `pzn:applied` and call `utag.link`.
- **RUM** marks successful application only. The A/B population comes from the data layer.
- **Click attribution.** Personalized sections carry `data-personalization` (the id) and
  `data-pzn-variant`.

## Adobe Target, Web SDK and AEM Experimentation

- **Target.** `target` sections let Target pick the fragment (`target.md`). The skill never
  creates Target activities, audiences or offers, and never sets up AJO journeys.
- **Regions Target already owns.** When detect reports at.js, Web SDK, Launch or Target
  auto-rendering, ask which regions those own; the default is none of the requested ones. Never
  put a personalized section in such a region.
- **AEM Experimentation.** A page that runs a page experiment (`Experiment` or `Campaign` page
  metadata) gets no personalized sections, and a section can't carry both. Use `split` or Target
  for a section test (`split.md`). Custom audiences use the aem-experimentation function
  signature. The preview params don't collide: `?pzn…` here, `?audience=` / `?experiment=` there.

## CDN

- **Client mode** works on any CDN, including the Adobe-managed one.
- **Edge mode** needs a BYO Cloudflare CDN. The origin cache and its key are unchanged.
  Personalized HTML is `private, no-cache`; fragments stay publicly cacheable.
- **Pages without personalized sections** pass through untouched, with no `x-pzn` header.

## Launch checklist

- [ ] Section Metadata reaches the page as `data-personalization*` attributes, and the hooks are
      on `main`
- [ ] `config.consent` recorded (`mode`, `tool`), `hasConsent` wired, and the CMP calls
      `refresh()` on changes; exceptions only with their `policyRef`; `edge-config.js` `consent`
      matches
- [ ] Fragments `noindex`; variants equivalent to the default; same H1
- [ ] No held first section in client mode, or the LCP cost accepted; no slow engine on a first
      section in the browser
- [ ] Analytics maps the `pzn:*` events; the split results have an owner
- [ ] `overrides` is `preview` (or `never`) in `config.js`, and `never` in `edge-config.js`
- [ ] `config.mock` is `false`; `api.endpoint` is the production same-origin route;
      `target.endpoint` is empty or the production proxy
- [ ] `target.clientCode` and `propertyToken` set; activities live on the right locations with JSON
      `{ "fragment" }` / `{ "control": true }` offers; Web SDK transport checked on a live
      datastream
- [ ] The engine key is only a Worker secret; the worker is deployed by the site owner
- [ ] `PZN_RATE_LIMITER` is bound when the browser uses `/pzn/decide`; no browser-side adapters
- [ ] Regions owned by Target, the Web SDK or AEM Experimentation are disjoint from the
      personalized sections
- [ ] Content previewed and published in DA, including every fragment
- [ ] Every required `verify-preview.mjs` check passes on `*.aem.page` (none reported as passed
      without running); the edge checked with a browser and with `curl -A Googlebot`
