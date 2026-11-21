/**
 * machines-filter — sticky family filter pills (prototype section.machines-filter;
 * dynamic-features row 13). Template-slotted: one pill per authored <p>.
 *
 * Authored (one cell): the pill labels, one <p> each — the first is "show all"
 * (All machines), the rest name a machine family. A family pill keeps only the
 * machine-band whose eyebrow starts with that family name (Bean-to-cup ↔
 * "Bean-to-cup · Premium"); band grounds re-alternate by visible index
 * (machine-band.js applyBandGrounds). Filters in place: no scroll, no animation.
 * @ew-exempt <p> pill labels — moved into <button class="filter-pill"> hosts (EW7)
 */

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

// family key of a label: "Bean-to-cup · Premium" → "bean-to-cup"
const familyKey = (s) => s.split('·')[0].trim().toLowerCase().replace(/\s+/g, '-');

function applyFilter(value) {
  const bands = [...document.querySelectorAll('main .machine-band')];
  let i = 0;
  bands.forEach((band) => {
    const show = value === 'all' || band.dataset.band === value;
    const section = band.closest('.section') || band;
    section.hidden = !show;
    if (show) {
      band.classList.toggle('alt', i % 2 === 1);
      i += 1;
    }
  });
}

export default async function decorate(block) {
  const labels = [...block.querySelectorAll(':scope > div > div > *')]
    .filter((n) => n.textContent.trim());
  const group = document.createElement('div');
  group.className = 'container machines-filter-inner';
  group.dataset.filterPills = '';
  labels.forEach((label, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'filter-pill';
    pill.dataset.filter = i === 0 ? 'all' : familyKey(label.textContent);
    pill.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    if (i === 0) pill.classList.add('is-active');
    pill.append(label);
    group.append(pill);
  });
  block.replaceChildren(group);

  const w = await loadWidgets();
  if (!w) return;
  w.initFilterPills(group, (value) => applyFilter(value));
}
