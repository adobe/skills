# Pre-Commit Review of a New Product Teaser Block

## Problem/Feature Description

I'm a developer on the Northwind Outfitters site (AEM Edge Delivery Services, repository `northwind-outfitters/northwind-site`, based on aem-boilerplate). I've just finished building a `product-teaser` carousel block on my local branch `product-teaser` and checked it in the browser against my test page, `/drafts/jdoe/product-teaser`, served by `aem up` at `http://localhost:3000`. Nothing is committed yet.

I'm about to commit this and open a pull request. Before I do, review my changes and do whatever a pre-commit review should do so the work is ready to commit and open as a PR. Do not commit anything or touch git yourself.

Here is what my terminal shows:

```
$ git status
On branch product-teaser
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   scripts/scripts.js

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	blocks/product-teaser/

no changes added to commit (use "git add" and/or "git commit -a")

$ git diff --staged
$ git diff
diff --git a/scripts/scripts.js b/scripts/scripts.js
index 06188f5..d072f80 100644
--- a/scripts/scripts.js
+++ b/scripts/scripts.js
@@ -10,6 +10,7 @@ import {
   loadSections,
   loadCSS,
   buildBlock,
+  loadScript,
 } from './aem.js';
 
 if (window.trustedTypes && window.trustedTypes.createPolicy) {
@@ -162,6 +163,8 @@ export function decorateMain(main) {
 async function loadEager(doc) {
   document.documentElement.lang = 'en';
   decorateTemplateAndTheme();
+  // swiper is needed by the product-teaser block
+  await loadScript('https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js');
   const main = doc.querySelector('main');
   if (main) {
     decorateMain(main);
```

## Output Specification

- Leave the project files in the state you consider ready to commit.
- Write `SELF-REVIEW.md` summarizing the review: files reviewed, what you found, what was changed, anything still open, and what remains to do before committing and opening the PR.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: blocks/product-teaser/product-teaser.js ===============
const PRICE_API = 'https://commerce.northwind-outfitters.com/api/v2/prices';

export default async function decorate(block) {
  console.log('decorating product-teaser', block.children.length);
  block.classList.add('swiper');
  const wrapper = document.createElement('div');
  wrapper.className = 'swiper-wrapper';

  [...block.children].forEach((row) => {
    row.className = 'swiper-slide slide';
    const [, info] = row.children;
    info.className = 'slide-info';
    wrapper.append(row);
  });
  block.append(wrapper);

  const skus = [...block.querySelectorAll('.slide-info code')].map((c) => c.textContent);
  const resp = await fetch(`${PRICE_API}?skus=${skus.join(',')}`);
  const prices = await resp.json();
  block.querySelectorAll('.slide-info').forEach((info, i) => {
    const price = document.createElement('p');
    price.className = 'price';
    price.textContent = prices[skus[i]];
    price.style.fontWeight = '700';
    price.style.color = '#c4122f';
    info.append(price);
  });

  // eslint-disable-next-line no-undef
  new Swiper(block, { slidesPerView: 1.2, spaceBetween: 16 });
}

=============== FILE: blocks/product-teaser/product-teaser.css ===============
.product-teaser {
  overflow: hidden;
}

.slide {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slide img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.slide-info h3 {
  margin: 0 !important;
}

@media (max-width: 899px) {
  .slide-info {
    padding: 0 16px;
  }
}

@media (width >= 900px) {
  .slide {
    flex-direction: row;
  }
}

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
  loadScript,
} from './aem.js';

if (window.trustedTypes && window.trustedTypes.createPolicy) {
  const innerTT = window.trustedTypes.createPolicy('tt-inner', {
    createHTML: (s) => s, // avoid stack overflow
  });

  window.trustedTypes.createPolicy('default', {
    createHTML: (input, type, sink) => {
      let processedInput = input;
      if (/srcdoc\s*=/i.test(processedInput)) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('iframe[srcdoc]').forEach((el) => el.removeAttribute('srcdoc'));
        processedInput = doc.body.innerHTML;
      }
      if (sink.includes('createContextualFragment') || sink.includes('Document write')) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('script').forEach((el) => el.remove());
        processedInput = doc.body.innerHTML;
      }
      return processedInput;
    },
    createScriptURL: (input) => input,
    createScript: (input) => input,
  });
}

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
  // swiper is needed by the product-teaser block
  await loadScript('https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js');
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

=============== FILE: drafts/jdoe/product-teaser.plain.html ===============
<div>
  <h1>New this season</h1>
  <div class="product-teaser">
    <div>
      <div><picture><img src="./media_1a2b3c.jpg?width=750&format=jpg&optimize=medium" alt="Trailhead 2 hiking boot" loading="lazy"></picture></div>
      <div><h3>Trailhead 2 Boot</h3><p>Waterproof leather, all-day grip.</p><p><code>NW-BT-2201</code></p></div>
    </div>
    <div>
      <div><picture><img src="./media_4d5e6f.jpg?width=750&format=jpg&optimize=medium" alt="Ridgeline insulated jacket" loading="lazy"></picture></div>
      <div><h3>Ridgeline Jacket</h3><p>Recycled fill, packs into its own pocket.</p><p><code>NW-JK-3307</code></p></div>
    </div>
  </div>
</div>
