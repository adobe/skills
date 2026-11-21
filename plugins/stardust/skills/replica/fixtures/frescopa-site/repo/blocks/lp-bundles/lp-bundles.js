/**
 * lp-bundles — "Ways to buy": head + three bundle cards (prototype section.lp-bundles#bundles),
 * template-slotted head, reconstructive cards.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-bundles.
 *
 * Authored rows:
 *   1. head — eyebrow <p> → <h2>
 *   2..n. one bundle per row:
 *      [badge <p> before the title — marks the featured bundle] → <h3> title → text <p>
 *      → price <p> → [old price <p> in <s> (struck) | a saving <p>] → CTA <p>
 *      (<strong><a> on the featured bundle, <em><a> ghost on the others)
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')];

function buildBundle(row) {
  const card = document.createElement('div');
  card.className = 'bundle';
  const nodes = cellNodes(row);
  const hIdx = nodes.findIndex(isHeading);
  const price = document.createElement('div');
  price.className = 'bundle-price';
  let textDone = false;
  nodes.forEach((n, j) => {
    if (hIdx > -1 && j < hIdx) {
      card.classList.add('bundle-featured');
      card.append(wrapNode(n, 'bundle-badge'));
    } else if (j === hIdx) {
      card.append(wrapNode(n, 'bundle-title'));
    } else if (n.querySelector('a')) {
      if (price.children.length) card.append(price);
      card.append(wrapNode(n, 'bundle-cta'));
    } else if (!textDone) {
      textDone = true;
      card.append(wrapNode(n, 'bundle-text'));
    } else if (!price.children.length) {
      price.append(wrapNode(n, 'bundle-amount'));
    } else {
      price.append(wrapNode(n, n.querySelector('s, del') ? 'bundle-was' : 'bundle-save'));
    }
  });
  if (price.children.length && !price.parentElement) card.append(price);
  return card;
}

export default function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'bundles';
  const rows = [...block.querySelectorAll(':scope > div')];
  const headRow = rows.find((r) => r.querySelector('h2')) || rows[0];
  const bundleRows = rows.filter((r) => r !== headRow && r.querySelector('h3, h4'));

  const head = document.createElement('div');
  head.className = 'lp-head lp-head-narrow';
  cellNodes(headRow).forEach((n) => {
    head.append(wrapNode(n, isHeading(n) ? 'lp-h2' : 'eyebrow'));
  });

  const grid = document.createElement('div');
  grid.className = 'lp-bundles-grid';
  bundleRows.forEach((row) => grid.append(buildBundle(row)));

  const container = document.createElement('div');
  container.className = 'container';
  container.append(head, grid);
  block.replaceChildren(container);
}
