/*
 * Fréscopa — shared interactive layer (lifted from stardust/prototypes/shared/widgets.js,
 * canon.js and the archetype page scripts). Blocks import it lazily:
 *   const w = await import('../../scripts/widgets.js');
 * Every helper is a no-op when its markup is absent and honours reduced motion.
 *   reveal(el, delay)          .reveal → .is-in on view (IO threshold .14, rootMargin -8% bottom)
 *   parallax(el, amount)       subtle translate3d on scroll (app.js initParallax)
 *   whenOnScreen(el, fn)       run fn once el is on screen
 *   initFilterPills(group, cb) one active pill (.is-active + aria-pressed), cb(value, pill)
 *   initFlavorDna(box)         flavour-DNA radar morphing between profiles (flavor-dna.js)
 */
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- Scroll reveal ---- */
let revealObserver;
function getRevealObserver() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  }
  return revealObserver;
}

/**
 * Marks an element as a scroll-reveal target.
 * @param {Element} el element to reveal
 * @param {number} [delay] transition delay in seconds (--reveal-delay)
 */
export function reveal(el, delay = 0) {
  if (!el || reduce || !('IntersectionObserver' in window)) return;
  el.classList.add('reveal');
  if (delay) el.style.setProperty('--reveal-delay', `${delay}s`);
  getRevealObserver().observe(el);
}

/* ---- Subtle parallax (transform only) ---- */
const parallaxItems = new Map();
let parallaxTicking = false;
function updateParallax() {
  const vh = window.innerHeight;
  parallaxItems.forEach((amount, item) => {
    const rect = item.getBoundingClientRect();
    const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
    item.style.transform = `translate3d(0,${(-progress * amount).toFixed(1)}px,0)`;
  });
  parallaxTicking = false;
}
function onParallaxScroll() {
  if (!parallaxTicking) {
    requestAnimationFrame(updateParallax);
    parallaxTicking = true;
  }
}

/**
 * Adds a scroll parallax to an element (skipped on touch-only and reduced-motion).
 * @param {Element} el element to move
 * @param {number} [amount] travel in px (default 24)
 */
export function parallax(el, amount = 24) {
  if (!el || reduce || window.matchMedia('(hover: none)').matches) return;
  if (!parallaxItems.size) {
    window.addEventListener('scroll', onParallaxScroll, { passive: true });
    window.addEventListener('resize', updateParallax, { passive: true });
  }
  parallaxItems.set(el, amount);
  updateParallax();
}

/**
 * Runs fn once the element is on screen.
 * @param {Element} el element to watch
 * @param {Function} fn callback
 */
export function whenOnScreen(el, fn) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if ((r.top < vh && r.bottom > 0) || !('IntersectionObserver' in window)) {
    fn();
    return;
  }
  const obs = new IntersectionObserver((e) => {
    if (e[0].isIntersecting) {
      obs.disconnect();
      fn();
    }
  }, { threshold: 0 });
  obs.observe(el);
}

/**
 * Filter pills: one active pill (.is-active, aria-pressed), the callback filters.
 * Pills are elements carrying data-filter inside the group.
 * @param {Element} group pill container
 * @param {Function} onFilter (value, pill) => void
 */
export function initFilterPills(group, onFilter) {
  if (!group) return;
  const pills = [...group.querySelectorAll('[data-filter]')];
  group.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-filter]');
    if (!pill || !group.contains(pill)) return;
    pills.forEach((p) => {
      const on = p === pill;
      p.classList.toggle('is-active', on);
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (onFilter) onFilter(pill.dataset.filter, pill);
  });
}

/* ---- Flavour DNA radar ---- */
const AXES = ['Strength', 'Body', 'Sweetness', 'Smoothness', 'Warmth', 'Crema'];
const PROFILES = {
  weekday: [0.92, 0.62, 0.34, 0.5, 0.66, 0.82],
  sunday: [0.58, 0.8, 0.6, 0.88, 0.84, 0.62],
  evening: [0.34, 0.7, 0.78, 0.74, 0.9, 0.5],
};
const ORDER = ['weekday', 'sunday', 'evening'];
const SIZE = 420;
const CX = 210;
const CY = 206;
const R = 138;
const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}
function angleFor(i) {
  return -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
}
function pointAt(i, v) {
  const a = angleFor(i);
  return [CX + Math.cos(a) * R * v, CY + Math.sin(a) * R * v];
}
function polygonPath(values) {
  const d = values.map((v, i) => {
    const p = pointAt(i, v);
    return `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)} `;
  }).join('');
  return `${d}Z`;
}
function easeExpo(t) {
  return t === 1 ? 1 : 1 - 2 ** (-10 * t);
}

function buildRadar(svg) {
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.replaceChildren();
  const gridG = svgEl('g', { class: 'dna-grid' });
  [0.25, 0.5, 0.75, 1].forEach((ring) => {
    const pts = AXES.map((_, i) => pointAt(i, ring).map((n) => n.toFixed(1)).join(','));
    gridG.append(svgEl('polygon', {
      points: pts.join(' '),
      fill: 'none',
      stroke: 'var(--dna-grid, rgba(0,0,0,.12))',
      'stroke-width': ring === 1 ? 1.4 : 1,
    }));
  });
  svg.append(gridG);
  const axisG = svgEl('g', { class: 'dna-axes' });
  AXES.forEach((name, i) => {
    const end = pointAt(i, 1);
    const a = angleFor(i);
    axisG.append(svgEl('line', {
      x1: CX,
      y1: CY,
      x2: end[0].toFixed(1),
      y2: end[1].toFixed(1),
      stroke: 'var(--dna-axis, rgba(0,0,0,.15))',
      'stroke-width': 1,
    }));
    let anchor = 'end';
    if (Math.abs(Math.cos(a)) < 0.3) anchor = 'middle';
    else if (Math.cos(a) > 0) anchor = 'start';
    const label = svgEl('text', {
      x: (CX + Math.cos(a) * (R + 26)).toFixed(1),
      y: (CY + Math.sin(a) * (R + 26)).toFixed(1),
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      class: 'dna-label',
      fill: 'var(--dna-label, currentColor)',
    });
    label.textContent = name;
    axisG.append(label);
  });
  svg.append(axisG);
  const area = svgEl('path', {
    d: polygonPath([0, 0, 0, 0, 0, 0]),
    fill: 'var(--dna-fill, rgba(183,97,62,.18))',
    stroke: 'var(--dna-stroke, #b7613e)',
    'stroke-width': 2,
    'stroke-linejoin': 'round',
    class: 'dna-area',
  });
  svg.append(area);
  const dotsG = svgEl('g', { class: 'dna-dots' });
  const dots = AXES.map(() => {
    const dot = svgEl('circle', {
      r: 3.6,
      cx: CX,
      cy: CY,
      fill: 'var(--dna-dot, #b7613e)',
      stroke: 'var(--dna-dot-ring, transparent)',
      'stroke-width': 2,
    });
    dotsG.append(dot);
    return dot;
  });
  svg.append(dotsG);
  return { area, dots };
}
function draw(parts, values) {
  parts.area.setAttribute('d', polygonPath(values));
  values.forEach((v, i) => {
    const p = pointAt(i, v);
    parts.dots[i].setAttribute('cx', p[0].toFixed(2));
    parts.dots[i].setAttribute('cy', p[1].toFixed(2));
  });
}
function animate(parts, from, to, dur) {
  if (reduce) {
    draw(parts, to);
    return;
  }
  const start = performance.now();
  function frame(now) {
    const e = easeExpo(Math.min(1, (now - start) / dur));
    draw(parts, to.map((v, i) => from[i] + (v - from[i]) * e));
    if (e < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/**
 * Flavour-DNA radar. Options ride data attributes on the box:
 *   data-default="weekday|sunday|evening", data-autocycle (3 s loop once on screen,
 *   stops on a click), data-dna-intro="mount" (grows from zero on mount, 820 ms) —
 *   default grows on first 35 % visibility over 1100 ms (home).
 * Readout: one .dna-panel[data-profile-panel] per profile; the active one is shown.
 * Styles: .dna rules in styles/styles.css (shared by home learn and landing).
 * @param {Element} box the .dna root
 */
export function initFlavorDna(box) {
  const svg = box.querySelector('svg');
  if (!svg) return;
  // a block may ship the static radar (grid, axes, labels) so it renders before this module
  const shipped = svg.querySelector('.dna-area');
  const parts = shipped
    ? { area: shipped, dots: [...svg.querySelectorAll('.dna-dots circle')] }
    : buildRadar(svg);
  let current = [0, 0, 0, 0, 0, 0];
  const buttons = [...box.querySelectorAll('[data-profile]')];
  const panels = [...box.querySelectorAll('[data-profile-panel]')];
  let activeKey = box.dataset.default || 'weekday';
  function setActive(key) {
    buttons.forEach((b) => {
      const on = b.dataset.profile === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    panels.forEach((p) => { p.hidden = p.dataset.profilePanel !== key; });
  }
  function go(key, immediate) {
    const target = PROFILES[key] || PROFILES.weekday;
    activeKey = key;
    setActive(key);
    if (immediate) {
      draw(parts, target);
      current = target.slice();
      return;
    }
    animate(parts, current.slice(), target, 820);
    current = target.slice();
  }
  buttons.forEach((b) => b.addEventListener('click', () => go(b.dataset.profile)));
  setActive(activeKey);
  if (box.dataset.dnaIntro === 'mount' && !reduce) {
    go(activeKey);
  } else if ('IntersectionObserver' in window && !reduce) {
    let seen = false;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !seen) {
          seen = true;
          const target = PROFILES[activeKey] || PROFILES.weekday;
          animate(parts, [0, 0, 0, 0, 0, 0], target, 1100);
          current = target.slice();
          io.disconnect();
        }
      });
    }, { threshold: 0.35 });
    io.observe(box);
  } else {
    go(activeKey, true);
  }
  if (box.hasAttribute('data-autocycle') && !reduce) {
    let idx = Math.max(0, ORDER.indexOf(activeKey));
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        idx = (idx + 1) % ORDER.length;
        go(ORDER[idx]);
        schedule();
      }, 3000);
    };
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }));
    whenOnScreen(box, schedule);
  }
}

/**
 * Art-directed hero copy (source hero.js): above 760px the copy column aligns to the
 * product in the cover-fitted photo — --hero-copy-top / --hero-copy-max on the hero.
 * Re-runs on every size change of the hero (ResizeObserver) and when the image loads.
 * @param {Element} hero element that carries the custom properties
 * @param {HTMLImageElement} img the cover-fitted photo
 * @param {Object} opts { focal: '50% 44%', productTop: 0.2, productLeft: 0.43, inner }
 */
export function artDirectHero(hero, img, opts = {}) {
  if (!hero || !img) return;
  const MOBILE = 760;
  const GAP = 28;
  const MIN_COL = 280;
  const MAX_COL = 560;
  const parse = (v) => (v.indexOf('%') > -1 ? parseFloat(v) / 100 : parseFloat(v));
  const [fxs, fys] = (opts.focal || '50% 50%').trim().split(/\s+/);
  const fx = parse(fxs);
  const fy = parse(fys !== undefined ? fys : fxs);
  const cover = (iw, ih, cw, ch, nx, ny) => {
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    return { x: (cw - dw) * fx + nx * dw, y: (ch - dh) * fy + ny * dh };
  };
  const apply = () => {
    const rect = hero.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (!cw) return;
    if (cw < MOBILE) {
      hero.style.removeProperty('--hero-copy-top');
      hero.style.removeProperty('--hero-copy-max');
      return;
    }
    img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
    const iw = img.naturalWidth || parseFloat(img.getAttribute('width')) || 1;
    const ih = img.naturalHeight || parseFloat(img.getAttribute('height')) || 1;
    if (opts.productTop !== undefined) {
      const { y } = cover(iw, ih, cw, ch, 0, opts.productTop);
      hero.style.setProperty('--hero-copy-top', `${Math.max(0, Math.round(y))}px`);
    }
    if (opts.productLeft !== undefined) {
      const { x } = cover(iw, ih, cw, ch, opts.productLeft, 0);
      const inner = opts.inner || hero;
      const ci = inner.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
      const col = Math.max(MIN_COL, Math.min(MAX_COL, x - (ci.left + padL) - GAP));
      hero.style.setProperty('--hero-copy-max', `${Math.round(col)}px`);
    }
  };
  if (!img.complete) img.addEventListener('load', apply, { once: true });
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe(hero);
  else window.addEventListener('resize', apply, { passive: true });
  apply();
}
