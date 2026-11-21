/**
 * CTA — closing promise band on charcoal (prototype `section.cta`).
 *
 * Authored rows (any cell layout; flattened single-cell content is read the same way):
 *   - the promise paragraph (italic run = the amber accent)
 *   - the sub paragraph
 *   - button paragraphs (bold link = terracotta, italic link = ghost on dark)
 * Text paragraphs are classified by order: the first is the promise, the rest the sub line.
 *
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 *
 * @ew-exempt "→" — decorative CTA arrow (aria-hidden), appended as text as on the source.
 */

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    const kids = [...cell.children];
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

const isButtonP = (n) => n.tagName === 'P'
  && !!n.querySelector('a.button, strong a, em a, a strong, a em');

/** the source CTA arrow is text: append span.arrow[aria-hidden] "→" (re-entrant) */
function addArrows(scope) {
  scope.querySelectorAll('a.button.primary, a.button.accent').forEach((a) => {
    if (a.querySelector('.arrow')) return;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.append('→');
    a.append(arrow);
  });
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';

  const nodes = collectNodes(block);
  const inner = el('div', 'container cta-inner');
  const promise = el('div', 'cta-promise');
  const sub = el('div', 'cta-sub');
  const actions = el('div', 'cta-actions');
  nodes.forEach((node) => {
    if (isButtonP(node)) actions.append(node);
    else if (!promise.children.length) promise.append(node);
    else sub.append(node);
  });
  [promise, sub, actions].forEach((part) => {
    if (part.children.length) inner.append(part);
  });
  block.replaceChildren(inner);
  addArrows(block);
  revealAll([[promise, 0], [sub, 0.08], [actions, 0.16]]);
}
