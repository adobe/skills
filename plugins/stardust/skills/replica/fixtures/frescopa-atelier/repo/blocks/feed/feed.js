/**
 * Fréscopa feed — section head + product cards.
 * Authored rows: row 1 = eyebrow <p>, <h2> | intro <p>; then one row per card:
 * image | category <p>, <h3> title, note <p>, price <p>, action <p>.
 * Cards are classified by content (heading, price pattern, order), never by row index.
 * The action ("Add to cart") is inert, as on the source (dynamic-features x-commerce).
 */

const PRICE = /^\s*[£$€]\s?\d/;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function addArrow(host) {
  if (!host || host.querySelector('.arrow') || /→\s*$/.test(host.textContent)) return;
  const span = document.createElement('span');
  span.className = 'arrow';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = '→';
  host.append(' ', span);
}

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function wrap(node, cls) {
  const w = el('div', cls);
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

function buildCard(row) {
  const picture = row.querySelector('picture') || row.querySelector('img');
  const heading = row.querySelector('h2, h3, h4');
  const paras = [...row.querySelectorAll('p')]
    .filter((p) => !p.querySelector('picture, img') && p.textContent.trim());
  const isBefore = (n) => heading
    && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;
  const cats = paras.filter(isBefore);
  const after = paras.filter((p) => !cats.includes(p));
  const price = after.find((p) => PRICE.test(p.textContent));
  const rest = after.filter((p) => p !== price);
  // the action is the paragraph that follows the price
  const action = price ? rest.find((p) => (price.compareDocumentPosition(p) % 8) >= 4) : null;
  const notes = rest.filter((p) => p !== action);

  const card = el('article', 'card');
  const media = el('div', 'card-media');
  if (picture) media.append(picture);
  cats.forEach((p) => media.append(wrap(p, 'card-cat')));
  const body = el('div', 'card-body');
  if (heading) body.append(wrap(heading, 'card-title'));
  const note = el('div', 'card-note');
  notes.forEach((p) => note.append(p));
  body.append(note);
  const foot = el('div', 'card-foot');
  if (price) foot.append(wrap(price, 'card-price'));
  if (action) {
    const btn = wrap(action, 'card-action');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    addArrow(btn);
    foot.append(btn);
  }
  body.append(foot);
  card.append(media, body);
  return card;
}

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const cardRows = rows.filter((r) => r.querySelector('picture, img'));
  const headRows = rows.filter((r) => !cardRows.includes(r));

  const head = el('div', 'feed-head');
  const title = el('div');
  const intro = el('div', 'feed-intro');
  headRows.forEach((row) => {
    const heading = row.querySelector('h1, h2, h3');
    const isBefore = (n) => heading
      && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;
    [...row.querySelectorAll('p, h1, h2, h3')].forEach((n) => {
      if (n === heading) title.append(wrap(n, 'feed-heading'));
      else if (isBefore(n)) title.append(wrap(n, 'eyebrow'));
      else intro.append(n);
    });
  });
  head.append(title, intro);
  reveal(head);

  const grid = el('div', 'feed-grid');
  cardRows.forEach((row, i) => {
    const card = buildCard(row);
    reveal(card, i * 0.1);
    grid.append(card);
  });

  const container = el('div', 'container');
  container.append(head, grid);
  block.replaceChildren(container);
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'feed';
}
