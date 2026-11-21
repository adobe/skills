/**
 * Intro — template-slotted from the gated prototype (`section.intro`).
 *
 * Authored rows (any cell layout; flattened single-cell content is read the same way):
 *   - a short paragraph BEFORE the heading → eyebrow
 *   - the statement heading (italic run = the terracotta accent)
 *   - body paragraphs AFTER the heading → right-hand column
 *   - a plain link paragraph → the arrow link ("See how it learns")
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

const isLinkP = (n) => n.tagName === 'P' && n.querySelector('a')
  && n.textContent.trim() === n.querySelector('a').textContent.trim();

/** the source CTA arrow is text: append span.arrow[aria-hidden] "→" (re-entrant) */
function addArrows(scope) {
  scope.querySelectorAll('.intro-link a[href]').forEach((a) => {
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
  if (!document.getElementById('intro')) block.id = 'intro';

  const nodes = collectNodes(block);
  const grid = el('div', 'container intro-grid');
  const lead = el('div', 'intro-lead');
  const eyebrow = el('div', 'eyebrow');
  const statement = el('div', 'intro-statement');
  const body = el('div', 'intro-body');
  const copy = el('div', 'intro-copy');
  const link = el('div', 'link-wrap intro-link');
  let seenHeading = false;

  nodes.forEach((node) => {
    if (/^H[1-6]$/.test(node.tagName) && !seenHeading) {
      statement.append(node);
      seenHeading = true;
    } else if (isLinkP(node) && seenHeading) {
      link.append(node);
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      copy.append(node);
    }
  });

  if (eyebrow.children.length) lead.append(eyebrow);
  lead.append(statement);
  body.append(copy);
  if (link.children.length) body.append(link);
  grid.append(lead, body);
  block.replaceChildren(grid);
  addArrows(block);
  revealAll([[lead, 0], [body, 0.1]]);
}
