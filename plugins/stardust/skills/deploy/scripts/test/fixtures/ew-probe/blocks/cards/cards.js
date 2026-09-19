/* eslint-disable no-param-reassign */
import { el } from '../../scripts/dom-helpers.js';

/**
 * Cards — the price paragraph is re-rendered from the row (derived), declared
 * item-level so only matching texts are exempt.
 * @ew-exempt <p> /^\$\d/ — derived: price re-rendered with the currency badge
 */
export default function decorate(block) {
  const ul = el('ul', 'cards-list');
  [...block.children].forEach((row) => {
    const li = el('li');
    [...row.children].forEach((cell) => {
      [...cell.children].forEach((node) => {
        if (node.tagName === 'P' && /^\$\d/.test(node.textContent.trim())) {
          const price = el('p', 'price'); // rebuilt from text → dead, but declared
          price.textContent = `${node.textContent.trim()} / mo`;
          li.append(price);
        } else li.append(node);
      });
    });
    ul.append(li);
  });
  block.replaceChildren(ul);
}
