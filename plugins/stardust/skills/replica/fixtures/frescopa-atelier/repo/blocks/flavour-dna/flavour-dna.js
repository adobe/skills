/**
 * Fréscopa flavour DNA — copy column + six-axis SVG radar that blooms on view,
 * auto-cycles the profiles every 3 s and stops for good on the first click
 * (source shared/flavor-dna.js; dynamic-features dna-radar, client-only).
 * Authored rows: row 1 = eyebrow <p>, <h2>, lede <p>, points <ul> (<strong> label + text);
 * then one row per profile: label | readout (<h4> + <p>) | six values 0–1.
 * @ew-exempt <p> profile values (cell 3) — radar data, never displayed
 */

const AXES = ['Strength', 'Body', 'Sweetness', 'Smoothness', 'Warmth', 'Crema'];
const CX = 210;
const CY = 206;
const R = 138;
const NS = 'http://www.w3.org/2000/svg';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const angle = (i) => -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
const point = (i, v) => [CX + Math.cos(angle(i)) * R * v, CY + Math.sin(angle(i)) * R * v];

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

function svgNode(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  parent.appendChild(n);
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

function autocycle(node, controls, step) {
  if (reduced()) return;
  let timer = null;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      step();
      schedule();
    }, 3000);
  };
  controls.forEach((c) => c.addEventListener('click', () => {
    stopped = true;
    clearTimeout(timer);
  }));
  const r = node.getBoundingClientRect();
  if (r.top < window.innerHeight && r.bottom > 0) {
    schedule();
  } else {
    const obs = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        schedule();
        obs.disconnect();
      }
    }, { threshold: 0 });
    obs.observe(node);
  }
}

function buildRadar(svg) {
  svg.setAttribute('viewBox', '0 0 420 420');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Flavour profile radar showing six taste dimensions.');
  const grid = svgNode('g', { class: 'dna-grid' }, svg);
  [0.25, 0.5, 0.75, 1].forEach((ring) => {
    const pts = AXES.map((_, i) => point(i, ring).map((n) => n.toFixed(1)).join(',')).join(' ');
    svgNode('polygon', {
      points: pts, fill: 'none', stroke: 'var(--dna-grid)', 'stroke-width': ring === 1 ? 1.4 : 1,
    }, grid);
  });
  const axes = svgNode('g', { class: 'dna-axes' }, svg);
  AXES.forEach((label, i) => {
    const [ex, ey] = point(i, 1);
    svgNode('line', {
      x1: CX, y1: CY, x2: ex.toFixed(1), y2: ey.toFixed(1), stroke: 'var(--dna-axis)', 'stroke-width': 1,
    }, axes);
    const c = Math.cos(angle(i));
    let anchor = 'end';
    if (Math.abs(c) < 0.3) anchor = 'middle';
    else if (c > 0) anchor = 'start';
    const t = svgNode('text', {
      x: (CX + c * (R + 26)).toFixed(1),
      y: (CY + Math.sin(angle(i)) * (R + 26)).toFixed(1),
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      class: 'dna-label',
      fill: 'var(--dna-label)',
    }, axes);
    t.textContent = label;
  });
  const area = svgNode('path', {
    fill: 'var(--dna-fill)',
    stroke: 'var(--dna-stroke)',
    'stroke-width': 2,
    'stroke-linejoin': 'round',
    class: 'dna-area',
  }, svg);
  const dotsG = svgNode('g', { class: 'dna-dots' }, svg);
  const dots = AXES.map(() => svgNode('circle', {
    r: 3.6, cx: CX, cy: CY, fill: 'var(--dna-dot)', stroke: 'var(--dna-dot-ring)', 'stroke-width': 2,
  }, dotsG));
  const draw = (values) => {
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${point(i, v).map((n) => n.toFixed(2)).join(' ')}`);
    area.setAttribute('d', `${d.join(' ')} Z`);
    values.forEach((v, i) => {
      const [x, y] = point(i, v);
      dots[i].setAttribute('cx', x.toFixed(2));
      dots[i].setAttribute('cy', y.toFixed(2));
    });
  };
  const animate = (from, to, dur) => {
    if (reduced()) {
      draw(to);
      return;
    }
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t === 1 ? 1 : 1 - 2 ** (-10 * t);
      draw(to.map((v, i) => from[i] + (v - from[i]) * e));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  return { draw, animate };
}

function parseValues(text) {
  const nums = (text.match(/[\d.]+/g) || []).map(Number).filter((n) => !Number.isNaN(n));
  return AXES.map((_, i) => Math.max(0, Math.min(1, nums[i] ?? 0.5)));
}

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const profileRows = rows.filter((r) => r.children.length >= 2);
  const copyRows = rows.filter((r) => !profileRows.includes(r));

  // copy column
  const copy = el('div');
  copyRows.forEach((row) => {
    const heading = row.querySelector('h1, h2, h3');
    const isBefore = (n) => heading
      && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;
    let ledeDone = false;
    [...row.querySelectorAll('p, ul, ol, h1, h2, h3')].forEach((n) => {
      if (n.tagName === 'P' && n.closest('li')) return;
      if (n === heading) copy.append(wrap(n, 'dna-heading'));
      else if (n.tagName === 'UL' || n.tagName === 'OL') copy.append(wrap(n, 'points'));
      else if (isBefore(n)) copy.append(wrap(n, 'eyebrow'));
      else if (!ledeDone) {
        copy.append(wrap(n, 'lede'));
        ledeDone = true;
      } else copy.append(n);
    });
  });
  reveal(copy);

  // radar
  const frame = el('div', 'dna-frame');
  const svg = document.createElementNS(NS, 'svg');
  frame.append(svg);
  const readout = el('div', 'dna-readout', { 'aria-live': 'polite' });
  frame.append(readout);
  const controls = el('div', 'dna-controls', { role: 'group', 'aria-label': 'Choose a taste profile' });

  const profiles = profileRows.map((row, i) => {
    const [labelCell, readCell, valueCell] = row.children;
    const pill = el('div', 'pill', { role: 'button', tabindex: '0', 'data-profile': i });
    pill.append(...labelCell.childNodes);
    controls.append(pill);
    const panel = el('div', 'dna-profile');
    panel.append(...readCell.childNodes);
    readout.append(panel);
    const values = parseValues(valueCell ? valueCell.textContent : '');
    if (valueCell) {
      const data = el('div', 'dna-data');
      data.hidden = true;
      data.append(...valueCell.childNodes);
      panel.append(data);
    }
    return { pill, panel, values };
  });

  const dna = el('div', 'dna');
  dna.append(frame, controls);
  const visual = el('div');
  visual.append(dna);
  reveal(visual, 0.12);

  const split = el('div', 'container split split-learn');
  split.append(copy, visual);
  block.replaceChildren(split);
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'learn';
  if (!profiles.length) return;

  const { draw, animate } = buildRadar(svg);
  let active = 0;
  let current = AXES.map(() => 0);
  draw(current);
  const setUi = (idx) => {
    profiles.forEach((p, i) => {
      p.panel.hidden = i !== idx;
      p.pill.classList.toggle('is-active', i === idx);
      p.pill.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
    });
  };
  const go = (idx) => {
    active = idx;
    setUi(idx);
    animate(current.slice(), profiles[idx].values, 820);
    current = profiles[idx].values.slice();
  };
  profiles.forEach((p, i) => {
    p.pill.addEventListener('click', () => go(i));
    p.pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        p.pill.click();
      }
    });
  });
  setUi(active);
  if ('IntersectionObserver' in window && !reduced()) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        animate(AXES.map(() => 0), profiles[active].values, 1100);
        current = profiles[active].values.slice();
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(dna);
  } else {
    draw(profiles[active].values);
    current = profiles[active].values.slice();
  }
  autocycle(dna, profiles.map((p) => p.pill), () => go((active + 1) % profiles.length));
}
