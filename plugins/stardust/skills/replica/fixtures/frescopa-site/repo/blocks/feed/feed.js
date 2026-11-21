/**
 * feed — "This week, for you" product cards (prototype section.feed).
 * Schema: stardust/eds-schema/frescopa-atelier.json § feed. Head template-slotted,
 * cards reconstructive (one row per card, any field order).
 *
 * Authored rows:
 *   1. head — eyebrow <p> → <h2> → intro <p>
 *   2..n. one row per card: photo, category <p>, title <h3>, note <p>, price <p> (£14),
 *      action label <p> (Add to cart — an inert control, as on the source)
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

// trailing arrow glyph of the canon .link (a separate element, never edits the authored text)
function appendArrow(el) {
  if (el.querySelector('.arrow') || /→\s*$/.test(el.textContent)) return;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  if (!document.body.classList.contains('app')) el.append(' ');
  el.append(arrow);
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const isMedia = (el) => el.matches('picture, img') || !!el.querySelector('picture, img');
const isPrice = (el) => /^[£$€]\s?\d/.test(el.textContent.trim());

// cells may arrive folded into one <p> by wrapTextNodes (#104) — expand them
function cellNodes(row) {
  const out = [];
  row.querySelectorAll(':scope > div').forEach((cell) => {
    const kids = [...cell.children];
    if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].querySelector('picture, img')
      && kids[0].children.length > 1) {
      out.push(...kids[0].children);
    } else {
      out.push(...kids);
    }
  });
  return out;
}

function buildCard(nodes) {
  const card = document.createElement('article');
  card.className = 'card';
  const media = document.createElement('div');
  media.className = 'card-media';
  const body = document.createElement('div');
  body.className = 'card-body';
  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const hIdx = nodes.findIndex(isHeading);
  const rest = [];
  nodes.forEach((n, i) => {
    if (isMedia(n)) {
      media.prepend(n.querySelector('picture') || n);
    } else if (isHeading(n)) {
      body.append(wrapNode(n, 'card-title'));
    } else if (hIdx > -1 && i < hIdx) {
      media.append(wrapNode(n, 'card-cat'));
    } else if (isPrice(n)) {
      foot.append(wrapNode(n, 'card-price'));
    } else {
      rest.push(n);
    }
  });
  // after the heading: the note(s), then the action label (the last short line after the price)
  const priceSeen = foot.children.length > 0;
  const action = priceSeen ? rest.pop() : null;
  rest.forEach((n) => body.append(wrapNode(n, 'card-note')));
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link link-sm';
    btn.append(action);
    appendArrow(btn);
    foot.append(btn);
  }
  if (foot.children.length) body.append(foot);
  card.append(media, body);
  return card;
}

export default async function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'feed';
  const rows = [...block.querySelectorAll(':scope > div')];
  const cardRows = rows.filter((r) => r.querySelector('picture, img') || r.querySelector('h3, h4'));
  const headRows = rows.filter((r) => !cardRows.includes(r));

  const head = document.createElement('div');
  head.className = 'feed-head';
  const headLead = document.createElement('div');
  let seenHeading = false;
  headRows.forEach((row) => cellNodes(row).forEach((n) => {
    if (isHeading(n)) {
      seenHeading = true;
      headLead.append(wrapNode(n, 'feed-title'));
    } else if (!seenHeading) {
      headLead.append(wrapNode(n, 'eyebrow'));
    } else {
      head.append(wrapNode(n, 'feed-intro'));
    }
  }));
  head.prepend(headLead);

  const grid = document.createElement('div');
  grid.className = 'feed-grid';
  const cards = cardRows.map((row) => buildCard(cellNodes(row)));
  grid.append(...cards);

  const container = document.createElement('div');
  container.className = 'container';
  container.append(head, grid);
  block.replaceChildren(container);

  const w = await loadWidgets();
  if (!w) return;
  w.reveal(head);
  cards.forEach((c, i) => w.reveal(c, i * 0.1));
}
