# Client Mode (contract sections 4 and 8)

The browser runtime is always installed. It decides:

- on Adobe-managed CDNs;
- on `aem.page` preview;
- every section the edge leaves to the browser: `target` sections, sections that need
  browser-only criteria, no consent cookie, and edge failures.

## Contents

- Installed files
- The `scripts.js` hooks
- Lifecycle
- Budgets, LCP and CLS
- Public API
- Configuration (`config.js`)

## Installed files

| Path | Owner | Notes |
|---|---|---|
| `scripts/personalization/sections.js` | skill | Orchestrator: holds, decides, applies and reveals sections, re-evaluates, measures |
| `scripts/personalization/section-spec.js` | skill | Section grammar, Rule rows, split draw (shared with the edge) |
| `scripts/personalization/outcomes.js` | skill | Outcomes, decision identity, event payloads, `data-pzn-*` (shared with the edge) |
| `scripts/personalization/visitor.js` | skill | Consent, context, bots, state, overrides, events, RUM, feedback, `window.hlx.personalization` |
| `scripts/personalization/sources/{api,split,target,target-websdk}.js` | skill | Engine, split, Target (Delivery API or Web SDK) |
| `scripts/personalization/popup.js` | skill | Target popup (`<dialog>`) and triggers |
| `scripts/personalization/mocks.js`, `mock-engine.js` | skill | In-browser engine and Target mocks, loaded only with `config.mock` |
| `scripts/personalization/rules.js`, `contract.js`, `context.js`, `provider-api.js` | skill | Conditions, v1 request/response, context readers, engine transport (shared with the edge) |
| `scripts/personalization/config.js` | site | Created once, never overwritten |
| `styles/target-popup.css` | site | Popup styles (reduced-motion aware); created once |
| `blocks/fragment/fragment.js` | site | The stock `loadFragment`, added only when missing (the runtime needs `loadFragment(path)`) |

Re-running `install-runtime.mjs` updates the skill-owned files and keeps the site-owned ones. Its
report lists:

- the files: `created`, `updated`, `unchanged`, `kept`;
- `warnings`;
- `hooks.{sections,lazy}`, each `{ status, patch }`, where status is `installed`, `pending`,
  `applied` or `not-found`, plus an overall `hook`;
- `config`: the recorded `consent` and the problems still open in `config.js`.

## The `scripts.js` hooks

`install-runtime.mjs --apply-hook` inserts the hooks and prints the patch; the skill always passes
`--apply-hook`. On a page without personalized sections each hook costs one `querySelector` and
loads nothing.

In `loadEager`, right **after** `decorateMain(main);`, so sections are held before the first one
loads:

```js
    decorateMain(main);
    if (main.querySelector(':scope > .section[data-personalization]')) {
      const { personalizeSections } = await import('./personalization/sections.js');
      await personalizeSections(main);
    }
```

The `await` matters only when the first section is personalized. `loadEager` then continues once
that section shows (within `budgets.eager`), so nothing else appears first and shifts when it
does.

In `loadLazy`, right after `await loadSections(main);` (this arms `target` popups):

```js
    await loadSections(main);
    if (main.querySelector(':scope > .section[data-personalization]')) {
      const { personalizeSectionsLazy } = await import('./personalization/sections.js');
      personalizeSectionsLazy(main);
    }
```

A hook reported `not-found` (a `scripts.js` without these anchors) is placed by hand at the
equivalent spot: after the sections are decorated and before the first one loads, and after all
sections have loaded. Show the diff in the summary.

## Lifecycle

1. **Read.** `personalizeSections(main)` reads every `.section[data-personalization]`.
   - An invalid section shows its default (outcome `invalid`).
   - A section marked by the edge (`data-pzn-where="edge"`) is final. `applied` is only measured;
     `selected` gets its fragment here and is not decided again.
2. **Hold.** Each section to decide gets `data-section-status="pzn-pending"`, so `aem.js`
   `loadSection` skips it and it stays hidden. Every section below the first held one gets
   `pzn-waiting`. Target popups are not held.
3. **Decide.** The steps are, in order:
   1. a `?pzn=` override (preview hosts only);
   2. bot: the default, with no calls;
   3. no consent and no matching exception: the default, outcome `no-consent` (`consent.md`);
   4. the source's answer, with one batched call per source (engine, Target), counting listed
      variants only;
   5. for `api` sections, the Rule rows after `no-match`, `low-confidence` or `fallback`;
   6. otherwise, the default.

   Outcomes are listed in `decisions-and-measurement.md`.
4. **Apply.** Each section races its decision **and** its fragment against its budget. A variant
   replaces the section's children with the fragment's content. The default is kept in memory
   and restored when a later decision is the default. If the fragment fails, the default shows
   with `result: failed`.
5. **Reveal.** A decided section becomes `pzn-ready` and is revealed with `loadSection` **in page
   order**: it appears only once every section above it has, so nothing shifts above the reader.
6. **Measure.** `pzn:decided`, `pzn:applied`, then `pzn:seen` and `pzn:clicked` once per
   decision, along with Target notifications and engine feedback.
7. **Popups.** `personalizeSectionsLazy(main)` arms popups (`target.md`).
8. **Re-evaluate.** `refresh()`, `setState()` and consent changes evaluate again, with the
   decision-identity rules in `decisions-and-measurement.md`. A newer evaluation wins; an older
   answer that arrives late is ignored.
9. **Safety net.** At `max(budgets.eager, budgets.lazy) + 2000` ms, any section still hidden
   shows its default (outcome `timeout`, reason `failsafe`, console error). Budgets normally
   decide first; the safety net only guards against a runtime fault.

## Budgets, LCP and CLS

- **Budgets.** `config.budgets` sets `eager` 800 ms (the first section) and `lazy` 2000 ms (the
  others, up to 10 s). A budget covers the decision and the fragment. Running out gives outcome
  `timeout` and the default; Rule rows are not used.
- **Request timeouts.** The engine request has its own `api.timeout`, and Target has
  `target.timeout` (3000 ms). A request timeout is a `fallback`, so the Rule rows apply, but the
  section budget still caps the whole thing.
- **LCP.** A first section decided in the browser stays hidden until it is decided. On preview
  hosts and with `?pzn-debug` the runtime warns about it, and the validator warns too. The
  validator **fails** a slow engine (`of1`) on a first section in the browser. Decide that
  section at the edge (`edge-cloudflare.md`), where it is never hidden, or personalize a later
  section. For `target`, use a popup or a later section.
- **Images.** The first section's variant image loads `eager` with `fetchpriority="high"`.
- **CLS.** Decisions happen while sections are hidden, and sections are revealed in order, so the
  first render doesn't shift. The price is that sections below a held section wait for it. Measure
  with `verify-preview.mjs --perf --baseline <url before the change>`. An LCP regression over
  500 ms fails; then recommend the edge or a later section.

## Public API (`window.hlx.personalization`)

```js
await window.hlx.personalization.setState('quiz-persona', 'cn'); // re-decides dependent sections
window.hlx.personalization.getState('quiz-persona');             // 'cn'
await window.hlx.personalization.setState('quiz-persona', null); // remove
await window.hlx.personalization.refresh();                       // re-evaluate, e.g. after a consent change
window.hlx.personalization.decisions;                             // the ?pzn-debug rows
window.hlx.personalization.preview.consent(true);                 // preview hosts only: stand in for the CMP
```

A block can also import it: `import { setState } from '../../scripts/personalization/visitor.js'`.

- `setState` evaluates again the browser-decided sections that have a `state:` rule on that key,
  every section with `audience:` rules, and, with consent, the `api` sections when the engine
  reads `state` (`generic`: yes; `of1`: no, see `decision-api.md` § Engine profiles). A new engine
  answer is a new decision; an identical one sends nothing. State is kept in localStorage
  (`pzn-state`) only with consent; otherwise it lasts for the page view.
  `personalization:state-changed` fires on `document`.
- `refresh()` evaluates every browser-decided section again. The CMP calls it when consent
  changes. The runtime also listens for a window `consent.update` event.
- Edge-decided sections are final for the page view. Only a consent withdrawal (back to the
  default) or a `?pzn=` override changes them.

## Configuration (`config.js`)

Every option is commented in the file. The schema is
`assets/contract/schemas/site-config.schema.json`.

| Key | Default | Purpose |
|---|---|---|
| `consent` | `{ mode: 'deny' }` | `mode` (`cmp`, `allow`, `deny`), `tool`, `withoutConsent`, `policyRef` (`consent.md`) |
| `hasConsent(category)` | `() => false` | Called with `'personalization'`. Wire it to the CMP (`consent.md`) |
| `fragmentPrefixes` | `['/fragments/']` | Fragments a section may show |
| `budgets` | `{ eager: 800, lazy: 2000 }` | Per-section budget (decision plus fragment) |
| `devices` | mobile, tablet and desktop media queries | `device:` values; the first match wins |
| `geo` | `{ endpoint: '', timeout: 500 }` | Opt-in geo lookup, with consent, when there is no edge meta tag or cookie |
| `api` | `{ endpoint: '', engine: 'generic', timeout: 1500, feedback: '', mapRequest: null, mapResponse: null }` | `decision-api.md` |
| `target` | `{ transport: 'delivery-api', clientCode: '', propertyToken: '', endpoint: '', timeout: 3000 }` | `target.md` |
| `audiences` | `{}` | `audience:` functions (`criteria.md`) |
| `overrides` | `'preview'` | Where the `?pzn…` params work (`'always'`, `'never'`) |
| `botsGetDefault` | `true` | Crawlers get the default |
| `analytics` | `{ dataLayer: true, rum: true, seenThreshold: 0.25 }` | `decisions-and-measurement.md` |
| `mock` | `false` | Demos and tests only: `{ api: <decisions table>, target: <activities> }` answered in the browser. Must be `false` at launch |
