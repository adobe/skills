# Product Page Tabs With Rich Panels

## Problem/Feature Description

Kestrel Audio's product detail pages run on AEM Edge Delivery Services, authored in Document Authoring (da.live) and, for some regional teams, in Word. The site already has a `tabs` block; today its panels hold only short text (see the input files for how authors write it).

The product manager filed this request:

> **PDP-212 — Richer product tabs**
>
> We want three to five tabs below the product hero, e.g. **Overview**, **In the box**, **Accessories**, **Reviews**:
>
> - **Overview**: a few paragraphs, a bulleted list of highlights, a product image, and a YouTube video.
> - **In the box**: an image and a short list.
> - **Accessories**: an intro sentence and then the accessories shown with our **Cards** block (3–6 cards: image, name, short text, link), same look as on the accessories landing page.
> - **Reviews**: our **Quote** block for a pull quote, and a two-column comparison using our **Columns** block.
>
> Product managers add, remove and reorder tabs per product, and the regional teams often copy a whole tab from one product page to another.

## Output Specification

- Write `MODEL.md` describing how authors create the tabbed area: an authored example (text tables / markdown grids, using `---` for section breaks if you use sections) covering at least the **Accessories** and **Reviews** tabs, an explanation of how the tab label and the start/end of each panel are determined, how the tabs and the Cards, Quote and Columns content get rendered, a short check of the model against the authoring tools the teams use, and a 2–5 sentence rationale.
- Provide the code changes needed for your model to work: modify `scripts/scripts.js` and/or `blocks/tabs/tabs.js` (only the functions you change need to be complete). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: content/current-tabs.md ===============
How authors write the tabs block today (short text panels only):

| Tabs |  |
|------|--|
| Overview | The Aria 3 headphones combine hybrid ANC with 40-hour battery life. |
| In the box | Headphones, travel pouch, USB-C cable. |
| Reviews | "Best ANC under $300." — AudioWeekly |

=============== FILE: blocks/tabs/tabs.js ===============
// Project tabs block (adapted from the AEM Block Collection).
// Expects one row per tab: | tab label | panel content |
export default async function decorate(block) {
  const tablist = document.createElement('div');
  tablist.className = 'tabs-list';
  tablist.setAttribute('role', 'tablist');

  const tabs = [...block.children].map((child) => child.firstElementChild);
  tabs.forEach((tab, i) => {
    const id = `tab-${i}`;
    const tabpanel = block.children[i];
    tabpanel.className = 'tabs-panel';
    tabpanel.id = `tabpanel-${id}`;
    tabpanel.setAttribute('aria-hidden', !!i);
    tabpanel.setAttribute('role', 'tabpanel');

    const button = document.createElement('button');
    button.className = 'tabs-tab';
    button.id = `tab-${id}`;
    button.innerHTML = tab.innerHTML;
    button.setAttribute('aria-controls', `tabpanel-${id}`);
    button.setAttribute('aria-selected', !i);
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      block.querySelectorAll('[role=tabpanel]').forEach((p) => p.setAttribute('aria-hidden', true));
      tablist.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', false));
      tabpanel.setAttribute('aria-hidden', false);
      button.setAttribute('aria-selected', true);
    });
    tablist.append(button);
    tab.remove();
  });
  block.prepend(tablist);
}

=============== FILE: scripts/scripts.js (excerpt) ===============
import {
  buildBlock, decorateBlocks, decorateSections, decorateIcons,
  loadSection, loadSections, getMetadata,
} from './aem.js';

function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  // eslint-disable-next-line no-bitwise
  if (h1 && picture && (h1.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_PRECEDING)) {
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, h1] }));
    main.prepend(section);
  }
}

function buildAutoBlocks(main) {
  try {
    buildHeroBlock(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

// loadEager / loadLazy omitted: they call decorateMain(main) and then loadSection / loadSections(main)
