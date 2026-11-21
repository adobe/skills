/**
 * Sustain — "Kind by design" image + copy with chips (prototype `section.sustain`).
 *
 * Authored rows (any cell layout; flattened single-cell content is read the same way):
 *   - an image
 *   - eyebrow paragraph (before the heading), heading, lede paragraph(s)
 *   - a list → the chips
 *
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 */

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    let kids = [...cell.children];
    if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].querySelector('picture, img')
      && kids[0].textContent.trim()) {
      kids = [...kids[0].children];
    }
    if (kids.length) out.push(...kids);
    else if (cell.textContent.trim()) {
      const p = el('p');
      p.append(...cell.childNodes);
      out.push(p);
    }
  });
  return out;
}

function revealAll(pairs) {
  pairs.forEach(([node, delay]) => {
    node.classList.add('reveal');
    if (delay) node.style.setProperty('--reveal-delay', `${delay}s`);
  });
  import('../../scripts/reveal.js')
    .then(({ reveal }) => pairs.forEach(([node, delay]) => reveal(node, delay)))
    .catch(() => pairs.forEach(([node]) => node.classList.add('is-in')));
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';

  const nodes = collectNodes(block);
  const grid = el('div', 'container sustain-grid');
  const media = el('div', 'sustain-media');
  const copy = el('div', 'sustain-copy');
  const eyebrow = el('div', 'eyebrow');
  const title = el('div', 'sustain-title');
  const lede = el('div', 'lede-wrap');
  const chips = el('div', 'sustain-chips');
  let seenHeading = false;

  nodes.forEach((node) => {
    const pic = node.matches('picture, img') ? node : node.querySelector('picture, img');
    if (pic && !media.children.length) {
      media.append(pic);
      if (node !== pic && !node.textContent.trim()) node.remove();
    } else if (/^H[1-6]$/.test(node.tagName) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (node.matches('ul, ol')) {
      chips.append(node);
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      lede.append(node);
    }
  });

  [eyebrow, title, lede, chips].forEach((part) => {
    if (part.children.length) copy.append(part);
  });
  if (media.children.length) grid.append(media);
  grid.append(copy);
  block.replaceChildren(grid);
  revealAll([[media, 0], [copy, 0.1]]);
}
