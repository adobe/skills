/**
 * cafe-cta — dark closing band with amber glow (prototype section.cafe-cta), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-cafe-html.json § cafe-cta.
 *
 * Authored (one cell): eyebrow <p> → <h2> → text <p> → CTAs <em><strong><a> (accent)
 * then <em><a> (secondary ghost). The glow is decorative (CSS ::before). Nodes are moved.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

export default function decorate(block) {
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const inner = document.createElement('div');
  inner.className = 'container cafe-cta-inner';
  const actions = document.createElement('div');
  actions.className = 'cafe-cta-actions';
  let seenHeading = false;
  nodes.forEach((n) => {
    if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      inner.append(wrapNode(n, 'cafe-cta-title'));
    } else if (n.querySelector('a')) {
      actions.append(n);
    } else if (!seenHeading) {
      inner.append(wrapNode(n, 'cafe-cta-eyebrow'));
    } else if (n.textContent.trim()) {
      inner.append(wrapNode(n, 'cafe-cta-text'));
    }
  });
  if (actions.children.length) inner.append(actions);
  block.replaceChildren(inner);
}
