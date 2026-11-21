/**
 * lp-dna — "How it learns you": copy column + flavour-DNA radar (prototype section.lp-dna),
 * template-slotted copy, reconstructive profile rows.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-dna.
 *
 * Authored rows:
 *   1. copy — eyebrow <p> → <h2> → lede <p> → link <p> (bare <a>, gets the canon arrow)
 *   2..n. one row per taste profile, in the order weekday, slow Sunday, after dinner:
 *      button label <p> → readout title <h4> → readout note <p>
 *
 * Behaviour (dynamic-features: landing FlavourDNA): the radar grows from zero on mount,
 * then auto-cycles every 3 s until a profile button is clicked (scripts/widgets.js
 * initFlavorDna, data-dna-intro="mount").
 * @ew-exempt <text> radar axis labels (Strength … Crema) — chart code (static SVG)
 */

const KEYS = ['weekday', 'sunday', 'evening'];

// static radar (grid, axes, labels, collapsed area + dots) — scripts/widgets.js geometry;
// initFlavorDna() binds to it and animates the area.
const RADAR = '<g class="dna-grid"><polygon points="210.0,171.5 239.9,188.8 239.9,223.3 210.0,240.5 180'
  + '.1,223.3 180.1,188.8" fill="none" stroke="var(--dna-grid, rgba(0,0,0,.12))" stroke-width'
  + '="1"/><polygon points="210.0,137.0 269.8,171.5 269.8,240.5 210.0,275.0 150.2,240.5 150.2'
  + ',171.5" fill="none" stroke="var(--dna-grid, rgba(0,0,0,.12))" stroke-width="1"/><polygon'
  + ' points="210.0,102.5 299.6,154.3 299.6,257.8 210.0,309.5 120.4,257.8 120.4,154.3" fill="'
  + 'none" stroke="var(--dna-grid, rgba(0,0,0,.12))" stroke-width="1"/><polygon points="210.0'
  + ',68.0 329.5,137.0 329.5,275.0 210.0,344.0 90.5,275.0 90.5,137.0" fill="none" stroke="var'
  + '(--dna-grid, rgba(0,0,0,.12))" stroke-width="1.4"/></g><g class="dna-axes"><line x1="210'
  + '" y1="206" x2="210.0" y2="68.0" stroke="var(--dna-axis, rgba(0,0,0,.15))" stroke-width="'
  + '1"/><text x="210.0" y="42.0" text-anchor="middle" dominant-baseline="middle" class="dna-'
  + 'label" fill="var(--dna-label, currentColor)">Strength</text><line x1="210" y1="206" x2="'
  + '329.5" y2="137.0" stroke="var(--dna-axis, rgba(0,0,0,.15))" stroke-width="1"/><text x="3'
  + '52.0" y="124.0" text-anchor="start" dominant-baseline="middle" class="dna-label" fill="v'
  + 'ar(--dna-label, currentColor)">Body</text><line x1="210" y1="206" x2="329.5" y2="275.0" '
  + 'stroke="var(--dna-axis, rgba(0,0,0,.15))" stroke-width="1"/><text x="352.0" y="288.0" te'
  + 'xt-anchor="start" dominant-baseline="middle" class="dna-label" fill="var(--dna-label, cu'
  + 'rrentColor)">Sweetness</text><line x1="210" y1="206" x2="210.0" y2="344.0" stroke="var(-'
  + '-dna-axis, rgba(0,0,0,.15))" stroke-width="1"/><text x="210.0" y="370.0" text-anchor="mi'
  + 'ddle" dominant-baseline="middle" class="dna-label" fill="var(--dna-label, currentColor)"'
  + '>Smoothness</text><line x1="210" y1="206" x2="90.5" y2="275.0" stroke="var(--dna-axis, r'
  + 'gba(0,0,0,.15))" stroke-width="1"/><text x="68.0" y="288.0" text-anchor="end" dominant-b'
  + 'aseline="middle" class="dna-label" fill="var(--dna-label, currentColor)">Warmth</text><l'
  + 'ine x1="210" y1="206" x2="90.5" y2="137.0" stroke="var(--dna-axis, rgba(0,0,0,.15))" str'
  + 'oke-width="1"/><text x="68.0" y="124.0" text-anchor="end" dominant-baseline="middle" cla'
  + 'ss="dna-label" fill="var(--dna-label, currentColor)">Crema</text></g><path d="M210.00 20'
  + '6.00 L210.00 206.00 L210.00 206.00 L210.00 206.00 L210.00 206.00 L210.00 206.00 Z" fill='
  + '"var(--dna-fill, rgba(183,97,62,.18))" stroke="var(--dna-stroke, #b7613e)" stroke-width='
  + '"2" stroke-linejoin="round" class="dna-area"/><g class="dna-dots"><circle r="3.6" cx="21'
  + '0" cy="206" fill="var(--dna-dot, #b7613e)" stroke="var(--dna-dot-ring, transparent)" str'
  + 'oke-width="2"/><circle r="3.6" cx="210" cy="206" fill="var(--dna-dot, #b7613e)" stroke="'
  + 'var(--dna-dot-ring, transparent)" stroke-width="2"/><circle r="3.6" cx="210" cy="206" fi'
  + 'll="var(--dna-dot, #b7613e)" stroke="var(--dna-dot-ring, transparent)" stroke-width="2"/'
  + '><circle r="3.6" cx="210" cy="206" fill="var(--dna-dot, #b7613e)" stroke="var(--dna-dot-'
  + 'ring, transparent)" stroke-width="2"/><circle r="3.6" cx="210" cy="206" fill="var(--dna-'
  + 'dot, #b7613e)" stroke="var(--dna-dot-ring, transparent)" stroke-width="2"/><circle r="3.'
  + '6" cx="210" cy="206" fill="var(--dna-dot, #b7613e)" stroke="var(--dna-dot-ring, transpar'
  + 'ent)" stroke-width="2"/></g>';

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

// trailing arrow glyph of the canon .link (a separate element, never edits the authored text)
function appendArrow(el) {
  if (!el || el.querySelector('.arrow') || /→\s*$/.test(el.textContent)) return;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  el.append(arrow);
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);
const cellNodes = (row) => [...row.querySelectorAll(':scope > div > *')];

export default async function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const copyRow = rows.find((r) => r.querySelector('h2')) || rows[0];
  const profileRows = rows.filter((r) => r !== copyRow && r.querySelector('h3, h4, p'));

  const copy = document.createElement('div');
  copy.className = 'lp-dna-copy';
  let seenHeading = false;
  cellNodes(copyRow).forEach((n) => {
    if (isHeading(n)) {
      seenHeading = true;
      copy.append(wrapNode(n, 'lp-h2'));
    } else if (n.querySelector('a')) {
      appendArrow(n.querySelector('a'));
      copy.append(wrapNode(n, 'lp-dna-more link-wrap'));
    } else {
      copy.append(wrapNode(n, seenHeading ? 'lp-dna-lede' : 'eyebrow'));
    }
  });

  const dna = document.createElement('div');
  dna.className = 'dna';
  dna.dataset.default = 'weekday';
  dna.dataset.dnaIntro = 'mount';
  dna.setAttribute('data-autocycle', '');
  const frame = document.createElement('div');
  frame.className = 'dna-frame';
  frame.insertAdjacentHTML('afterbegin', '<svg class="dna-svg" viewBox="0 0 420 420" role="img" '
    + `aria-label="Flavour profile radar showing six taste dimensions.">${RADAR}</svg>`);
  const readout = document.createElement('div');
  readout.className = 'dna-readout';
  const controls = document.createElement('div');
  controls.className = 'dna-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Choose a taste profile');
  profileRows.forEach((row, i) => {
    const key = KEYS[i] || `profile-${i}`;
    const nodes = cellNodes(row);
    const hIdx = nodes.findIndex(isHeading);
    const panel = document.createElement('div');
    panel.className = 'dna-panel';
    panel.dataset.profilePanel = key;
    panel.hidden = i !== 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dna-btn${i === 0 ? ' is-active' : ''}`;
    btn.dataset.profile = key;
    btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    nodes.forEach((n, j) => {
      if (hIdx > -1 && j < hIdx) btn.append(n);
      else panel.append(n);
    });
    readout.append(panel);
    controls.append(btn);
  });
  frame.append(readout);
  dna.append(frame, controls);
  const viz = document.createElement('div');
  viz.className = 'lp-dna-viz';
  viz.append(dna);

  const grid = document.createElement('div');
  grid.className = 'container lp-dna-grid';
  grid.append(copy, viz);
  block.replaceChildren(grid);

  const w = await loadWidgets();
  if (w) w.initFlavorDna(dna);
}
