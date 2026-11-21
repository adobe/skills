/* Fréscopa Atelier — replica prototype behaviour.
   Re-authored from the observed source behaviour (shared/app.js, hero.js, flavor-dna.js):
   header scroll morph (12px / hide past 480px), art-directed hero copy column,
   scroll reveal, flavour-DNA radar and calendar auto-cycling every 3 s, image parallax. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Header: is-scrolled past 12px, hidden while scrolling down past 480px. */
  function initHeader() {
    const header = document.querySelector('[data-header]');
    if (!header) return;
    let last = 0;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 12);
      if (y > 480 && y > last + 4) header.classList.add('is-hidden');
      else if (y < last - 4 || y < 480) header.classList.remove('is-hidden');
      last = y;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* Hero: copy starts at the product's top and stops at its left edge (object-fit: cover math). */
  function initHero() {
    const hero = document.querySelector('[data-hero-art]');
    const img = hero && hero.querySelector('img[data-hero-product-top]');
    if (!img) return;
    const apply = () => {
      const { width: cw, height: ch } = hero.getBoundingClientRect();
      if (cw < 760) {
        hero.style.removeProperty('--hero-copy-top');
        hero.style.removeProperty('--hero-copy-max');
        return;
      }
      const [fx, fy] = img.dataset.heroFocal.split(/\s+/).map((v) => parseFloat(v) / 100);
      img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
      const iw = img.naturalWidth || 1408;
      const ih = img.naturalHeight || 768;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const top = (ch - dh) * fy + parseFloat(img.dataset.heroProductTop) * dh;
      hero.style.setProperty('--hero-copy-top', `${Math.max(0, Math.round(top))}px`);
      const x = (cw - dw) * fx + parseFloat(img.dataset.heroProductLeft) * dw;
      const inner = hero.querySelector('.hero__inner');
      const left = inner.getBoundingClientRect().left + (parseFloat(getComputedStyle(inner).paddingLeft) || 0);
      const col = Math.max(280, Math.min(560, x - left - 28));
      hero.style.setProperty('--hero-copy-max', `${Math.round(col)}px`);
    };
    if (!img.complete) img.addEventListener('load', apply, { once: true });
    apply();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 120); }, { passive: true });
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || reduce) {
      els.forEach((e) => e.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  }

  /* Starts fn's 3 s cycle once el is on screen; any click on a control stops it for good. */
  function autocycle(el, controls, step) {
    if (!el.hasAttribute('data-autocycle') || reduce) return;
    let timer = null;
    const schedule = () => { timer = setTimeout(() => { step(); schedule(); }, 3000); };
    controls.forEach((c) => c.addEventListener('click', () => { clearTimeout(timer); timer = null; }));
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) schedule();
    else {
      const obs = new IntersectionObserver((e) => {
        if (e[0].isIntersecting) { schedule(); obs.disconnect(); }
      }, { threshold: 0 });
      obs.observe(el);
    }
  }

  function initCalendar() {
    const cal = document.querySelector('[data-calendar]');
    if (!cal) return;
    const days = [...cal.querySelectorAll('[data-day]')];
    const out = cal.querySelector('[data-brew]');
    const activate = (day) => {
      days.forEach((d) => {
        d.classList.toggle('is-active', d === day);
        d.setAttribute('aria-pressed', d === day ? 'true' : 'false');
      });
      ['Title', 'Note', 'Tag'].forEach((k) => {
        out.querySelector(`[data-brew-${k.toLowerCase()}]`).textContent = day.dataset[`brew${k}`];
      });
    };
    days.forEach((d) => d.addEventListener('click', () => activate(d)));
    const initial = cal.querySelector('[data-day].is-active') || days[0];
    activate(initial);
    let idx = days.indexOf(initial);
    autocycle(cal, days, () => { idx = (idx + 1) % days.length; activate(days[idx]); });
  }

  /* Flavour DNA: six-axis SVG radar that morphs between three profiles. */
  const AXES = ['Strength', 'Body', 'Sweetness', 'Smoothness', 'Warmth', 'Crema'];
  const PROFILES = {
    weekday: { title: 'The weekday cup', note: 'Brisk and a little bolder. Enough to meet the day, never so much it rushes you.', values: [0.92, 0.62, 0.34, 0.5, 0.66, 0.82] },
    sunday: { title: 'The slow Sunday', note: 'Softer and rounder, made for lingering. It knows there is nowhere you need to be.', values: [0.58, 0.8, 0.6, 0.88, 0.84, 0.62] },
    evening: { title: 'The after-dinner cup', note: 'Gentle and sweet, half the strength. A quiet close to the evening, not a second start.', values: [0.34, 0.7, 0.78, 0.74, 0.9, 0.5] },
  };
  const ORDER = ['weekday', 'sunday', 'evening'];
  const CX = 210;
  const CY = 206;
  const R = 138;
  const NS = 'http://www.w3.org/2000/svg';
  const angle = (i) => -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
  const point = (i, v) => [CX + Math.cos(angle(i)) * R * v, CY + Math.sin(angle(i)) * R * v];
  const node = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    parent.appendChild(n);
    return n;
  };

  function initDna() {
    const dna = document.querySelector('[data-flavor-dna]');
    const svg = dna && dna.querySelector('[data-dna-svg]');
    if (!svg) return;
    svg.setAttribute('viewBox', '0 0 420 420');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Flavour profile radar showing six taste dimensions.');
    const grid = node('g', { class: 'dna-grid' }, svg);
    [0.25, 0.5, 0.75, 1].forEach((ring) => {
      const pts = AXES.map((_, i) => point(i, ring).map((n) => n.toFixed(1)).join(',')).join(' ');
      node('polygon', { points: pts, fill: 'none', stroke: 'var(--dna-grid)', 'stroke-width': ring === 1 ? 1.4 : 1 }, grid);
    });
    const axes = node('g', { class: 'dna-axes' }, svg);
    AXES.forEach((label, i) => {
      const [ex, ey] = point(i, 1);
      node('line', { x1: CX, y1: CY, x2: ex.toFixed(1), y2: ey.toFixed(1), stroke: 'var(--dna-axis)', 'stroke-width': 1 }, axes);
      const c = Math.cos(angle(i));
      let anchor = 'end';
      if (Math.abs(c) < 0.3) anchor = 'middle';
      else if (c > 0) anchor = 'start';
      const t = node('text', {
        x: (CX + c * (R + 26)).toFixed(1),
        y: (CY + Math.sin(angle(i)) * (R + 26)).toFixed(1),
        'text-anchor': anchor,
        'dominant-baseline': 'middle',
        class: 'dna-label',
        fill: 'var(--dna-label)',
      }, axes);
      t.textContent = label;
    });
    const area = node('path', { fill: 'var(--dna-fill)', stroke: 'var(--dna-stroke)', 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'dna-area' }, svg);
    const dotsG = node('g', { class: 'dna-dots' }, svg);
    const dots = AXES.map(() => node('circle', { r: 3.6, cx: CX, cy: CY, fill: 'var(--dna-dot)', stroke: 'var(--dna-dot-ring)', 'stroke-width': 2 }, dotsG));

    const draw = (values) => {
      area.setAttribute('d', `${values.map((v, i) => `${i ? 'L' : 'M'}${point(i, v).map((n) => n.toFixed(2)).join(' ')}`).join(' ')} Z`);
      values.forEach((v, i) => {
        const [x, y] = point(i, v);
        dots[i].setAttribute('cx', x.toFixed(2));
        dots[i].setAttribute('cy', y.toFixed(2));
      });
    };
    const animate = (from, to, dur) => {
      if (reduce) { draw(to); return; }
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const e = t === 1 ? 1 : 1 - 2 ** (-10 * t);
        draw(to.map((v, i) => from[i] + (v - from[i]) * e));
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };

    const title = dna.querySelector('[data-flavor-title]');
    const note = dna.querySelector('[data-flavor-note]');
    const buttons = [...dna.querySelectorAll('[data-profile]')];
    let active = dna.dataset.default || 'weekday';
    let current = [0, 0, 0, 0, 0, 0];
    draw(current);
    const setUi = (key) => {
      title.textContent = PROFILES[key].title;
      note.textContent = PROFILES[key].note;
      buttons.forEach((b) => {
        b.classList.toggle('is-active', b.dataset.profile === key);
        b.setAttribute('aria-pressed', b.dataset.profile === key ? 'true' : 'false');
      });
    };
    const go = (key) => {
      active = key;
      setUi(key);
      animate(current.slice(), PROFILES[key].values, 820);
      current = PROFILES[key].values.slice();
    };
    buttons.forEach((b) => b.addEventListener('click', () => go(b.dataset.profile)));
    setUi(active);
    if ('IntersectionObserver' in window && !reduce) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          animate([0, 0, 0, 0, 0, 0], PROFILES[active].values, 1100);
          current = PROFILES[active].values.slice();
          io.disconnect();
        }
      }, { threshold: 0.35 });
      io.observe(dna);
    } else {
      draw(PROFILES[active].values);
      current = PROFILES[active].values.slice();
    }
    let idx = ORDER.indexOf(active);
    autocycle(dna, buttons, () => { idx = (idx + 1) % ORDER.length; go(ORDER[idx]); });
  }

  function initParallax() {
    const items = document.querySelectorAll('[data-parallax]');
    if (!items.length || reduce || window.matchMedia('(hover: none)').matches) return;
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      items.forEach((item) => {
        const r = item.getBoundingClientRect();
        const progress = (r.top + r.height / 2 - vh / 2) / vh;
        item.style.transform = `translate3d(0,${(-progress * parseFloat(item.dataset.parallax)).toFixed(1)}px,0)`;
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function initNav() {
    const toggle = document.querySelector('[data-nav-toggle]');
    const nav = document.querySelector('[data-nav]');
    if (!toggle || !nav) return;
    const set = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.documentElement.classList.toggle('nav-open', open);
    };
    toggle.addEventListener('click', () => set(!nav.classList.contains('is-open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  function init() {
    initNav();
    initReveal();
    initHeader();
    initHero();
    initCalendar();
    initDna();
    initParallax();
    document.querySelectorAll('[data-year]').forEach((e) => { e.textContent = new Date().getFullYear(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
