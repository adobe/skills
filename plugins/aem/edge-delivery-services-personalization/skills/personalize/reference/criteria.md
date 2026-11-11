# Criteria and Condition Syntax (contract section 2)

## Syntax

```
criterion: value1, value2          any value matches (OR)
clause & clause                    all clauses match (AND)
!criterion: value                  negation
```

Examples: `geo: US, CA`, `geo: US-CA & device: mobile`, `!visitor: returning`,
`param: utm_campaign=diwali`, `state: quiz-persona=cn & !device: mobile`.

Matching is case-insensitive. A condition is the value of a `Personalization Rule <Variant>` row
(`authoring-model.md`); rows are checked in order and the first match wins, so put specific rules
above general ones. One condition per row, on one line: the pipeline joins several paragraphs of a
cell with `,`, which turns them into an OR (the validator rejects it). For an OR across different
criteria, add a numbered row for the same variant: `Personalization Rule India 2 | param: utm_campaign=diwali`.

Rules decide `rules` sections and are the written fallback of `api` sections: they decide when the
engine answers `no-match`, `low-confidence` or `fallback`, never after `control`,
`intentional-default` or `timeout`. `split` and `target` sections have no Rule rows. The mock
engine tables (`decision-api.md`, `target.md`) use the same syntax.

## Built-in criteria

| Criterion | Values | Source in the browser | At the edge |
|---|---|---|---|
| `geo` | ISO country `IN`, or country-region `US-CA` | `<meta name="pzn-geo">` from the edge; with consent also a `pzn-geo` cookie (CDN shim), then `config.geo.endpoint` (opt-in) | `request.cf.country` / `regionCode` |
| `device` | names in `config.devices` (`mobile`, `tablet`, `desktop`) | first matching media query (viewport, not UA) | left to the browser |
| `visitor` | `new`, `returning` | `pzn-seen` cookie (persistent) and `pzn-vs` (session); read and written only with consent | same cookies, with consent |
| `param` | `key` (present) or `key=value` | URL query (`pzn*` keys excluded) | URL query |
| `state` | `key` or `key=value` | `setState()` values; kept in localStorage `pzn-state` only with consent | left to the browser |
| `audience` | a name in `config.audiences` | your function | left to the browser |

Engines (`api`) also get `referrer`: the host of the site the visitor came from, only when it is
another site, never its path or query. It is not a rule criterion.

Notes:
- **Geo is never guessed** from timezone or language. Without a geo source, `geo:` rules simply do
  not match and the next rule / default applies. On the Adobe-managed CDN there is no geo header;
  use the edge worker, a CDN shim that sets the `pzn-geo` cookie (`IN` or `US-CA`), an opt-in
  endpoint answering `{"country":"IN","region":"KA"}`, or the decision API.
- **`visitor` is session-sticky**: a visitor stays `new` for the whole first session (so the page
  does not change on the second page view), and is `returning` from the next session on.
- **Without consent** (`consent.md`) rules run only with the approved `rules` exception, and then
  only with `geo` (request geo: the edge meta tag, never the `pzn-geo` cookie), `device`, `param`
  and this page view's `state`. A rule using `visitor:` or `audience:` never matches without
  consent.
- Device classes are evaluated in the order listed in `config.devices`; edit the media queries to
  match the site's breakpoints.
- At the edge, a section whose first possibly-matching rule needs a browser-only criterion
  (`device`, `state`, `audience`) is left to the browser, so edge and browser never disagree.
- `param:` keys are also what an `api` section may send to the engine besides `utm_*`
  (`decision-api.md`).
- **No personal data** in conditions: no names, emails, ids or profile values. A new signal is a
  contract change with a privacy review, not a site setting.

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

- `context` is `{ geo, device, visitor, params, state }`. `audience:` rules match only with consent.
- A throwing function counts as "no match". An unknown name never matches (the validator warns).
- Async audiences count against the section's decision budget.
- Sections with `audience:` rules re-decide on every `setState()`, so audiences can depend on state.
- Preview: `?pzn-audience=vip,logged-in` forces audiences to match.

## Adding a new built-in criterion

Prefer a custom audience. A new built-in needs changes in `rules.js` (`CRITERIA`, `matchValue`,
validation), `context.js` / `visitor.js` (resolver), `contract.js` (if sent to the engine),
`CLIENT_ONLY_CRITERIA` if the edge cannot know it, the simulator's `autoMatrix`, and tests. That is a
skill change, not a site change.
