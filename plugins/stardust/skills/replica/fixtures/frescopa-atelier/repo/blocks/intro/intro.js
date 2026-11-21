/**
 * Fréscopa intro — two-column statement band.
 * Authored: eyebrow <p>, <h2> (an <em> run is the accent), body <p>s, a link paragraph.
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

export default function decorate(block) {
  const heading = block.querySelector('h1, h2, h3');
  const paras = [...block.querySelectorAll('p')].filter((p) => p.textContent.trim());
  const links = paras.filter((p) => p.querySelector('a'));
  const texts = paras.filter((p) => !links.includes(p));
  const isBefore = (p) => heading
    && (heading.compareDocumentPosition(p) % 4) === Node.DOCUMENT_POSITION_PRECEDING;

  const head = el('div');
  texts.filter(isBefore).forEach((p) => head.append(wrap(p, 'eyebrow')));
  if (heading) head.append(wrap(heading, 'intro-statement'));
  reveal(head);

  const body = el('div', 'intro-body');
  texts.filter((p) => !isBefore(p)).forEach((p) => body.append(p));
  links.forEach((p) => {
    body.append(wrap(p, 'text-link'));
    addArrow(p.querySelector('a'));
  });
  reveal(body, 0.1);

  const grid = el('div', 'container intro-grid');
  grid.append(head, body);
  block.replaceChildren(grid);
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'intro';
}
