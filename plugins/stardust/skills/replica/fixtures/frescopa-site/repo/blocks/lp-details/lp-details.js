/**
 * lp-details — "In the details": centred head + feature chips (prototype section.lp-details),
 * template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-details.
 *
 * Authored: eyebrow <p> → <h2> → <ul> of chips (one <li> per chip).
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const isHeading = (el) => /^H[1-6]$/.test(el.tagName);

export default function decorate(block) {
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const inner = document.createElement('div');
  inner.className = 'container lp-details-inner';
  nodes.forEach((n) => {
    if (isHeading(n)) inner.append(wrapNode(n, 'lp-details-title'));
    else if (n.tagName === 'UL' || n.tagName === 'OL') inner.append(wrapNode(n, 'lp-details-chips'));
    else inner.append(wrapNode(n, 'eyebrow eyebrow-plain'));
  });
  block.replaceChildren(inner);
}
