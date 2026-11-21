/**
 * cafe-hero — café photo hero (prototype section.cafe-hero), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-cafe-html.json § cafe-hero.
 *
 * Authored (by role, any row layout): the hero photo (editorial) · eyebrow <p> → <h1>
 * → lead <p> · CTAs <em><strong><a> (accent, cream) then <em><a> (secondary, ghost).
 * The header (Header Style | app) sits transparent over the photo. Nodes are moved.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

export default function decorate(block) {
  const media = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2');
  const nodes = [...block.querySelectorAll(':scope > div > div > *')]
    .filter((n) => n !== heading && !n.matches('picture, img') && !n.querySelector('picture, img'));
  const before = (n) => heading
    && heading.compareDocumentPosition(n) === Node.DOCUMENT_POSITION_PRECEDING;

  const mediaBox = document.createElement('div');
  mediaBox.className = 'cafe-hero-media';
  if (media) mediaBox.append(media);
  const scrim = document.createElement('div');
  scrim.className = 'cafe-hero-scrim';

  const inner = document.createElement('div');
  inner.className = 'cafe-hero-inner';
  const actions = document.createElement('div');
  actions.className = 'cafe-hero-actions';
  const lead = document.createElement('div');
  lead.className = 'cafe-hero-lead';
  const eyebrows = [];
  nodes.forEach((n) => {
    if (n.querySelector('a')) actions.append(n);
    else if (before(n)) eyebrows.push(n);
    else if (n.textContent.trim()) lead.append(n);
  });
  eyebrows.forEach((n) => inner.append(wrapNode(n, 'cafe-hero-eyebrow')));
  if (heading) inner.append(wrapNode(heading, 'cafe-hero-title'));
  if (lead.children.length) inner.append(lead);
  if (actions.children.length) inner.append(actions);
  block.replaceChildren(mediaBox, scrim, inner);

  const img = mediaBox.querySelector('img');
  if (img) {
    img.loading = 'eager';
    img.setAttribute('fetchpriority', 'high');
  }
}
