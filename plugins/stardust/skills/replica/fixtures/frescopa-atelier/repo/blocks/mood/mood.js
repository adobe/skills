/**
 * Mood — "It reads the room. And the calendar." copy + the mood calendar
 * (prototype `section.mood`).
 *
 * Authored rows:
 *   1. head: eyebrow paragraph (before the heading), heading, lede paragraph, hint paragraph.
 *   2. calendar head: | month | year |
 *   3..n. one row per day: | day number | tag, heading, note |  — a day with an empty second
 *      cell is shown muted (not selectable); a bold day number marks the day selected first.
 *
 * Template-slotted (copy) + reconstructive (days, one per numbered row). Behaviour carried
 * from the source (app.js): clicking a day shows its brew; once on screen the days cycle every
 * 3 s until one is clicked.
 *
 * @ew-exempt "M T W T F S S", "Days of the week" — fixed weekday initials of the grid header.
 * Harness-only fallback (EW5): a bare-text cell is wrapped by moving its text nodes into a <p>.
 */

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function cellNodes(cell) {
  if (!cell) return [];
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
const isDayRow = (row) => /^\s*\d{1,2}\s*$/.test(row.firstElementChild?.textContent || '');

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

function buildCopy(row) {
  const copy = el('div', 'mood-copy');
  const eyebrow = el('div', 'eyebrow');
  const title = el('div', 'mood-title');
  const lede = el('div', 'lede-wrap');
  const hint = el('div', 'mood-hint');
  let seenHeading = false;
  [...(row ? row.children : [])].flatMap(cellNodes).forEach((node) => {
    if (isHeading(node) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (!seenHeading) {
      eyebrow.append(node);
    } else if (!lede.children.length) {
      lede.append(node);
    } else {
      hint.append(node);
    }
  });
  [eyebrow, title, lede, hint].forEach((part) => {
    if (part.children.length) copy.append(part);
  });
  return copy;
}

function buildBrew(nodes) {
  const item = el('div', 'brew-item');
  const tag = el('div', 'brew-tag');
  const title = el('div', 'brew-title');
  const note = el('div', 'brew-note');
  let seenHeading = false;
  nodes.forEach((node) => {
    if (isHeading(node) && !seenHeading) {
      title.append(node);
      seenHeading = true;
    } else if (!seenHeading) {
      tag.append(node);
    } else {
      note.append(node);
    }
  });
  [tag, title, note].forEach((part) => {
    if (part.children.length) item.append(part);
  });
  return { item, tag: tag.textContent.trim() };
}

function initCalendar(panel, days) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const activate = (day) => {
    days.forEach((d) => {
      const on = d === day;
      d.btn.classList.toggle('is-active', on);
      d.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      d.item.hidden = !on;
    });
  };
  let timer = null;
  let stopped = false;
  days.forEach((d) => {
    d.btn.addEventListener('click', () => {
      stopped = true;
      clearTimeout(timer);
      activate(d);
    });
    d.btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        d.btn.click();
      }
    });
  });
  const initial = days.find((d) => d.initial) || days[0];
  let idx = days.indexOf(initial);
  activate(initial);
  if (reduce || days.length < 2) return;
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      idx = (idx + 1) % days.length;
      activate(days[idx]);
      schedule();
    }, 3000);
  };
  whenOnScreen(panel, () => {
    if (!stopped) schedule();
  });
}

export default function decorate(block) {
  if (block.dataset.decorated) return;
  block.dataset.decorated = 'true';
  if (!document.getElementById('mood')) block.id = 'mood';

  const rows = [...block.children];
  const copyRow = rows.find((r) => r.querySelector('h1, h2, h3') && !isDayRow(r));
  const dayRows = rows.filter(isDayRow);
  const headRow = rows.find((r) => r !== copyRow && !isDayRow(r));

  const grid = el('div', 'container mood-grid');
  const copy = buildCopy(copyRow);

  const panel = el('div', 'mood-panel', { 'data-calendar': '' });
  const cal = el('div', 'cal');
  const head = el('div', 'cal-head');
  const [month, year] = [el('div', 'cal-month'), el('div', 'cal-year')];
  cellNodes(headRow?.children[0]).forEach((n) => month.append(n));
  [...(headRow ? headRow.children : [])].slice(1).flatMap(cellNodes)
    .forEach((n) => year.append(n));
  head.append(month, year);
  const calGrid = el('div', 'cal-grid', { role: 'group', 'aria-label': 'Days of the week' });
  DOW.forEach((d) => {
    const dow = el('span', 'cal-dow');
    dow.textContent = d;
    calGrid.append(dow);
  });
  const brew = el('div', 'brew', { 'data-brew': '' });
  const days = [];
  dayRows.forEach((row) => {
    const [numCell, ...rest] = [...row.children];
    const brewNodes = rest.flatMap(cellNodes);
    const day = el('div', 'cal-day');
    cellNodes(numCell).forEach((n) => day.append(n));
    calGrid.append(day);
    if (!brewNodes.length) {
      day.classList.add('cal-day-muted');
      return;
    }
    const { item, tag } = buildBrew(brewNodes);
    day.setAttribute('role', 'button');
    day.setAttribute('tabindex', '0');
    day.setAttribute('aria-pressed', 'false');
    day.dataset.day = '';
    if (tag) day.dataset.brewTag = tag;
    brew.append(item);
    days.push({ btn: day, item, initial: !!numCell.querySelector('strong, b') });
  });
  cal.append(head, calGrid);
  panel.append(cal);
  if (days.length) panel.append(brew);

  grid.append(copy, panel);
  block.replaceChildren(grid);
  revealAll([[copy, 0], [panel, 0.12]]);
  if (days.length) initCalendar(panel, days);
}
