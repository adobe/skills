# Criteria and Condition Syntax

## Syntax

```
criterion: value1, value2          any value matches (OR)
clause & clause                    all clauses match (AND)
!criterion: value                  negation
```

Examples: `geo: US, CA`, `geo: US-CA & device: mobile`, `!visitor: returning`,
`param: utm_campaign=diwali`, `state: quiz-persona=cn & !device: mobile`.

Matching is case-insensitive. Rows are checked in order; put specific rules above general ones.

## Built-in criteria

| Criterion | Values | Source in the browser | At the edge |
|---|---|---|---|
| `geo` | ISO country `IN`, or country-region `US-CA` | `<meta name="pzn-geo">` from the edge, then a `pzn-geo` cookie (CDN shim), then `config.geo.endpoint` (opt-in) | `request.cf.country` / `regionCode` |
| `device` | names in `config.devices` (`mobile`, `tablet`, `desktop`) | first matching media query (viewport, not UA) | deferred to browser |
| `visitor` | `new`, `returning` | `pzn-seen` cookie (persistent) and `pzn-vs` (session); written only with consent | same cookies |
| `param` | `key` (present) or `key=value` | URL query (`pzn*` keys excluded) | URL query |
| `state` | `key` or `key=value` | `setState()` values; persisted in localStorage `pzn-state` only with consent | deferred to browser |
| `audience` | a name in `config.audiences` | your function | deferred to browser |

Notes:
- **Geo is never guessed** from timezone or language. Without a geo source, `geo:` rules simply do
  not match and the next rule / default applies. On the Adobe-managed CDN there is no geo header;
  use the edge worker, a CDN shim that sets the `pzn-geo` cookie (`IN` or `US-CA`), an opt-in
  endpoint answering `{"country":"IN","region":"KA"}`, or the decision API.
- **`visitor` is session-sticky**: a visitor stays `new` for the whole first session (so the page
  does not change on the second page view), and is `returning` from the next session on. Without
  consent no cookie is written, so everyone is `new`.
- Device classes are evaluated in the order listed in `config.devices`; edit the media queries to
  match the site's breakpoints.
- At the edge, a placeholder whose first potentially-matching rule needs a browser-only criterion
  is left to the browser (deferred), so edge and browser never disagree.

## Custom audiences (extension point)

Register functions in `scripts/personalization/config.js`. The signature matches
aem-experimentation, so the same registry can serve both:

```js
audiences: {
  'logged-in': () => document.cookie.includes('login-token='),
  'high-value': async (context) => (await fetch('/api/segment')).ok,  // keep it same-origin and fast
  'in-store-hours': () => { const h = new Date().getHours(); return h >= 9 && h < 21; },
},
```

- `context` is `{ geo, device, visitor, params, state }`.
- A throwing function counts as "no match". An unknown name never matches (the validator warns).
- Async audiences count against the placeholder's decision budget.
- Audiences re-evaluate on every `setState()`, so they can depend on state.

## Adding a new built-in criterion

Prefer a custom audience. A new built-in needs changes in `rules.js` (`CRITERIA`, `matchValue`,
validation), `context.js` (resolver), `contract.js` (if sent to the engine), `CLIENT_ONLY_CRITERIA`
if the edge cannot know it, the simulator's `autoMatrix`, and tests. That is a skill change, not a
site change.
