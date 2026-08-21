/*
 * page-animator controls — scroll-driven animation param model + CSS compiler.
 *
 * VENDORED VERBATIM from Milo's page-animator work by Ryan:
 *   milo @ origin/page-animator-poc (3fc472a1f20a2c8da2aa7f2cba7847388222084b)
 *   libs/c2/tools/page-animator/controls.js
 *
 * Shipped by the snowflake Milo substrate so deployed pages can run the
 * `animation` sidecar block (blocks/animation/animation.js imports buildCssRule +
 * generateAnimId from here). The page-animator panel reads/writes the same
 * --pa-* / range-* / timing-* vocabulary, so snowflake-emitted animation
 * sidecars are adjustable in the Animator. Remove this vendored copy once the
 * page-animator work lands in Milo main (it becomes a native c2 block).
 *
 * Keep in sync with the upstream branch until then.
 */

export const CONTROLS = [
  { label: 'Opacity from', cssVar: '--pa-opacity-from', type: 'range', min: 0, max: 1, step: 0.01, default: 1, unit: '' },
  { label: 'Translate Y', cssVar: '--pa-translate-y', type: 'range', min: -200, max: 200, step: 1, default: 0, unit: 'px' },
  { label: 'Translate X', cssVar: '--pa-translate-x', type: 'range', min: -200, max: 200, step: 1, default: 0, unit: 'px' },
  { label: 'Scale from', cssVar: '--pa-scale', type: 'range', min: 0, max: 2, step: 0.01, default: 1, unit: '' },
  { label: 'Blur', cssVar: '--pa-blur', type: 'range', min: 0, max: 20, step: 0.5, default: 0, unit: 'px' },
  { label: 'Easing', cssVar: '--pa-easing', type: 'select', options: ['ease', 'ease-in-out', 'cubic-bezier(0.42,0,0,1)', 'linear'], default: 'cubic-bezier(0.42,0,0,1)', unit: '', emitProp: false },
  { label: 'Range start', cssVar: 'range-start', type: 'select', options: ['entry 0%', 'entry 25%', 'entry 50%'], default: 'entry 0%', unit: '' },
  { label: 'Range end', cssVar: 'range-end', type: 'select', options: ['entry 75%', 'entry 100%', 'cover 50%'], default: 'entry 100%', unit: '' },
  { label: 'Opacity start %', cssVar: 'timing-opacity-start', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: '%', commitOnInput: true },
  { label: 'Opacity end %', cssVar: 'timing-opacity-end', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', commitOnInput: true },
  { label: 'Transform start %', cssVar: 'timing-transform-start', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: '%', commitOnInput: true },
  { label: 'Transform end %', cssVar: 'timing-transform-end', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', commitOnInput: true },
  { label: 'Blur start %', cssVar: 'timing-blur-start', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: '%', commitOnInput: true },
  { label: 'Blur end %', cssVar: 'timing-blur-end', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', commitOnInput: true },
];

// Animated property groups: each maps timing controls to a CSS property's from/to values.
const ANIM_PROPS = [
  {
    cssProperty: 'opacity',
    timingStart: 'timing-opacity-start',
    timingEnd: 'timing-opacity-end',
    fromValue: () => 'var(--pa-opacity-from, 1)',
    toValue: () => '1',
  },
  {
    cssProperty: 'transform',
    timingStart: 'timing-transform-start',
    timingEnd: 'timing-transform-end',
    fromValue: () => 'translate3d(var(--pa-translate-x, 0px), var(--pa-translate-y, 0px), 0) scale(var(--pa-scale, 1))',
    toValue: () => 'translate3d(0, 0, 0) scale(1)',
  },
  {
    cssProperty: 'filter',
    timingStart: 'timing-blur-start',
    timingEnd: 'timing-blur-end',
    fromValue: () => 'blur(var(--pa-blur, 0px))',
    toValue: () => 'blur(0)',
  },
];

export function generateAnimId(sectionIdx, blockIdx = null) {
  return blockIdx === null
    ? `section-${sectionIdx}`
    : `section-${sectionIdx}-block-${blockIdx}`;
}

export function getDefaultState() {
  return Object.fromEntries(CONTROLS.map((c) => [c.cssVar, c.default]));
}

export function buildCssRule(animId, state) {
  const rangeStart = state['range-start'] ?? 'entry 0%';
  const rangeEnd = state['range-end'] ?? 'entry 100%';
  const easing = state['--pa-easing'] ?? 'cubic-bezier(0.42,0,0,1)';

  const customProps = CONTROLS
    .filter((c) => c.cssVar.startsWith('--') && c.emitProp !== false)
    .map((c) => `  ${c.cssVar}: ${state[c.cssVar] ?? c.default}${c.unit};`)
    .join('\n');

  // Collect all keyframe stop percentages: 0%, 100%, plus each property's start/end.
  // Properties hold their from-value from 0% to timingStart, animate to timingEnd, then hold to-value.
  const stopSet = new Set([0, 100]);
  ANIM_PROPS.forEach(({ timingStart, timingEnd }) => {
    stopSet.add(state[timingStart] ?? 0);
    stopSet.add(state[timingEnd] ?? 100);
  });
  const stops = [...stopSet].sort((a, b) => a - b);

  const keyframeBlocks = stops.map((pct) => {
    const declarations = [];
    ANIM_PROPS.forEach(({ cssProperty, timingStart, timingEnd, fromValue, toValue }) => {
      const s = state[timingStart] ?? 0;
      const e = state[timingEnd] ?? 100;
      if (pct === 0 || pct === s) {
        declarations.push(`    ${cssProperty}: ${fromValue()};`);
      } else if (pct === e || pct === 100) {
        declarations.push(`    ${cssProperty}: ${toValue()};`);
      }
    });
    if (!declarations.length) return null;
    return `  ${pct}% {\n${declarations.join('\n')}\n  }`;
  }).filter(Boolean);

  const keyframes = `@keyframes pa-anim-${animId} {\n${keyframeBlocks.join('\n')}\n}`;
  const rule = `[data-anim-id="${animId}"] {\n  animation: pa-anim-${animId} ${easing} both;\n  animation-timeline: view();\n  animation-range: ${rangeStart} ${rangeEnd};\n${customProps}\n}`;

  return `${keyframes}\n${rule}`;
}

// tree node shape: { id, el, domIndex, label, blocks: [{ id, el, domIndex?, label }] }
export function serializeState(tree, stateMap) {
  const animations = [];
  tree.forEach((section) => {
    if (stateMap[section.id]) {
      const sel = `.section:nth-child(${section.domIndex + 1})`;
      animations.push({ id: section.id, selector: sel, properties: { ...stateMap[section.id] } });
    }
    section.blocks.forEach((block) => {
      if (stateMap[block.id]) {
        const sel = `.section:nth-child(${section.domIndex + 1}) .${block.el.classList[0]}`;
        animations.push({ id: block.id, selector: sel, properties: { ...stateMap[block.id] } });
      }
    });
  });
  return { version: 1, animations };
}

export function deserializeState(json) {
  return Object.fromEntries(json.animations.map((a) => [a.id, a.properties]));
}
