import { el } from '../../scripts/dom-helpers.js';

export function buildTeaser(row) {
  const t = el('div', 'teaser');
  t.append(...[...row.children].flatMap((c) => [...c.children]));
  return t;
}
export default function decorate(block) {
  const rows = [...block.children];
  block.replaceChildren(...rows.map(buildTeaser));
}
