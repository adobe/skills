/**
 * journal-hero — journal index hero band (prototype section.journal-hero), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-blog-html.json § journal-hero.
 *
 * Authored (one cell): eyebrow <p> → <h1> → lede <p>. Nodes are moved, never rebuilt.
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
  inner.className = 'container';
  let seenHeading = false;
  nodes.forEach((n) => {
    if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      inner.append(wrapNode(n, 'journal-hero-title'));
    } else if (!seenHeading) {
      inner.append(wrapNode(n, 'journal-hero-eyebrow'));
    } else {
      inner.append(wrapNode(n, 'journal-hero-lede'));
    }
  });
  block.replaceChildren(inner);
}
