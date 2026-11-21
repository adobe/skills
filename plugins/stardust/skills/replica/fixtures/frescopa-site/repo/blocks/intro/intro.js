/**
 * intro — home statement band (prototype section.intro), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier.json § intro.
 *
 * Authored: eyebrow <p> → <h2> statement (accent phrase in <em>) → body <p>
 * → a bare link alone in its <p> (the "See how it learns" text link).
 * Everything up to the heading forms the lead column, the rest the body column.
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

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

const isLinkOnly = (p) => {
  const a = p.querySelector('a');
  return !!a && !a.classList.contains('button') && p.textContent.trim() === a.textContent.trim();
};

export default async function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'intro';
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const headingIdx = nodes.findIndex((n) => /^H[1-6]$/.test(n.tagName));

  const lead = document.createElement('div');
  lead.className = 'intro-lead';
  const body = document.createElement('div');
  body.className = 'intro-body';
  nodes.forEach((n, i) => {
    if (headingIdx > -1 && i <= headingIdx) {
      if (/^H[1-6]$/.test(n.tagName)) lead.append(wrapNode(n, 'intro-statement'));
      else lead.append(wrapNode(n, 'eyebrow'));
    } else if (isLinkOnly(n)) {
      appendArrow(n.querySelector('a'));
      body.append(wrapNode(n, 'link-wrap'));
    } else {
      body.append(n);
    }
  });

  const grid = document.createElement('div');
  grid.className = 'container intro-grid';
  grid.append(lead, body);
  block.replaceChildren(grid);

  const w = await loadWidgets();
  if (!w) return;
  w.reveal(lead);
  w.reveal(body, 0.1);
}
