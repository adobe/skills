/**
 * sustain — "Kind by design": photo + copy with chips (prototype section.sustain),
 * template-slotted. Schema: stardust/eds-schema/frescopa-atelier.json § sustain.
 *
 * Authored: the photo; eyebrow <p> → <h2> → lede <p> → <ul> of chips.
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
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const media = document.createElement('div');
  media.className = 'sustain-media';
  const copy = document.createElement('div');
  copy.className = 'sustain-copy';
  let seenHeading = false;
  nodes.forEach((n) => {
    const pic = n.matches('picture, img') ? n : n.querySelector('picture, img');
    if (pic) {
      media.append(pic);
    } else if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      copy.append(wrapNode(n, 'sustain-title'));
    } else if (n.tagName === 'UL' || n.tagName === 'OL') {
      copy.append(wrapNode(n, 'chips'));
    } else if (!seenHeading) {
      copy.append(wrapNode(n, 'eyebrow'));
    } else {
      copy.append(wrapNode(n, 'lede'));
    }
  });
  const grid = document.createElement('div');
  grid.className = 'container sustain-grid';
  grid.append(media, copy);
  block.replaceChildren(grid);

  const w = await loadWidgets();
  if (!w) return;
  w.reveal(media);
  w.reveal(copy, 0.1);
}
