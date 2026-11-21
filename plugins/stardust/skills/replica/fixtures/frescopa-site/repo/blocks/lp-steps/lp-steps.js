/**
 * lp-steps — "How it actually works": head, four numbered steps and a privacy note
 * (prototype section.lp-steps#how), template-slotted head, reconstructive steps.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-steps.
 *
 * Authored rows:
 *   1. head — eyebrow <p> → <h2> → lede <p>
 *   2..n. one step per row — number <p> → <h3> title → <p> text
 *   last. a row with no heading — the note <p> under the grid
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
  if (section && !section.id) section.id = 'how';
  const rows = [...block.querySelectorAll(':scope > div')];
  const headRow = rows.find((r) => r.querySelector('h2')) || rows[0];
  const stepRows = rows.filter((r) => r !== headRow && r.querySelector('h3, h4'));
  const noteRows = rows.filter((r) => r !== headRow && !stepRows.includes(r));

  const head = document.createElement('div');
  head.className = 'lp-head lp-head-steps';
  let seenHeading = false;
  cellNodes(headRow).forEach((n) => {
    if (isHeading(n)) {
      seenHeading = true;
      head.append(wrapNode(n, 'lp-h2'));
    } else {
      head.append(wrapNode(n, seenHeading ? 'lp-head-lede' : 'eyebrow'));
    }
  });

  const grid = document.createElement('ol');
  grid.className = 'lp-steps-grid';
  stepRows.forEach((row) => {
    const step = document.createElement('li');
    step.className = 'lp-step';
    let seen = false;
    cellNodes(row).forEach((n) => {
      if (isHeading(n)) {
        seen = true;
        step.append(wrapNode(n, 'lp-step-title'));
      } else {
        step.append(wrapNode(n, seen ? 'lp-step-text' : 'lp-step-num'));
      }
    });
    grid.append(step);
  });

  const container = document.createElement('div');
  container.className = 'container';
  container.append(head, grid);
  noteRows.forEach((row) => {
    cellNodes(row).forEach((n) => container.append(wrapNode(n, 'lp-steps-note')));
  });
  block.replaceChildren(container);
}
