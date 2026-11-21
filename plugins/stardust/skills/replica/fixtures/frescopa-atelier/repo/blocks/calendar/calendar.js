/**
 * Fréscopa mood calendar — copy column + a week calendar whose days suggest a brew;
 * auto-cycles the days every 3 s and stops for good on the first click
 * (source shared/app.js initCalendar; dynamic-features mood-calendar, client-only).
 * Authored rows: row 1 = eyebrow <p>, <h2>, lede <p>, hint <p>; a month | year row;
 * then one row per day: number [| tag | <h4> title + <p> note [| active]].
 * A day row with only a number renders muted (not bookable).
 * @ew-exempt <p> "active" marker (day row cell 4) — default-selection flag, never displayed
 */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function moveChildren(cell, target) {
  if (cell) target.append(...cell.childNodes);
  return target;
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

const isDayRow = (row) => /^\s*\d{1,2}\s*$/.test(row.children[0]?.textContent || '');

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const dayRows = rows.filter(isDayRow);
  const monthRow = rows.find((r) => !dayRows.includes(r) && r.children.length === 2
    && !r.querySelector('h1, h2, h3'));
  const copyRows = rows.filter((r) => !dayRows.includes(r) && r !== monthRow);

  // copy column
  const copy = el('div');
  copyRows.forEach((row) => {
    const heading = row.querySelector('h1, h2, h3');
    const isBefore = (n) => heading
      && (heading.compareDocumentPosition(n) % 4) === Node.DOCUMENT_POSITION_PRECEDING;
    let ledeDone = false;
    [...row.querySelectorAll('p, h1, h2, h3')].forEach((n) => {
      if (n === heading) copy.append(wrap(n, 'cal-heading'));
      else if (isBefore(n)) copy.append(wrap(n, 'eyebrow'));
      else if (!ledeDone) {
        copy.append(wrap(n, 'lede'));
        ledeDone = true;
      } else copy.append(wrap(n, 'mood-hint'));
    });
  });
  reveal(copy);

  // calendar panel
  const panel = el('div', 'panel');
  const head = el('div', 'cal-head');
  if (monthRow) {
    head.append(
      moveChildren(monthRow.children[0], el('div', 'cal-month')),
      moveChildren(monthRow.children[1], el('div', 'cal-year')),
    );
  }
  const grid = el('div', 'cal-grid', { role: 'group', 'aria-label': 'Days of the week' });
  DOW.forEach((d) => {
    const s = el('span', 'cal-dow');
    s.textContent = d;
    grid.append(s);
  });
  const brew = el('div', 'brew', { 'aria-live': 'polite' });
  const days = [];
  let initial = -1;
  dayRows.forEach((row) => {
    const [numCell, tagCell, noteCell, flagCell] = row.children;
    if (!tagCell) {
      grid.append(moveChildren(numCell, el('div', 'cal-day cal-day-muted')));
      return;
    }
    const day = moveChildren(numCell, el('div', 'cal-day', { role: 'button', tabindex: '0' }));
    grid.append(day);
    const item = el('div', 'brew-item');
    item.append(moveChildren(tagCell, el('div', 'brew-tag')));
    moveChildren(noteCell, item);
    if (flagCell) {
      if (/active/i.test(flagCell.textContent) && initial < 0) initial = days.length;
      const flag = moveChildren(flagCell, el('div', 'brew-flag'));
      flag.hidden = true;
      item.append(flag);
    }
    brew.append(item);
    days.push({ day, item });
  });
  panel.append(head, grid, brew);
  reveal(panel, 0.12);

  const split = el('div', 'container split split-mood');
  split.append(copy, panel);
  block.replaceChildren(split);
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'mood';
  if (!days.length) return;

  let idx = Math.max(0, initial);
  const activate = (i) => {
    idx = i;
    days.forEach((d, j) => {
      d.day.classList.toggle('is-active', j === i);
      d.day.setAttribute('aria-pressed', j === i ? 'true' : 'false');
      d.item.hidden = j !== i;
    });
  };
  days.forEach((d, i) => {
    d.day.addEventListener('click', () => activate(i));
    d.day.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        d.day.click();
      }
    });
  });
  activate(idx);
  autocycle(panel, days.map((d) => d.day), () => activate((idx + 1) % days.length));
}
