/*
 * animation — Milo scroll-driven animation sidecar block.
 *
 * VENDORED VERBATIM from Milo's page-animator work by Ryan:
 *   milo @ origin/page-animator-poc (3fc472a1f20a2c8da2aa7f2cba7847388222084b)
 *   libs/c2/blocks/animation/animation.js
 *
 * Authored as a sidecar block inside a section: `<div class="animation {target}">`
 * with --pa-* / range-* / timing-* KV rows. Finds its target by class name /
 * variant tokens (no allow-list, so it animates bespoke forge-* blocks too),
 * compiles the rows to a CSS scroll-driven animation via buildCssRule, injects a
 * <style>, stamps data-pa-* on the target (so the page-animator panel can read +
 * adjust it), then hides itself. Milo auto-loads this block from the repo root.
 *
 * Shipped by the snowflake Milo substrate. Remove once it lands in Milo main.
 */

import { generateAnimId, buildCssRule } from '../../tools/page-animator/controls.js';

const SKIP_CLASSES = new Set(['section-metadata', 'visually-hidden', 'animation']);

export function parseVariant(classList) {
  const tokens = [...classList].filter((c) => c !== 'block' && c !== 'animation');
  if (!tokens.length) return { targetClass: null, targetIndex: 1 };
  const parsed = parseInt(tokens[1], 10);
  return {
    targetClass: tokens[0],
    targetIndex: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
  };
}

export function parseProps(block) {
  const props = {};
  [...block.querySelectorAll(':scope > div')].forEach((row) => {
    const cells = [...row.querySelectorAll(':scope > div')];
    if (cells.length < 2) return;
    const key = cells[0].textContent.trim();
    const raw = cells[1].textContent.trim();
    if (!key) return;
    const num = parseFloat(raw);
    props[key] = Number.isNaN(num) ? raw : num;
  });
  return props;
}

export default function init(block) {
  const section = block.closest('.section');
  if (!section) return;

  const sectionIdx = [...document.querySelectorAll('.section')].indexOf(section);
  const { targetClass, targetIndex } = parseVariant(block.classList);

  const visibleBlocks = [...section.children].filter(
    (el) => el.classList.length > 0 && ![...el.classList].some((c) => SKIP_CLASSES.has(c)),
  );

  let target;
  let animId;

  if (!targetClass) {
    target = section;
    animId = generateAnimId(sectionIdx);
  } else {
    const candidates = visibleBlocks.filter((el) => el.classList.contains(targetClass));
    target = candidates[targetIndex - 1];
    if (!target) return;
    const blockIdx = visibleBlocks.indexOf(target);
    if (blockIdx === -1) return;
    animId = generateAnimId(sectionIdx, blockIdx);
  }

  const props = parseProps(block);

  block.dataset.paProps = JSON.stringify(props);
  block.dataset.paAnimId = animId;

  target.dataset.animId = animId;

  document.getElementById(`pa-block-${animId}`)?.remove();
  const style = document.createElement('style');
  style.id = `pa-block-${animId}`;
  style.textContent = buildCssRule(animId, props);
  document.head.appendChild(style);

  block.style.display = 'none';
}
