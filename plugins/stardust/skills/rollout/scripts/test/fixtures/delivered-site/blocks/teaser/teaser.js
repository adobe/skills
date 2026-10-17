/**
 * Teaser block: a list of linked cards, each with a title
 * and a short text. The list and secure option classes change the layout.
 * @param {Element} block the block element
 */
export default function decorate(block) {
  [...block.children].forEach((row) => row.classList.add('teaser-item'));
  if (block.classList.contains('secure')) block.setAttribute('data-locked', 'true');
}
