# Site Analytics Tag and Top-of-Page Promo Block

## Problem/Feature Description

The marketing team at Northwind Outfitters runs their site on AEM Edge Delivery Services and keeps a Lighthouse score of 100. They need two things this sprint.

First, a vendor analytics tag must run on every page. The vendor's snippet is:

```html
<script async src="https://cdn.example-analytics.com/tag.js" data-site="northwind"></script>
```

Legal requires that analytics only run for visitors who have given consent.

Second, authors want a `promo-banner` block. It shows an authored image and a heading, plus a countdown to the promotion's end. The end time comes from `/promo.json`, which returns `{ "ends": "<ISO date>" }`. Authors usually place this block at the very top of landing pages.

## Output Specification

- Make the analytics change in the existing project files (create new files only if needed).
- Create the block's JavaScript at the standard AEM block path. CSS is not needed.
- Write `NOTES.md` with two or three sentences explaining where the analytics tag is loaded and how the block avoids hurting page performance.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: scripts/scripts.js ===============
// excerpt of the project's scripts.js
import {
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  buildBlock,
} from './aem.js';

// ... buildAutoBlocks, decorateButtons, loadFonts omitted ...

export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('body > header'));

  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('body > footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  import('./consent-check.js');
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();

=============== FILE: scripts/consent-check.js ===============
let consentedLoaded = false;

/**
 * Dummy consent implementation.
 *
 * By default consent is declined, so consented scripts (analytics, martech, etc.)
 * are not loaded. This stands in for a real CMP (OneTrust, etc.) and can be
 * swapped out later.
 *
 * The default can be overridden with a query parameter for testing:
 *   ?consent=accept   grant consent (loads consented.js)
 *   ?consent=decline  decline consent (default behavior)
 *
 * @returns {boolean} true if the user has consented
 */
function hasConsent() {
  const consent = new URLSearchParams(window.location.search).get('consent');
  if (consent !== null) {
    return ['accept', 'true', '1', 'yes'].includes(consent.toLowerCase());
  }
  // default: decline
  return false;
}

/**
 * Loads consented scripts once consent is available.
 */
function loadConsented() {
  if (consentedLoaded) return;
  consentedLoaded = true;
  import('./consented.js');
}

/**
 * Notifies listeners of the current consent state and loads consented
 * scripts if consent has been granted.
 */
function onConsentUpdate() {
  const consented = hasConsent();
  window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
  if (consented) {
    loadConsented();
  }
}

onConsentUpdate();

=============== FILE: scripts/consented.js ===============
// add functionality that requires user consent here (analytics, martech, etc.)

=============== FILE: inputs/sample-block-content.html ===============
<!-- What the AEM platform delivers to decorate() for the promo-banner block. -->
<div class="promo-banner">
  <div>
    <div><picture><img src="./media_1a2b3c.jpg" alt="Summer gear on a trail" width="1600" height="900"></picture></div>
    <div><h2>Summer Sale</h2></div>
  </div>
</div>
