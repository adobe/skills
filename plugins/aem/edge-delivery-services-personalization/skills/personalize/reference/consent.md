# Consent (contract section 3)

The default policy is **no consent, no personalization**. Until `hasConsent('personalization')`
is true, every section shows its default and the skill stores nothing, calls no engine or Target,
and sends no measurement. The `split` source is included in this.

## Contents

- Setup: what the skill records
- Wiring `hasConsent` to a consent tool
- Approved exceptions
- When consent changes
- The edge
- Checks

## Setup: what the skill records

`detect-project.mjs` reports `integrations.consentTools` (found in the site's code) and
`consent.recorded` (what `config.js` already says). `consent.ask: true` means the setup still has
to decide.

1. **A tool is found** (OneTrust, Cookiebot, Usercentrics, Didomi, TrustArc, Adobe Web SDK consent,
   or a site `consent.update` event):
   - set `consent: { mode: 'cmp', tool: '<name>' }`;
   - wire `hasConsent` to the tool (below), and make its change callback call
     `window.hlx.personalization.refresh()`;
   - tell the user which category was used (for example OneTrust `C0003`) so they can confirm it.
2. **No tool is found**: ask the user to choose one of these.

   | Choice | `config.consent` | Effect |
   |---|---|---|
   | Connect my consent tool (name it, or give the check) | `{ mode: 'cmp', tool }` | Wired as above |
   | Personalization needs no consent on this site (owner and legal confirm) | `{ mode: 'allow' }` | Consent is always given |
   | Keep it off until a consent tool is added (**default**) | `{ mode: 'deny' }` | Every section shows its default |

   No answer, or a hands-off run, gives `deny`. List it as an assumption in the summary.
3. **Exceptions.** Ask whether privacy/legal approved any exception (below), and where that
   approval is recorded. No answer means none. **Never add an exception on your own.**

`validate-placeholders.mjs` fails when `consent.mode` is missing, when `tool` is missing with
`cmp`, when `withoutConsent` is set without a `policyRef`, and when `config.providers` or
`sendWithoutConsent` is present (neither is supported).

## Wiring `hasConsent` to a consent tool

`hasConsent` returns `true`, `false`, or `undefined` while the tool hasn't answered yet. While
the answer is `undefined`, sections are decided as `no-consent` and nothing is written. When the
tool answers, it calls `refresh()` and those sections are decided again. Use the category the
site's consent banner uses for personalization, and confirm it with the user.

```js
// OneTrust: the category id the site uses for personalization (often C0003 or C0004).
hasConsent: () => (typeof window.OnetrustActiveGroups === 'string'
  ? window.OnetrustActiveGroups.includes(',C0003,') : undefined),
// and in head.html or delayed.js, after OneTrust loads:
//   window.OneTrust?.OnConsentChanged(() => window.hlx?.personalization?.refresh());

// Cookiebot
hasConsent: () => (window.Cookiebot?.hasResponse ? !!window.Cookiebot.consent.preferences : undefined),
//   window.addEventListener('CookiebotOnConsentReady', () => window.hlx?.personalization?.refresh());

// Didomi: the purpose id configured for personalization.
hasConsent: () => window.Didomi?.getUserConsentStatusForPurpose?.('<purpose-id>'),
//   window.didomiEventListeners = window.didomiEventListeners || [];
//   window.didomiEventListeners.push({ event: 'consent.changed', listener: () => window.hlx?.personalization?.refresh() });

// Site glue (any tool, Adobe Web SDK consent included): the site keeps its consent state and fires
// window.dispatchEvent(new Event('consent.update')) on changes; the runtime listens for it.
hasConsent: () => window.siteConsent?.personalization,
```

For Usercentrics, TrustArc and others, read the tool's documented consent API in the same way.
Return `undefined` until the tool has answered. A consent-change hook outside `config.js` lives in
the site's own code (`head.html` or `delayed.js`); never put it in `aem.js`.

## Approved exceptions

These are recorded only with the site's privacy/legal approval, and `policyRef` is where that
approval is recorded:

```js
consent: { mode: 'cmp', tool: 'onetrust', withoutConsent: ['rules', 'rum'], policyRef: 'LEGAL-1234' },
```

| Exception | Allows without consent |
|---|---|
| `rules` | `rules` sections, and the Rule rows of `api` sections, using only request geo (never the `pzn-geo` cookie), `device`, `param` and this page view's `state`. Nothing is stored. `visitor:` and `audience:` rules never match |
| `split` | The A/B assignment, kept for the session |
| `api` | Engine calls with request data only: no `visitor`, no `state`, and `consent.personalization: false`. Answers aren't kept in the browser |
| `rum` | RUM checkpoints |
| `data-layer` | `pzn:*` events in `adobeDataLayer` (the analytics tool applies its own consent) |

Target never runs without consent: inline sections show the default, and popups wait.
`withoutConsent` is ignored without a `policyRef`, and with `mode: 'allow'`.

## When consent changes

- **Given.** Sections whose outcome was `no-consent` are decided again, each with a new
  `decisionId` and `trigger: 'consent'`. Sections that were already decided keep their result.
- **Withdrawn.** Every personalized section goes back to its default, edge sections included
  (restored from `<template data-pzn-default>`), with outcome `no-consent`. The skill deletes its
  cookies and stored data (`pzn-*` cookies, localStorage and sessionStorage). After that, only
  what the `rum` and `data-layer` exceptions allow is sent.

The runtime copies the tool's answer into the `pzn-consent` cookie (`1` or `0`), so the edge
follows the same policy. The cookie holds only the consent choice, and it is written only after
the tool has answered.

## The edge

The edge decides only with `pzn-consent=1` or an approved exception. Copy `withoutConsent` and
`policyRef` from `config.js` into `edge-config.js` `consent`. On the first visit there is no
cookie yet, so the edge leaves those sections to the browser.

## Checks

- **Preview.** `?pzn-consent=1` or `?pzn-consent=0` fakes the answer.
  `window.hlx.personalization.preview.consent(true | false)` stands in for the tool and calls
  `refresh()`. Both work only on preview hosts.
- **Browser flow.** `verify-preview.mjs --consent-flow` checks three steps in turn:
  - no consent: every section shows its default, nothing is stored and nothing is sent;
  - consent given: the `no-consent` sections are decided again (`#2`, trigger `consent`);
  - consent withdrawn: the defaults are restored and storage is cleared.
- **Edge.** `simulate.mjs --edge` with and without `--consent` checks that sections are left to
  the browser when there is no cookie.
