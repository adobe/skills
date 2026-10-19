// skills/reskin/scripts/figma/foundation.mjs — buildFoundation: a Figma nodes response for the chosen
// frames → the donor foundation (canon-source/foundation/*.json), ranked role candidates for the 13
// default-probe paths, module candidates (frames, sections, component sets, remote components) and
// spec tables. Pure and deterministic: document order breaks every tie, nothing reads a clock.
//
// Foundation files: colors, typography, effects, radii, spacing, components. Each record is
//   { value, figma, node, count, nodes }  value = normalized CSS (an object of CSS strings for
//   typography and components), figma = the raw REST value, node = first node seen, nodes = ≤ 5 ids.
// Colors add hex and usage {fill,text,stroke}; components add set, variant and divergent[] (later
// instances whose computed values differ from the first: reported, never averaged). A component's box
// values (fill, radius, padding, border, shadow) come from the layers its label sits in, innermost
// first, with their same-size background layers (figma.box lists them; figma.fields cites the node
// behind each value). Keys are the
// Figma style name slug when any use carries a style (the most frequent wins), else value-derived
// (rgb-31-58-95, inter-16-400, radius-8, pad-24, gap-32, max-width-1200, width-760, shadow-0-4-12-0).
//
// Hidden subtrees (visible: false) contribute nothing. Only a SOLID top paint is a color; gradients
// and images are recorded by kind (backgroundKind) and never turned into a color. Values are read from
// instance children, which carry resolved overrides (overrides[] is empty on real files). Omitted
// auto-layout paddings are 0. Mixed-style text runs (characterStyleOverrides) use the node's base style.
//
// Role-candidate heuristics (candidates only; the agent authors the roles):
//   pageBg       solid fills of the top-level frames, by frame count
//   bodyFg       fills of TEXT at the modal font size (modal by character count), by characters
//   headingFg    fills of TEXT at ≥ 1.5 × the modal size, by node count
//   type.family  font families by characters; from = that family's most-used text style
//   body size    text styles by characters
//   display wt   text styles by font size, largest first
//   buttons.*    components or instances named /button|btn|cta/i (node, component or set name);
//                a /primary/i variant first, then by instance count
//   container    maxWidth values and widths of frames named /container|content|wrapper|grid/i,
//                desktop-scale (≥ 960px) first
//   section pad  paddingTop of auto-layout sections (direct children of the top-level frames)
// Each path: ≤ 5 candidates { from: "<file>/<key>", count, evidence: [≤ 5 node ids] }, ties by
// document order.
import {
  px, paddingShorthand, radiusCss, shadowCss, lineHeightCss, letterSpacingCss, weightCss, solidFill, topPaint,
} from './normalize.mjs';

export const PROBE_PATHS = [
  'palette.pageBg', 'palette.bodyFg', 'palette.headingFg',
  'type.family', 'type.body.fontSize', 'type.display.fontWeight',
  'buttons.primary.background', 'buttons.primary.color', 'buttons.primary.borderRadius',
  'buttons.primary.padding', 'buttons.primary.fontSize',
  'layout.containerMaxWidth', 'layout.sectionPaddingY',
];

// Which foundation file each probe path reads, and which field of an object-valued record.
export const PROBE_SOURCES = {
  'palette.pageBg': { file: 'colors', field: null },
  'palette.bodyFg': { file: 'colors', field: null },
  'palette.headingFg': { file: 'colors', field: null },
  'type.family': { file: 'typography', field: 'fontFamily' },
  'type.body.fontSize': { file: 'typography', field: 'fontSize' },
  'type.display.fontWeight': { file: 'typography', field: 'fontWeight' },
  'buttons.primary.background': { file: 'components', field: 'background' },
  'buttons.primary.color': { file: 'components', field: 'color' },
  'buttons.primary.borderRadius': { file: 'components', field: 'borderRadius' },
  'buttons.primary.padding': { file: 'components', field: 'padding' },
  'buttons.primary.fontSize': { file: 'components', field: 'fontSize' },
  'layout.containerMaxWidth': { file: 'spacing', field: null },
  'layout.sectionPaddingY': { file: 'spacing', field: null },
};

export const FOUNDATION_FILES = ['colors', 'typography', 'effects', 'radii', 'spacing', 'components'];
const SECTION_TYPES = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'GROUP', 'SECTION']);
const BUTTON = /button|btn|cta/i;
const CONTAINER = /container|content|wrapper|grid/i;
const MAX = 5;
const CONTAINER_MIN = 960;

export function slugify(s) {
  return String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// A desktop frame's header row: the topmost horizontal auto-layout in the top band, at least half the
// frame wide, with ≥ 3 visible children of which an inner one (the menu) holds ≥ 2 text-bearing items.
// align: the menu's centre within 2% (≥ 8px) of the row's → center; else ≤ 64px after the first child
// (the brand) → start; ≤ 64px before the last (the actions) → end; anything else is not recorded.
// Subtrees the design names "footer" are skipped: a footer link row has the same shape.
const HEADER_BAND = 240;
const isFooter = (n) => /\bfooter\b/i.test(n?.name || '');
const ADJACENT = 64;
export function headerRowOf(root) {
  const box = (n) => n?.absoluteBoundingBox;
  const fb = box(root);
  if (!fb || fb.width < CONTAINER_MIN) return null;
  const hasText = (n) => visible(n) && (n.type === 'TEXT' || (n.children || []).some(hasText));
  let best = null;
  const visit = (n, depth) => {
    const b = box(n);
    if (!visible(n) || isFooter(n) || depth > 8 || (b && b.y - fb.y > HEADER_BAND)) return;
    const kids = (n.children || []).filter((c) => visible(c) && box(c));
    if (depth > 0 && n.layoutMode === 'HORIZONTAL' && kids.length >= 3 && b && b.width >= 0.5 * fb.width) {
      const menu = kids.slice(1, -1).find((c) => (c.children || []).filter(hasText).length >= 2);
      if (menu && (!best || b.y < best.b.y)) best = { n, b, kids, menu };
    }
    for (const c of n.children || []) visit(c, depth + 1);
  };
  visit(root, 0);
  if (!best) return null;
  const { n, b, kids, menu } = best;
  const mb = box(menu);
  const brand = box(kids[0]);
  const last = box(kids.at(-1));
  const offset = mb.x + mb.width / 2 - (b.x + b.width / 2);
  let align = null;
  if (Math.abs(offset) <= Math.max(8, b.width * 0.02)) align = 'center';
  else if (mb.x - (brand.x + brand.width) <= ADJACENT) align = 'start';
  else if (last.x - (mb.x + mb.width) <= ADJACENT) align = 'end';
  return align && { node: n.id, menu: menu.id, align, offset: Math.round(offset), width: b.width };
}

// Every header row of a frame. A captured frame is often a canvas laying out many screens, so each
// desktop-width node whose parent is the root or a canvas (≥ 1.5× its width) counts as a screen and
// its top band is measured from the screen's own top. Rows are deduped by node.
export function headerRowsOf(root) {
  const w = (n) => n?.absoluteBoundingBox?.width ?? 0;
  if (isFooter(root)) return [];
  const screens = [root];
  const visit = (n, parent, depth) => {
    if (!visible(n) || isFooter(n) || depth > 6) return;
    if (parent && w(n) >= CONTAINER_MIN && (parent === root || w(parent) >= 1.5 * w(n))) screens.push(n);
    for (const c of n.children || []) visit(c, n, depth + 1);
  };
  for (const c of root.children || []) visit(c, root, 1);
  const rows = new Map();
  for (const s of screens) {
    const h = headerRowOf(s);
    if (h && !rows.has(h.node)) rows.set(h.node, { ...h, screen: s.id });
  }
  return [...rows.values()];
}

const numSlug = (n) => slugify(String(Math.round(n * 100) / 100));
const visible = (n) => n && n.visible !== false;
const cleanProp = (name) => String(name).replace(/#[^#]*$/, '');
const pads = (n) => [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0];
const autoLayout = (n) => n.layoutMode && n.layoutMode !== 'NONE';
const rawTextStyle = (s = {}) => ({
  fontFamily: s.fontFamily ?? null,
  fontPostScriptName: s.fontPostScriptName ?? null,
  fontStyle: s.fontStyle ?? null,
  fontWeight: s.fontWeight ?? null,
  fontSize: s.fontSize ?? null,
  lineHeightPx: s.lineHeightPx ?? null,
  lineHeightUnit: s.lineHeightUnit ?? null,
  letterSpacing: s.letterSpacing ?? 0,
});

// A record group: identity → record, keyed at the end so a style name seen late still names it.
function group() {
  const byId = new Map();
  return {
    byId,
    add(identity, { value, figma, node, style, fallbackKey, extra = {} }) {
      let r = byId.get(identity);
      if (!r) {
        r = { value, figma, node, count: 0, nodes: [], styleCounts: new Map(), fallbackKey, ...extra };
        byId.set(identity, r);
      }
      r.count += 1;
      if (!r.nodes.includes(node) && r.nodes.length < MAX) r.nodes.push(node);
      if (style) r.styleCounts.set(style, (r.styleCounts.get(style) || 0) + 1);
      return r;
    },
    finalize(shape) {
      const out = {};
      const keyOf = new Map();
      for (const [identity, r] of byId) {
        let best = null;
        for (const [name, n] of r.styleCounts) if (!best || n > best[1]) best = [name, n];
        const base = best ? slugify(best[0]) : r.fallbackKey;
        let key = base;
        for (let i = 2; key in out; i += 1) key = `${base}-${i}`;
        keyOf.set(identity, key);
        out[key] = shape(r, [...r.styleCounts.keys()]);
      }
      return { records: out, keyOf };
    },
  };
}

function mergeMaps(file, nodes) {
  const maps = { components: {}, componentSets: {}, styles: {} };
  for (const src of [file, ...Object.values(nodes?.nodes || {})]) {
    if (!src) continue;
    for (const k of Object.keys(maps)) for (const [id, v] of Object.entries(src[k] || {})) if (!(id in maps[k])) maps[k][id] = v;
  }
  return maps;
}

// The first visible TEXT in a subtree, depth first in document order.
function firstText(n) {
  if (!visible(n)) return null;
  if (n.type === 'TEXT') return n;
  for (const c of n.children || []) { const t = firstText(c); if (t) return t; }
  return null;
}

function componentInfo(n, maps, parentSet) {
  const comp = n.type === 'INSTANCE' ? maps.components[n.componentId] : maps.components[n.id];
  const setId = comp?.componentSetId ?? (parentSet ? parentSet.id : null);
  const setName = (setId && maps.componentSets[setId]?.name) || parentSet?.name || null;
  const compName = comp?.name ?? (n.type === 'COMPONENT' ? n.name : null);
  return { comp, setName, compName, displayName: setName ?? compName ?? n.name };
}

function variantOf(n, compName) {
  const v = {};
  for (const [k, p] of Object.entries(n.componentProperties || {})) if (p?.type === 'VARIANT') v[cleanProp(k)] = p.value;
  if (!Object.keys(v).length && compName && compName.includes('=')) {
    for (const part of compName.split(',')) {
      const [k, val] = part.split('=').map((s) => s.trim());
      if (k && val) v[k] = val;
    }
  }
  return v;
}

function propsOf(n, maps) {
  const out = {};
  for (const [k, p] of Object.entries(n.componentProperties || {})) {
    out[cleanProp(k)] = p?.type === 'INSTANCE_SWAP' ? (maps.components[p.value]?.name ?? p.value) : p?.value;
  }
  return out;
}

// The visual box of a component without a label: the node itself, then down a chain of single,
// same-size (±1px), non-text children. Real kits often wrap the styled frame inside a bare instance.
function boxChain(n) {
  const chain = [n];
  for (let cur = n; ;) {
    const kids = (cur.children || []).filter(visible);
    const k = kids[0];
    if (kids.length !== 1 || k.type === 'TEXT' || !sameSize(k, cur)) return chain;
    chain.push(k);
    cur = k;
  }
}

const sameSize = (a, b) => {
  const x = a?.absoluteBoundingBox; const y = b?.absoluteBoundingBox;
  return Boolean(x && y && Math.abs(x.width - y.width) <= 1 && Math.abs(x.height - y.height) <= 1);
};

// Nodes from n down to target's parent, or null when target is not under n.
function pathTo(n, target) {
  for (const c of (n.children || []).filter(visible)) {
    if (c === target) return [n];
    const sub = pathTo(c, target);
    if (sub) return [n, ...sub];
  }
  return null;
}

// The layers that paint a button, innermost first: from the label's parent up to the component, each
// level preceded by its background layers (same-size, text-free children, often absolutely
// positioned). A full-width row instance around a hugging button frame is common in real kits.
function boxLayers(n) {
  const label = firstText(n);
  if (!label) return boxChain(n).reverse();
  const path = pathTo(n, label) || [n];
  const layers = [];
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const node = path[i];
    const next = path[i + 1] ?? label;
    for (const c of (node.children || []).filter(visible)) {
      if (c !== next && c.type !== 'TEXT' && !firstText(c) && sameSize(c, node)) layers.push(c);
    }
    layers.push(node);
  }
  return layers;
}

// value: the flattened CSS of the button; fields: for each non-null value, the node that paints it
// and its raw Figma value (the composite-button convention: each property from its own layer).
function buttonValue(n) {
  const chain = boxLayers(n);
  const filled = chain.find((x) => solidFill(x.fills).kind !== 'NONE');
  const fill = solidFill(filled?.fills);
  const stroked = chain.find((x) => x.strokeWeight > 0 && solidFill(x.strokes).kind === 'SOLID');
  // The painted box decides: padding is the auto-layout layer the same size as it (a padded label
  // wrapper inside the button is inner spacing, not the button's padding).
  const box = filled ?? stroked ?? null;
  const padded = box
    ? chain.find((x) => autoLayout(x) && sameSize(x, box))
    : chain.find((x) => autoLayout(x) && pads(x).some((p) => p > 0)) ?? chain.find(autoLayout);
  const rounded = (box && radiusCss(box) ? box : null) ?? chain.find((x) => radiusCss(x));
  const shadowed = chain.find((x) => shadowCss(x.effects));
  const label = firstText(n);
  const st = label?.style || {};
  const value = {
    background: fill.css,
    backgroundKind: fill.kind,
    color: label ? solidFill(label.fills).css : null,
    fontFamily: st.fontFamily ?? null,
    fontSize: label && typeof st.fontSize === 'number' ? px(st.fontSize) : null,
    fontWeight: label && typeof st.fontWeight === 'number' ? weightCss(st.fontWeight) : null,
    lineHeight: label ? lineHeightCss(st) : null,
    letterSpacing: label ? letterSpacingCss(st) : null,
    borderRadius: rounded ? radiusCss(rounded) : null,
    padding: padded ? paddingShorthand(pads(padded)) : null,
    border: stroked ? `${px(stroked.strokeWeight)} solid ${solidFill(stroked.strokes).css}` : null,
    boxShadow: shadowed ? shadowCss(shadowed.effects) : null,
  };
  const at = (node, raw) => ({ node: node.id, raw });
  const fields = {
    background: filled && fill.css ? at(filled, topPaint(filled.fills)) : null,
    color: label && value.color ? at(label, topPaint(label.fills)) : null,
    fontFamily: label && value.fontFamily ? at(label, st.fontFamily) : null,
    fontSize: label && value.fontSize ? at(label, st.fontSize) : null,
    fontWeight: label && value.fontWeight ? at(label, st.fontWeight) : null,
    lineHeight: label ? at(label, { lineHeightPx: st.lineHeightPx ?? null, lineHeightUnit: st.lineHeightUnit ?? null, fontSize: st.fontSize ?? null }) : null,
    letterSpacing: label ? at(label, { letterSpacing: st.letterSpacing ?? 0, fontSize: st.fontSize ?? null }) : null,
    borderRadius: rounded ? at(rounded, rounded.rectangleCornerRadii ?? rounded.cornerRadius) : null,
    padding: padded ? at(padded, pads(padded)) : null,
    border: stroked ? at(stroked, { strokeWeight: stroked.strokeWeight, paint: topPaint(stroked.strokes) }) : null,
    boxShadow: shadowed ? at(shadowed, shadowed.effects.filter((e) => e && e.visible !== false && /SHADOW$/.test(e.type))) : null,
  };
  return { value, fields: Object.fromEntries(Object.entries(fields).filter(([, f]) => f)) };
}

// Aggregate role evidence: identity → { count, chars, evidence, order }.
function tally() {
  const m = new Map();
  return {
    m,
    add(identity, node, chars = 0) {
      let t = m.get(identity);
      if (!t) { t = { count: 0, chars: 0, evidence: [], order: m.size }; m.set(identity, t); }
      t.count += 1;
      t.chars += chars;
      if (!t.evidence.includes(node) && t.evidence.length < MAX) t.evidence.push(node);
    },
  };
}

export function buildFoundation({ file, nodes, frameIds }) {
  const maps = mergeMaps(file, nodes);
  const styleName = (id) => (id && maps.styles[id]?.name) || null;
  const g = { colors: group(), typography: group(), effects: group(), radii: group(), spacing: group(), components: group() };
  const texts = [];
  const specTables = [];
  const pageBg = tally();
  const sectionPad = tally();
  const frames = [];
  const missing = [];
  const usedSlugs = new Set();
  // Top-level nodes → their page (CANVAS), so a component kit's modules map to the page that documents them.
  const pageOf = new Map();
  for (const p of file?.document?.children || []) for (const c of p.children || []) pageOf.set(c.id, { node: p.id, name: p.name });

  const addColor = (paints, node, usage, style) => {
    const f = solidFill(paints);
    if (f.kind !== 'SOLID') return null;
    const p = topPaint(paints);
    const r = g.colors.add(f.css, {
      value: f.css, figma: { color: p.color, opacity: p.opacity ?? 1 }, node, style,
      fallbackKey: slugify(f.css), extra: { hex: f.hex, usage: { fill: 0, text: 0, stroke: 0 } },
    });
    r.usage[usage] += 1;
    return f.css;
  };
  const addSpacing = (kind, prefix, n, node) => {
    if (!(typeof n === 'number' && n > 0)) return null;
    const value = px(n);
    const identity = `${kind}:${value}`;
    g.spacing.add(identity, { value, figma: { kind, px: n }, node, fallbackKey: `${prefix}-${numSlug(n)}` });
    return identity;
  };

  function walk(n, parentSet) {
    if (!visible(n)) return;
    const s = n.styles || {};
    const fillCss = addColor(n.fills, n.id, n.type === 'TEXT' ? 'text' : 'fill', styleName(s.fill));
    if (n.strokeWeight > 0) addColor(n.strokes, n.id, 'stroke', styleName(s.stroke));

    if (n.type === 'TEXT' && n.style) {
      const st = n.style;
      const identity = [st.fontFamily, st.fontSize, st.fontWeight, st.lineHeightUnit, st.lineHeightPx, st.letterSpacing ?? 0].join('|');
      const typo = g.typography.add(identity, {
        value: { fontFamily: st.fontFamily, fontSize: px(st.fontSize), fontWeight: weightCss(st.fontWeight), lineHeight: lineHeightCss(st), letterSpacing: letterSpacingCss(st) },
        figma: rawTextStyle(st), node: n.id, style: styleName(s.text),
        fallbackKey: slugify(`${st.fontFamily} ${st.fontSize} ${st.fontWeight}`),
      });
      const chars = (n.characters || '').length;
      // Horizontal alignment per text style, weighted by characters: curate derives
      // type.display.textAlign from the display record's majority (renderers fall back to left).
      if (typeof st.textAlignHorizontal === 'string') {
        const a = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[st.textAlignHorizontal];
        if (a) { typo.align ??= {}; typo.align[a] = (typo.align[a] || 0) + Math.max(chars, 1); }
      }
      texts.push({ node: n.id, chars, size: st.fontSize, family: st.fontFamily, typo: identity, color: fillCss });
      const raw = (n.characters || '').trim();
      if (raw.startsWith('{')) {
        try {
          const json = JSON.parse(raw);
          if (json && typeof json === 'object' && !Array.isArray(json) && Object.keys(json).length) specTables.push({ node: n.id, name: n.name, json });
        } catch { /* prose that starts with a brace */ }
      }
    }

    const shadow = shadowCss(n.effects);
    if (shadow) {
      const fx = (n.effects || []).filter((e) => e && e.visible !== false && /SHADOW$/.test(e.type));
      const e0 = fx[0];
      g.effects.add(shadow, {
        value: shadow, figma: fx, node: n.id, style: styleName(s.effect),
        fallbackKey: slugify(`shadow ${e0.offset?.x ?? 0} ${e0.offset?.y ?? 0} ${e0.radius ?? 0} ${e0.spread ?? 0}${fx.length > 1 ? ` x${fx.length}` : ''}`),
      });
    }

    const radius = radiusCss(n);
    if (radius && !/^0px( 0px)*$/.test(radius)) {
      g.radii.add(radius, {
        value: radius, figma: n.rectangleCornerRadii ?? n.cornerRadius, node: n.id,
        fallbackKey: slugify(`radius ${radius.replace(/px/g, '')}`),
      });
    }

    if (autoLayout(n)) {
      for (const p of pads(n)) addSpacing('padding', 'pad', p, n.id);
      addSpacing('gap', 'gap', n.itemSpacing, n.id);
    }
    addSpacing('max-width', 'max-width', n.maxWidth, n.id);
    if (['FRAME', 'INSTANCE', 'COMPONENT'].includes(n.type) && CONTAINER.test(n.name || '')) addSpacing('width', 'width', n.absoluteBoundingBox?.width, n.id);

    if (n.type === 'INSTANCE' || n.type === 'COMPONENT') {
      const info = componentInfo(n, maps, parentSet);
      if ([n.name, info.compName, info.setName].some((x) => BUTTON.test(x || ''))) {
        const variant = variantOf(n, info.compName);
        const { value, fields: sources } = buttonValue(n);
        const identity = `component:${n.type === 'INSTANCE' ? n.componentId : n.id}`;
        const existing = g.components.byId.get(identity);
        const r = g.components.add(identity, {
          value, node: n.id,
          figma: {
            componentId: n.type === 'INSTANCE' ? n.componentId : n.id,
            componentProperties: propsOf(n, maps),
            box: boxLayers(n).map((x) => x.id),
            fields: sources,
          },
          fallbackKey: slugify([info.setName ?? info.compName ?? n.name, ...Object.values(variant)].join(' ')),
          extra: { set: info.setName, variant, divergent: [] },
        });
        if (existing) {
          const fields = Object.keys(value).filter((k) => value[k] !== r.value[k]);
          if (fields.length) r.divergent.push({ node: n.id, fields });
        }
      }
    }

    const set = n.type === 'COMPONENT_SET' ? { id: n.id, name: n.name } : parentSet;
    for (const c of n.children || []) walk(c, set);
  }

  function componentsUsed(n, acc) {
    if (!visible(n)) return acc;
    if (n.type === 'INSTANCE') {
      const { displayName } = componentInfo(n, maps, null);
      if (!acc.includes(displayName)) acc.push(displayName);
    }
    for (const c of n.children || []) componentsUsed(c, acc);
    return acc;
  }

  for (const id of frameIds) {
    const root = nodes?.nodes?.[id]?.document;
    if (!root) { missing.push(id); continue; }
    walk(root, null);
    const bg = solidFill(root.fills);
    if (bg.kind === 'SOLID') pageBg.add(bg.css, root.id);
    const top = root.absoluteBoundingBox?.y ?? 0;
    const sections = (root.children || [])
      .filter((c) => visible(c) && SECTION_TYPES.has(c.type))
      .map((c, i) => {
        const fill = solidFill(c.fills);
        if (autoLayout(c) && (c.paddingTop ?? 0) > 0) sectionPad.add(`padding:${px(c.paddingTop)}`, c.id);
        const info = c.type === 'INSTANCE' ? componentInfo(c, maps, null) : null;
        return {
          i,
          section: {
            node: c.id, name: c.name, type: c.type,
            y: (c.absoluteBoundingBox?.y ?? 0) - top, height: c.absoluteBoundingBox?.height ?? 0,
            background: fill.css, backgroundKind: fill.kind,
            instanceOf: info ? info.displayName : null,
            componentProperties: info ? propsOf(c, maps) : null,
            components: componentsUsed(c, []),
          },
        };
      })
      .sort((a, b) => a.section.y - b.section.y || a.i - b.i)
      .map((x) => x.section);
    const base = slugify(root.name);
    let slug = base;
    for (let i = 2; usedSlugs.has(slug); i += 1) slug = `${base}-${i}`;
    usedSlugs.add(slug);
    frames.push({ node: root.id, name: root.name, page: pageOf.get(root.id) ?? null, slug, width: root.absoluteBoundingBox?.width ?? 0, height: root.absoluteBoundingBox?.height ?? 0, sections, headerRows: headerRowsOf(root) });
  }

  // ---- finalize records ---------------------------------------------------------------------------
  const strip = ({ styleCounts, fallbackKey, ...r }) => r;
  const shaped = {
    colors: g.colors.finalize((r, styles) => ({ value: r.value, hex: r.hex, figma: r.figma, node: r.node, count: r.count, nodes: r.nodes, usage: r.usage, styles })),
    typography: g.typography.finalize((r, styles) => ({ ...strip(r), styles })),
    effects: g.effects.finalize((r, styles) => ({ ...strip(r), styles })),
    radii: g.radii.finalize((r) => strip(r)),
    spacing: g.spacing.finalize((r) => strip(r)),
    components: g.components.finalize((r) => ({ value: r.value, figma: r.figma, node: r.node, count: r.count, nodes: r.nodes, set: r.set, variant: r.variant, divergent: r.divergent })),
  };
  const foundation = Object.fromEntries(FOUNDATION_FILES.map((f) => [f, shaped[f].records]));
  const ref = (f, identity) => `${f}/${shaped[f].keyOf.get(identity)}`;

  // ---- role candidates ----------------------------------------------------------------------------
  const rank = (t, f, cmp, withChars = false) => [...t.m.entries()]
    .filter(([identity]) => shaped[f].keyOf.has(identity))
    .sort(([, a], [, b]) => cmp(a, b) || a.order - b.order)
    .slice(0, MAX)
    .map(([identity, x]) => ({ from: ref(f, identity), count: x.count, ...(withChars ? { chars: x.chars } : {}), evidence: x.evidence }));
  const byCount = (a, b) => b.count - a.count;
  const byChars = (a, b) => b.chars - a.chars || b.count - a.count;

  const sizeChars = new Map();
  for (const t of texts) sizeChars.set(t.size, (sizeChars.get(t.size) || 0) + t.chars);
  let modal = null;
  for (const [size, chars] of sizeChars) if (modal === null || chars > sizeChars.get(modal)) modal = size;

  const bodyFg = tally(); const headingFg = tally(); const families = new Map(); const bodySize = tally(); const display = tally();
  const typoSize = new Map();
  for (const t of texts) {
    if (t.color && t.size === modal) bodyFg.add(t.color, t.node, t.chars);
    if (t.color && modal !== null && t.size >= 1.5 * modal) headingFg.add(t.color, t.node, t.chars);
    bodySize.add(t.typo, t.node, t.chars);
    display.add(t.typo, t.node, t.chars);
    typoSize.set(t.typo, t.size);
    if (!families.has(t.family)) families.set(t.family, { tally: tally(), chars: 0, count: 0, evidence: [], order: families.size });
    const fam = families.get(t.family);
    fam.tally.add(t.typo, t.node, t.chars);
    fam.chars += t.chars; fam.count += 1;
    if (fam.evidence.length < MAX) fam.evidence.push(t.node);
  }
  const familyCandidates = [...families.values()]
    .sort((a, b) => b.chars - a.chars || b.count - a.count || a.order - b.order)
    .slice(0, MAX)
    .map((fam) => {
      const [top] = rank(fam.tally, 'typography', byChars);
      return { from: top.from, count: fam.count, chars: fam.chars, evidence: fam.evidence };
    });

  const buttons = [...g.components.byId.values()]
    .map((r, order) => ({ r, order, primary: [...Object.values(r.variant), r.fallbackKey].some((v) => /primary/i.test(String(v ?? ''))) }))
    .sort((a, b) => (b.primary - a.primary) || (b.r.count - a.r.count) || a.order - b.order)
    .slice(0, MAX)
    .map(({ r }) => ({ from: `components/${shaped.components.keyOf.get(`component:${r.figma.componentId}`)}`, count: r.count, evidence: r.nodes }));

  // Desktop page containers are rarely narrower than 960px; narrower max-widths are usually text
  // measures, which can outnumber the container by hundreds on a component kit.
  const container = [...g.spacing.byId.entries()]
    .filter(([identity]) => identity.startsWith('max-width:') || identity.startsWith('width:'))
    .map(([identity, r], order) => ({ identity, r, order, wide: r.figma.px >= CONTAINER_MIN }))
    .sort((a, b) => (b.wide - a.wide) || b.r.count - a.r.count || a.order - b.order)
    .map(({ identity, r }) => ({ from: ref('spacing', identity), count: r.count, evidence: r.nodes }));

  const roleCandidates = {
    'palette.pageBg': rank(pageBg, 'colors', byCount),
    'palette.bodyFg': rank(bodyFg, 'colors', byChars, true),
    'palette.headingFg': rank(headingFg, 'colors', byCount),
    'type.family': familyCandidates,
    'type.body.fontSize': rank(bodySize, 'typography', byChars, true),
    'type.display.fontWeight': [...display.m.entries()]
      .sort(([ia, a], [ib, b]) => typoSize.get(ib) - typoSize.get(ia) || b.count - a.count || a.order - b.order)
      .slice(0, MAX)
      .map(([identity, x]) => ({ from: ref('typography', identity), count: x.count, evidence: x.evidence })),
    'buttons.primary.background': buttons,
    'buttons.primary.color': buttons,
    'buttons.primary.borderRadius': buttons,
    'buttons.primary.padding': buttons,
    'buttons.primary.fontSize': buttons,
    'layout.containerMaxWidth': container.slice(0, MAX),
    'layout.sectionPaddingY': rank(sectionPad, 'spacing', byCount),
  };

  // ---- module candidates --------------------------------------------------------------------------
  const sets = new Map();
  for (const [id, set] of Object.entries(maps.componentSets)) sets.set(id, { node: id, name: set.name, variantOptions: {} });
  for (const comp of Object.values(maps.components)) {
    const set = comp.componentSetId && sets.get(comp.componentSetId);
    if (!set) continue;
    for (const [k, v] of Object.entries(variantOf({}, comp.name))) {
      set.variantOptions[k] ??= [];
      if (!set.variantOptions[k].includes(v)) set.variantOptions[k].push(v);
    }
  }
  const remote = Object.entries(maps.components)
    .filter(([, c]) => c.remote)
    .map(([componentId, c]) => {
      const setName = c.componentSetId && maps.componentSets[c.componentSetId]?.name;
      return { componentId, name: setName ? `${setName} (${c.name})` : c.name };
    });

  return {
    foundation,
    roleCandidates,
    moduleCandidates: { frames, componentSets: [...sets.values()], remote, missing },
    specTables,
  };
}
