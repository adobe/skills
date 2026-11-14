/**
 * Decorate the testimonial-carousel block
 * @param {Element} block the block
 */
export default async function decorate(block) {
  const items = [...block.querySelectorAll(':scope > div')];

  const list = document.createElement('ul');
  list.className = 'items';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';

    const quoteEl = item.querySelector('p:first-child');
    const bylineEl = item.querySelector('p:last-child');

    if (quoteEl) {
      const blockquote = document.createElement('blockquote');
      blockquote.className = 'quote';
      blockquote.append(quoteEl);
      li.append(blockquote);
    }

    if (bylineEl) {
      const byline = document.createElement('div');
      byline.className = 'byline';
      byline.append(bylineEl);
      li.append(byline);
    }

    list.append(li);
  });

  block.replaceChildren(list);
}
