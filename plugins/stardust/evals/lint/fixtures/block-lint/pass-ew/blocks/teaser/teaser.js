/**
 * teaser — the scaffold shape: authored nodes MOVE into wrappers; classification
 * reads cell text (#79) but never displays from it; clones strip instrumentation.
 * Rows: [kind | picture | title + body + cta]
 */
const stripInstrumentation = (node) => node.querySelectorAll('[data-prose-index]').forEach((n) => n.removeAttribute('data-prose-index'));
const labelWrap = (el, cls) => { const w = document.createElement('div'); w.className = cls; el.replaceWith(w); w.append(el); return w; };

export default function decorate(block) {
  [...block.children].forEach((row) => {
    const [kindCell, mediaCell, textCell] = row.children;
    const kind = kindCell.textContent.trim().toLowerCase(); // classify by cell text — legal
    block.classList.add(`teaser--${kind}`);
    kindCell.remove();
    const input = document.createElement('input');
    input.placeholder = textCell.querySelector('p').textContent.trim(); // attribute position — legal
    const heading = textCell.querySelector('h3');
    if (heading && heading.textContent.length > 40) block.classList.add('teaser--long'); // condition — legal
    const media = labelWrap(mediaCell.querySelector('picture'), 'teaser-media');
    const ghost = media.cloneNode(true); // presentational clone, stripped (EW4)
    stripInstrumentation(ghost);
    textCell.querySelectorAll('p').forEach((p) => { if (p.querySelector('a')) labelWrap(p, 'teaser-actions'); }); // wrapper gets the class
    row.append(media, ghost, input);
  });
}
