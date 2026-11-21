/**
 * bev-cta — dark café CTA band with amber glow (prototype section.bev-cta), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-beverages-html.json § bev-cta.
 *
 * Authored (one cell): eyebrow <p> → <h2> → text <p> → CTA <p><em><strong><a> (accent).
 * The glow is decorative (CSS ::before). Nodes are moved, never rebuilt.
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
  inner.className = 'container bev-cta-inner';
  let seenHeading = false;
  nodes.forEach((n) => {
    if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      inner.append(wrapNode(n, 'bev-cta-title'));
    } else if (n.querySelector('a')) {
      inner.append(wrapNode(n, 'bev-cta-action on-dark'));
    } else if (!seenHeading) {
      inner.append(wrapNode(n, 'bev-cta-eyebrow'));
    } else {
      inner.append(wrapNode(n, 'bev-cta-text'));
    }
  });
  block.replaceChildren(inner);
}
