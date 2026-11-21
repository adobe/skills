/**
 * lp-cta — closing "Bring the Atelier home." band (prototype section.lp-cta), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier-landing-html.json § lp-cta.
 *
 * Authored: the title <p> (accent word in <em>) → text <p>
 * → CTAs: <strong><a> (primary) then <em><a> (ghost, takes the band's cream colour).
 */

function wrapNode(node, className) {
  const w = document.createElement('div');
  w.className = className;
  w.append(node);
  return w;
}

export default function decorate(block) {
  const nodes = [...block.querySelectorAll(':scope > div > div > *')];
  const ctas = nodes.filter((n) => n.querySelector('a'));
  const texts = nodes.filter((n) => !ctas.includes(n));
  const inner = document.createElement('div');
  inner.className = 'container lp-cta-inner';
  texts.forEach((n, i) => inner.append(wrapNode(n, i === 0 ? 'lp-cta-title' : 'lp-cta-text')));
  if (ctas.length) {
    const actions = document.createElement('div');
    actions.className = 'lp-cta-actions';
    actions.append(...ctas);
    inner.append(actions);
  }
  const glow = document.createElement('div');
  glow.className = 'lp-cta-glow';
  block.replaceChildren(glow, inner);
}
