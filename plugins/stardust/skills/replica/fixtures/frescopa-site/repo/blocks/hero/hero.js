/**
 * hero — home cinematic hero (prototype section.hero), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier.json § hero.
 *
 * Authored rows (query by role, not by index — a single consolidated cell works too):
 *   - the hero photo (<picture>/<img>, editorial)
 *   - eyebrow <p> → heading <h1> → lead <p>
 *   - CTAs: <strong><a> (primary) then <em><a> (secondary, on-media)
 *   - a bare <a> alone in its <p> → the "Scroll" cue (bottom right)
 *
 * Behaviour: eager LCP image; copy aligned to the product in the photo above 760px
 * (source hero.js, scripts/widgets.js artDirectHero); parallax 12 on the photo; reveal.
 */

const ART = {
  focal: '50% 44%',
  productTop: 0.2,
  productLeft: 0.43,
  parallax: 12,
};

const SCROLL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" '
  + 'stroke="currentColor" stroke-width="1.6" aria-hidden="true">'
  + '<path d="M12 5v14M6 13l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const text = (el) => (el ? el.textContent.trim() : '');

async function loadWidgets() {
  try {
    return await import('../../scripts/widgets.js');
  } catch (e) {
    return null;
  }
}

export default async function decorate(block) {
  const media = block.querySelector('picture') || block.querySelector('img');
  const heading = block.querySelector('h1, h2');
  const paras = [...block.querySelectorAll('p')].filter((p) => !p.querySelector('picture, img'));
  const ctas = paras.filter((p) => p.querySelector('a.button, strong a, em a'));
  const scroll = paras.find((p) => !ctas.includes(p) && p.querySelector('a'));
  const plain = paras.filter((p) => !p.querySelector('a') && text(p));
  const beforeHeading = (p) => heading
    && heading.compareDocumentPosition(p) === Node.DOCUMENT_POSITION_PRECEDING;
  const eyebrow = plain.find((p) => beforeHeading(p));
  const lead = plain.filter((p) => p !== eyebrow);

  const mediaBox = document.createElement('div');
  mediaBox.className = 'hero-media';
  if (media) mediaBox.append(media);
  const scrim = document.createElement('div');
  scrim.className = 'hero-scrim';
  mediaBox.append(scrim);

  const inner = document.createElement('div');
  inner.className = 'container hero-inner';
  const parts = [];
  if (eyebrow) parts.push(wrapNode(eyebrow, 'eyebrow eyebrow-light'));
  if (heading) parts.push(wrapNode(heading, 'hero-title'));
  if (lead.length) {
    const leadBox = document.createElement('div');
    leadBox.className = 'hero-lead';
    leadBox.append(...lead);
    parts.push(leadBox);
  }
  if (ctas.length) {
    const actions = document.createElement('div');
    actions.className = 'hero-actions on-media';
    actions.append(...ctas);
    parts.push(actions);
  }
  inner.append(...parts);

  const children = [mediaBox, inner];
  if (scroll) {
    const cue = wrapNode(scroll, 'hero-scroll');
    const a = scroll.querySelector('a');
    a.setAttribute('aria-label', 'Scroll to explore');
    a.insertAdjacentHTML('beforeend', SCROLL_ICON);
    children.push(cue);
  }
  block.replaceChildren(...children);

  const img = mediaBox.querySelector('img');
  if (img) {
    img.loading = 'eager';
    img.setAttribute('fetchpriority', 'high');
  }

  const w = await loadWidgets();
  if (!w) return;
  parts.forEach((el, i) => w.reveal(el, i * 0.08));
  if (img) {
    w.parallax(img, ART.parallax);
    w.artDirectHero(block, img, { ...ART, inner });
  }
}
