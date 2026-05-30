# Known Overlay Patterns

Consult this reference when heuristic detection finds overlays but cannot compose a dismiss recipe.

## 1. Common Close Button Patterns

CSS selectors that commonly match close/dismiss buttons:

```css
[aria-label*="close"]
[aria-label*="Close"]
.close-btn
.close-button
button.close
button:has(svg)        /* X icons — check proximity to overlay */
[data-dismiss]
[data-close]
[data-action="close"]
.modal-close
.dialog-close
```

Evaluation order: prefer `aria-label` selectors (semantic) over class-based (fragile).
For `button:has(svg)`, confirm the button is visually inside or adjacent to the overlay.

## 2. Top 10 CMP Accept-All Button Selectors

| CMP | Selector |
|-----|----------|
| OneTrust | `#onetrust-accept-btn-handler` |
| Cookiebot | `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll` |
| TrustArc | `.truste-consent-button`, `#truste-consent-button` |
| Quantcast | `.qc-cmp2-summary-buttons button[mode="primary"]` |
| Didomi | `#didomi-notice-agree-button` |
| LiveRamp | `.lfr-btn.lfr-btn--primary` |
| Axeptio | `[data-testid="accept-all"]` inside `#axeptio_overlay` |
| Osano | `.osano-cm-accept-all` |
| CookieYes | `.cky-btn-accept` |
| Usercentrics | `button[data-testid="uc-accept-all-button"]` |

Try each selector with `document.querySelector(selector)` — null means not present on this page.

## 3. Shadow DOM CMPs

Known CMPs that render inside shadow roots and are invisible to normal `querySelector`:

**Usercentrics v2:**
```js
document.querySelector('#usercentrics-root')
  ?.shadowRoot
  ?.querySelector('button[data-testid="uc-accept-all-button"]')
  ?.click();
```

General traversal pattern:
```js
document.querySelector('#host')?.shadowRoot?.querySelector('button')
```

Diagnosis: if no overlays are detected but the page is visibly blocked, try shadow DOM traversal.
Walk `document.querySelectorAll('*')` and check `.shadowRoot` on each element.

## 4. Scroll-Lock Patterns

Common CSS applied to `html` or `body` that blocks scrolling:

| Property | Value |
|----------|-------|
| `overflow` | `hidden` |
| `position` | `fixed` (on body — freezes scroll position) |
| `touch-action` | `none` |
| `height` + `overflow` | `100vh` + `hidden` (locks viewport) |

Fix — inject via `page.evaluate()`:
```js
document.documentElement.style.cssText +=
  ';overflow:auto!important;height:auto!important;position:static!important';
document.body.style.cssText +=
  ';overflow:auto!important;height:auto!important;position:static!important';
```

## 5. Delayed and Exit-Intent Overlays

Overlays that appear after initial page load:

| Type | Trigger | Common selectors |
|------|---------|-----------------|
| Newsletter signup | 15-60s delay or scroll % | `.newsletter-modal`, `[class*="subscribe"]` |
| Exit-intent | Mouse leaves viewport | `.exit-intent`, `[class*="exit"]` |
| Re-consent | Cookie expired | CMP selectors from §2 |
| Paywall | Article scroll depth | `.paywall`, `[class*="paywall"]`, `[class*="meter"]` |

Strategy:
- Use watch mode to auto-detect overlays that appear after load
- Re-run scan after scrolling or waiting if initial scan finds a clean page that looks blocked
- For exit-intent: simulate mouse move to top of viewport to trigger early, then dismiss
