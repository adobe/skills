/**
 * Fréscopa sustain — image + copy split.
 * Authored: an image; eyebrow <p>, <h2>, lede <p>, chips <ul>.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function wrap(node, cls, tag = 'div') {
  const w = el(tag, cls);
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

const precedes = (heading) => (n) => !!heading
  && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;

export default function decorate(block) {
  const picture = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2, h3');
  const isBefore = precedes(heading);
  const copy = el('div');
  let ledeDone = false;
  [...block.querySelectorAll('p, ul, ol, h1, h2, h3')].forEach((n) => {
    if (n.querySelector('picture, img') || n.closest('li')) return;
    if (n.tagName === 'P' && !n.textContent.trim()) return;
    if (n === heading) copy.append(wrap(n, 'sustain-heading'));
    else if (n.tagName === 'UL' || n.tagName === 'OL') copy.append(wrap(n, 'chips'));
    else if (isBefore(n)) copy.append(wrap(n, 'eyebrow'));
    else if (!ledeDone) {
      copy.append(wrap(n, 'lede'));
      ledeDone = true;
    } else copy.append(n);
  });
  const media = wrap(picture, 'sustain-media');
  reveal(media);
  reveal(copy, 0.1);
  const split = el('div', 'container split');
  split.append(media, copy);
  block.replaceChildren(split);
}
