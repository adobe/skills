# Add a Unit Test Setup for Auto-Blocking and Plan the Consent Checks

## Problem/Feature Description

Acme's site is an AEM Edge Delivery Services project built from the current boilerplate. The team wants unit tests, starting with the auto-blocking code in `scripts/scripts.js`, and the work is split into two pull requests:

- **PR 1 (yours):** add Vitest, a `test` npm script, and an `npm test` step in CI, plus any source changes needed so the auto-blocking logic can be unit tested. Do **not** add test files in PR 1; a teammate writes them in PR 2. CI must be green on PR 1 as merged.
- **PR 2 (teammate):** the actual tests, following a test plan you write.

Two tickets also need to be folded into the test plan:

> **QA-311:** On `/products` the first image used to be turned into a hero automatically. Please add a regression test that the hero auto-block is still built from the first section's picture and heading.

> **QA-318:** Marketing added the Example Chat widget in `scripts/consented.js`. Verify it never loads before the visitor has accepted, and that it does load once they accept. On a throttled connection the chat loader can take up to 20 seconds to arrive, so make sure the check waits long enough. Our old wiki says third-party scripts load from `delayed.js` three seconds after page load.

## Output Specification

- The updated `package.json`, a Vitest config file, and the updated `.github/workflows/ci.yml`.
- Any source files you change or add so the auto-blocking code can be unit tested.
- `TESTPLAN.md` for your teammate: which unit test cases PR 2 should add and what each asserts, which module each test file imports, how QA-311 and QA-318 are handled (including how the QA-318 check is run and how it waits), and the commands to run before each PR is marked ready.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: package.json ===============
{
  "name": "@acme/acme-site",
  "private": true,
  "version": "1.3.0",
  "description": "Acme marketing site",
  "scripts": {
    "lint:js": "eslint .",
    "lint:css": "stylelint \"blocks/**/*.css\" \"styles/*.css\"",
    "lint": "npm run lint:js && npm run lint:css",
    "lint:fix": "npm run lint:js -- --fix && npm run lint:css -- --fix"
  },
  "devDependencies": {
    "@babel/eslint-parser": "7.29.9",
    "eslint": "8.57.1",
    "eslint-config-airbnb-base": "15.0.0",
    "eslint-plugin-import": "2.32.0",
    "stylelint": "17.16.0",
    "stylelint-config-standard": "40.0.0"
  }
}

=============== FILE: .github/workflows/ci.yml ===============
name: CI
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint

=============== FILE: scripts/scripts.js ===============
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

// ... Trusted Types default policy setup omitted ...

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Turns `/widgets/...` links into widget blocks.
 * @param {Element} main The container element
 */
function buildWidgetAutoBlocks(main) {
  const widgetLinks = [...main.querySelectorAll('a[href*="/widgets/"]')];
  widgetLinks.forEach((link) => {
    if (link.closest('.widget')) return;
    const newLink = link.cloneNode(true);
    const widgetBlock = buildBlock('widget', { elems: [newLink] });
    const p = link.closest('p');
    if (
      p
      && p.querySelectorAll('a').length === 1
      && p.querySelector('a') === link
      && p.textContent.trim() === link.textContent.trim()
    ) {
      p.replaceWith(widgetBlock);
    } else {
      link.replaceWith(widgetBlock);
    }
  });
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // auto load `*/fragments/*` references
    const fragments = [...main.querySelectorAll('a[href*="/fragments/"]')].filter((f) => !f.closest('.fragment'));
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(...frag.children);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }
    buildWidgetAutoBlocks(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();

    // quick structural checks
    if (a.querySelector('img') || p.textContent.trim() !== text) return;

    // skip URL display links
    try {
      if (new URL(a.href).href === new URL(text, window.location).href) return;
    } catch { /* continue */ }

    // require authored formatting for buttonization
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (!strong && !em) return;

    p.className = 'button-wrapper';
    a.className = 'button';
    if (strong && em) { // high-impact call-to-action
      a.classList.add('accent');
      const outer = strong.contains(em) ? strong : em;
      outer.replaceWith(a);
    } else if (strong) {
      a.classList.add('primary');
      strong.replaceWith(a);
    } else {
      a.classList.add('secondary');
      em.replaceWith(a);
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
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
import { loadScript } from './aem.js';

loadScript('https://widget.example-chat.com/v2/loader.js', { 'data-account': 'acme' });
