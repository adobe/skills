/**
 * lp-reviews — "What owners say": head + score, three review cards
 * (prototype section.lp-reviews#reviews), template-slotted head, reconstructive cards.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-reviews.
 *
 * Authored rows:
 *   1. head — eyebrow <p> → <h2>
 *   2. score — the score <p> (4.8, a number on its own) → the count <p>
 *   3..n. one review per row — quote <p> → attribution <p>
 * The amber stars are decorative chrome (aria-hidden), added by the block.
 */

const star = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" `
  + 'fill="var(--amber)" aria-hidden="true"><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8'
  + '-5.4 2.8 1-6L3.3 9.4l6-.9z"/></svg>';

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

function stars(size, extra = '') {
  const s = document.createElement('span');
  s.className = `stars${extra}`;
  s.innerHTML = star(size).repeat(5);
  return s;
}

const text = (el) => (el ? el.textContent.trim() : '');
const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')];

export default function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'reviews';
  const rows = [...block.querySelectorAll(':scope > div')];
  const headRow = rows.find((r) => r.querySelector('h2')) || rows[0];
  const rest = rows.filter((r) => r !== headRow && text(r));
  const scoreRow = rest.find((r) => /^\d+([.,]\d+)?$/.test(text(cellNodes(r)[0])));
  const reviewRows = rest.filter((r) => r !== scoreRow);

  const head = document.createElement('div');
  head.className = 'lp-head lp-head-short';
  cellNodes(headRow).forEach((n) => {
    head.append(wrapNode(n, isHeading(n) ? 'lp-h2' : 'eyebrow'));
  });
  const top = document.createElement('div');
  top.className = 'lp-reviews-head';
  top.append(head);
  if (scoreRow) {
    const score = document.createElement('div');
    score.className = 'lp-reviews-score';
    const [num, ...counts] = cellNodes(scoreRow);
    score.append(wrapNode(num, 'lp-reviews-num'), stars(18, ' stars-lg'));
    counts.forEach((n) => score.append(wrapNode(n, 'lp-reviews-count')));
    top.append(score);
  }

  const grid = document.createElement('div');
  grid.className = 'lp-reviews-grid';
  reviewRows.forEach((row) => {
    const fig = document.createElement('figure');
    fig.className = 'review';
    const [quote, ...by] = cellNodes(row);
    fig.append(stars(16));
    if (quote) fig.append(wrapNode(quote, 'review-quote'));
    by.forEach((n) => fig.append(wrapNode(n, 'review-by')));
    grid.append(fig);
  });

  const container = document.createElement('div');
  container.className = 'container';
  container.append(top, grid);
  block.replaceChildren(container);
}
