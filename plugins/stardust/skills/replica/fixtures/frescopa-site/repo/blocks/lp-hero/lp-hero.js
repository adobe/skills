/**
 * lp-hero — product-landing photo hero (prototype section.lp-hero), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-hero.
 *
 * Authored (queried by role — one consolidated cell or several rows both work):
 *   - the hero photo (<picture>/<img>, editorial, the LCP image)
 *   - eyebrow <p> → heading <h1> → lead <p>
 *   - CTAs: <strong><a> (primary) then <em><a> (secondary ghost)
 *   - after the CTAs: rating <p> (gets the decorative five stars) → price <p>
 */

const STAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="var(--amber)" aria-hidden="true">'
  + '<path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.4l6-.9z"/></svg>';

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const text = (el) => (el ? el.textContent.trim() : '');
const follows = (a, b) => a && b
  && a.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING;

export default function decorate(block) {
  const media = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2');
  const paras = [...block.querySelectorAll('p')].filter((p) => !p.querySelector('picture, img'));
  const ctas = paras.filter((p) => p.querySelector('a'));
  const plain = paras.filter((p) => !ctas.includes(p) && text(p));
  const lastCta = ctas[ctas.length - 1];
  const eyebrow = plain.find((p) => follows(p, heading));
  const after = plain.filter((p) => p !== eyebrow && lastCta && follows(lastCta, p));
  const lead = plain.filter((p) => p !== eyebrow && !after.includes(p));
  const [rating, ...price] = after;

  const mediaBox = document.createElement('div');
  mediaBox.className = 'lp-hero-media';
  if (media) mediaBox.append(media);
  const scrim = document.createElement('div');
  scrim.className = 'lp-hero-scrim';

  const copy = document.createElement('div');
  copy.className = 'lp-hero-copy';
  if (eyebrow) copy.append(wrapNode(eyebrow, 'eyebrow eyebrow-light'));
  if (heading) copy.append(wrapNode(heading, 'lp-hero-title'));
  if (lead.length) {
    const box = document.createElement('div');
    box.className = 'lp-hero-lead';
    box.append(...lead);
    copy.append(box);
  }
  if (ctas.length) {
    const actions = document.createElement('div');
    actions.className = 'lp-hero-actions';
    actions.append(...ctas);
    copy.append(actions);
  }
  if (rating) {
    const row = document.createElement('div');
    row.className = 'lp-hero-rating';
    const stars = document.createElement('span');
    stars.className = 'stars';
    stars.innerHTML = STAR.repeat(5);
    row.append(stars, rating);
    copy.append(row);
  }
  if (price.length) {
    const box = document.createElement('div');
    box.className = 'lp-hero-price';
    box.append(...price);
    copy.append(box);
  }

  const inner = document.createElement('div');
  inner.className = 'container lp-hero-inner';
  inner.append(copy);
  block.replaceChildren(mediaBox, scrim, inner);

  const img = mediaBox.querySelector('img');
  if (img) {
    img.loading = 'eager';
    img.setAttribute('fetchpriority', 'high');
  }
}
