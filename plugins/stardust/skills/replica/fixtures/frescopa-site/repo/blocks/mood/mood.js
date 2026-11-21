/**
 * mood — "Mood-aware brewing": copy column + calendar → brew suggestion
 * (prototype section.mood). Schema: stardust/eds-schema/frescopa-atelier.json § mood.
 *
 * Authored rows:
 *   1. copy — eyebrow <p> → <h2> → lede <p> → hint <p> ("Tap a day …")
 *   2. calendar head — month <p>, year <p>, then a <ul> of the weekday initials
 *   3..n. one row per calendar day: the day number <p> (the initially selected day in
 *      <strong>); a day with a suggestion continues with tag <p> → title <h3> → note <p>;
 *      a number alone is a muted (non-selectable) day.
 *
 * Behaviour (dynamic-features row 10): clicking a day shows its suggestion; once on screen
 * the days auto-cycle every 3 s until one is clicked (source app.js initCalendar).
 */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const isDayNumber = (el) => el && el.tagName === 'P' && /^\d{1,2}$/.test(el.textContent.trim());

function initCalendar(panel, days, whenOnScreen) {
  const activate = (day) => {
    days.forEach((d) => {
      const on = d.button === day.button;
      d.button.classList.toggle('is-active', on);
      d.button.setAttribute('aria-pressed', on ? 'true' : 'false');
      d.brew.hidden = !on;
    });
  };
  let timer = null;
  days.forEach((d) => d.button.addEventListener('click', () => {
    activate(d);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }));
  const initial = days.find((d) => d.button.classList.contains('is-active')) || days[0];
  activate(initial);
  if (reduce || !whenOnScreen) return;
  let idx = Math.max(0, days.indexOf(initial));
  const schedule = () => {
    timer = setTimeout(() => {
      idx = (idx + 1) % days.length;
      activate(days[idx]);
      schedule();
    }, 3000);
  };
  whenOnScreen(panel, schedule);
}

export default async function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'mood';
  const rows = [...block.querySelectorAll(':scope > div')];
  const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')];
  const dayRows = rows.filter((r) => isDayNumber(cellNodes(r)[0]));
  const headRow = rows.find((r) => !dayRows.includes(r) && r.querySelector('ul, ol'));
  const copyRow = rows.find((r) => !dayRows.includes(r) && r !== headRow);

  const copy = document.createElement('div');
  copy.className = 'mood-copy';
  let seenHeading = false;
  let ledeDone = false;
  if (copyRow) {
    cellNodes(copyRow).forEach((n) => {
      if (isHeading(n)) {
        seenHeading = true;
        copy.append(wrapNode(n, 'mood-title'));
      } else if (!seenHeading) {
        copy.append(wrapNode(n, 'eyebrow'));
      } else if (!ledeDone) {
        ledeDone = true;
        copy.append(wrapNode(n, 'lede'));
      } else {
        copy.append(wrapNode(n, 'mood-hint'));
      }
    });
  }

  const cal = document.createElement('div');
  cal.className = 'cal';
  const calHead = document.createElement('div');
  calHead.className = 'cal-head';
  const calGrid = document.createElement('div');
  calGrid.className = 'cal-grid';
  calGrid.setAttribute('role', 'group');
  calGrid.setAttribute('aria-label', 'Days of the week');
  if (headRow) {
    const [month, year] = cellNodes(headRow).filter((n) => n.tagName === 'P');
    if (month) calHead.append(wrapNode(month, 'cal-month'));
    if (year) calHead.append(wrapNode(year, 'cal-year'));
    const dow = headRow.querySelector('ul, ol');
    if (dow) calGrid.append(dow);
  }
  cal.append(calHead, calGrid);

  const brew = document.createElement('div');
  brew.className = 'brew';
  const days = [];
  dayRows.forEach((row) => {
    const [num, ...rest] = cellNodes(row);
    if (!rest.length) {
      calGrid.append(wrapNode(num, 'cal-day cal-day-muted'));
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    if (num.querySelector('strong, b')) btn.classList.add('is-active');
    btn.append(num);
    calGrid.append(btn);
    const panel = document.createElement('div');
    panel.className = 'brew-panel';
    const hIdx = rest.findIndex(isHeading);
    rest.forEach((n, j) => {
      if (isHeading(n)) panel.append(wrapNode(n, 'brew-title'));
      else if (hIdx > -1 && j < hIdx) panel.append(wrapNode(n, 'brew-tag'));
      else panel.append(wrapNode(n, 'brew-note'));
    });
    brew.append(panel);
    days.push({ button: btn, brew: panel });
  });

  const panelBox = document.createElement('div');
  panelBox.className = 'mood-panel';
  panelBox.append(cal, brew);

  const grid = document.createElement('div');
  grid.className = 'container mood-grid';
  grid.append(copy, panelBox);
  block.replaceChildren(grid);

  const w = await loadWidgets();
  if (days.length) initCalendar(panelBox, days, w && w.whenOnScreen);
  if (!w) return;
  w.reveal(copy);
  w.reveal(panelBox, 0.12);
}
