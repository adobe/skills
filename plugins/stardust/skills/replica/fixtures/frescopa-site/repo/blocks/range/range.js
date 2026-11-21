/**
 * range — one product-range row: photo + copy split (prototype section.range),
 * template-slotted. Variant `alt` = the paper-2 band (prototype section.range--alt).
 * Schema: stardust/eds-schema/frescopa-atelier-beverages-html.json § range.
 *
 * Authored: two rows in reading order — the photo row and the copy row (the `alt` row on
 * the page authors the copy first, as the prototype does). Copy cell: eyebrow <p> → <h2>
 * → text <p> → picks label <p> → <ul> of picks → CTA <p><strong><a> → meta <p>.
 * Authors may omit any of these; nodes are moved, never rebuilt.
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

function decorateCopy(cell) {
  const body = document.createElement('div');
  body.className = 'range-body';
  const nodes = [...cell.children];
  let seenHeading = false;
  let seenCta = false;
  let picks = null;
  let foot = null;
  nodes.forEach((n, i) => {
    const next = nodes[i + 1];
    if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      body.append(wrapNode(n, 'range-title'));
    } else if (n.tagName === 'UL' || n.tagName === 'OL') {
      if (!picks) {
        picks = document.createElement('div');
        picks.className = 'range-picks';
        body.append(picks);
      }
      picks.append(n);
    } else if (n.querySelector('a')) {
      seenCta = true;
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'range-foot';
        body.append(foot);
      }
      foot.append(n);
    } else if (!seenHeading) {
      body.append(wrapNode(n, 'range-eyebrow'));
    } else if (seenCta) {
      n.classList.add('range-meta');
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'range-foot';
        body.append(foot);
      }
      foot.append(n);
    } else if (next && (next.tagName === 'UL' || next.tagName === 'OL')) {
      n.classList.add('range-picks-label');
      picks = document.createElement('div');
      picks.className = 'range-picks';
      picks.append(n);
      body.append(picks);
    } else {
      body.append(wrapNode(n, 'range-text'));
    }
  });
  return body;
}

export default function decorate(block) {
  const grid = document.createElement('div');
  grid.className = 'container range-grid';
  [...block.querySelectorAll(':scope > div > div')].forEach((cell) => {
    const pic = cell.querySelector('picture, img');
    if (pic && !cell.querySelector('h1, h2, h3, h4, h5, h6')) {
      const media = document.createElement('div');
      media.className = 'range-media';
      media.append(pic);
      grid.append(media);
    } else if (cell.children.length) {
      grid.append(decorateCopy(cell));
    }
  });
  block.replaceChildren(grid);
}
