# Rework the Promo Block Authors Keep Breaking

## Problem/Feature Description

Halvorsen Outdoor's AEM Edge Delivery site (authored in SharePoint/Word, with a German and a French site translated by an agency) has a `promo` block used on about 120 pages. The content team lead sent this summary of author complaints from the last quarter:

1. "When I bold a word or add a link in the Body, it comes out as plain text on the site."
2. "I copied a promo from another page, the button disappeared. Turned out the row said `Button link ` with a trailing space — I can't see that in Word."
3. "On the German site every promo broke after translation — the agency translated `Title` to `Titel`."
4. "Half of our promos don't need a subtitle. If I delete the row the layout jumps; if I leave it empty, there's an empty gap on the page."
5. "We need a second button sometimes (e.g. 'Shop now' + 'View lookbook') and there's no way to do it."
6. "New authors never know what to type in `Theme` or `Image Position` — is it `Dark`, `dark`, `black`?"

The current authored structure and code are in the input files. Redesign the block's content model and rewrite the block so these problems go away. The visual design (image beside text, heading, optional subtitle, body, button(s), dark or light theme, image on left or right) stays the same.

## Output Specification

- Write `MODEL.md` with: the new authored structure as a text table or markdown grid (one full example and one minimal example), a 2–5 sentence rationale, and one or two sentences on what happens to the ~120 existing promos.
- Rewrite `blocks/promo/promo.js` (default-exported `decorate(block)`). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: content/example-promo.md ===============
How a promo is authored today (Word table):

| Promo                                             |
|----------------|----------------------------------|
| Title          | Summer Sale                      |
| Subtitle       | Up to 40% off tents              |
| Body           | Gear up for the season. **Members** get free shipping. [See terms](https://www.halvorsen.example/terms) |
| Image          | ![tent at a lake](tent.jpg)      |
| Button Text    | Shop now                         |
| Button Link    | https://www.halvorsen.example/sale |
| Theme          | dark                             |
| Image Position | right                            |

=============== FILE: blocks/promo/promo.js ===============
import { readBlockConfig, createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  const config = readBlockConfig(block);
  const theme = config.theme || 'light';
  const position = config['image-position'] || 'left';

  block.classList.add(`promo-${theme}`, `promo-image-${position}`);

  const picture = config.image
    ? createOptimizedPicture(config.image, '', false, [{ width: '900' }]).outerHTML
    : '';

  block.innerHTML = `
    <div class="promo-image">${picture}</div>
    <div class="promo-content">
      <h2>${config.title}</h2>
      <h3>${config.subtitle || ''}</h3>
      <p>${config.body}</p>
      <a class="button" href="${config['button-link']}">${config['button-text']}</a>
    </div>
  `;
}

=============== FILE: scripts/aem.js (excerpt) ===============
// readBlockConfig: reads a two-column block into an object.
// key = toClassName(first cell text); value = href of link(s), else src of img(s),
// else textContent of paragraph(s), else textContent of the cell.
function readBlockConfig(block) { /* ... */ }
