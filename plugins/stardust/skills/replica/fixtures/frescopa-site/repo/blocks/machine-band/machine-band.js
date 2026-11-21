/**
 * machine-band — one machine family band (prototype section.machine-band ×4).
 * Schema: stardust/eds-schema/frescopa-atelier-machines-html.json § machine-band.
 * Band head template-slotted; machines reconstructive (one row per machine, any field order).
 *
 * @variants block class: feature | grid | solo (default: solo for one machine, feature when
 *   the first machine carries a list, else grid)
 *   feature — the first machine is the large featured card, the rest "Also in this family"
 *   grid    — every machine is a grid card
 *   solo    — every machine is a wide single card
 *
 * Authored rows:
 *   1. head — cell 1: eyebrow <p> (family name first, "·" then a qualifier) → <h2> → value <p>;
 *      cell 2: note label <p> → note <p>
 *   2..n. one row per machine — media cell: photo (+ a short badge <p>, e.g. New), left empty
 *      for an unfilled image slot; body cell: category <p> → <h3> name → blurb <p>
 *      → optional <ul> features → price <p> ($2,199) → CTA <p> (bare link = text link,
 *      strong/em = button)
 *   a heading-less row after the first machine — the companions label (Also in this family)
 *
 * The eyebrow's family name keys the band for machines-filter (data-band); grounds alternate
 * by visible band index (.alt). A machine without a photo renders the source's empty
 * <image-slot> placeholder (its own shadow stylesheet, captioned with the machine name).
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

// trailing arrow glyph of the canon .link (a separate element, never edits the authored text)
function appendArrow(el) {
  if (el.querySelector('.arrow') || /→\s*$/.test(el.textContent)) return;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  if (!document.body.classList.contains('app')) el.append(' ');
  el.append(arrow);
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const hasMedia = (el) => el.matches('picture, img') || !!el.querySelector('picture, img');
const isPrice = (el) => /^[£$€]\s?\d/.test(el.textContent.trim());
const isCta = (el) => {
  const a = el.querySelector('a');
  return !!a && el.textContent.trim() === a.textContent.trim();
};
const familyKey = (s) => s.split('·')[0].trim().toLowerCase().replace(/\s+/g, '-');

const KINDS = {
  feature: 'machine-feature',
  companion: 'companion-card',
  card: 'machine-card',
  solo: 'machine-solo',
};

// the source's unfilled <image-slot> (live element's own shadow stylesheet)
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

function imageSlot(caption) {
  const slot = document.createElement('image-slot');
  slot.setAttribute('shape', 'rect');
  slot.setAttribute('placeholder', caption);
  const root = slot.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SLOT_CSS;
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.innerHTML = SLOT_ICON;
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = caption; // presentational placeholder caption, not authored text
  empty.append(cap);
  const ring = document.createElement('div');
  ring.className = 'ring';
  root.append(style, empty, ring);
  return slot;
}

// cells may arrive folded into one <p> by wrapTextNodes (#104) — expand them
function cellKids(cell) {
  const kids = [...cell.children];
  if (kids.length === 1 && kids[0].tagName === 'P' && kids[0].querySelector('picture, img')
    && kids[0].children.length > 1) {
    return [...kids[0].children];
  }
  return kids;
}

/** Splits one machine row into media nodes, badge nodes and body nodes. */
function machineParts(row) {
  const media = [];
  const badges = [];
  const body = [];
  const cells = [...row.querySelectorAll(':scope > div')];
  const flat = cells.length < 2;
  cells.forEach((cell) => {
    const kids = cellKids(cell);
    const bodyCell = flat || kids.some(isHeading);
    kids.forEach((n) => {
      if (hasMedia(n)) media.push(n.querySelector('picture') || n);
      else if (!bodyCell) badges.push(n);
      else body.push(n);
    });
  });
  return { media, badges, body };
}

function buildMachine(row, kind) {
  const prefix = KINDS[kind];
  const { media, badges, body } = machineParts(row);
  const card = document.createElement('article');
  card.className = prefix;
  const mediaBox = document.createElement('div');
  mediaBox.className = `${prefix}-media`;
  const bodyBox = document.createElement('div');
  bodyBox.className = `${prefix}-body`;
  const textBox = kind === 'companion' ? document.createElement('div') : bodyBox;
  if (kind === 'companion') textBox.className = `${prefix}-text`;
  const foot = document.createElement('div');
  foot.className = kind === 'companion' ? `${prefix}-buy` : `${prefix}-foot`;

  const hIdx = body.findIndex(isHeading);
  const heading = body[hIdx];
  body.forEach((n, i) => {
    if (n === heading) {
      textBox.append(wrapNode(n, `${prefix}-name`));
    } else if (hIdx > -1 && i < hIdx) {
      textBox.append(wrapNode(n, `${prefix}-cat`));
    } else if (n.matches('ul, ol')) {
      n.querySelectorAll(':scope > li').forEach((li) => {
        if (li.querySelector('.machine-feature-arrow') || /^\s*→/.test(li.textContent)) return;
        const arrow = document.createElement('span');
        arrow.className = 'machine-feature-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        li.prepend(arrow);
      });
      textBox.append(wrapNode(n, `${prefix}-list`));
    } else if (isPrice(n)) {
      foot.append(wrapNode(n, `${prefix}-price`));
    } else if (isCta(n)) {
      const a = n.querySelector('a');
      if (a.classList.contains('button')) {
        foot.append(n);
      } else {
        appendArrow(a);
        foot.append(wrapNode(n, 'link-wrap link-sm'));
      }
    } else {
      textBox.append(wrapNode(n, `${prefix}-blurb`));
    }
  });

  if (media.length) {
    mediaBox.append(...media);
  } else {
    mediaBox.append(imageSlot(heading ? heading.textContent.trim() : ''));
  }
  if (badges.length) {
    const badgeBox = document.createElement('div');
    badgeBox.className = 'machine-feature-badge';
    badges.forEach((b) => badgeBox.append(wrapNode(b, 'badge badge-burgundy')));
    mediaBox.append(badgeBox);
  }
  if (kind === 'companion') bodyBox.append(textBox);
  if (foot.children.length) bodyBox.append(foot);
  card.append(mediaBox, bodyBox);
  return card;
}

function buildHead(rows) {
  const head = document.createElement('div');
  head.className = 'band-head';
  const lead = document.createElement('div');
  lead.className = 'band-head-lead';
  const note = document.createElement('div');
  note.className = 'band-head-note';
  let key = '';
  rows.forEach((row) => row.querySelectorAll(':scope > div').forEach((cell) => {
    const kids = cellKids(cell);
    const leadCell = kids.some(isHeading) || !lead.children.length;
    let seenHeading = false;
    kids.forEach((n) => {
      if (!leadCell) {
        const cls = note.children.length ? 'band-head-note-text' : 'band-head-note-label';
        note.append(wrapNode(n, cls));
      } else if (isHeading(n)) {
        seenHeading = true;
        lead.append(wrapNode(n, 'band-head-title'));
      } else if (!seenHeading && kids.some(isHeading)) {
        if (!key) key = familyKey(n.textContent);
        lead.append(wrapNode(n, 'band-head-eyebrow'));
      } else {
        lead.append(wrapNode(n, 'band-head-value'));
      }
    });
  }));
  head.append(lead);
  if (note.children.length) head.append(note);
  return { head, key };
}

export default function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const firstMachine = rows.findIndex((r) => r.querySelector('h3, h4, h5, h6, picture, img'));
  const headRows = firstMachine === -1 ? rows : rows.slice(0, firstMachine);
  const rest = firstMachine === -1 ? [] : rows.slice(firstMachine);
  const machineRows = rest.filter((r) => r.querySelector('h3, h4, h5, h6, picture, img'));
  const labelRows = rest.filter((r) => !machineRows.includes(r));

  let layout = ['feature', 'grid', 'solo'].find((v) => block.classList.contains(v));
  if (!layout) {
    if (machineRows.length === 1) layout = 'solo';
    else if (machineRows[0] && machineRows[0].querySelector('ul, ol')) layout = 'feature';
    else layout = 'grid';
    block.classList.add(layout);
  }

  const { head, key } = buildHead(headRows);
  if (key) block.dataset.band = key;
  const container = document.createElement('div');
  container.className = 'container';
  container.append(head);

  if (layout === 'feature') {
    const [lead, ...others] = machineRows;
    if (lead) container.append(buildMachine(lead, 'feature'));
    const companions = document.createElement('div');
    companions.className = 'companions';
    labelRows.forEach((row) => row.querySelectorAll(':scope > div').forEach((cell) => {
      cellKids(cell).forEach((n) => companions.append(wrapNode(n, 'companions-label')));
    }));
    others.forEach((row) => companions.append(buildMachine(row, 'companion')));
    if (companions.children.length) container.append(companions);
  } else if (layout === 'grid') {
    const grid = document.createElement('div');
    grid.className = 'machine-grid';
    machineRows.forEach((row) => grid.append(buildMachine(row, 'card')));
    container.append(grid);
  } else {
    machineRows.forEach((row) => container.append(buildMachine(row, 'solo')));
  }
  // leftovers pass: a heading-less row in a non-feature band stays visible
  if (layout !== 'feature') {
    labelRows.forEach((row) => row.querySelectorAll(':scope > div').forEach((cell) => {
      cellKids(cell).forEach((n) => container.append(wrapNode(n, 'companions-label')));
    }));
  }
  block.replaceChildren(container);

  // grounds alternate by band index (machines-filter re-applies by VISIBLE index)
  const bands = [...document.querySelectorAll('main .machine-band')];
  const idx = bands.indexOf(block);
  block.classList.toggle('alt', idx > -1 && idx % 2 === 1);
}
