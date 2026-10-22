// skills/reskin/scripts/figma-gate/waivers.mjs — what each waiver of a checks section takes out of the coverage floor,
// as the register shows it: the waived node (name and id) or the mobile or desktop root, the why, and how many text styles and text
// nodes it drops at which width. A bare count would let a container waiver hide a whole page area.
// Pure: boxes are the loaded box trees (loadBoxes), the section is validateChecks' output for it.
import { findBox } from './boxes.mjs';
import { mobileCandidates, mobileVariants, textStyles } from './checks.mjs';

const textNodes = (box) => (box.text ? 1 : 0) + box.children.reduce((n, c) => n + textNodes(c), 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// [{ width, styles, nodes }] → "2 text styles (5 text nodes) at 1440px; 1 text style (1 text node) at 360px"
const dropsText = (drops) => (drops.length
  ? drops.map((d) => `${plural(d.styles, 'text style')} (${plural(d.nodes, 'text node')}) at ${d.width}px`).join('; ')
  : '0 text styles (0 text nodes)');

// What a { width: "desktop" } waiver stands for in the module frame: its first component or instance named desktop and
// wider than 480, else the frame itself when it holds no mobile variant (a page section is the desktop), else null.
function desktopRoot(frame) {
  const find = (b) => b.children.reduce((hit, c) => hit
    ?? (((c.type === 'COMPONENT' || c.type === 'INSTANCE') && /\bdesktop\b/i.test(c.name) && c.w > 480) ? c : find(c)), null);
  return find(frame) ?? (frame.w > 480 && mobileVariants(frame).length === 0 ? frame : null);
}

// → [{ check, node, why, detail }], one per waiver of the section (a skip last). joined is the join's section (its
// module frame holds the mobile variants); a waiver whose frame is not loaded drops nothing it can count.
export function waiverImpacts(section, joined, boxes) {
  const box = (id) => boxes?.roots?.[id]?.box;
  const roots = Object.entries(section?.roots ?? {}).map(([w, id]) => ({ width: Number(w), box: box(id) })).filter((r) => r.box);
  const out = [];
  const add = (check, node, why, drops, note = '') => out.push({ check, node, why, detail: `"${why}": drops ${note}${dropsText(drops)}` });

  for (const w of section?.waive ?? []) {
    if (w.node) {
      const hits = roots.map((r) => ({ r, target: findBox(r.box, w.node) })).filter((h) => h.target);
      const drops = hits.map(({ r, target }) => {
        const all = textStyles(r.box);
        const kept = textStyles(r.box, [w.node]);
        const gone = [...all.keys()].filter((k) => !kept.has(k));
        // A TEXT node waives its style wherever the root has it; a container drops every text node under it.
        return { width: r.width, styles: gone.length, nodes: target.text ? gone.reduce((n, k) => n + all.get(k).nodes.length, 0) : textNodes(target) };
      });
      add(`waive node "${hits[0]?.target.name ?? '?'}" (${w.node})`, w.node, w.why, drops);
      continue;
    }
    const frame = box(joined?.node) ?? box(section.root);
    if (w.width === 'desktop') {
      const root = frame && desktopRoot(frame);
      const drops = root ? [{ width: root.w, styles: textStyles(root).size, nodes: textNodes(root) }] : [];
      const via = root ? `the desktop root "${root.name}" (${root.id}): ` : 'the desktop root, which the module frame does not hold: ';
      add('waive width desktop', root?.id ?? section.root, w.why, drops, via);
      continue;
    }
    if (w.width === 'mobile') {
      // The variants of the desktop root's own set, when the frame holds several.
      const [first, ...more] = frame ? mobileCandidates(frame, roots.find((r) => r.width > 480)?.box ?? null).list : [];
      const variant = first && findBox(frame, first.id);
      const drops = variant ? [{ width: first.w, styles: textStyles(variant).size, nodes: textNodes(variant) }] : [];
      const via = first ? `the mobile root "${first.name}" (${first.id})${more.length ? `, one of ${more.length + 1} variants` : ''}: ` : 'the mobile root, which the module frame does not hold: ';
      add('waive width mobile', first?.id ?? section.root, w.why, drops, via);
    }
  }
  if (section?.skip) {
    const drops = roots.map((r) => ({ width: r.width, styles: textStyles(r.box).size, nodes: textNodes(r.box) }));
    add('skip', section.root, section.skip, drops, 'the whole section, no geometry or type entries required: ');
  }
  return out;
}
