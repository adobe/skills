/**
 * cafe — "Come say hello" photo band (prototype section.cafe), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier.json § cafe.
 *
 * Authored: the background photo (editorial); eyebrow <p> → <h2> → body <p>
 * → CTA <em><strong><a> (the cream accent button).
 * Behaviour: parallax 14 on the photo; reveal on the copy.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

export default async function decorate(block) {
  const section = block.closest('.section');
  if (section && !section.id) section.id = 'cafe';
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const media = document.createElement('div');
  media.className = 'cafe-media';
  const scrim = document.createElement('div');
  scrim.className = 'cafe-scrim';
  const inner = document.createElement('div');
  inner.className = 'container cafe-inner';
  const actions = document.createElement('div');
  actions.className = 'cafe-actions';
  let seenHeading = false;
  nodes.forEach((n) => {
    const pic = n.matches('picture, img') ? n : n.querySelector('picture, img');
    if (pic) {
      media.append(pic);
    } else if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      inner.append(wrapNode(n, 'cafe-title'));
    } else if (n.querySelector('a')) {
      actions.append(n);
    } else if (!seenHeading) {
      inner.append(wrapNode(n, 'eyebrow eyebrow-light'));
    } else {
      inner.append(wrapNode(n, 'cafe-body'));
    }
  });
  if (actions.children.length) inner.append(actions);
  media.append(scrim);
  block.replaceChildren(media, inner);

  const w = await loadWidgets();
  if (!w) return;
  w.reveal(inner);
  const img = media.querySelector('img');
  if (img) w.parallax(img, 14);
}
