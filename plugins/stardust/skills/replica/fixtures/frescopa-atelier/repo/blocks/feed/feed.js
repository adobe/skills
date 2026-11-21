/**
 * Feed — "This week, for you" head + product cards (prototype `section.feed`).
 *
 * Authored rows:
 *   1. head: eyebrow paragraph (before the heading), heading, intro paragraph.
 *   2..n. one row per card: | image | category, heading, note, price, action label |
 *      The price is the paragraph that starts with a currency sign (or ends with one); the
 *      paragraph after it is the add-to-cart label. A flattened single cell is segmented on
 *      the card heading (the most frequent heading tag after the section heading).
 *
 * Template-slotted (head) + reconstructive (cards). Add to cart is inert, as on the source
 * (no commerce backend — owner decision), and a real <button type="button"> (role parity with
 * the source `<button class="link link--sm">`); the authored label's text moves into it and the
 * source's text arrow `<span class="arrow" aria-hidden="true">→</span>` is appended.
 *
 * @ew-exempt "Add to cart" label — hosted by a real <button> for role parity with the source
 *   (EW7: a button cannot host the layout-view editor); edit the label in the document.
 * @ew-exempt "→" — decorative arrow (aria-hidden), drawn as text as on the source.
 *
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 */

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function cellNodes(cell) {
  let kids = [...cell.children];
  if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].querySelector('picture, img')
    && kids[0].textContent.trim()) {
    kids = [...kids[0].children];
  }
  if (kids.length) return kids;
  if (!cell.textContent.trim()) return [];
  const p = el('p');
  p.append(...cell.childNodes);
  return [p];
}

function arrow() {
  const span = el('span', 'arrow', { 'aria-hidden': 'true' });
  span.append('→');
  return span;
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

const isHeading = (n) => /^H[1-6]$/.test(n.tagName);
const mediaOf = (n) => (n.matches('picture, img') ? n : n.querySelector('picture, img'));
const PRICE = /^\s*([£$€¥]\s?\d|\d[\d.,]*\s?[£$€¥])/;

function buildHead(nodes) {
  const head = el('div', 'feed-head');
  const lead = el('div', 'feed-lead');
  const eyebrow = el('div', 'eyebrow');
  const title = el('div', 'feed-title');
  const intro = el('div', 'feed-intro');
  let seenHeading = false;
  nodes.forEach((node) => {
    if (isHeading(node) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      intro.append(node);
    }
  });
  if (eyebrow.children.length) lead.append(eyebrow);
  lead.append(title);
  head.append(lead);
  if (intro.children.length) head.append(intro);
  return head;
}

function buildCard(nodes) {
  const card = el('article', 'card');
  const media = el('div', 'card-media');
  const cat = el('div', 'card-cat');
  const body = el('div', 'card-body');
  const title = el('div', 'card-title');
  const note = el('div', 'card-note');
  const foot = el('div', 'card-foot');
  const price = el('div', 'card-price');
  const cart = el('button', 'link link-sm card-cart', { type: 'button' });
  let seenHeading = false;
  nodes.forEach((node) => {
    const pic = mediaOf(node);
    if (pic && !media.querySelector('picture, img')) {
      media.append(pic);
      if (node !== pic && !node.textContent.trim()) node.remove();
    } else if (isHeading(node) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (!seenHeading) {
      cat.append(node);
    } else if (!price.children.length && PRICE.test(node.textContent)) {
      price.append(node);
    } else if (price.children.length) {
      // a <button> holds phrasing content only: move the label's inline content, drop the <p>
      if (node.tagName === 'P') {
        if (cart.childNodes.length) cart.append(' ');
        cart.append(...node.childNodes);
        node.remove();
      } else cart.append(node);
    } else {
      note.append(node);
    }
  });
  if (cat.children.length) media.append(cat);
  if (media.children.length) card.append(media);
  [title, note].forEach((part) => {
    if (part.children.length) body.append(part);
  });
  if (price.children.length) foot.append(price);
  if (cart.textContent.trim()) {
    cart.append(arrow());
    foot.append(cart);
  }
  if (foot.children.length) body.append(foot);
  card.append(body);
  return card;
}

/** one node list per card: per row when rows carry the card headings, else per heading */
function segmentCards(rows) {
  const rowGroups = rows.map((r) => [...r.children].flatMap(cellNodes));
  if (rowGroups.filter((g) => g.some(isHeading)).length >= 2) return rowGroups;
  const flat = rowGroups.flat();
  const counts = {};
  flat.filter(isHeading).forEach((h) => { counts[h.tagName] = (counts[h.tagName] || 0) + 1; });
  const tag = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const groups = [];
  let pending = [];
  let state = null; // { nodes, priced, closed }
  flat.forEach((node) => {
    if (node.tagName === tag) {
      state = { nodes: [...pending, node], priced: false, closed: false };
      groups.push(state.nodes);
      pending = [];
    } else if (!state || state.closed || mediaOf(node)) {
      // media and text after a finished card open the NEXT card (buffered until its heading)
      pending.push(node);
    } else {
      state.nodes.push(node);
      if (state.priced) state.closed = true;
      else if (PRICE.test(node.textContent)) state.priced = true;
    }
  });
  if (pending.length && groups.length) groups[groups.length - 1].push(...pending);
  return groups;
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';
  if (!document.getElementById('feed')) block.id = 'feed';

  const rows = [...block.children];
  const headRow = rows.find((r) => r.querySelector('h1, h2')) || null;
  const container = el('div', 'container');
  const head = buildHead(headRow ? [...headRow.children].flatMap(cellNodes) : []);
  const grid = el('div', 'feed-grid');
  const cards = segmentCards(rows.filter((r) => r !== headRow)).map(buildCard);
  cards.forEach((card) => grid.append(card));
  container.append(head, grid);
  block.replaceChildren(container);
  revealAll([[head, 0], ...cards.map((c, i) => [c, i * 0.1])]);
}
