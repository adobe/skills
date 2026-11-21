/**
 * Fréscopa closing CTA — promise line (an <em> run is the accent), sub line,
 * CTA paragraphs (<strong> link = primary, <em> link = secondary).
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

export default function decorate(block) {
  const paras = [...block.querySelectorAll('p')].filter((p) => p.textContent.trim());
  const ctas = paras.filter((p) => p.querySelector('a'));
  const texts = paras.filter((p) => !ctas.includes(p));
  const inner = el('div', 'container cta-inner');
  const heading = block.querySelector('h1, h2, h3');
  if (heading) {
    const w = wrap(heading, 'cta-promise');
    reveal(w);
    inner.append(w);
  }
  texts.forEach((p, i) => {
    const promise = i === 0 && !heading;
    const w = wrap(p, promise ? 'cta-promise' : 'cta-sub');
    reveal(w, promise ? 0 : 0.08);
    inner.append(w);
  });
  if (ctas.length) {
    const actions = el('div', 'cta-actions');
    ctas.forEach((p) => {
      actions.append(p);
      addArrow(p.querySelector('a.primary, strong a'));
    });
    reveal(actions, 0.16);
    inner.append(actions);
  }
  block.replaceChildren(inner);
}
