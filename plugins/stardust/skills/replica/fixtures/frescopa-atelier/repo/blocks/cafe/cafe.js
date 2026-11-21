/**
 * Fréscopa café band — full-bleed image with a scrim and a copy column.
 * Authored: an image; eyebrow <p>, <h2>, body <p>, CTA paragraph (<strong> link).
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function addArrow(host) {
  if (!host || host.querySelector('.arrow') || /→\s*$/.test(host.textContent)) return;
  const span = document.createElement('span');
  span.className = 'arrow';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = '→';
  host.append(' ', span);
}

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

function parallax(img, amount) {
  if (!img || reduced() || window.matchMedia('(hover: none)').matches) return;
  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    const r = img.getBoundingClientRect();
    const progress = (r.top + r.height / 2 - vh / 2) / vh;
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

const precedes = (heading) => (n) => !!heading
  && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;

export default function decorate(block) {
  const picture = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2, h3');
  const isBefore = precedes(heading);
  const paras = [...block.querySelectorAll('p')]
    .filter((p) => !p.querySelector('picture, img') && p.textContent.trim());
  const media = el('div', 'cafe-media');
  if (picture) media.append(picture);
  media.append(el('div', 'cafe-scrim'));
  const inner = el('div', 'container cafe-inner');
  paras.filter(isBefore).forEach((p) => inner.append(wrap(p, 'eyebrow eyebrow-light')));
  if (heading) inner.append(wrap(heading, 'cafe-title'));
  paras.filter((p) => !isBefore(p)).forEach((p) => {
    inner.append(p.querySelector('a') ? wrap(p, 'cafe-actions') : wrap(p, 'cafe-body'));
    addArrow(p.querySelector('a.primary, strong a'));
  });
  reveal(inner);
  block.replaceChildren(media, inner);
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'cafe';
  parallax(media.querySelector('img'), 14);
}
