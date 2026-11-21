/* Fréscopa Atelier — replica prototype behaviour.
   Re-authored from the source's observed behaviour (shared/app.js, hero.js, flavor-dna.js):
   same thresholds, timings and states; no dependencies. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Run `start` once `el` is on screen (immediately when it already is). */
  function whenOnScreen(el, start) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < vh && r.bottom > 0) { start(); return; }
    if (!('IntersectionObserver' in window)) { start(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { io.disconnect(); start(); }
    }, { threshold: 0 });
    io.observe(el);
  }

  /* Cycle through `count` states every 3 s until the user clicks one of `controls`. */
  function autocycle(container, controls, startIdx, step) {
    let idx = Math.max(0, startIdx);
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => { idx = (idx + 1) % controls.length; step(idx); schedule(); }, 3000);
    };
    controls.forEach((c) => c.addEventListener('click', () => { clearTimeout(timer); timer = null; }));
    whenOnScreen(container, schedule);
  }

  /* ---- Scroll reveal ---- */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || reduce) {
      els.forEach((e) => e.classList.add('is-in'));
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
    els.forEach((e) => io.observe(e));
  }

  /* ---- Header: solid after 12px, hides scrolling down past 480px ---- */
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

  /* ---- Mobile navigation drawer ---- */
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

  /* ---- Art-directed hero: copy aligns to the product top and stops at its left edge ---- */
  function initHeroArt() {
    const MOBILE = 760;
    const GAP = 28;
    const MIN_COL = 280;
    const MAX_COL = 560;
    const heroes = document.querySelectorAll('[data-hero-art]');
    const ratio = (v) => (v.includes('%') ? parseFloat(v) / 100 : parseFloat(v));
    const apply = (hero) => {
      const img = hero.querySelector('img[data-hero-product-top], img[data-hero-product-left]');
      if (!img) return;
      const { width: cw, height: ch } = hero.getBoundingClientRect();
      if (cw < MOBILE) {
        hero.style.removeProperty('--hero-copy-top');
        hero.style.removeProperty('--hero-copy-max');
        return;
      }
      const [fxs, fys] = (img.dataset.heroFocal || '50% 50%').trim().split(/\s+/);
      const fx = ratio(fxs);
      const fy = ratio(fys ?? fxs);
      img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
      const iw = img.naturalWidth || parseFloat(img.getAttribute('width')) || 1;
      const ih = img.naturalHeight || parseFloat(img.getAttribute('height')) || 1;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const top = parseFloat(img.dataset.heroProductTop);
      if (!Number.isNaN(top)) {
        const y = (ch - dh) * fy + top * dh;
        hero.style.setProperty('--hero-copy-top', `${Math.max(0, Math.round(y))}px`);
      }
      const left = parseFloat(img.dataset.heroProductLeft);
      if (!Number.isNaN(left)) {
        const x = (cw - dw) * fx + left * dw;
        const inner = hero.querySelector('.hero__inner') || hero;
        const padL = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
        const col = Math.max(MIN_COL, Math.min(MAX_COL, x - (inner.getBoundingClientRect().left + padL) - GAP));
        hero.style.setProperty('--hero-copy-max', `${Math.round(col)}px`);
      }
    };
    if (!heroes.length) return;
    const run = () => heroes.forEach(apply);
    heroes.forEach((h) => {
      const img = h.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', run, { once: true });
    });
    run();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(run, 120); }, { passive: true });
  }

  /* ---- Flavour DNA radar ---- */
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
  const svgEl = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };
  const shape = (values) => `${values.map((v, i) => {
    const [x, y] = point(i, v);
    return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }).join('')}Z`;

  function buildRadar(svg) {
    svg.setAttribute('viewBox', '0 0 420 420');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Flavour profile radar showing six taste dimensions.');
    svg.replaceChildren();
    const grid = svgEl('g', { class: 'dna-grid' });
    [0.25, 0.5, 0.75, 1].forEach((ring) => {
      const pts = AXES.map((_, i) => point(i, ring).map((n) => n.toFixed(1)).join(',')).join(' ');
      grid.append(svgEl('polygon', {
        points: pts, fill: 'none', stroke: 'var(--dna-grid)', 'stroke-width': ring === 1 ? 1.4 : 1,
      }));
    });
    const axes = svgEl('g', { class: 'dna-axes' });
    AXES.forEach((name, i) => {
      const [ex, ey] = point(i, 1);
      axes.append(svgEl('line', {
        x1: CX, y1: CY, x2: ex.toFixed(1), y2: ey.toFixed(1), stroke: 'var(--dna-axis)', 'stroke-width': 1,
      }));
      const cos = Math.cos(angle(i));
      const label = svgEl('text', {
        x: (CX + cos * (R + 26)).toFixed(1),
        y: (CY + Math.sin(angle(i)) * (R + 26)).toFixed(1),
        'text-anchor': Math.abs(cos) < 0.3 ? 'middle' : (cos > 0 ? 'start' : 'end'),
        'dominant-baseline': 'middle',
        class: 'dna-label',
        fill: 'var(--dna-label)',
      });
      label.textContent = name;
      axes.append(label);
    });
    const area = svgEl('path', {
      d: shape([0, 0, 0, 0, 0, 0]), fill: 'var(--dna-fill)', stroke: 'var(--dna-stroke)', 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'dna-area',
    });
    const dotsG = svgEl('g', { class: 'dna-dots' });
    const dots = AXES.map(() => {
      const dot = svgEl('circle', {
        r: 3.6, cx: CX, cy: CY, fill: 'var(--dna-dot)', stroke: 'var(--dna-dot-ring)', 'stroke-width': 2,
      });
      dotsG.append(dot);
      return dot;
    });
    svg.append(grid, axes, area, dotsG);
    return { area, dots };
  }

  function initRadar(container) {
    const svg = container.querySelector('[data-dna-svg]');
    if (!svg) return;
    const parts = buildRadar(svg);
    const draw = (values) => {
      parts.area.setAttribute('d', shape(values));
      values.forEach((v, i) => {
        const [x, y] = point(i, v);
        parts.dots[i].setAttribute('cx', x.toFixed(2));
        parts.dots[i].setAttribute('cy', y.toFixed(2));
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
    const title = container.querySelector('[data-flavor-title]');
    const note = container.querySelector('[data-flavor-note]');
    const buttons = [...container.querySelectorAll('[data-profile]')];
    let current = [0, 0, 0, 0, 0, 0];
    let active = container.dataset.default || 'weekday';
    const select = (key) => {
      buttons.forEach((b) => {
        const on = b.dataset.profile === key;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (title) title.textContent = PROFILES[key].title;
      if (note) note.textContent = PROFILES[key].note;
    };
    const go = (key, immediate) => {
      const target = PROFILES[key].values;
      active = key;
      select(key);
      if (immediate) draw(target); else animate(current.slice(), target, 820);
      current = target.slice();
    };
    buttons.forEach((b) => b.addEventListener('click', () => go(b.dataset.profile)));
    select(active);
    if ('IntersectionObserver' in window && !reduce) {
      // bloom outward the first time it enters view
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          animate([0, 0, 0, 0, 0, 0], PROFILES[active].values, 1100);
          current = PROFILES[active].values.slice();
        }
      }, { threshold: 0.35 });
      io.observe(container);
    } else {
      go(active, true);
    }
    if (container.hasAttribute('data-autocycle') && !reduce) {
      autocycle(container, buttons, ORDER.indexOf(active), (i) => go(ORDER[i]));
    }
  }

  /* ---- Mood calendar → brew suggestion ---- */
  function initCalendar(cal) {
    const days = [...cal.querySelectorAll('[data-day]')];
    if (!days.length) return;
    const out = cal.querySelector('[data-brew]') || cal;
    const title = out.querySelector('[data-brew-title]');
    const note = out.querySelector('[data-brew-note]');
    const tag = out.querySelector('[data-brew-tag]');
    const activate = (day) => {
      days.forEach((d) => {
        const on = d === day;
        d.classList.toggle('is-active', on);
        d.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (title && day.dataset.brewTitle) title.textContent = day.dataset.brewTitle;
      if (note && day.dataset.brewNote) note.textContent = day.dataset.brewNote;
      if (tag && day.dataset.brewTag) tag.textContent = day.dataset.brewTag;
    };
    days.forEach((d) => d.addEventListener('click', () => activate(d)));
    const initial = cal.querySelector('[data-day].is-active') || days[0];
    activate(initial);
    if (cal.hasAttribute('data-autocycle') && !reduce) {
      autocycle(cal, days, days.indexOf(initial), (i) => activate(days[i]));
    }
  }

  /* ---- Subtle parallax (transform only, pointer devices) ---- */
  function initParallax() {
    const items = document.querySelectorAll('[data-parallax]');
    if (!items.length || reduce || window.matchMedia('(hover: none)').matches) return;
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
        const amount = parseFloat(item.dataset.parallax) || 24;
        item.style.transform = `translate3d(0,${(-progress * amount).toFixed(1)}px,0)`;
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function init() {
    initReveal();
    initHeader();
    initNav();
    initHeroArt();
    document.querySelectorAll('[data-flavor-dna]').forEach(initRadar);
    document.querySelectorAll('[data-calendar]').forEach(initCalendar);
    initParallax();
    document.querySelectorAll('[data-year]').forEach((e) => { e.textContent = new Date().getFullYear(); });
    document.querySelectorAll('form.signup').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
