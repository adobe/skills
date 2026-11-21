/**
 * Fréscopa voices — testimonials: an eyebrow row, then one row per quote:
 * quote | attribution. The first quote is the large lead; the rest form a grid.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function wrap(node, cls, tag = 'div') {
  const w = el(tag, cls);
  if (node) w.append(node);
  return w;
}

function reveal(node, delay = 0) {
  node.classList.add('reveal');
  if (delay) node.style.setProperty('--reveal-delay', `${delay}s`);
  if (!('IntersectionObserver' in window) || reduced()) {
    node.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  io.observe(node);
}

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const quoteRows = rows.filter((r) => r.children.length >= 2);
  const eyebrowRows = rows.filter((r) => !quoteRows.includes(r));
  const container = el('div', 'container');
  eyebrowRows.forEach((row) => {
    row.querySelectorAll('p').forEach((p) => {
      const w = wrap(p, 'eyebrow');
      reveal(w);
      container.append(w);
    });
  });
  const grid = el('div', 'voices-grid');
  quoteRows.forEach((row, i) => {
    const [quoteCell, citeCell] = row.children;
    const quote = el('blockquote', i === 0 ? 'voices-lead' : 'voices-item');
    quote.append(...quoteCell.childNodes);
    const cite = el('div', 'voices-cite');
    if (citeCell) cite.append(...citeCell.childNodes);
    quote.append(cite);
    if (i === 0) {
      reveal(quote, 0.06);
      container.append(quote);
    } else {
      reveal(quote, (i - 1) * 0.1);
      grid.append(quote);
    }
  });
  if (grid.children.length) container.append(grid);
  block.replaceChildren(container);
}
