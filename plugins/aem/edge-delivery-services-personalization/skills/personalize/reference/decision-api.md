# Decision Engine API v1 (contract section 5)

Used by sections with `Personalization Source | api`. The browser sends one batched request per
evaluation (`sources/api.js`), and the edge sends one per HTML response. The code is in
`contract.js` (request and response, shared with the edge), `provider-api.js` (transport and
session cache) and `personalize.js` (edge decisions and the server route). Schemas:
`assets/contract/schemas/decision-{request,response,feedback}.schema.json`.

## Contents

- Section
- Request
- Response
- Timeouts
- Caching
- Endpoint, server route and secrets
- Engine profiles and OF1
- Adapters for other engines
- Feedback
- Testing with the mock

## Section

```
| Section Metadata                     |                                                    |
| Personalization                      | home-hero                                          |
| Personalization Source               | api                                                |
| Personalization Variants             | /fragments/personalization/home-hero/pro           |
|                                      | /fragments/personalization/home-hero/deals         |
| Personalization Hint                 | Show the hero that best matches why the visitor came |
| Personalization Description Pro      | Pro espresso machines: dual boilers, PID control.  |
| Personalization Description Default  | Our flagship espresso machine range.               |
| Personalization Rule Deals           | param: utm_campaign=black-friday   (written fallback) |
```

The Variants are the engine's allowlist. The Rule rows are the written fallback: they decide after
`no-match`, `low-confidence` or `fallback`, and never after `control`, `intentional-default` or
`timeout`.

## Request

```json
{
  "version": "1",
  "page": { "path": "/", "locale": "en-US", "title": "Espresso machines" },
  "placeholders": [{
    "id": "home-hero",
    "candidates": ["pro", "deals", "default"],
    "fragments": { "pro": "/fragments/personalization/home-hero/pro", "deals": "/fragments/personalization/home-hero/deals" },
    "hint": "Show the hero that best matches why the visitor came",
    "descriptions": { "pro": "Pro espresso machines: …", "default": "Our flagship …" }
  }],
  "context": {
    "geo": { "country": "US", "region": "CA" },
    "device": "desktop",
    "visitor": "returning",
    "state": { "quiz-persona": "cn" },
    "params": { "utm_source": "espresso-forum" },
    "referrer": "espresso-forum.example",
    "consent": { "personalization": true }
  },
  "mode": "client"
}
```

- `candidates` are the listed variants plus `default`. `fragments` gives each variant's path.
  `hint` and `descriptions` are sent only when the section has those rows (the server route can
  fill in descriptions, below).
- `params` holds only `utm_*` keys and keys used by `param:` rules.
- `referrer` is the host of another site, never its path.
- `mode` is `client` or `edge`. At the edge `device` and `state` are unknown.
- **Consent.** The engine is called only with consent, or with the approved `api` exception
  (`consent.md`). Under the exception the request has no `visitor`, no `state`, and
  `consent.personalization: false`.
- **No personal data.** An adapter never adds emails, names, ids or profile values.

## Response

```json
{
  "decisions": {
    "home-hero": { "variant": "pro", "tracking": { "engine": "of1", "requestId": "r-91", "confidence": 0.82 } },
    "banner": { "variant": "default" },
    "holdout": { "control": true },
    "offer": { "reason": "low_confidence", "tracking": { "engine": "of1", "requestId": "r-92" } }
  },
  "ttl": 300,
  "cacheable": false
}
```

| Answer | Outcome | Shows |
|---|---|---|
| `variant: "<listed>"` or `fragment: "<listed path>"` | `variant` | That variant |
| `variant: "default"` | `intentional-default` | Default; no Rule rows |
| `control: true` | `control` | Default; no Rule rows |
| `reason: "low_confidence"` | `low-confidence` | Rule rows, else default |
| `reason: "no_candidate"` or any other code | `no-match` | Rule rows, else default |
| `reason: "provider_error"` or `"invalid_choice"` | `fallback` | Rule rows, else default |
| Section missing from `decisions` | `no-match` (`no decision`) | Rule rows, else default |
| Unlisted variant or fragment, or several answer kinds at once | `fallback` (`not listed: …`) | Rule rows, else default |
| HTTP error, bad JSON, no endpoint, `api.timeout` | `fallback` | Rule rows, else default |
| Section budget exceeded | `timeout` | Default |

**An engine that can't decide answers with a `reason`, never with the default.**

- `tracking` is the engine's own data, passed unchanged into events and feedback. It never holds
  personal data. The engine names its own id `requestId` (or similar), never `decisionId`.
- `tracking.cached: true` marks an answer served from the engine's cache.
- `ttl` is in seconds: default 300, maximum 1800.

## Timeouts

| Where | Budget | Then |
|---|---|---|
| Browser, first section | 800 ms (`budgets.eager`), decision and fragment | `timeout`: the default |
| Browser, other sections | 2000 ms (`budgets.lazy`) | `timeout`: the default |
| Browser engine request | `api.timeout` (1500 ms) | `fallback`: Rule rows, else the default |
| Edge engine call | 300 ms (`edge-config.api.timeout`) | `timeout`: Rule rows. If none match, the section is left to the browser, unless the browser may not decide it (a slow engine on the first section): then the default is applied |
| Server route `/pzn/decide` | 2000 ms (`api.routeTimeout`) | 502 `{ "decisions": {} }`, so the browser falls back |

## Caching

- **Browser.** The answer is kept in sessionStorage (`pzn-decisions:<hash>`) for `ttl` seconds,
  keyed by page, sections and context, only with consent. A reused answer is a new decision
  (`decisionId` `#1` on the next page view) with `cached: true`.
- **Edge.** The answer is kept in the Cache API only with `cacheable: true` and `ttl > 0`. The key
  holds the path, the sections with their candidates, hints and descriptions, geo, device, the
  allowed params, the referrer, the consent policy and the origin page's `Last-Modified`.
  `visitor` and `state` are never part of it: a request that carries them is never shared.
- **Pages.** Personalized HTML is sent with `Cache-Control: private, no-cache`.

## Endpoint, server route and secrets

`config.api.endpoint` is a **same-origin server route**: the skill's edge route `/pzn/decide`, an
engine's proxy, or a CDN proxy. Engine keys stay on the server: the `PZN_API_KEY` Cloudflare
secret, which the site owner sets. **Never put a key in browser code.**

The route `handleApiRoute` (in `edge-config.js` `apiRoute`):

- answers `405` to anything but POST, and `503` when no engine is set;
- answers `403` to a request that isn't same-origin (`Origin` / `Sec-Fetch-Site`);
- answers `429` when the optional `PZN_RATE_LIMITER` binding refuses the request;
- answers `413` to a body over 16 KB, and `400` to anything that isn't a v1 request;
- rebuilds the request from contract fields only;
- forwards the request only with the `pzn-consent` cookie and `consent.personalization: true`.
  With the `api` exception it strips `visitor` and `state`; otherwise it answers `403`;
- fills missing descriptions for the `of1` profile: a variant without a Description row gets its
  fragment's `.plain.html` text, and the default gets the authored section's text, cut to 600
  characters. Author rows always win;
- answers given without consent come back with `ttl: 0`.

## Engine profiles and OF1

| `api.engine` | `api` sections per page | Candidates per section (with `default`) | Reads `state` | Notes |
|---|---|---|---|---|
| `generic` (default) | 20 | 2 to 21 | Yes: `setState()` re-decides its sections | |
| `of1` | 8 | 2 to 10 | No: the adapter sends no state, so `setState()` re-decides only sections whose Rule rows use the key. Flip `state` in `contract.js` if OF1 reads state natively | Mapped by `adapters/of1.js`. Uses `hint`, `descriptions`, `page.title` and `referrer`. Uncached calls take 0.3 to 1.0 s, so it is **never used on the first section in the browser** (the validator fails it). The validator warns about a section without a `Description Default` row |

The OF1 adapter runs in the server route and at the edge, never in the browser (the tenant is
server configuration). Set it in `edge-config.js`:

```js
import { createOf1Adapter } from './adapters/of1.js';
const of1 = createOf1Adapter({ tenant: '<owner>/<site>' });
// api: { engine: 'of1', mapRequest: of1.mapRequest, mapResponse: of1.mapResponse, ... }
```

- **Candidates.** OF1 gets positional candidates, with `c0` being the default.
  - `choice: c0` with `fallback: false` becomes `{ "variant": "default" }`.
  - Any `fallback: true` becomes a `reason`.
- **Context.** The only visitor signal is `acquisition.source`, derived from the context:
  `campaign`, `search`, `referral` or `direct`. No profile is sent, and no audiences.

In the browser, set `config.api.engine: 'of1'` too, so the validator applies the profile, and
leave the browser adapters empty.

## Adapters for other engines

`api.mapRequest(v1) → { url?, init?, body }` and `api.mapResponse(json, v1) → v1 response`.
`mapResponse` receives the v1 request too, for engines that answer by position. Adapters that need
credentials or tenant ids go in `edge-config.js`, never in `config.js`. When the browser calls
the edge route, it speaks v1 and the route applies the adapters; the route rejects non-v1 bodies
with `400`.

```js
// edge-config.js
api: {
  mapRequest: (v1) => ({ body: { slots: v1.placeholders.map((p) => p.id), country: v1.context.geo?.country } }),
  mapResponse: (json, v1) => ({
    decisions: Object.fromEntries((json.slots || []).map((s) => [s.id, s.path ? { fragment: s.path } : { reason: 'no_candidate' }])),
    ttl: json.maxAge ?? 300,
  }),
},
```

Write adapters from the user's **sample request and response**, and check them offline:
`mapResponse(sample, v1)` must pass `parseResponse` (from `contract.js`) and `scripts/schema.mjs`
`check('decision-response', …)`, and give the expected answers. Vendor shapes stay out of the
runtime.

## Feedback

When `api.feedback` is set (a same-origin URL), the browser sends `seen` and `clicked` for
engine-assigned decisions with `navigator.sendBeacon`. It sends them with consent only, once per
`decisionId`, best effort and with no retries. The body follows
`decision-feedback.schema.json`: `{ version, page, events: [{ id, decisionId, variant, type, tracking }] }`.

## Testing with the mock

Both mocks use the same tables (`mock-engine.js`):

- **In the browser** (demos on aem.page, `verify-preview --faults`): set
  `config.mock = { api: <table> }` with a non-empty `api.endpoint`. On preview hosts these knobs
  apply: `?pzn-mock=fail | invalid | missing | control | default | reason:<code> | variant:<name>`
  and `?pzn-mock-latency=3000`.
- **A local server:**

```bash
node scripts/mock-decision-api.mjs --port 4100 --decisions decisions.json [--latency 3000] [--knob reason:low_confidence] [--ttl 60] [--cacheable]
```

The server checks requests against the contract schemas and answers `400` to a non-conforming
one. Its endpoints are:

- `POST /decide`;
- `POST /feedback`;
- `POST /rest/v1/delivery` (Target);
- `GET` or `DELETE /requests`, to check consent and param filtering;
- `GET /health`.

A request header `x-pzn-mock: <knob>` sets the knob for one request.

```json
{ "ttl": 0, "placeholders": { "home-hero": {
  "param: utm_source=espresso-forum": "pro",
  "geo: US": { "control": true },
  "*": { "reason": "low_confidence" } } } }
```

Conditions use the authoring grammar, checked in order. A value is a variant name (`"default"`
for the intentional default) or a v1 decision object. A section with no matching condition is
left out of the answer, which gives `no-match`. Use the same table with `simulate.mjs` and
`verify-preview.mjs` (`--api-decisions decisions.json`).
