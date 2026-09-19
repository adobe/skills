/** Hero — imports aem.js, a project helper and a sibling block (the common case). */
import { getMetadata } from '../../scripts/aem.js';
import { el } from '../../scripts/dom-helpers.js';
import { buildTeaser } from '../teaser/teaser.js';

export default function decorate(block) {
  const body = el('div', `hero-body theme-${getMetadata('theme') || 'none'}`);
  const [first, ...rest] = [...block.children];
  body.append(...[...first.children].flatMap((c) => [...c.children])); // MOVE authored nodes (EW1)
  block.replaceChildren(body, ...rest.map(buildTeaser));
}
