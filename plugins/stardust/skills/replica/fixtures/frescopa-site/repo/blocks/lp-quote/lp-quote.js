/**
 * lp-quote — pull quote over a photo (prototype section.lp-quote), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-quote.
 *
 * Authored (queried by role):
 *   - the photo (<picture>/<img>, editorial)
 *   - quote <p> (the accent word in <em>) → attribution <p>
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const text = (el) => (el ? el.textContent.trim() : '');

export default function decorate(block) {
  const media = block.querySelector('picture') || block.querySelector('img');
  const paras = [...block.querySelectorAll('p')].filter((p) => !p.querySelector('picture, img')
    && text(p));
  const [quote, ...cites] = paras;

  const mediaBox = document.createElement('div');
  mediaBox.className = 'lp-quote-media';
  if (media) mediaBox.append(media);
  const scrim = document.createElement('div');
  scrim.className = 'lp-quote-scrim';
  const inner = document.createElement('div');
  inner.className = 'container lp-quote-inner';
  if (quote) inner.append(wrapNode(quote, 'lp-quote-text'));
  cites.forEach((p) => inner.append(wrapNode(p, 'lp-quote-cite')));
  block.replaceChildren(mediaBox, scrim, inner);

  const img = mediaBox.querySelector('img');
  if (img) img.loading = 'lazy';
}
