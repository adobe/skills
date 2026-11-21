/**
 * voices — testimonials (prototype section.voices). Schema:
 * stardust/eds-schema/frescopa-atelier.json § voices. Reconstructive (one row per quote).
 *
 * Authored rows:
 *   1. eyebrow <p>
 *   2..n. one row per quote: the quote <p> (accent in <em>), then the attribution <p>.
 *      The first quote renders as the large lead quote, the rest as the two-up grid.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

function buildQuote(nodes, className) {
  const quote = document.createElement('blockquote');
  quote.className = className;
  const [text, ...rest] = nodes;
  if (text) quote.append(wrapNode(text, 'voices-text'));
  rest.forEach((n) => quote.append(wrapNode(n, 'voices-cite')));
  return quote;
}

export default async function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')]
    .flatMap((n) => (n.tagName === 'BLOCKQUOTE' ? [...n.children] : [n]));
  const quoteRows = rows.filter((r) => cellNodes(r).length >= 2);
  const headRows = rows.filter((r) => !quoteRows.includes(r));

  const container = document.createElement('div');
  container.className = 'container';
  const heads = [];
  headRows.forEach((r) => cellNodes(r).forEach((n) => {
    const eyebrow = wrapNode(n, 'eyebrow');
    heads.push(eyebrow);
    container.append(eyebrow);
  }));
  const quotes = quoteRows.map((r, i) => buildQuote(cellNodes(r), i === 0 ? 'voices-lead' : 'voices-item'));
  const items = quotes.slice(1);
  if (quotes[0]) container.append(quotes[0]);
  if (items.length) {
    const grid = document.createElement('div');
    grid.className = 'voices-grid';
    grid.append(...items);
    container.append(grid);
  }
  block.replaceChildren(container);

  const w = await loadWidgets();
  if (!w) return;
  heads.forEach((h) => w.reveal(h));
  if (quotes[0]) w.reveal(quotes[0], 0.06);
  items.forEach((q, i) => w.reveal(q, i * 0.1));
}
