---
name: building-blocks
description: "Use this before writing or changing AEM Edge Delivery Services (EDS, Franklin, Helix) block or site code: a block's `decorate(block)`, block CSS and variants, `scripts.js` loading phases (eager, lazy, delayed), images, fragments, and LCP or performance fixes. EDS conventions don't always match standard front-end practice because of its architecture and page-loading model, and the boilerplate keeps evolving past model training cutoffs, so check here rather than relying on memory. For new blocks or changes to the authored structure, start with content-driven-development."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Building Blocks

EDS rules for block and site code that differ from general front-end practice. Follow the project's existing blocks, `AGENTS.md` and lint config for everything else. For a new block, a reference implementation from Block Collection (see **block-collection-and-party**) is a good start.

## JavaScript (`decorate(block)`)

- **Move, don't copy:** move the delivered pictures, headings, paragraphs and links into the new structure. Copying their text or `src` into new elements, or rebuilding them with `innerHTML` or template strings, loses heading ids, image sizes and Universal Editor `data-aue-*` attributes.
- **Cells vary:** authors leave cells out and add extra ones. Find content by what it is (e.g. the cell with a `picture`), not by index.
- **Don't hold up the section:** a section stays hidden until all its blocks are decorated, and the first section gates LCP. Don't await slow fetches, large imports or embeds in `decorate()`; load them when the block comes into view (IntersectionObserver) or on interaction, and reserve their space (e.g. `aspect-ratio`) so late content doesn't shift the layout.
- **aem.js is vendored:** never edit it. Import its helpers (`createOptimizedPicture`, `readBlockConfig`, `loadScript`, ...) from `../../scripts/aem.js`.

## CSS

- **Page grid:** global styles set max-width, centering and inline padding on `main > .section > div`. Don't override them on the block. For outer layout such as a full-bleed background, style `.{block-name}-container` (the section) or `.{block-name}-wrapper` (the block's parent), not `100vw` or `calc(50% - 50vw)`. Don't reuse those class names inside the block.
- **Custom properties:** use the ones declared on `:root` in `styles/styles.css`. Sites embedded with aem-embed load styles into a shadow root, so declare them on `:root, :host` there.

## Site code

- **Late-loading code:** code that can wait goes in `loadDelayed()` in `scripts.js`. Analytics and martech go in `consented.js`, which `consent-check.js` loads only after consent. Older projects may have `delayed.js` instead; follow what the project has.

When the code works, test it with **testing-blocks**.
