# Client Mode

## Installed files

| Path | Owner | Notes |
|---|---|---|
| `scripts/personalization/index.js` | skill | Runtime: lifecycle, rendering, public API |
| `scripts/personalization/rules.js`, `contract.js`, `context.js` | skill | Shared with the edge worker |
| `scripts/personalization/provider-api.js` | skill | Decision API transport and session cache; `callEngine` shared with the edge worker |
| `scripts/personalization/config.js` | site | Never overwritten |
| `blocks/personalization/personalization.js` | skill | Calls `personalize(block)` |
| `blocks/personalization/personalization.css` | site | Hides the rule rows |
| `blocks/fragment/fragment.js` | site | Stock `loadFragment`, only added when missing |

Re-running `install-runtime.mjs` updates skill-owned files and keeps site-owned ones.

## The `scripts.js` hook

Inside `loadEager`, immediately **before** `decorateMain(main)`:

```js
    if (main.querySelector('div.personalization')) {
      const { initPersonalization } = await import('./personalization/index.js');
      initPersonalization(main);
    }
    decorateMain(main);
```

Why there: it reads the raw rows before decoration and plain-texts their fragment links, so the
boilerplate auto-blocking (`a[href*="/fragments/"]` → fragment block) does not consume them. It
also starts the single batched API request as early as possible. Pages without placeholders pay
one `querySelector` and load nothing.

For non-boilerplate `scripts.js` (no `decorateMain(main)` in `loadEager`), place the same block
right before the code that decorates blocks and show the diff in the summary (no approval needed).

## Lifecycle

1. `initPersonalization(main)` (eager): reads rows, starts one decision API request for all
   `source | api` placeholders not already decided by the edge.
2. The block's `decorate` calls `personalize(block)` while its section is still hidden (E-L-D),
   so the visitor never sees the default flash to a variant.
3. Decision order: `?pzn=` override → bot default → edge decision → API → rules → default.
4. The chosen fragment is fetched with `loadFragment` (retried under `/content` when the page is
   served from an `aem up --html-folder content` mount) and inserted after the block. A fragment that fails to load falls back to the default.
5. `personalization:applied` fires; analytics are pushed (`cross-cutting.md`).

## Budgets, LCP and CLS

- `config.budgets`: `eager` (800 ms, placeholders in the first section) and `lazy` (2000 ms).
  When the budget runs out the default renders (`source: timeout`). A slow API stops being awaited
  ~50 ms before the budget so rules can still decide.
- In the first section the variant's first image gets `loading="eager"` and `fetchpriority="high"`.
- Above-the-fold cost in client mode: the fragment fetch, plus the API or geo lookup if used.
  Measure with `verify-preview.mjs --baseline <before url>`; if LCP regresses > 500 ms, recommend
  edge mode or moving the placeholder below the fold.
- CLS: decisions happen before the section is shown, and `default | none` leaves nothing behind,
  so first render does not shift. Live swaps after `setState` follow user input and are excluded
  from CLS when they happen within 500 ms of it.

## Public API (`window.hlx.personalization`)

```js
await window.hlx.personalization.setState('quiz-persona', 'cn'); // re-evaluates dependent placeholders
window.hlx.personalization.getState('quiz-persona');             // 'cn'
await window.hlx.personalization.setState('quiz-persona', null); // remove
await window.hlx.personalization.refresh();                       // re-evaluate all, e.g. after consent
window.hlx.personalization.decisions;                             // [{ id, variant, source, rule, ms }]
```

Also importable: `import { setState } from '../../scripts/personalization/index.js'` (e.g. from a
quiz block). `setState` re-evaluates placeholders with a `state:` rule on that key and every
placeholder with `audience:` rules; others are untouched. State persists in localStorage only with
consent; otherwise it lives for the page view.

Call `refresh()` from the CMP's consent-change callback so `visitor` and API decisions update.

Re-evaluations decide in the browser, also for placeholders the edge decided: the edge used the
context of the page request, which consent or state changes make stale. Calls made while a
placeholder is still rendering apply to it, and when calls overlap the latest one wins, even if an
earlier one's fragment loads later.

## Events

| Event | Target | `detail` |
|---|---|---|
| `personalization:applied` | the block (bubbles) | `{ id, variant, source, rule, tracking }` |
| `personalization:state-changed` | `document` | `{ key, value }` |

## Configuration (`config.js`)

`fragmentPrefixes`, `budgets`, `devices`, `geo` (opt-in endpoint), `api` (endpoint, consent,
adapters), `audiences`, `hasConsent(category)`, `overrides` (`preview` | `always` | `never`),
`botsGetDefault`, `analytics` (`dataLayer`, `rum`). Each option is commented in the file.
