/**
 * Café — full-bleed photograph band with copy and a cream CTA (prototype `section.cafe`).
 *
 * Authored rows (any cell layout; flattened single-cell content is read the same way):
 *   - an image (the band's photograph)
 *   - eyebrow paragraph (before the heading), heading, body paragraph(s)
 *   - a button paragraph (bold + italic link = cream button)
 *
 * Behaviour carried from the source (app.js): 14 px parallax on the photograph for pointer
 * devices; scroll reveal on the copy.
 *
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 *
 * @ew-exempt "→" — decorative CTA arrow (aria-hidden), appended as text as on the source.
 */

const PARALLAX = '14';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function collectNodes(block) {
  const out = [];
  block.querySelectorAll(':scope > div > div').forEach((cell) => {
    let kids = [...cell.children];
    if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].querySelector('picture, img')
      && kids[0].textContent.trim()) {
      kids = [...kids[0].children];
    }
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

function parallax(img) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || window.matchMedia('(hover: none)').matches) return;
  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    const rect = img.getBoundingClientRect();
    const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
    const amount = parseFloat(img.dataset.parallax) || 24;
    img.style.transform = `translate3d(0,${(-progress * amount).toFixed(1)}px,0)`;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

const isButtonP = (n) => n.tagName === 'P'
  && !!n.querySelector('a.button, strong a, em a, a strong, a em');

/** the source CTA arrow is text: append span.arrow[aria-hidden] "→" (re-entrant) */
function addArrows(scope) {
  scope.querySelectorAll('a.button.primary, a.button.accent').forEach((a) => {
    if (a.querySelector('.arrow')) return;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.append('→');
    a.append(arrow);
  });
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';
  if (!document.getElementById('cafe')) block.id = 'cafe';

  const nodes = collectNodes(block);
  const media = el('div', 'cafe-media');
  const inner = el('div', 'container cafe-inner');
  const eyebrow = el('div', 'eyebrow eyebrow-light');
  const title = el('div', 'cafe-title');
  const body = el('div', 'cafe-body');
  const actions = el('div', 'cafe-actions');
  let seenHeading = false;
  let picture = null;

  nodes.forEach((node) => {
    const pic = node.matches('picture, img') ? node : node.querySelector('picture, img');
    if (pic && !picture) {
      picture = pic;
      media.append(pic);
      if (node !== pic && !node.textContent.trim()) node.remove();
    } else if (/^H[1-6]$/.test(node.tagName) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (isButtonP(node)) {
      actions.append(node);
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      body.append(node);
    }
  });

  media.append(el('div', 'cafe-scrim'));
  [eyebrow, title, body, actions].forEach((part) => {
    if (part.children.length) inner.append(part);
  });
  block.replaceChildren(media, inner);
  addArrows(block);
  revealAll([[inner, 0]]);

  const img = media.querySelector('img');
  if (img) {
    img.dataset.parallax = PARALLAX;
    parallax(img);
  }
}
