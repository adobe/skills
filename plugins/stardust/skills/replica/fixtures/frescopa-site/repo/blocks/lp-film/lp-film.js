/**
 * lp-film — "See it in the morning" dark film band (prototype section.lp-film),
 * template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-film.
 *
 * Authored (queried by role):
 *   - eyebrow <p> → <h2>
 *   - poster row: | film poster (<picture>/<img>, editorial) | running time <p> (2:14) |
 *     — any <p> in the poster's ROW is the running-time chip
 *   - any other <p> after the poster → the note under the frame
 * The play button is inert chrome (the film is not produced yet — the note says so).
 */

const PLAY = '<svg viewBox="0 0 24 24" width="32" height="32" fill="var(--terracotta)" '
  + 'aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

const text = (el) => (el ? el.textContent.trim() : '');

export default function decorate(block) {
  const media = block.querySelector('picture') || block.querySelector('img');
  const mediaRow = media ? media.closest('.lp-film > div') : null;
  const heading = block.querySelector('h1, h2, h3');
  const paras = [...block.querySelectorAll('p')].filter((p) => !p.querySelector('picture, img')
    && text(p));
  const before = (p) => heading
    && p.compareDocumentPosition(heading) === Node.DOCUMENT_POSITION_FOLLOWING;
  const eyebrow = paras.find((p) => before(p));
  const time = paras.filter((p) => p !== eyebrow && mediaRow && mediaRow.contains(p));
  const notes = paras.filter((p) => p !== eyebrow && !time.includes(p));

  const glow = document.createElement('div');
  glow.className = 'lp-film-glow';
  const inner = document.createElement('div');
  inner.className = 'lp-film-inner';
  if (eyebrow) inner.append(wrapNode(eyebrow, 'eyebrow eyebrow-light'));
  if (heading) inner.append(wrapNode(heading, 'lp-film-title'));

  const frame = document.createElement('div');
  frame.className = 'lp-film-frame';
  if (media) frame.append(media);
  const scrim = document.createElement('div');
  scrim.className = 'lp-film-scrim';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'lp-film-play';
  play.setAttribute('aria-label', 'Play the film');
  play.innerHTML = PLAY;
  frame.append(scrim, play);
  if (time.length) {
    const chip = document.createElement('div');
    chip.className = 'lp-film-time';
    chip.append(...time);
    frame.append(chip);
  }
  inner.append(frame);
  notes.forEach((p) => inner.append(wrapNode(p, 'lp-film-note')));
  block.replaceChildren(glow, inner);

  const img = frame.querySelector('img');
  if (img) img.loading = 'lazy';
}
