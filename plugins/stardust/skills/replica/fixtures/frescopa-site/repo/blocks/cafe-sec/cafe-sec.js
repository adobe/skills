/**
 * cafe-sec — the café page's content sections (prototype section.cafe-sec ×5), one block
 * with variants. Schema: stardust/eds-schema/frescopa-atelier-cafe-html.json § cafe-sec.
 *
 * Every variant starts with a head row: eyebrow <p> → <h2> → (variant copy). Then:
 *   reasons    one row per reason: <h3> + <p> (decorative line icon by position)
 *   rooms      one row per room: copy cell (eyebrow <p>, <h3>, <p>, link <p>) + image cell;
 *              an image-first row is the prototype's .room--flip
 *   events     one row per event: day <p>, <h3>, <p>, time <p>, price <p>
 *   locations  head copy = lede; a stats row (one cell per stat: number <p> + label <p>);
 *              the flagship row (badge cell + copy: eyebrow, <h3>, <p>, tags <ul>, address,
 *              hours, primary CTA); the finder row (search placeholder cell + one region
 *              pill <p> each, the first = all); one row per café: region cell + <h3>, city,
 *              address, tags <ul>, hours, link <p>
 *   tour       head copy = text <p> + <ul>; a form title row (<h3>); one row per field:
 *              label | type (select, date, text, email, tel, chips; + "half" pairs two
 *              fields on one line) | placeholder <p> and/or options <ul>; the submit row
 *              (<strong><a>); the fine-print row
 * Modifier `alt` = the paper-2 ground. Variants are inferred from content when unauthored.
 * Behaviour (live motion record, progress.json types.cafe): location finder — region pills
 * + search (name/city, trimmed, case-insensitive, AND) + count line + empty note; tour
 * request — chips toggle, ordered validation, confirmation, reset.
 * @ew-exempt config cells — café region labels, field types, placeholders, select options
 * @ew-exempt <p> region pill, interest chip and submit labels — moved into <button> hosts (EW7)
 */

const VARIANTS = ['reasons', 'rooms', 'events', 'locations', 'tour'];
const SECTION_IDS = {
  rooms: 'experience',
  events: 'whatson',
  locations: 'locations',
  tour: 'tour',
};
const TITLE_MOD = {
  reasons: 'w20',
  rooms: 'w22',
  locations: 'xl',
  tour: 'w18',
};

const svg = (w, stroke, body) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" `
  + `fill="none" stroke="var(${stroke})" stroke-width="1.6" stroke-linecap="round" `
  + `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const REASON_ICONS = [
  '<path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2"/>'
    + '<path d="M7 4c0 .8-.5 1.2-.5 2M11 4c0 .8-.5 1.2-.5 2"/>',
  '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="2"/>'
    + '<path d="M14 8h3M14 11h3M7 15h10"/>',
  '<path d="M12 4c-3 2-6 2-7 2 0 6 2.5 10 7 12 4.5-2 7-6 7-12-1 0-4 0-7-2Z"/>'
    + '<path d="M9 11l2 2 4-4"/>',
  '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/>'
    + '<path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 19a4.5 4.5 0 0 1 6-3.9"/>',
];
const SEARCH_ICON = svg(20, '--ink-soft', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
const PIN_ICON = svg(22, '--terracotta', '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 '
  + '10-6 10Z"/><circle cx="12" cy="11" r="2.2"/>');
const CHECK_ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" '
  + 'stroke="var(--burgundy)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

// the source's unfilled <image-slot> (live element's own shadow stylesheet; as machine-band)
const SLOT_CSS = ':host{display:block;position:relative;'
  + 'font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);'
  + 'width:100%;height:100%;aspect-ratio:3/2}'
  + '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
  + 'justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;'
  + 'background:rgba(0,0,0,.04)}'
  + '.empty svg{display:block;opacity:.45}.cap{max-width:90%;font-weight:500;letter-spacing:.01em}'
  + '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25)}';
const SLOT_ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" '
  + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/>'
  + '<circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
const MAP_CAPTION = 'Map of Fréscopa cafés near you';

/* ---------- helpers ---------- */

function el(tag, className, ...kids) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...kids.filter(Boolean));
  return e;
}

const isHeading = (n) => /^H[1-6]$/.test(n.tagName);
const hasMedia = (n) => n.matches('picture, img') || !!n.querySelector('picture, img');
const text = (n) => (n ? n.textContent.trim() : '');
const BLOCKY = ':scope > :is(p, h1, h2, h3, h4, h5, h6, ul, ol, picture, img, div)';

/** A cell's authored elements; a bare-text cell (DA single paragraph) is wrapped in a <p>. */
function nodesOf(cell) {
  if (!cell) return [];
  if (!cell.querySelector(BLOCKY) && cell.textContent.trim()) {
    const p = document.createElement('p');
    p.append(...cell.childNodes);
    cell.append(p);
  }
  return [...cell.children];
}

const rowNodes = (row) => [...row.children].flatMap(nodesOf);

function imageSlot(caption) {
  const slot = document.createElement('image-slot');
  slot.setAttribute('shape', 'rect');
  slot.setAttribute('placeholder', caption);
  const root = slot.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SLOT_CSS;
  const empty = el('div', 'empty');
  empty.innerHTML = SLOT_ICON;
  const cap = el('div', 'cap');
  cap.textContent = caption; // presentational placeholder caption, not authored text
  empty.append(cap);
  root.append(style, empty, el('div', 'ring'));
  return slot;
}

// trailing arrow glyph of the canon .link (a separate element; the authored text is untouched)
function appendArrow(a) {
  if (!a || a.querySelector('.arrow') || /→\s*$/.test(a.textContent)) return;
  const arrow = el('span', 'arrow');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  if (!document.body.classList.contains('app')) a.append(' ');
  a.append(arrow);
}

// a plain (unformatted) link stays a text link: undo a stock lone-link buttonization
function linkWrap(p, className) {
  const a = p.querySelector('a');
  if (a && !a.matches('.primary, .secondary, .accent')) {
    a.classList.remove('button');
    p.classList.remove('button-container');
  }
  const w = el('div', `${className} link-wrap`, p);
  appendArrow(a);
  return w;
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

/** Head row: eyebrow (inline, before the heading) → title → the rest (returned). */
function decodeHead(row, variant, container) {
  const nodes = row ? rowNodes(row) : [];
  const heading = nodes.find(isHeading);
  const rest = [];
  let seen = false;
  const head = [];
  nodes.forEach((n) => {
    if (n === heading) {
      seen = true;
      const mod = TITLE_MOD[variant];
      head.push(el('div', `cafe-sec-title${mod ? ` ${mod}` : ''}`, n));
    } else if (!seen) {
      head.push(el('div', 'cafe-sec-eyebrow', n));
    } else {
      rest.push(n);
    }
  });
  if (variant === 'events') {
    const titleBox = el('div', 'whatson-copy', ...head);
    container.append(el('div', 'whatson-head', titleBox, ...rest.map((n) => el('div', 'whatson-note', n))));
    return [];
  }
  container.append(...head);
  return rest;
}

/* ---------- variants ---------- */

function decodeReasons(rows, container) {
  const grid = el('div', 'reasons');
  rows.forEach((row, i) => {
    const card = el('div', 'reason');
    card.insertAdjacentHTML('beforeend', svg(30, '--terracotta', REASON_ICONS[i % REASON_ICONS.length]));
    rowNodes(row).forEach((n) => {
      card.append(el('div', isHeading(n) ? 'reason-title' : 'reason-text', n));
    });
    grid.append(card);
  });
  container.append(grid);
}

function decodeRooms(rows, container) {
  rows.forEach((row) => {
    const cells = [...row.children];
    const mediaFirst = cells.length > 1 && hasMedia(cells[0]);
    const room = el('div', `room${mediaFirst ? ' flip' : ''}`);
    const body = el('div', 'room-body');
    const media = el('div', 'room-media');
    let seen = false;
    cells.flatMap(nodesOf).forEach((n) => {
      if (hasMedia(n)) {
        media.append(n);
      } else if (isHeading(n)) {
        seen = true;
        body.append(el('div', 'room-title', n));
      } else if (n.querySelector('a')) {
        body.append(linkWrap(n, 'room-cta'));
      } else {
        body.append(el('div', seen ? 'room-text' : 'room-eyebrow', n));
      }
    });
    if (mediaFirst) room.append(media, body);
    else room.append(body, media);
    container.append(room);
  });
}

function decodeEvents(rows, container) {
  const grid = el('div', 'events');
  rows.forEach((row) => {
    const card = el('article', 'event');
    const foot = el('div', 'event-foot');
    let seen = false;
    let textDone = false;
    const after = [];
    rowNodes(row).forEach((n) => {
      if (isHeading(n)) {
        seen = true;
        card.append(el('div', 'event-title', n));
      } else if (!seen) {
        card.append(el('div', 'event-day', n));
      } else if (!textDone) {
        textDone = true;
        card.append(el('div', 'event-text', n));
      } else {
        after.push(n);
      }
    });
    after.forEach((n, i) => {
      foot.append(el('div', i === after.length - 1 && after.length > 1 ? 'event-price' : 'event-time', n));
    });
    if (foot.children.length) card.append(foot);
    grid.append(card);
  });
  container.append(grid);
}

const isStatRow = (row) => {
  const cells = [...row.children];
  return cells.length > 1 && cells.every((c) => /^[\d.,]+\+?$/.test(text(c.firstElementChild || c)));
};

function decodeStats(row) {
  const stats = el('div', 'stats');
  [...row.children].forEach((cell) => {
    const [num, ...labels] = nodesOf(cell);
    stats.append(el('div', 'stat', el('div', 'stat-num', num), ...labels.map((l) => el('div', 'stat-label', l))));
  });
  return stats;
}

/** Tag pills: each item's text moves into an inner inline span (live's pill box + text). */
function tagList(list) {
  [...list.children].forEach((li) => {
    if (li.querySelector(':scope > span.tag-text')) return;
    const span = el('span', 'tag-text');
    span.append(...li.childNodes);
    li.append(span);
  });
  return list;
}

/** Splits a place (flagship / café) row into its copy roles. */
function placeParts(nodes) {
  const parts = {
    eyebrow: [], heading: null, city: [], copy: [], tags: null, meta: [], cta: null, link: null,
  };
  nodes.forEach((n) => {
    if (isHeading(n)) parts.heading = n;
    else if (n.matches('ul, ol')) parts.tags = n;
    else if (n.querySelector('strong a, a.button')) parts.cta = n;
    else if (n.querySelector('a')) parts.link = n;
    else if (!parts.heading) parts.eyebrow.push(n);
    else if (!parts.tags) parts.copy.push(n);
    else parts.meta.push(n);
  });
  return parts;
}

function decodeFlagship(row) {
  const cells = [...row.children];
  const copyCell = cells.find((c) => c.querySelector('h1, h2, h3, h4, h5, h6')) || cells[cells.length - 1];
  const badgeNodes = cells.filter((c) => c !== copyCell).flatMap(nodesOf);
  const p = placeParts(nodesOf(copyCell));
  const media = el('div', 'flagship-media');
  const pic = badgeNodes.find(hasMedia);
  const where = text(p.eyebrow[0]).split('·').pop().trim();
  media.append(pic || imageSlot(`Fréscopa ${where} flagship`));
  badgeNodes.filter((n) => n !== pic && text(n)).forEach((n) => {
    media.append(el('div', 'flagship-badge', el('div', 'badge badge-burgundy', n)));
  });
  const body = el('div', 'flagship-body');
  p.eyebrow.forEach((n) => body.append(el('div', 'flagship-eyebrow', n)));
  if (p.heading) body.append(el('div', 'flagship-title', p.heading));
  p.copy.forEach((n) => body.append(el('div', 'flagship-text', n)));
  if (p.tags) body.append(el('div', 'flagship-tags tags', tagList(p.tags)));
  if (p.meta.length) {
    const meta = el('div', 'flagship-meta');
    p.meta.forEach((n, i) => meta.append(el('div', i ? 'flagship-hours' : 'flagship-addr', n)));
    body.append(meta);
  }
  if (p.cta) body.append(el('div', 'flagship-cta', p.cta));
  if (p.link) body.append(linkWrap(p.link, 'flagship-cta'));
  return el('article', 'flagship', media, body);
}

function decodeLocation(row) {
  const cells = [...row.children];
  const copyCell = cells.find((c) => c.querySelector('h1, h2, h3, h4, h5, h6'));
  const region = cells.filter((c) => c !== copyCell).map((c) => text(c)).join(' ').trim();
  const p = placeParts(nodesOf(copyCell));
  const card = el('article', 'loc');
  card.dataset.region = region;
  card.insertAdjacentHTML('beforeend', PIN_ICON);
  const body = el('div', 'loc-body');
  const head = el('div', 'loc-head');
  if (p.heading) head.append(el('div', 'loc-name', p.heading));
  const [city, ...addr] = p.copy;
  if (city) head.append(el('div', 'loc-city', city));
  body.append(head);
  addr.forEach((n) => body.append(el('div', 'loc-addr', n)));
  if (p.tags) body.append(el('div', 'loc-tags tags', tagList(p.tags)));
  const foot = el('div', 'loc-foot');
  p.meta.forEach((n) => foot.append(el('div', 'loc-hours', n)));
  if (p.link) foot.append(linkWrap(p.link, 'loc-link link-sm'));
  if (p.cta) foot.append(el('div', 'loc-link', p.cta));
  body.append(foot);
  card.append(body);
  return card;
}

function decodeFinder(row, cafes) {
  const cells = [...row.children];
  const [searchCell, ...pillCells] = cells.length > 1 ? cells : [null, ...cells];
  const placeholder = searchCell ? text(searchCell) : '';
  const input = el('input', 'finder-input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder || 'Search cafés');
  const search = el('div', 'finder-search');
  search.insertAdjacentHTML('beforeend', SEARCH_ICON);
  search.append(input);

  const pills = el('div', 'finder-pills');
  pillCells.flatMap(nodesOf).filter((n) => text(n)).forEach((n, i) => {
    const pill = el('button', `filter-pill${i === 0 ? ' is-active' : ''}`, n);
    pill.type = 'button';
    pill.dataset.filter = i === 0 ? 'all' : text(n);
    pill.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    pills.append(pill);
  });

  const count = el('p', 'finder-count');
  count.setAttribute('aria-live', 'polite');
  const list = el('div', 'finder-list', ...cafes);
  const grid = el(
    'div',
    'finder-grid',
    el('div', 'finder-map', imageSlot(MAP_CAPTION)),
    el('div', 'finder-results', count, list),
  );
  return el('div', 'finder', search, pills, grid);
}

/** Location finder (dynamic-features row 13): region pill AND search over name + city. */
async function initFinder(finder) {
  const input = finder.querySelector('.finder-input');
  const list = finder.querySelector('.finder-list');
  const count = finder.querySelector('.finder-count');
  const cards = [...list.querySelectorAll('.loc')];
  let region = 'all';
  const empty = el('div', 'finder-empty');
  const emptyTitle = el('p', 'finder-empty-title');
  const emptyText = el('p', 'finder-empty-text');
  emptyText.textContent = 'Try a nearby city, or clear your search to see them all.';
  empty.append(emptyTitle, emptyText);

  const render = () => {
    const raw = input.value.trim();
    const q = raw.toLowerCase();
    let n = 0;
    cards.forEach((c) => {
      const hay = `${text(c.querySelector('.loc-name'))} ${text(c.querySelector('.loc-city'))}`;
      const show = (region === 'all' || c.dataset.region === region)
        && (!q || hay.toLowerCase().includes(q));
      c.hidden = !show;
      if (show) n += 1;
    });
    if (n === 0) {
      count.textContent = 'No matches';
      emptyTitle.textContent = `No cafés match “${raw}”.`;
      if (!empty.parentNode) list.append(empty);
    } else {
      count.textContent = `${n}${n === 1 ? ' café near you' : ' cafés near you'}`;
      if (empty.parentNode) empty.remove();
    }
  };
  render();
  input.addEventListener('input', render);
  const w = await loadWidgets();
  const onFilter = (value) => {
    region = value;
    render();
  };
  if (w) w.initFilterPills(finder.querySelector('.finder-pills'), onFilter);
}

// the flagship is the place row with media or an eyebrow before its heading; café rows lead
// with their heading
function isFlagshipRow(row) {
  if (row.querySelector('picture, img')) return true;
  const copy = [...row.children].find((c) => c.querySelector('h1, h2, h3, h4, h5, h6'));
  const first = copy && nodesOf(copy)[0];
  return !!first && !isHeading(first);
}

function decodeLocations(rows, container, rest) {
  rest.forEach((n) => container.append(el('div', 'locations-lede', n)));
  const cafes = [];
  let finderRow = null;
  const order = [];
  rows.forEach((row) => {
    const hasH = !!row.querySelector('h1, h2, h3, h4, h5, h6');
    if (isStatRow(row)) order.push(decodeStats(row));
    else if (hasH && isFlagshipRow(row)) order.push(decodeFlagship(row));
    else if (hasH) cafes.push(decodeLocation(row));
    else finderRow = row;
  });
  container.append(...order);
  if (finderRow || cafes.length) {
    const finder = decodeFinder(finderRow || el('div'), cafes);
    container.append(finder);
    initFinder(finder);
  }
}

/* ---------- tour request ---------- */

const fieldKey = (label) => text(label).split(/\s/)[0].normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

function buildField(row) {
  const cells = [...row.children];
  const [labelCell, typeCell, valueCell] = cells;
  const label = nodesOf(labelCell)[0];
  const typeWords = text(typeCell).toLowerCase().split(/\s+/);
  const type = typeWords[0] || 'text';
  const values = valueCell ? nodesOf(valueCell) : [];
  const key = fieldKey(label);
  const labelBox = el('div', 'field-label', label);

  if (type === 'chips') {
    const chips = el('div', 'chips');
    values.flatMap((n) => (n.matches('ul, ol') ? [...n.children] : [n])).forEach((n) => {
      const chip = el('button', 'chip', n);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', 'false');
      chips.append(chip);
    });
    return { node: el('div', 'field field-chips', labelBox, chips), half: false };
  }

  let control;
  const placeholder = values.find((n) => n.tagName === 'P');
  if (type === 'select') {
    control = el('select', 'field-control');
    const opts = [];
    if (placeholder) opts.push(['', text(placeholder)]);
    values.filter((n) => n.matches('ul, ol')).forEach((ul) => {
      [...ul.children].forEach((li) => opts.push([text(li), text(li)]));
    });
    opts.forEach(([value, label2]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label2;
      control.append(o);
    });
  } else {
    control = el('input', 'field-control');
    control.type = type;
    if (placeholder) control.placeholder = text(placeholder);
  }
  control.dataset.field = key;
  values.forEach((n) => n.remove());
  return { node: el('label', 'field', labelBox, control), half: typeWords.includes('half') };
}

const isFieldRow = (row) => [...row.children].length >= 2
  && /^(select|date|text|email|tel|number|chips)\b/i.test(text(row.children[1]));

function confirmation(form, f) {
  const when = new Date(`${f.date.value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const email = f.email.value.trim();
  const mark = el('div', 'tour-done-mark');
  mark.innerHTML = CHECK_ICON;
  const title = el('h3', 'tour-done-title');
  title.textContent = `You're on the list, ${f.name.value.trim()}.`;
  const msg = el('p', 'tour-done-text');
  msg.textContent = `Your Atelier tour at ${f.cafe.value.split(' — ')[0]} is requested for ${when} `
    + `at ${f.time.value}, for ${(f.guests ? f.guests.value : '').toLowerCase()}.`;
  const strong = document.createElement('strong');
  strong.textContent = email;
  const note = el('p', 'tour-done-note', 'We\'ve sent a confirmation to ', strong, '. See you soon.');
  const again = el('button', 'button secondary', 'Book another tour');
  again.type = 'button';
  const done = el('div', 'tour-done', mark, title, msg, note, el('div', 'tour-done-cta', again));
  again.addEventListener('click', () => {
    form.reset();
    form.querySelectorAll('.chip').forEach((c) => {
      c.setAttribute('aria-pressed', 'false');
      c.classList.remove('is-on');
    });
    done.remove();
    form.hidden = false;
  });
  return done;
}

/** Tour request (dynamic-features row 4, client-only). */
function initTour(card, form, submitWrap) {
  const error = el('p', 'tour-form-error');
  error.setAttribute('role', 'alert');
  const fail = (msg) => {
    error.textContent = msg;
    if (!error.parentNode) form.insertBefore(error, submitWrap);
  };
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      chip.classList.toggle('is-on', on);
      return;
    }
    const submit = e.target.closest('.tour-form-submit a');
    if (submit) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = {};
    form.querySelectorAll('[data-field]').forEach((c) => {
      f[c.dataset.field] = c;
    });
    const val = (k) => (f[k] ? f[k].value.trim() : '');
    if (!val('cafe')) return fail('Please choose which café you’d like to visit.');
    if (!val('date')) return fail('Please pick a date for your tour.');
    if (!val('time')) return fail('Please choose a time slot.');
    if (!val('name')) return fail('Please add your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email'))) return fail('Please enter a valid email address.');
    if (error.parentNode) error.remove();
    const done = confirmation(form, f);
    form.hidden = true;
    card.append(done);
    return true;
  });
}

// a paragraph that is only bold text = the submit label (bold, the primary convention)
const isStrongOnly = (n) => {
  const strong = n.querySelector(':scope > strong');
  return !!strong && !n.querySelector('a') && text(strong) === text(n);
};

function decodeTour(rows, container, rest) {
  const intro = el('div', 'tour-intro');
  [...container.children].forEach((n) => intro.append(n));
  rest.forEach((n) => {
    if (n.matches('ul, ol')) {
      n.querySelectorAll(':scope > li').forEach((li) => {
        const arrow = el('span', 'tour-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        li.prepend(arrow);
      });
      intro.append(el('div', 'tour-list', n));
    } else {
      intro.append(el('div', 'tour-text', n));
    }
  });

  const form = el('form', 'tour-form');
  form.action = '#';
  form.noValidate = true;
  let pending = null;
  let submitWrap = null;
  rows.forEach((row) => {
    if (isFieldRow(row)) {
      const { node, half } = buildField(row);
      if (half && pending) {
        pending.append(node);
        pending = null;
      } else if (half) {
        pending = el('div', 'field-row', node);
        form.append(pending);
      } else {
        pending = null;
        form.append(node);
      }
      return;
    }
    pending = null;
    rowNodes(row).forEach((n) => {
      if (isHeading(n)) form.append(el('div', 'tour-form-title', n));
      else if (isStrongOnly(n)) {
        const btn = el('button', 'button primary', n);
        btn.type = 'submit';
        const arrow = el('span', 'arrow');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        btn.append(arrow);
        submitWrap = el('div', 'tour-form-submit', btn);
        form.append(submitWrap);
      } else if (n.querySelector('a')) {
        submitWrap = el('div', 'tour-form-submit', n);
        const a = n.querySelector('a');
        a.setAttribute('role', 'button');
        form.append(submitWrap);
      } else if (text(n)) form.append(el('div', 'tour-form-fine', n));
    });
  });
  const card = el('div', 'tour-card', form);
  container.append(el('div', 'tour', intro, card));
  initTour(card, form, submitWrap);
}

/* ---------- decorate ---------- */

function inferVariant(block, rows) {
  const v = VARIANTS.find((name) => block.classList.contains(name));
  if (v) return v;
  if (rows.some(isFieldRow)) return 'tour';
  if (rows.some(isStatRow)) return 'locations';
  if (block.querySelector('picture, img')) return 'rooms';
  const body = rows.slice(1);
  if (body.length && body.every((r) => r.querySelector('h3') && r.querySelectorAll('p').length >= 3)) {
    return 'events';
  }
  return 'reasons';
}

export default function decorate(block) {
  if (block.querySelector(':scope > .container')) return; // re-entrant (EW9)
  const rows = [...block.children];
  const variant = inferVariant(block, rows);
  block.classList.add(variant);
  const section = block.closest('.section');
  if (section && !section.id && SECTION_IDS[variant]) section.id = SECTION_IDS[variant];

  const headIdx = rows.findIndex((r) => r.querySelector('h2'));
  const head = headIdx >= 0 ? rows[headIdx] : null;
  const body = rows.filter((r) => r !== head);
  const container = el('div', 'container');
  const rest = decodeHead(head, variant, container);

  if (variant === 'reasons') decodeReasons(body, container);
  else if (variant === 'rooms') decodeRooms(body, container);
  else if (variant === 'events') decodeEvents(body, container);
  else if (variant === 'locations') decodeLocations(body, container, rest);
  else if (variant === 'tour') decodeTour(body, container, rest);
  if (variant !== 'locations' && variant !== 'tour') {
    rest.forEach((n) => container.append(el('div', 'cafe-sec-text', n)));
  }
  block.replaceChildren(container);
}
