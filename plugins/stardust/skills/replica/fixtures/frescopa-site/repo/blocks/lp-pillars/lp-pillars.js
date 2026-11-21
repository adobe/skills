/**
 * lp-pillars — "Ritual, meet intelligence" head + three pillar cards
 * (prototype section.lp-pillars#learn), template-slotted head, reconstructive cards.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-pillars.
 *
 * Authored rows:
 *   1. head — eyebrow <p> → <h2>
 *   2..n. one card per row — <h3> title → <p> text
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')];

export default function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'learn';
  const rows = [...block.querySelectorAll(':scope > div')];
  const headRow = rows.find((r) => r.querySelector('h2')) || rows[0];
  const cardRows = rows.filter((r) => r !== headRow && r.querySelector('h3, h4, p'));

  const head = document.createElement('div');
  head.className = 'lp-head lp-head-narrow';
  cellNodes(headRow).forEach((n) => {
    head.append(wrapNode(n, isHeading(n) ? 'lp-h2' : 'eyebrow'));
  });

  const grid = document.createElement('div');
  grid.className = 'lp-pillars-grid';
  cardRows.forEach((row) => {
    const card = document.createElement('div');
    card.className = 'lp-card';
    cellNodes(row).forEach((n) => {
      card.append(wrapNode(n, isHeading(n) ? 'lp-card-title' : 'lp-card-text'));
    });
    grid.append(card);
  });

  const container = document.createElement('div');
  container.className = 'container';
  container.append(head, grid);
  block.replaceChildren(container);
}
