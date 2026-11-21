/**
 * Learn — "How it learns you" copy + the flavour-DNA radar (prototype `section.learn`).
 *
 * Authored rows:
 *   1. head: eyebrow paragraph (before the heading), heading, lede paragraph, and a list of
 *      points — each item a bold label followed by its sentence.
 *   2..n. one row per taste profile: | label (button text) | heading + note | six values |
 *      The values cell is a comma-separated list of 0–1 numbers in axis order (Strength, Body,
 *      Sweetness, Smoothness, Warmth, Crema). The first profile is shown first.
 *
 * Template-slotted (copy) + reconstructive (profiles, one per heading row). Behaviour carried
 * from the source (flavor-dna.js): the radar blooms outward (1100 ms) the first time 35 % of it
 * is on screen, morphs between profiles (820 ms, expo-out), and cycles every 3 s until a
 * profile is clicked.
 *
 * @ew-exempt <p> profile values (cell 3) — text-as-metadata, drawn as the radar shape.
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 */

const AXES = ['Strength', 'Body', 'Sweetness', 'Smoothness', 'Warmth', 'Crema'];
const CX = 210;
const CY = 206;
const R = 138;
const NS = 'http://www.w3.org/2000/svg';
const ZERO = AXES.map(() => 0);

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function cellNodes(cell) {
  const kids = [...cell.children];
  if (kids.length) return kids;
  if (!cell.textContent.trim()) return [];
  const p = el('p');
  p.append(...cell.childNodes);
  return [p];
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

const isHeading = (n) => /^H[1-6]$/.test(n.tagName);
const isValues = (n) => /^[\s\d.,;]+$/.test(n.textContent) && /\d/.test(n.textContent);
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const angle = (i) => -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
const point = (i, v) => [CX + Math.cos(angle(i)) * R * v, CY + Math.sin(angle(i)) * R * v];
const shape = (values) => `${values.map((v, i) => {
  const [x, y] = point(i, v);
  return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
}).join('')}Z`;

function buildRadar() {
  const svg = svgEl('svg', {
    viewBox: '0 0 420 420',
    role: 'img',
    'aria-label': 'Flavour profile radar showing six taste dimensions.',
  });
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
      x1: CX,
      y1: CY,
      x2: ex.toFixed(1),
      y2: ey.toFixed(1),
      stroke: 'var(--dna-axis)',
      'stroke-width': 1,
    }));
    const cos = Math.cos(angle(i));
    let anchor = 'end';
    if (Math.abs(cos) < 0.3) anchor = 'middle';
    else if (cos > 0) anchor = 'start';
    const label = svgEl('text', {
      x: (CX + cos * (R + 26)).toFixed(1),
      y: (CY + Math.sin(angle(i)) * (R + 26)).toFixed(1),
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      class: 'dna-label',
      fill: 'var(--dna-label)',
    });
    label.textContent = name;
    axes.append(label);
  });
  const area = svgEl('path', {
    d: shape(ZERO),
    fill: 'var(--dna-fill)',
    stroke: 'var(--dna-stroke)',
    'stroke-width': 2,
    'stroke-linejoin': 'round',
    class: 'dna-area',
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
  return { svg, area, dots };
}

/** run `start` once `node` is on screen (immediately when it already is) */
function whenOnScreen(node, start) {
  const r = node.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (r.height && r.top < vh && r.bottom > 0) {
    start();
    return;
  }
  if (!('IntersectionObserver' in window)) {
    start();
    return;
  }
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      io.disconnect();
      start();
    }
  }, { threshold: 0 });
  io.observe(node);
}

function parseProfiles(rows) {
  return rows.map((row) => {
    const profile = {
      label: el('div', 'dna-btn-label'), panel: el('div', 'dna-profile'), values: null,
    };
    let seenHeading = false;
    [...row.children].flatMap(cellNodes).forEach((node) => {
      if (isHeading(node)) {
        profile.panel.append(node);
        seenHeading = true;
      } else if (!profile.values && isValues(node)) {
        profile.values = node.textContent.split(/[,;\s]+/).filter(Boolean)
          .map((v) => Math.max(0, Math.min(1, parseFloat(v) || 0)));
        const data = el('div', 'dna-values');
        data.hidden = true;
        data.append(node);
        profile.panel.append(data);
      } else if (!seenHeading && !profile.label.children.length) {
        profile.label.append(node);
      } else {
        profile.panel.append(node);
      }
    });
    while (profile.values && profile.values.length < AXES.length) profile.values.push(0);
    profile.key = slug(profile.label.textContent) || `profile-${rows.indexOf(row) + 1}`;
    return profile;
  }).filter((p) => p.values);
}

function initRadar(dna, radar, profiles, buttons) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (values) => {
    radar.area.setAttribute('d', shape(values));
    values.forEach((v, i) => {
      const [x, y] = point(i, v);
      radar.dots[i].setAttribute('cx', x.toFixed(2));
      radar.dots[i].setAttribute('cy', y.toFixed(2));
    });
  };
  const animate = (from, to, dur) => {
    if (reduce) {
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
  let current = ZERO.slice();
  let active = 0;
  const select = (idx) => {
    profiles.forEach((p, i) => {
      const on = i === idx;
      p.panel.hidden = !on;
      buttons[i].classList.toggle('is-active', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  const go = (idx, immediate) => {
    const target = profiles[idx].values;
    active = idx;
    select(idx);
    if (immediate) draw(target);
    else animate(current.slice(), target, 820);
    current = target.slice();
  };
  let timer = null;
  const stopCycle = () => {
    clearTimeout(timer);
    timer = null;
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      stopCycle();
      go(i);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        b.click();
      }
    });
  });
  select(active);
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        animate(ZERO.slice(), profiles[active].values, 1100);
        current = profiles[active].values.slice();
      }
    }, { threshold: 0.35 });
    io.observe(dna);
  } else {
    go(active, true);
  }
  if (!reduce && profiles.length > 1) {
    const schedule = () => {
      timer = setTimeout(() => {
        go((active + 1) % profiles.length);
        schedule();
      }, 3000);
    };
    let stopped = false;
    buttons.forEach((b) => b.addEventListener('click', () => { stopped = true; }));
    whenOnScreen(dna, () => {
      if (!stopped) schedule();
    });
  }
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';
  if (!document.getElementById('learn')) block.id = 'learn';

  const rows = [...block.children];
  const headRow = rows.find((r) => r.querySelector('h1, h2, h3') && !r.querySelector('h4'))
    || rows[0];
  const profiles = parseProfiles(rows.filter((r) => r !== headRow));

  const grid = el('div', 'container learn-grid');
  const copy = el('div', 'learn-copy');
  const eyebrow = el('div', 'eyebrow');
  const title = el('div', 'learn-title');
  const lede = el('div', 'lede-wrap');
  const points = el('div', 'learn-points');
  let seenHeading = false;
  [...(headRow ? headRow.children : [])].flatMap(cellNodes).forEach((node) => {
    if (isHeading(node) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (node.matches('ul, ol')) {
      points.append(node);
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else {
      lede.append(node);
    }
  });
  [eyebrow, title, lede, points].forEach((part) => {
    if (part.children.length) copy.append(part);
  });

  const viz = el('div', 'learn-viz');
  const dna = el('div', 'dna', { 'data-flavor-dna': '' });
  const frame = el('div', 'dna-frame');
  const radar = buildRadar();
  const readout = el('div', 'dna-readout');
  const controls = el('div', 'dna-controls', {
    role: 'group', 'aria-label': 'Choose a taste profile',
  });
  const buttons = profiles.map((p) => {
    readout.append(p.panel);
    const btn = el('div', 'dna-btn', {
      role: 'button', tabindex: '0', 'data-profile': p.key, 'aria-pressed': 'false',
    });
    btn.append(...p.label.childNodes);
    controls.append(btn);
    return btn;
  });
  frame.append(radar.svg, readout);
  dna.append(frame);
  if (buttons.length) dna.append(controls);
  viz.append(dna);

  grid.append(copy, viz);
  block.replaceChildren(grid);
  revealAll([[copy, 0], [viz, 0.12]]);
  if (profiles.length) initRadar(dna, radar, profiles, buttons);
}
