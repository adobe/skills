// skills/reskin/scripts/figma/pages.mjs — every page of a Figma-only site, and the kit its blocks come from
// (reskin Phase 2′; reference/content-model.md § Figma-sourced models, § Pages and kit). Pure: the I/O is
// figma/pages-run.mjs.
//
// A design-system file is organised by canvas: marker canvases (FOUNDATIONS, COMPONENTS, TEMPLATE
// SECTIONS, FULL PAGES) head groups of child canvases (❖ Button, ❏ Header, --- Login & Registration).
//   canvases   each canvas gets a group: its prefix glyph (❖ component, ❏ template, ↪ foundation) wins;
//              else a marker canvas sets the group for the indented canvases after it; else none.
//              rules.kit.canvases { "<canvasId>": "<group>" } overrides either.
//   pages      on every `pages` canvas: each COMPONENT_SET is a page family, its variants pages — the
//              breakpoint property (Breakpoint|Device|Viewport|Screen) picks desktop/tablet/mobile, the
//              other properties name the page (Type=Login Landing → login-landing). A canvas without a
//              set takes its top-level frames as pages, breakpoint words stripped from the name to pair
//              them. Frames beside a set and names matching rules.kit.exclude (Page: …, Cover, Notes)
//              are documentation and are listed as skipped, never silently dropped.
//   library    EVERY template and component canvas is one block of the site's block library, used by a page
//              or not (rules.kit.blockPer "canvas", the default; "set": one block per public set). Its
//              component sets (and lone components) within kit.depth are the block's sets: public ones are
//              its variants (a class from the set name when the canvas holds several), names starting "."
//              or "_" are its internal parts. Each block is one donor module (M1… in canvas order), its main
//              set the frame capture renders for it.
//   kit        a page frame's instances (wrappers descended, hidden skipped) bind to the block whose canvas
//              holds the set (or lone component) they instance — variant classes from the set and its
//              non-breakpoint properties (Default/None and bare breakpoint values dropped). A page uses only
//              the blocks it instances; a set found on no kit canvas becomes an off-kit block of its own.
//              So a page's sections are formed from the kit's template sections and components, never
//              re-invented per page.
import { safeClassToken, safeId } from './content.mjs';

export const PAGES_VERSION = 1;
export const GROUPS = ['foundation', 'component', 'template', 'pages'];
export const KIT_GROUPS = ['template', 'component'];
export const DEFAULT_KIT = {
  markers: {
    foundation: '^(foundations?|styles?|tokens?)$',
    component: '^(components?|atoms|molecules|elements?)$',
    template: '^(template ?sections?|templates?|sections?|patterns?|organisms|modules?|blocks?)$',
    pages: '^(full ?pages?|pages?|screens?|layouts?)$',
  },
  prefixes: { '❖': 'component', '◆': 'component', '❏': 'template', '▢': 'template', '↪': 'foundation' },
  breakpointProp: '^(breakpoint|device|viewport|screen|platform)$',
  blockPer: 'canvas',
  depth: 5,
  exclude: '^(page|cover|docs?|documentation|notes?|readme|annotations?|changelog)\\b\\s*[:\\-–—]?',
};

const BP_WORDS = [
  ['desktop', /\b(desktop|web|wide|large|lg|xl|x-large|1[2-9]\d\d(px)?|2\d\d\d(px)?)\b/i],
  ['tablet', /\b(tablet|ipad|medium|md|[789]\d\d(px)?)\b/i],
  ['mobile', /\b(mobile|phone|small|sm|xs|[34]\d\d(px)?)\b/i],
];
const BP_ORDER = ['desktop', 'tablet', 'mobile'];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const box = (n) => n?.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
const visible = (n) => n && n.visible !== false;

// "❖ Button" → "button"; "--- Login & Registration" → "login registration"; emoji and glyphs dropped.
export const markerName = (s) => norm(String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ')).toLowerCase();

export function compileKit(rules = {}) {
  const k = rules.kit || {};
  const markers = { ...DEFAULT_KIT.markers, ...(k.markers || {}) };
  for (const g of Object.keys(markers)) if (!GROUPS.includes(g)) throw new Error(`kit.markers.${g}: groups are ${GROUPS.join(', ')}`);
  for (const [id, g] of Object.entries(k.canvases || {})) if (!GROUPS.includes(g)) throw new Error(`kit.canvases.${id}: "${g}" is not one of ${GROUPS.join(', ')}`);
  if (k.blockPer !== undefined && !['canvas', 'set'].includes(k.blockPer)) throw new Error(`kit.blockPer: "${k.blockPer}" is not canvas or set`);
  if (k.depth !== undefined && !(Number.isInteger(k.depth) && k.depth >= 2 && k.depth <= 12)) throw new Error(`kit.depth: ${k.depth} is not an integer 2–12`);
  return {
    markers: Object.entries(markers).map(([group, re]) => ({ group, re: new RegExp(re, 'i') })),
    prefixes: { ...DEFAULT_KIT.prefixes, ...(k.prefixes || {}) },
    canvases: k.canvases || {},
    breakpointProp: new RegExp(k.breakpointProp || DEFAULT_KIT.breakpointProp, 'i'),
    exclude: new RegExp(k.exclude || DEFAULT_KIT.exclude, 'i'),
    blockPer: k.blockPer ?? DEFAULT_KIT.blockPer,
    depth: k.depth ?? DEFAULT_KIT.depth,
  };
}

// ---- canvases --------------------------------------------------------------------------------------------------
export function classifyCanvases(canvases, kit) {
  let current = null;
  return canvases.map((c) => {
    const raw = String(c.name ?? '');
    const trimmed = raw.trim();
    const glyph = Object.keys(kit.prefixes).find((p) => trimmed.startsWith(p));
    const clean = markerName(raw);
    const marker = kit.markers.find((m) => m.re.test(clean));
    let group = null;
    let how = null;
    if (kit.canvases[c.id]) { group = kit.canvases[c.id]; how = 'rules.kit.canvases'; } else if (glyph) { group = kit.prefixes[glyph]; how = `prefix ${glyph}`; } else if (marker && !/^\s/.test(raw)) { group = marker.group; how = 'marker'; } else if (/^\s/.test(raw) && current) { group = current; how = 'under marker'; }
    if (marker && !/^\s/.test(raw) && !glyph) current = marker.group;
    else if (!/^\s/.test(raw) && !glyph && clean) current = null;
    return { id: c.id, name: norm(raw), group, how, marker: Boolean(marker && how === 'marker') };
  });
}

// ---- variants and breakpoints ------------------------------------------------------------------------------------
export function parseVariant(name) {
  const s = String(name ?? '');
  if (!/^[^=,]+=/.test(s)) return null;
  return s.split(/,\s*(?=[^=,]+=)/).map((p) => { const i = p.indexOf('='); return [norm(p.slice(0, i)), norm(p.slice(i + 1))]; });
}

export function breakpointOf(word, width) {
  for (const [bp, re] of BP_WORDS) if (word && re.test(word)) return bp;
  if (!width) return null;
  return width >= 1024 ? 'desktop' : width >= 600 ? 'tablet' : 'mobile';
}

const stripBreakpoint = (name) => {
  let s = String(name ?? '');
  for (const [, re] of BP_WORDS) s = s.replace(new RegExp(re.source, 'gi'), ' ');
  return norm(s.replace(/[\s\-–—_/|,:()[\]]+$/g, '').replace(/^[\s\-–—_/|,:()[\]]+/g, '').replace(/\s*[\-–—_/|,]\s*(?=[\-–—_/|,]|$)/g, ''));
};

export const pageSlug = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

// ---- pages -------------------------------------------------------------------------------------------------------
// canvasNodes: [{ canvas: {id,name,group}, children: [top-level node with its children] }]
export function discoverPages(canvasNodes, kit) {
  const families = [];
  const skipped = [];
  for (const { canvas, children } of canvasNodes) {
    if (canvas.group !== 'pages') continue;
    const kids = (children || []).filter(visible);
    const sets = kids.filter((k) => k.type === 'COMPONENT_SET');
    for (const k of kids) {
      if (k.type === 'COMPONENT_SET') continue;
      if (!['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(k.type)) { skipped.push({ node: k.id, name: norm(k.name), canvas: canvas.id, why: `a ${k.type}, not a page frame` }); continue; }
      if (sets.length) { skipped.push({ node: k.id, name: norm(k.name), canvas: canvas.id, why: 'a frame beside the page component set (documentation)' }); continue; }
      if (kit.exclude.test(markerName(k.name)) || kit.exclude.test(norm(k.name))) { skipped.push({ node: k.id, name: norm(k.name), canvas: canvas.id, why: 'name matches kit.exclude (documentation)' }); continue; }
    }
    if (sets.length) {
      for (const set of sets) {
        for (const v of (set.children || []).filter(visible)) {
          const props = parseVariant(v.name);
          if (!props) { skipped.push({ node: v.id, name: norm(v.name), canvas: canvas.id, why: 'a variant without property=value pairs' }); continue; }
          const bpProp = props.find(([key]) => kit.breakpointProp.test(key));
          const rest = props.filter((p) => p !== bpProp);
          const title = rest.length ? rest.map(([, val]) => val).join(' / ') : norm(set.name);
          families.push({ key: `${set.id}|${title.toLowerCase()}`, title, canvas, set: { id: set.id, name: norm(set.name) }, frame: v, breakpoint: breakpointOf(bpProp?.[1], box(v).width), props: Object.fromEntries(props) });
        }
      }
    } else {
      for (const k of kids) {
        if (!['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(k.type) || kit.exclude.test(markerName(k.name)) || kit.exclude.test(norm(k.name))) continue;
        const title = stripBreakpoint(k.name) || norm(k.name);
        const word = BP_WORDS.find(([, re]) => re.test(k.name));
        families.push({ key: `${canvas.id}|${title.toLowerCase()}`, title, canvas, set: null, frame: k, breakpoint: breakpointOf(word ? k.name : null, box(k).width), props: null });
      }
    }
  }
  const byKey = new Map();
  for (const f of families) {
    if (!byKey.has(f.key)) byKey.set(f.key, { title: f.title, canvas: f.canvas, set: f.set, variants: {}, props: {} });
    const p = byKey.get(f.key);
    const bp = f.breakpoint || 'desktop';
    if (p.variants[bp]) { skipped.push({ node: f.frame.id, name: norm(f.frame.name), canvas: f.canvas.id, why: `a second ${bp} frame for "${f.title}" (kept ${p.variants[bp].id})` }); continue; }
    p.variants[bp] = { id: f.frame.id, name: norm(f.frame.name), width: Math.round(box(f.frame).width), height: Math.round(box(f.frame).height) };
  }
  const used = new Set();
  const pages = [...byKey.values()].map((p) => {
    let slug = pageSlug(p.title) || `page-${safeId(Object.values(p.variants)[0].id)}`;
    if (used.has(slug)) slug = `${slug}-${pageSlug(p.set?.name || p.canvas.name)}`.slice(0, 80);
    for (let i = 2; used.has(slug); i += 1) slug = `${pageSlug(p.title)}-${i}`;
    used.add(slug);
    const bps = BP_ORDER.filter((b) => p.variants[b]);
    const frame = p.variants[bps[0]].id;
    const responsive = [...bps].reverse().find((b) => p.variants[b].id !== frame);
    return { slug, title: p.title, canvas: { id: p.canvas.id, name: p.canvas.name }, family: p.set || { id: null, name: p.canvas.name }, template: pageSlug(String(p.set?.name || p.canvas.name).replace(/^\s*page\s*[:\-–—]\s*/i, '')) || null, variants: p.variants, frame, responsive: responsive ? p.variants[responsive].id : null };
  });
  return { pages, skipped };
}

// Every variant id → its page slug: NODE links (prototype navigation) in any breakpoint resolve.
export const linkMap = (pages) => Object.fromEntries(pages.flatMap((p) => Object.values(p.variants).map((v) => [v.id, p.slug])));

// ---- instances → kit --------------------------------------------------------------------------------------------
// The page frame's top-level instances in reading order (y, then x); non-instance wrappers are descended.
export function topInstances(frame) {
  const out = [];
  (function walk(n) {
    for (const c of (n.children || []).filter(visible)) {
      if (c.type === 'INSTANCE') out.push(c);
      else if (c.children?.length) walk(c);
    }
  }(frame));
  return out.sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x);
}

// One instance → { setId|componentId, names, props }: the kit identity of what it instances.
export function instanceKit(n, { components = {}, componentSets = {} } = {}) {
  const c = components[n.componentId];
  if (!c) return { key: n.componentId || null, setId: null, componentId: n.componentId || null, set: null, component: null, props: [] };
  const setId = c.componentSetId || null;
  return { key: setId || n.componentId, setId, componentId: n.componentId, set: setId ? norm(componentSets[setId]?.name) || null : null, component: norm(c.name), props: setId ? (parseVariant(c.name) || []) : [] };
}

export const blockNameOf = (name, id) => safeClassToken(markerName(name).replace(/\s+/g, '-')) || `kit-${safeId(id)}`.toLowerCase();
export function variantClasses(props, kit) {
  return props.filter(([k, v]) => !kit.breakpointProp.test(k) && !/^(default|none|false|off|desktop|tablet|mobile)$/i.test(v)).map(([, v]) => blockNameOf(v, v)).filter((t) => t && !t.startsWith('kit-'));
}

// homes: { "<setId|componentId>": { canvasId, canvasName, group } } (from the ids-pruned file response)
export function homesFrom(fileResponse, ids, canvases) {
  const want = new Set(ids);
  const group = new Map(canvases.map((c) => [c.id, c.group]));
  const homes = {};
  for (const canvas of fileResponse?.document?.children || []) {
    (function walk(n) {
      if (want.has(n.id)) { homes[n.id] = { canvasId: canvas.id, canvasName: norm(canvas.name), group: group.get(canvas.id) ?? null }; return; }
      for (const c of n.children || []) walk(c);
    }(canvas));
  }
  return homes;
}

// ---- the block library ---------------------------------------------------------------------------------------
const isPart = (name) => /^\s*[._]/.test(String(name ?? ''));
// A set's variant class inside its block: its name, the block name prefix dropped (Teaser / Card → card).
export function setClass(name, block) {
  let t = blockNameOf(String(name ?? '').replace(/^[\s._]+/, ''), '');
  if (!t || t.startsWith('kit-') || t === block) return null;
  if (t.startsWith(`${block}-`)) t = t.slice(block.length + 1);
  return t || null;
}

// kitCanvasNodes: [{ canvas: {id,name,group,marker}, document }] for the template/component canvases, fetched
// to kit.depth. → { blocks, index: { setId: { block, class, part } }, empty: [canvases with no set in reach] }
export function kitLibrary(kitCanvasNodes, kit) {
  const blocks = [];
  const index = {};
  const names = new Set();
  const empty = [];
  const name = (base, id, group) => {
    let b = blockNameOf(base, id);
    if (names.has(b)) b = `${b}-${group || 'kit'}`;
    for (let i = 2; names.has(b); i += 1) b = `${blockNameOf(base, id)}-${i}`;
    names.add(b);
    return b;
  };
  for (const { canvas, document } of kitCanvasNodes) {
    if (!KIT_GROUPS.includes(canvas.group) || canvas.marker) continue;
    const found = [];
    (function walk(n) { for (const c of (n?.children || []).filter(visible)) { if (c.type === 'COMPONENT_SET' || c.type === 'COMPONENT') found.push(c); else walk(c); } }(document));
    if (!found.length) { empty.push({ canvasId: canvas.id, name: canvas.name, group: canvas.group, why: `no component set within depth ${kit.depth} (raise content-rules.json kit.depth)` }); continue; }
    const sets = found.map((n) => ({ id: n.id, name: norm(n.name), kind: n.type, part: isPart(n.name), count: n.type === 'COMPONENT_SET' ? (n.children || []).filter((c) => c.type === 'COMPONENT').length : 1, props: n.type === 'COMPONENT_SET' ? [...new Set((n.children || []).flatMap((c) => (parseVariant(c.name) || []).map(([k]) => k)))] : [] }));
    const publics = sets.filter((x) => !x.part);
    const home = { canvasId: canvas.id, canvasName: canvas.name, group: canvas.group };
    const groups = kit.blockPer === 'set' && publics.length > 1
      ? publics.map((p, i) => ({ base: p.name, main: p, members: i === 0 ? [p, ...sets.filter((x) => x.part)] : [p] }))
      : [{ base: canvas.name, main: publics[0] || sets[0], members: sets }];
    for (const g of groups) {
      const block = name(g.base, g.main.id, canvas.group);
      const multi = g.members.filter((x) => !x.part).length > 1;
      const members = g.members.map((x) => ({ ...x, class: x.part || multi ? setClass(x.name, block) : null }));
      for (const x of members) index[x.id] = { block, class: x.class, part: x.part };
      blocks.push({
        block, module: null, canvas: { id: canvas.id, name: canvas.name }, group: canvas.group, home,
        set: { id: g.main.id, name: g.main.name, kind: g.main.kind },
        sets: members.filter((x) => !x.part).map(({ id, name: n, kind, count, props, class: c }) => ({ id, name: n, kind, count, props, class: c })),
        parts: members.filter((x) => x.part).map(({ id, name: n, kind, count, class: c }) => ({ id, name: n, kind, count, class: c })),
        variants: [], used: false, usedBy: [], instances: 0,
      });
    }
  }
  return { blocks, index, empty };
}

// pages[] + per-page frame responses + the library (+ homes for sets outside it) → the registry: every library
// block (used or not), off-kit blocks, per-page bindings and the set index content --all binds sections through.
export function buildKitRegistry({ pages, frameOf, homes = {}, kit, library = null }) {
  const blocks = (library?.blocks || []).map((b) => ({ ...b, variants: [], used: false, usedBy: [], instances: 0 }));
  const byName = new Map(blocks.map((b) => [b.block, b]));
  const index = { ...(library?.index || {}) };
  const names = new Set(blocks.map((b) => b.block));
  const bindings = {};
  const offKit = [];
  for (const p of pages) {
    const hit = frameOf(p.frame);
    if (!hit) { bindings[p.slug] = null; continue; }
    bindings[p.slug] = topInstances(hit.frame).map((n) => {
      const k = instanceKit(n, hit.maps);
      if (!k.key) return { node: n.id, name: norm(n.name), block: null, why: 'instance of a missing component' };
      if (!index[k.key]) {
        const home = homes[k.key] || null;
        let block = blockNameOf(k.set || k.component, k.key);
        if (names.has(block)) block = `${block}-${home?.group || 'kit'}`;
        for (let i = 2; names.has(block); i += 1) block = `${blockNameOf(k.set || k.component, k.key)}-${i}`;
        names.add(block);
        const b = { block, module: null, canvas: home ? { id: home.canvasId, name: home.canvasName } : null, group: home?.group ?? null, home, set: { id: k.key, name: k.set || k.component, kind: k.setId ? 'COMPONENT_SET' : 'COMPONENT' }, sets: [{ id: k.key, name: k.set || k.component, kind: k.setId ? 'COMPONENT_SET' : 'COMPONENT', class: null }], parts: [], variants: [], used: false, usedBy: [], instances: 0, offKit: true };
        blocks.push(b);
        byName.set(block, b);
        index[k.key] = { block, class: null, part: false };
        offKit.push({ block, set: b.set, home, why: home ? (KIT_GROUPS.includes(home.group) ? `its set is beyond kit.depth on "${home.canvasName}"` : `its home canvas "${home.canvasName}" is ${home.group ? `a ${home.group} canvas` : 'outside the kit groups'}`) : 'its home canvas was not found' });
      }
      const e = index[k.key];
      const b = byName.get(e.block);
      const variant = [...(e.class ? [e.class] : []), ...variantClasses(k.props, kit)];
      const vkey = variant.join(' ');
      if (!b.variants.some((v) => v.join(' ') === vkey)) b.variants.push(variant);
      if (!b.usedBy.includes(p.slug)) b.usedBy.push(p.slug);
      b.used = true;
      b.instances += 1;
      return { node: n.id, name: norm(n.name), block: b.block, variant, setId: k.key, component: k.component, ...(e.part ? { part: true } : {}) };
    });
  }
  blocks.forEach((b, i) => { b.module = `M${i + 1}`; });
  for (const list of Object.values(bindings)) for (const x of list || []) if (x.block) x.module = byName.get(x.block).module;
  return { blocks, bindings, offKit, index };
}

// curation-rules.json modules[] rows, one per block of the library (curate validates them against the capture).
export function moduleSeed(blocks) {
  return blocks.map((b) => {
    const kind = b.group || 'set';
    const sets = (b.sets || []).map((x) => x.name);
    const parts = (b.parts || []).map((x) => x.name);
    const use = b.used ? `instanced ${b.instances}× on ${b.usedBy.length} page(s)` : 'on no page (library block)';
    return {
      id: b.module,
      name: b.canvas?.name ? markerName(b.canvas.name).replace(/\b\w/g, (c) => c.toUpperCase()) : b.set.name,
      frame: b.set.id,
      family: b.group || 'kit',
      anatomy: `Figma kit ${kind} "${b.canvas?.name || b.set.name}": set${sets.length > 1 ? 's' : ''} ${sets.join(', ') || b.set.name}${parts.length ? `; parts ${parts.join(', ')}` : ''}; ${use} — refine with the slots it carries`,
      variants: [...new Set([...(b.sets || []).map((x) => x.class).filter(Boolean), ...b.variants.map((v) => v.join(' ')).filter(Boolean)])],
      components: [],
      status: 'include',
      block: b.block,
      used: b.used,
    };
  });
}

// Library blocks no page instances (they ship in the block library all the same).
export const unusedKit = (blocks) => blocks.filter((b) => !b.used).map((b) => ({ block: b.block, module: b.module, canvas: b.canvas?.name ?? null, group: b.group }));

// The page that carries the site chrome: the most common header variant, first page wins ties.
export function chromeSource(pages, bindings) {
  const sig = (slug) => (bindings[slug] || []).filter((b) => /^(header|nav|navigation|top-?bar|site-header)/.test(b.block || '')).map((b) => `${b.block}:${b.variant.join(' ')}`).join('|');
  const counts = new Map();
  for (const p of pages) { const s = sig(p.slug); if (s) counts.set(s, (counts.get(s) || 0) + 1); }
  if (!counts.size) return pages[0]?.slug ?? null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return pages.find((p) => sig(p.slug) === best).slug;
}
