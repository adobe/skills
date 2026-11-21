/**
 * Hero — template-slotted from the gated prototype (`section.hero`).
 *
 * Authored rows (any cell order; flattened single-cell content is read the same way):
 *   - an image (the art-directed background photograph)
 *   - a short paragraph BEFORE the heading → eyebrow
 *   - the heading (the page's single h1)
 *   - paragraphs AFTER the heading → lead
 *   - button paragraphs (bold link = terracotta, italic link = ghost) → actions
 *   - a plain link paragraph → the scroll cue (e.g. "Scroll" → #intro)
 *
 * Behaviour carried from the source (hero.js / app.js): art direction at ≥ 760 px — the copy
 * top aligns to the product top and the copy column stops at the product's left edge (focal
 * 50% 44%, product-top 0.20, product-left 0.43, gap 28, column 280–560); 12 px parallax on the
 * photograph for pointer devices; scroll reveal on the copy.
 *
 * Harness-only fallback (EW5): a cell holding bare text with no element is wrapped by moving
 * its text nodes into a <p>; DA content always delivers elements, so it never fires there.
 *
 * @ew-exempt "→" — decorative CTA arrow (aria-hidden), appended as text as on the source.
 */

const ART = {
  focal: '50% 44%',
  productTop: '0.20',
  productLeft: '0.43',
  parallax: '12',
};
const MOBILE = 760;
const GAP = 28;
const MIN_COL = 280;
const MAX_COL = 560;

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** every authored element of every cell, in order (media-led <p> wrappers expanded) */
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

const isButtonP = (n) => n.tagName === 'P'
  && !!n.querySelector('a.button, strong a, em a, a strong, a em');
const isLinkP = (n) => n.tagName === 'P' && n.querySelector('a')
  && n.textContent.trim() === n.querySelector('a').textContent.trim();

function ratio(v) {
  return v.includes('%') ? parseFloat(v) / 100 : parseFloat(v);
}

/** copy top + column width from the product position (source hero.js) */
function artDirect(hero, img, inner) {
  const { width: cw, height: ch } = hero.getBoundingClientRect();
  if (cw < MOBILE) {
    hero.style.removeProperty('--hero-copy-top');
    hero.style.removeProperty('--hero-copy-max');
    return;
  }
  const [fxs, fys] = ART.focal.split(/\s+/);
  const fx = ratio(fxs);
  const fy = ratio(fys ?? fxs);
  img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
  const iw = img.naturalWidth || parseFloat(img.getAttribute('width')) || 1;
  const ih = img.naturalHeight || parseFloat(img.getAttribute('height')) || 1;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const y = (ch - dh) * fy + parseFloat(ART.productTop) * dh;
  hero.style.setProperty('--hero-copy-top', `${Math.max(0, Math.round(y))}px`);
  const x = (cw - dw) * fx + parseFloat(ART.productLeft) * dw;
  const padL = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
  const left = inner.getBoundingClientRect().left + padL;
  const col = Math.max(MIN_COL, Math.min(MAX_COL, x - left - GAP));
  hero.style.setProperty('--hero-copy-max', `${Math.round(col)}px`);
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

  const nodes = collectNodes(block);
  const media = el('div', 'hero-media');
  const inner = el('div', 'container hero-inner');
  const eyebrow = el('div', 'eyebrow eyebrow-light');
  const title = el('div', 'hero-title');
  const lead = el('div', 'hero-lead');
  const actions = el('div', 'hero-actions');
  const scroll = el('div', 'hero-scroll');
  let picture = null;
  let seenHeading = false;

  nodes.forEach((node) => {
    const pic = node.matches('picture, img') ? node : node.querySelector('picture, img');
    if (pic && !picture) {
      picture = pic;
      media.append(pic);
      if (node !== pic && !node.textContent.trim() && !node.querySelector('picture, img')) {
        node.remove();
      }
      return;
    }
    if (/^H[1-6]$/.test(node.tagName)) {
      if (!seenHeading) title.append(node);
      else lead.append(node);
      seenHeading = true;
    } else if (isButtonP(node)) {
      actions.append(node);
    } else if (isLinkP(node) && !scroll.children.length) {
      scroll.append(node);
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      lead.append(node);
    }
  });

  media.append(el('div', 'hero-scrim'));
  [eyebrow, title, lead, actions].forEach((part) => {
    if (part.children.length) inner.append(part);
  });
  block.replaceChildren(media, inner);

  if (scroll.children.length) {
    const link = scroll.querySelector('a');
    link.setAttribute('aria-label', 'Scroll to explore');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M12 5v14M6 13l6 6 6-6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    scroll.append(svg);
    scroll.addEventListener('click', (e) => {
      if (!e.target.closest('a')) link.click();
    });
    block.append(scroll);
  }

  addArrows(block);
  revealAll([[eyebrow, 0], [title, 0.08], [lead, 0.16], [actions, 0.24]]);

  const img = media.querySelector('img');
  if (!img) return;
  img.dataset.heroFocal = ART.focal;
  img.dataset.heroProductTop = ART.productTop;
  img.dataset.heroProductLeft = ART.productLeft;
  img.dataset.parallax = ART.parallax;
  img.setAttribute('fetchpriority', 'high');
  img.loading = 'eager';

  const run = () => artDirect(block, img, inner);
  if (!img.complete) img.addEventListener('load', run, { once: true });
  requestAnimationFrame(run);
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(run, 120);
  }, { passive: true });
  parallax(img);
}
