/**
 * journal-list — filter pills over the post cards (prototype section.journal-list;
 * dynamic-features row 13). Template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-blog-html.json § journal-list.
 *
 * Authored:
 *   row 1 (one cell): the pill labels, one <p> each — the first shows every post (All posts),
 *     the rest name a category.
 *   rows 2…n (one per post): image cell (may be empty) | category <p> → <h3> (its <a> carries
 *     the post href) → excerpt <p> → meta <p>.
 * A post row becomes <a class="post-card" data-cat="<category>">; the authored nodes are moved
 * into it (the title link is unwrapped into the card link — HTML cannot nest <a>).
 * A post without an image keeps the live empty <image-slot> placeholder (a declarative-style
 * shadow root carrying the element's own stylesheet).
 * A category pill shows only that category's posts ("The Atelier" → none); no animation.
 * @ew-exempt <p> pill labels — moved into <button class="filter-pill"> hosts (EW7)
 * @ew-exempt image-slot placeholder caption — decorative shadow-DOM copy of the post title
 */

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

const SLOT_CSS = ':host{display:block;position:relative;font:13px/1.3 system-ui,-apple-system,'
  + 'sans-serif;color:rgba(0,0,0,.55);width:100%;height:100%;aspect-ratio:3/2}.empty{position:'
  + 'absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:'
  + 'center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;background:rgba(0,0,0,'
  + '.04)}.empty svg{display:block;opacity:.45}.cap{max-width:90%;font-weight:500;'
  + 'letter-spacing:.01em}.ring{position:absolute;inset:0;pointer-events:none;border:1.5px '
  + 'dashed rgba(0,0,0,.25)}';

const SLOT_ICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" '
  + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/>'
  + '<circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

function imageSlot(caption) {
  const host = document.createElement('div');
  host.className = 'post-card-slot';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SLOT_CSS;
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.innerHTML = SLOT_ICON;
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = caption;
  empty.append(cap);
  const ring = document.createElement('div');
  ring.className = 'ring';
  root.append(style, empty, ring);
  return host;
}

function buildPills(cell) {
  const group = document.createElement('div');
  group.className = 'filter-pills';
  group.dataset.filterPills = '';
  const labels = [...cell.children].filter((n) => n.textContent.trim());
  labels.forEach((label, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'filter-pill';
    pill.dataset.filter = i === 0 ? 'all' : label.textContent.trim();
    pill.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    if (i === 0) pill.classList.add('is-active');
    pill.append(label);
    group.append(pill);
  });
  return group;
}

function wrap(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

function buildCard(row) {
  const card = document.createElement('a');
  card.className = 'post-card';
  card.href = '#';
  const media = document.createElement('div');
  media.className = 'post-card-media';
  const texts = [];
  [...row.children].forEach((cell) => {
    const pic = cell.querySelector('picture, img');
    if (pic) {
      media.append(cell.querySelector('picture') || pic);
    } else {
      texts.push(...cell.children);
    }
  });
  let seenHeading = false;
  let seenExcerpt = false;
  let caption = '';
  const body = [];
  texts.forEach((n) => {
    if (/^H[1-6]$/.test(n.tagName)) {
      seenHeading = true;
      // EW6: the authored title link carries the card href and is unwrapped (no nested <a>)
      const a = n.querySelector('a[href]');
      if (a) {
        card.href = a.getAttribute('href');
        a.replaceWith(...a.childNodes);
      }
      caption = n.textContent.trim();
      body.push(wrap(n, 'post-card-title'));
    } else if (!seenHeading) {
      card.dataset.cat = n.textContent.trim();
      body.push(wrap(n, 'post-card-cat'));
    } else if (!seenExcerpt) {
      seenExcerpt = true;
      body.push(wrap(n, 'post-card-excerpt'));
    } else {
      body.push(wrap(n, 'post-card-meta'));
    }
  });
  if (!media.children.length) media.append(imageSlot(caption));
  card.append(media, ...body);
  return card;
}

export default async function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const inner = document.createElement('div');
  inner.className = 'container';
  const grid = document.createElement('div');
  grid.className = 'post-grid';
  grid.dataset.filterItems = '';
  let group;

  rows.forEach((row) => {
    const isPost = row.children.length > 1 || row.querySelector('h1, h2, h3, h4, h5, h6');
    if (!isPost && !group) {
      group = buildPills(row.firstElementChild || row);
    } else if (isPost) {
      grid.append(buildCard(row));
    }
  });
  if (group) inner.append(group);
  inner.append(grid);
  block.replaceChildren(inner);

  if (!group) return;
  const w = await loadWidgets();
  if (!w) return;
  const cards = [...grid.querySelectorAll('.post-card')];
  w.initFilterPills(group, (value) => {
    cards.forEach((c) => {
      c.hidden = !(value === 'all' || c.dataset.cat === value);
    });
  });
}
