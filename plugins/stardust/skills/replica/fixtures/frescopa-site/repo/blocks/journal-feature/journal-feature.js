/**
 * journal-feature — featured story card (prototype section.journal-feature), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-blog-html.json § journal-feature.
 *
 * Authored: media cell = image + optional badge <p> ("Featured");
 * copy cell = category <p> → <h2> → excerpt <p> → meta <p> → link <p> (plain <a>).
 * Cells may come in any order or be omitted; nodes are moved, never rebuilt.
 * The live card is one link wrapping another (same href): the card itself becomes an <a>
 * (built in the DOM, where anchors can nest — static HTML cannot) around the authored link.
 */

// trailing arrow glyph of the canon .link (a separate element, never edits the authored text)
function appendArrow(el) {
  if (el.querySelector('.arrow') || /→\s*$/.test(el.textContent)) return;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  el.append(arrow);
}

function div(className) {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

const isLinkPara = (n) => n.tagName === 'P' && n.querySelector('a[href]')
  && n.textContent.trim() === n.querySelector('a[href]').textContent.trim();

function wrap(node, className) {
  const w = div(className);
  w.append(node);
  return w;
}

export default function decorate(block) {
  const media = div('feature-card-media');
  const badge = div('feature-card-badge');
  const body = div('feature-card-body');
  const foot = div('feature-card-foot');
  let link;

  const cells = [...block.querySelectorAll(':scope > div > div')];
  cells.forEach((cell) => {
    const nodes = [...cell.children];
    if (cell.querySelector('picture, img')) {
      nodes.forEach((n) => {
        if (n.matches('picture, img') || n.querySelector('picture, img')) {
          media.append(n.matches('picture, img') ? n : (n.querySelector('picture') || n));
        } else if (n.textContent.trim()) {
          badge.append(wrap(n, 'badge badge-amber'));
        }
      });
      return;
    }
    let seenHeading = false;
    let seenExcerpt = false;
    nodes.forEach((n) => {
      if (/^H[1-6]$/.test(n.tagName)) {
        seenHeading = true;
        body.append(wrap(n, 'feature-card-title'));
      } else if (isLinkPara(n)) {
        link = n.querySelector('a[href]');
        appendArrow(link);
        foot.append(wrap(n, 'feature-card-link link-wrap'));
      } else if (!seenHeading) {
        body.append(wrap(n, 'feature-card-cat'));
      } else if (!seenExcerpt) {
        seenExcerpt = true;
        body.append(wrap(n, 'feature-card-excerpt'));
      } else {
        foot.prepend(wrap(n, 'feature-card-meta'));
      }
    });
  });

  const card = link ? document.createElement('a') : div('feature-card');
  if (link) {
    card.className = 'feature-card';
    card.href = link.getAttribute('href');
  }
  if (badge.children.length) media.append(badge);
  if (media.children.length) card.append(media);
  if (foot.children.length) body.append(foot);
  card.append(body);

  const inner = div('container');
  inner.append(card);
  block.replaceChildren(inner);
}
