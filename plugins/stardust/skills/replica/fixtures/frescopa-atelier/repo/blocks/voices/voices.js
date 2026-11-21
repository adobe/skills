/**
 * Voices — testimonials (prototype `section.voices`).
 *
 * Authored rows: an eyebrow paragraph, then one row per quote: | quote | attribution |.
 * The first quote is the large lead; the rest form the two-up grid below the rule.
 * Classified by content (a quote paragraph opens with a quotation mark; the paragraph after it
 * is its attribution), so a flattened single cell decodes the same way.
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

const QUOTE = /^\s*["“‘«„]/;

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';

  const nodes = collectNodes(block);
  const container = el('div', 'container');
  const eyebrow = el('div', 'eyebrow');
  const quotes = [];
  let current = null;
  nodes.forEach((node) => {
    if (node.tagName === 'BLOCKQUOTE' || QUOTE.test(node.textContent)) {
      current = { quote: el('div', 'voices-quote'), cite: el('div', 'voices-cite') };
      current.quote.append(node);
      quotes.push(current);
    } else if (!current) {
      eyebrow.append(node);
    } else if (!current.cite.children.length) {
      current.cite.append(node);
    } else {
      current.quote.append(node);
    }
  });

  const reveals = [];
  if (eyebrow.children.length) {
    container.append(eyebrow);
    reveals.push([eyebrow, 0]);
  }
  const grid = el('div', 'voices-grid');
  quotes.forEach((q, i) => {
    const bq = el('blockquote', i ? 'voices-item' : 'voices-lead');
    bq.append(q.quote);
    if (q.cite.children.length) bq.append(q.cite);
    if (i) {
      grid.append(bq);
      reveals.push([bq, (i - 1) * 0.1]);
    } else {
      container.append(bq);
      reveals.push([bq, 0.06]);
    }
  });
  if (grid.children.length) container.append(grid);
  block.replaceChildren(container);
  revealAll(reveals);
}
