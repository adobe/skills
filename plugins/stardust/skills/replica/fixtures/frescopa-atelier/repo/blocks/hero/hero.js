/**
 * Fréscopa hero — template-slotted, cinematic lead.
 * Authored: an image, then eyebrow <p>, <h1>, lead <p>, CTA paragraphs
 * (<strong> link = primary, <em> link = secondary), in any cell layout.
 * Behaviour (source hero.js / app.js): art-directed copy column computed from the
 * image's product position (object-fit: cover math), image parallax, scroll reveal.
 */

const FOCAL = [0.5, 0.44];
const PRODUCT_TOP = 0.2;
const PRODUCT_LEFT = 0.43;
const PARALLAX = 12;

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

function parallax(img) {
  if (!img || reduced() || window.matchMedia('(hover: none)').matches) return;
  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    const r = img.getBoundingClientRect();
    const progress = (r.top + r.height / 2 - vh / 2) / vh;
    img.style.transform = `translate3d(0,${(-progress * PARALLAX).toFixed(1)}px,0)`;
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

function artDirect(block, img, inner) {
  const apply = () => {
    const { width: cw, height: ch } = block.getBoundingClientRect();
    if (cw < 760) {
      block.style.removeProperty('--hero-copy-top');
      block.style.removeProperty('--hero-copy-max');
      return;
    }
    const [fx, fy] = FOCAL;
    img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
    const iw = img.naturalWidth || 1408;
    const ih = img.naturalHeight || 768;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const top = (ch - dh) * fy + PRODUCT_TOP * dh;
    block.style.setProperty('--hero-copy-top', `${Math.max(0, Math.round(top))}px`);
    const x = (cw - dw) * fx + PRODUCT_LEFT * dw;
    const pad = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
    const left = inner.getBoundingClientRect().left + pad;
    const col = Math.max(280, Math.min(560, x - left - 28));
    block.style.setProperty('--hero-copy-max', `${Math.round(col)}px`);
  };
  if (!img.complete) img.addEventListener('load', apply, { once: true });
  apply();
  // the section is display:none while it loads: re-apply whenever the hero's box changes
  // (first paint, then viewport resizes)
  let lastWidth = -1;
  let lastHeight = -1;
  if ('ResizeObserver' in window) {
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (Math.round(width) === lastWidth && Math.round(height) === lastHeight) return;
      lastWidth = Math.round(width);
      lastHeight = Math.round(height);
      apply();
    }).observe(block);
  } else {
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(apply, 120);
    }, { passive: true });
  }
}

export default function decorate(block) {
  const picture = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2, h3');
  const paras = [...block.querySelectorAll('p')]
    .filter((p) => !p.querySelector('picture, img') && p.textContent.trim());
  const ctas = paras.filter((p) => p.querySelector('a'));
  const texts = paras.filter((p) => !ctas.includes(p));
  const isBefore = (p) => heading
    && (heading.compareDocumentPosition(p) % 4) === Node.DOCUMENT_POSITION_PRECEDING;
  const eyebrows = texts.filter(isBefore);
  const leads = texts.filter((p) => !eyebrows.includes(p));

  const media = el('div', 'hero-media');
  if (picture) media.append(picture);
  media.append(el('div', 'hero-scrim'));

  const inner = el('div', 'container hero-inner');
  eyebrows.forEach((p) => {
    const w = wrap(p, 'eyebrow eyebrow-light');
    reveal(w);
    inner.append(w);
  });
  if (heading) {
    const w = wrap(heading, 'hero-title');
    reveal(w, 0.08);
    inner.append(w);
  }
  leads.forEach((p) => {
    const w = wrap(p, 'hero-lead');
    reveal(w, 0.16);
    inner.append(w);
  });
  if (ctas.length) {
    const actions = el('div', 'hero-actions');
    ctas.forEach((p) => {
      actions.append(p);
      addArrow(p.querySelector('a.primary, strong a'));
    });
    reveal(actions, 0.24);
    inner.append(actions);
  }

  const scroll = el('a', 'hero-scroll', { href: '#intro', 'aria-label': 'Scroll to explore' });
  const label = el('span');
  label.textContent = 'Scroll';
  scroll.append(label);
  scroll.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" width="18" height="18" '
    + 'fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path '
    + 'd="M12 5v14M6 13l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>');

  block.replaceChildren(media, inner, scroll);

  const img = media.querySelector('img');
  if (img) {
    img.loading = 'eager';
    img.setAttribute('fetchpriority', 'high');
    artDirect(block, img, inner);
    parallax(img);
  }
}
