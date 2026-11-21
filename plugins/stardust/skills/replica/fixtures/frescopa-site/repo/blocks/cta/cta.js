/**
 * cta — closing promise band (prototype section.cta), template-slotted.
 * Schema: stardust/eds-schema/frescopa-atelier.json § cta.
 *
 * Authored: the promise <p> (accent phrase in <em>) → sub <p>
 * → CTAs: <strong><a> (primary) then <em><a> (secondary, on-dark).
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
  const ctas = nodes.filter((n) => n.querySelector('a'));
  const texts = nodes.filter((n) => !ctas.includes(n));
  const parts = [];
  texts.forEach((n, i) => parts.push(wrapNode(n, i === 0 ? 'cta-promise' : 'cta-sub')));
  if (ctas.length) {
    const actions = document.createElement('div');
    actions.className = 'cta-actions on-dark';
    actions.append(...ctas);
    parts.push(actions);
  }
  const inner = document.createElement('div');
  inner.className = 'container cta-inner';
  inner.append(...parts);
  block.replaceChildren(inner);

  const w = await loadWidgets();
  if (!w) return;
  parts.forEach((p, i) => w.reveal(p, i * 0.08));
}
