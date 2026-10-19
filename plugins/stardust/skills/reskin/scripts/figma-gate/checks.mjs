// skills/reskin/scripts/figma-gate/checks.mjs — the checks file (reskin/figma-checks/<slug>.json): the agent
// pairs page selectors with Figma nodes, this module validates the pairing against the join, the box trees
// and donor-tokens.json and applies the defaults. Every problem is collected, never the first only. An entry may
// carry previewSelector, the selector of the deployed DOM (selectorFor picks it on a preview). The coverage floor
// is computed from Figma, not from the file: every text style of a root needs a type entry at that width, a module
// that documents a mobile variant needs a mobile root, and only a waiver (node or width "mobile", with a why)
// or a skip lowers it; validateChecks returns the per-section coverage that floor left.
// Pure: boxes come from loadBoxes/buildBoxes (rootsNamed lists the roots to load), no I/O here.
import { findBox, hexOf, round1 } from './boxes.mjs';

export const MEASURES = ['width', 'left', 'right', 'top', 'height', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const CONTENT_DEPENDENT = new Set(['top', 'height']);
const PADDING = { paddingTop: 0, paddingRight: 1, paddingBottom: 2, paddingLeft: 3 };
const PIXEL_MODES = ['auto', 'fixture', 'off'];
const PX = /^-?\d+(\.\d+)?px$/;
const MAX_VARIANTS_SHOWN = 6;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '';
const entries = (v) => (Array.isArray(v) ? v : []);

const rootOf = (section, joined) => (text(section?.node) ? section.node : joined.node);

// The selector an entry is measured by: its previewSelector on a deployed preview (EDS blocks rebuild the markup the
// reskin page was written with), its selector otherwise. Either one is scoped to the section the join found.
export const selectorFor = (entry, regime) => (regime === 'preview' ? entry.previewSelector ?? entry.selector : entry.selector);

const HEX = /[0-9a-f]/i;

// The index of the last character of the CSS escape that starts at selector[i] (a backslash): per CSS Syntax, 1 to 6
// hex digits and one optional whitespace after them (a CRLF is one), else the one character after the backslash.
// Nothing after it ends the escape at the end of the string.
function escapeEnd(selector, i) {
  let j = i + 1;
  if (!HEX.test(selector[j] ?? '')) return j;
  for (let digits = 0; digits < 6 && HEX.test(selector[j] ?? ''); digits += 1) j += 1;
  if (selector[j] === '\r' && selector[j + 1] === '\n') j += 1;
  if (/[ \t\r\n\f]/.test(selector[j] ?? '')) j += 1;
  return j - 1;
}

// Walks a selector for its structure: `visit(char, index, depth)` is called for every character that is not part of an
// escape and not inside a quoted string, with `depth` the nesting of (…) and […] that surrounds it (a bracket itself is
// visited at the depth outside the pair it opens or closes). An escape (escapeEnd) belongs to the identifier or string it
// is in: never a combinator, comma, bracket or quote, whatever character it spells. visit returns true to stop. The one
// lexical scan selectorBranches and leavesSection share, so a quote or an escape means the same to both.
function scanSelector(selector, visit) {
  let depth = 0; let quote = null;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === '\\') i = escapeEnd(selector, i);
    else if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') { if (visit(c, i, depth)) return; depth += 1; }
    else if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); if (visit(c, i, depth)) return; }
    else if (visit(c, i, depth)) return;
  }
}

// The branches of a selector list: it splits at the commas that stand at the top level, none inside (…) or […] or a
// quoted string, none escaped. The pieces are not trimmed.
export function selectorBranches(selector) {
  const branches = [];
  let from = 0;
  scanSelector(selector, (c, i, depth) => {
    if (c === ',' && depth === 0) { branches.push(selector.slice(from, i)); from = i + 1; }
  });
  branches.push(selector.slice(from));
  return branches;
}

const SCOPE = /^:scope(?![\w-])/i;

// An entry's selector, written relative to its section, as a document-wide selector that matches only inside the
// section (sectionSel is the join's selector for it, free of top-level commas). Each top-level branch is scoped on
// its own: a branch that starts with :scope has the section stand for it (`:scope > .a .b`), any other is a descendant
// of the section. A comma inside :is(), :where(), :not() or an attribute value is not a branch. A blank branch stays
// blank, so a stray comma still makes an invalid selector.
export function scopeSelector(sectionSel, selector) {
  return selectorBranches(selector).map((branch) => {
    const b = branch.trim();
    if (!b) return '';
    const scope = SCOPE.exec(b);
    return scope ? `${sectionSel}${b.slice(scope[0].length)}` : `${sectionSel} ${b}`;
  }).join(', ');
}

// Why a selector cannot stay inside its section, or null: a branch that, once its :scope (if any) and the compound
// on it are set aside, begins with a sibling combinator (`:scope + p`, `:scope.x ~ p`, `+ p`) reaches the section's
// siblings. The compound ends at the first space or combinator that is outside every (…), […], quoted string and escape.
export function leavesSection(selector) {
  const reaches = (b) => {
    let end = 0;
    if (SCOPE.test(b)) {
      end = b.length;
      scanSelector(b, (c, i, depth) => {
        if (i < ':scope'.length || depth !== 0 || !/[\s>+~]/.test(c)) return false;
        end = i;
        return true;
      });
    }
    return /^\s*[+~]/.test(b.slice(end));
  };
  const branch = selectorBranches(selector).map((b) => b.trim()).find(reaches);
  return branch ? `selector "${branch}" reaches the section's siblings with a sibling combinator: scope it with a descendant, ":scope > …"` : null;
}

// The roots a checks file needs in loadBoxes: each joined module's frame (the mobile rule reads it even when the
// section's own node is a desktop instance inside it), the section's own node and every per-width root, in
// first-seen order.
export function rootsNamed(checks, join) {
  const out = new Set();
  for (const j of join?.sections ?? []) {
    if (!j.module) continue;
    const section = checks?.sections?.[j.slot];
    const root = rootOf(section, j);
    if (root) out.add(root);
    if (j.node) out.add(j.node);
    for (const node of Object.values(isObject(section?.roots) ? section.roots : {})) if (text(node)) out.add(node);
  }
  return [...out];
}

const tokenValue = (tokens, path) => path.split('.').reduce((v, k) => (isObject(v) ? v[k] : undefined), tokens);

// The text style of a TEXT box's `text`, as one key: first font family, size, weight, line height and letter
// spacing to 0.1px, colour. The six things ramp.mjs asserts (it asserts them exactly, so equal keys are one check).
export const styleKey = (t) => [String(t.fontFamily ?? '').split(',')[0].trim(), t.fontSize, t.fontWeight, round1(t.lineHeightPx), round1(t.letterSpacing), hexOf(t.color)].map((v) => v ?? '').join('|');
// size/weight/line height, then the letter spacing when it is not 0 and the colour: two styles that differ only in those
// two never print the same label.
const styleLabel = (t) => `${[t.fontSize, t.fontWeight, round1(t.lineHeightPx)].map((v) => v ?? '?').join('/')}${round1(t.letterSpacing) ? ` ls ${round1(t.letterSpacing)}` : ''}${t.color ? ` ${hexOf(t.color)}` : ''}`;
const sampleOf = (characters) => {
  const s = String(characters ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
};

// The text styles a root asks for → Map<styleKey, { nodes: ids in tree order, sample, label }>. A waiver on a
// container drops everything under it; one on a TEXT node waives its style, as an entry on one node covers it.
export function textStyles(rootBox, waived = []) {
  const ids = new Set(waived);
  const live = [];
  const walk = (b) => {
    if (ids.has(b.id) && !b.text) return;
    if (b.text) live.push(b);
    b.children.forEach(walk);
  };
  walk(rootBox);
  const waivedKeys = new Set(live.filter((b) => ids.has(b.id)).map((b) => styleKey(b.text)));
  const out = new Map();
  for (const b of live) {
    const key = styleKey(b.text);
    if (waivedKeys.has(key)) continue;
    if (!out.has(key)) out.set(key, { nodes: [], sample: sampleOf(b.text.characters), label: styleLabel(b.text) });
    out.get(key).nodes.push(b.id);
  }
  return out;
}

// The mobile variants a joined module frame documents: a COMPONENT or INSTANCE named for mobile, 320 to 480 wide
// (narrower is an icon or a swatch, not a page), each with the parent it sits in (its component set or group).
export function mobileVariants(moduleBox) {
  const found = [];
  const walk = (b) => {
    for (const c of b.children) {
      if ((c.type === 'COMPONENT' || c.type === 'INSTANCE') && /\bmobile\b/i.test(c.name) && c.w >= 320 && c.w <= 480) found.push({ id: c.id, name: c.name, w: c.w, parent: { id: b.id, name: b.name } });
      walk(c);
    }
  };
  walk(moduleBox);
  return found;
}

// The mobile variants a desktop root may be paired with: those in the same parent as it (the same component set or
// variant group) when the module frame holds several sets, else, when the box tree cannot tell them apart (the root is
// the frame itself, or sits in a parent that holds no variant), every one. → { list, apart, total }: apart says the sets
// were told apart, total how many variants the frame holds.
export function mobileCandidates(moduleBox, desktopBox) {
  const variants = mobileVariants(moduleBox);
  const parentOf = (b, id) => b.children.reduce((hit, c) => hit ?? (c.id === id ? b.id : parentOf(c, id)), null);
  const parent = desktopBox ? parentOf(moduleBox, desktopBox.id) : null;
  const same = parent ? variants.filter((v) => v.parent.id === parent) : [];
  return { list: same.length ? same : variants, apart: same.length > 0, total: variants.length };
}

// A section's waive list, as { node, why } or { width: 'mobile', why } entries; every malformed entry is a problem.
function readWaivers(slot, list, inRoots, problems) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { problems.push(`${slot}: waive must be a list of { node | width: "mobile" | "desktop", why }`); return []; }
  const out = [];
  list.forEach((w, i) => {
    const at = `${slot}: waive[${i}]`;
    if (!isObject(w)) { problems.push(`${at} must be { node | width: "mobile" | "desktop", why }`); return; }
    if ((w.node === undefined) === (w.width === undefined)) { problems.push(`${at} needs exactly one of node and width`); return; }
    if (!text(w.why)) problems.push(`${at} needs why`);
    if (w.node !== undefined) {
      if (!text(w.node)) problems.push(`${at}: node must be a node id`);
      else if (!inRoots(w.node)) problems.push(`${at}: ${w.node} is not inside any of the section's roots`);
      else out.push({ node: w.node, why: w.why });
    } else if (w.width !== 'mobile' && w.width !== 'desktop') problems.push(`${at}: width must be "mobile" or "desktop"`);
    else out.push({ width: w.width, why: w.why });
  });
  return out;
}

// The coverage floor of one section: at every width it is checked at, each text style of that width's root (less
// the waived) needs a type entry at that width whose node has the style. → { covered, total } over (width, style).
// The base width goes first, and its first style problem takes `hint` (the root is the whole module frame).
function floorOf({ slot, roots, rootBox, type, waivedIds, enforce, problems, baseWidth, hint = '' }) {
  let covered = 0;
  let total = 0;
  let hinted = false;
  const widths = Object.entries(roots).sort(([a], [b]) => (a === baseWidth ? -1 : b === baseWidth ? 1 : 0));
  for (const [w, node] of widths) {
    const root = rootBox(node);
    const have = new Set();
    for (const e of type.filter((t) => String(t.width) === w)) {
      const box = text(e.node) ? findBox(root, e.node) : null;
      if (box?.text) have.add(styleKey(box.text));
    }
    const every = textStyles(root);
    total += every.size;
    covered += [...every.keys()].filter((k) => have.has(k)).length;
    if (!enforce) continue;
    for (const [key, s] of textStyles(root, waivedIds)) {
      if (have.has(key)) continue;
      const tail = hint && !hinted && w === baseWidth ? hint : '';
      hinted = hinted || Boolean(tail);
      problems.push(`${slot} @${w}: text style ${s.label} ("${s.sample}", node ${s.nodes[0]}) has no type entry or waiver${tail}`);
    }
  }
  return { covered, total };
}

// Why a root is not the joined module frame or an outermost COMPONENT/INSTANCE inside it, or null. A root that is
// a TEXT node, a plain frame, nested in another instance of the module, or outside it measures a slice of the
// module: the floor would be met by shrinking the root.
function rootFault(frame, root) {
  if (root.id === frame.id) return null;
  const path = [];
  const walk = (b) => {
    path.push(b);
    if (b.id === root.id) return true;
    if (b.children.some(walk)) return true;
    path.pop();
    return false;
  };
  if (!walk(frame)) return `is not inside the module frame ${frame.id}`;
  if (root.type !== 'COMPONENT' && root.type !== 'INSTANCE') return `is a ${root.type}, not a component or instance`;
  const outer = path.slice(1, -1).find((b) => b.type === 'COMPONENT' || b.type === 'INSTANCE');
  return outer ? `is nested inside ${outer.name}` : null;
}

function validatePixel(slot, pixel, problems) {
  const mode = pixel?.mode ?? 'auto';
  if (pixel !== undefined && !isObject(pixel)) problems.push(`${slot}: pixel must be { mode, fixtureUrl?, why? }`);
  else if (!PIXEL_MODES.includes(mode)) problems.push(`${slot}: pixel mode ${mode} is not auto, fixture or off`);
  else if (mode === 'fixture' && !text(pixel.fixtureUrl)) problems.push(`${slot}: pixel fixture needs fixtureUrl`);
  else if (mode === 'off' && !text(pixel.why)) problems.push(`${slot}: pixel off needs why`);
  return { ...(isObject(pixel) ? pixel : {}), mode };
}

export function validateChecks(checks, { join, boxes, tokens }) {
  const problems = [];
  const sections = {};
  const coverage = {};
  if (!isObject(checks)) return { sections, problems: ['the checks file must be a JSON object'], coverage };
  if (checks.version !== 1) problems.push('version must be 1');
  if (!text(checks.page)) problems.push('page must be a slug');
  const file = isObject(checks.sections) ? checks.sections : {};
  const joined = new Map((join?.sections ?? []).filter((j) => j.module).map((j) => [j.slot, j]));

  for (const slot of Object.keys(file)) {
    if (!joined.has(slot)) problems.push(`${slot} is not a joined section`);
  }

  for (const [slot, j] of joined) {
    const section = isObject(file[slot]) ? file[slot] : {};
    const rootBox = (id) => boxes.roots?.[id]?.box;
    const root = rootOf(section, j);
    const base = rootBox(root);
    if (!base) {
      problems.push(`${slot}: root ${root} is not in the loaded boxes`);
      continue;
    }
    const width = Number.isFinite(section.width) ? section.width : Math.round(base.w);
    const roots = { [width]: root };
    for (const [w, node] of Object.entries(isObject(section.roots) ? section.roots : {})) {
      if (!text(node)) problems.push(`${slot}: roots["${w}"] must be a node id`);
      else if (!rootBox(node)) problems.push(`${slot}: root ${node} for width ${w} is not in the loaded boxes`);
      else roots[w] = node;
    }

    // The root box for an entry's width, or null (already reported) when the entry cannot be resolved.
    const scopeOf = (id, entryWidth, sourcedByToken) => {
      const w = entryWidth ?? width;
      const node = roots[w];
      if (node) return { w, node, box: rootBox(node) };
      if (!sourcedByToken) problems.push(`${id}: width ${w} needs sections.${slot}.roots["${w}"] or a token`);
      return null;
    };
    const locate = (id, nodeId, scope) => {
      const box = findBox(scope.box, nodeId);
      if (!box) problems.push(`${id}: ${nodeId} is not inside ${slot}'s root ${scope.node}`);
      return box;
    };
    const seen = new Set();
    const identify = (e, kind) => {
      if (!isObject(e)) { problems.push(`${slot}: each ${kind} entry must be an object`); return null; }
      if (!text(e.id)) { problems.push(`${slot}: a ${kind} entry has no id`); return null; }
      if (seen.has(e.id)) problems.push(`${slot}: duplicate id ${e.id}`);
      seen.add(e.id);
      if (!text(e.selector)) problems.push(`${e.id}: selector must be a CSS selector scoped to the section`);
      else if (leavesSection(e.selector)) problems.push(`${e.id}: ${leavesSection(e.selector)}`);
      if (e.previewSelector !== undefined) {
        if (typeof e.previewSelector !== 'string') problems.push(`${e.id}: previewSelector must be a string (a CSS selector scoped to the section)`);
        else if (!e.previewSelector.trim()) problems.push(`${e.id}: previewSelector must not be blank`);
        else if (leavesSection(e.previewSelector)) problems.push(`${e.id}: previewSelector: ${leavesSection(e.previewSelector)}`);
      }
      return e.id;
    };

    const geometry = [];
    for (const e of entries(section.geometry)) {
      const id = identify(e, 'geometry');
      if (!id) continue;
      const sources = ['node', 'nodes', 'token'].filter((k) => e[k] !== undefined);
      const tolerancePx = e.tolerancePx ?? 1;
      const index = e.index ?? 0;
      geometry.push({ ...e, width: e.width ?? width, tolerancePx, index });
      if (!MEASURES.includes(e.measure)) { problems.push(`${id}: unknown measure ${e.measure} (one of ${MEASURES.join(', ')})`); continue; }
      if (!Number.isInteger(index) || index < 0) problems.push(`${id}: index must be a non-negative integer`);
      if (typeof tolerancePx !== 'number' || tolerancePx < 0) problems.push(`${id}: tolerancePx must be a non-negative number`);
      else if (CONTENT_DEPENDENT.has(e.measure) && (e.tolerancePx === undefined || !text(e.why))) problems.push(`${id}: ${e.measure} is content-dependent: needs tolerancePx and why`);
      else if (tolerancePx > 1 && !CONTENT_DEPENDENT.has(e.measure) && !text(e.why)) problems.push(`${id}: tolerancePx ${tolerancePx} above 1 needs why`);

      if (e.measure === 'gapX' || e.measure === 'gapY') {
        const pair = Array.isArray(e.nodes) && e.nodes.length === 2 && e.nodes.every(text);
        if (!pair || sources.length !== 1) { problems.push(`${id}: ${e.measure} needs nodes: [a, b]`); continue; }
      } else if (sources.length !== 1 || e.nodes !== undefined) {
        problems.push(sources.length === 0 ? `${id}: needs one of node, nodes or token` : `${id}: ${e.nodes !== undefined ? 'nodes is for gapX and gapY' : 'node and token are alternatives'}`);
        continue;
      }

      if (e.token !== undefined) {
        const value = text(e.token) ? tokenValue(tokens ?? {}, e.token) : undefined;
        if (typeof value !== 'string' || !PX.test(value)) problems.push(`${id}: token ${e.token} is not a px value in donor-tokens.json`);
        continue;
      }
      const scope = scopeOf(id, e.width, false);
      if (!scope) continue;
      for (const nodeId of e.nodes ?? [e.node]) {
        const box = text(nodeId) ? locate(id, nodeId, scope) : null;
        if (box && e.measure in PADDING && !box.layout) problems.push(`${id}: ${nodeId} has no auto-layout padding`);
      }
    }

    const type = [];
    for (const e of entries(section.type)) {
      const id = identify(e, 'type');
      if (!id) continue;
      type.push({ ...e, width: e.width ?? width });
      if (!text(e.node)) { problems.push(`${id}: type needs a node`); continue; }
      const scope = scopeOf(id, e.width, false);
      const box = scope && locate(id, e.node, scope);
      if (box && box.type !== 'TEXT') problems.push(`${id}: ${e.node} is not TEXT (${box.type})`);
    }

    const skipped = text(section.skip);
    if (!skipped && geometry.length === 0) problems.push(`${slot} has no geometry checks: add one or "skip": "<why>"`);
    if (!skipped && type.length === 0) problems.push(`${slot} has no type checks: add one or "skip": "<why>"`);

    const inRoots = (id) => Object.values(roots).some((node) => findBox(rootBox(node), id));
    const waive = readWaivers(slot, section.waive, inRoots, problems);
    const frame = !j.node || j.node === root ? base : rootBox(j.node);
    const hint = j.node && roots[width] === j.node ? '; name the desktop instance in "node"' : '';
    const waivedIds = waive.flatMap((w) => (w.node ? [w.node] : []));
    const styles = floorOf({ slot, roots, rootBox, type, waivedIds, enforce: !skipped, problems, baseWidth: String(width), hint });
    if (j.node && !frame && !skipped) problems.push(`${slot}: module frame ${j.node} is not in the loaded boxes`);
    // The base node is checked too when roots[<its width>] replaces it: it must not hide behind the replacement.
    const checked = Object.entries(roots);
    if (roots[width] !== root) checked.unshift([String(width), root]);
    const moduleHasText = frame ? textStyles(frame).size > 0 : false;
    for (const [w, node] of checked) {
      const box = rootBox(node);
      const refuse = (why) => problems.push(`${slot} @${w}: root ${node} (${box.name}) ${why} — name the module's outermost instance or variant`);
      const fault = j.node && frame ? rootFault(frame, box) : null;
      if (fault) refuse(fault);
      if (Number(w) > 0 && box.w < Number(w) / 2) refuse(`is ${box.w} wide, under half of ${w}`);
      if (!skipped && moduleHasText && textStyles(box, waivedIds).size === 0) refuse('holds no text style to check (after waivers) and the module frame has some');
    }
    if (!skipped) {
      const mobile = Object.entries(roots).filter(([w]) => Number(w) <= 480);
      const desktopNode = roots[width] && Number(width) > 480 ? roots[width] : Object.entries(roots).find(([w]) => Number(w) > 480)?.[1];
      const { list: variants, apart, total } = frame ? mobileCandidates(frame, desktopNode ? rootBox(desktopNode) : null) : { list: [], apart: true, total: 0 };
      // With several variants in the frame a name alone does not say which: the id and the parent's name do.
      const which = (v) => (total > 1 ? `, ${v.id}, in ${v.parent.name}` : '');
      if (!waive.some((w) => w.width === 'desktop') && mobile.length === Object.keys(roots).length) {
        problems.push(`${slot}: no root is checked wider than 480 (${Object.keys(roots).join(', ')}) and no { width: "desktop" } waiver`);
      }
      if (variants.length && !waive.some((w) => w.width === 'mobile') && !mobile.some(([, node]) => variants.some((v) => v.id === node))) {
        const shown = variants.slice(0, MAX_VARIANTS_SHOWN);
        const more = variants.length > shown.length ? `; +${variants.length - shown.length} more` : '';
        if (!mobile.length) {
          const names = shown.map((v) => `${v.name}, ${v.w} wide${which(v)}`).join('; ');
          problems.push(`${slot}: module has a mobile variant (${names}${more}) but no roots[<w>] ≤ 480 and no { width: "mobile" } waiver${hint}`);
        } else {
          const roles = mobile.map(([w, node]) => `roots[${w}] (${rootBox(node).name})`).join(', ');
          const list = shown.map((v) => `${v.name} (${v.w} wide, ${v.id}${total > 1 ? `, in ${v.parent.name}` : ''})`).join('; ');
          problems.push(`${slot}: ${roles} is not one of the ${apart && variants.length < total ? 'desktop root\'s own' : "module's"} mobile variants (${list}${more}) and no { width: "mobile" } waiver${hint}`);
        }
      }
    }
    coverage[slot] = { styles, widths: Object.keys(roots).map(Number).filter(Number.isFinite).sort((a, b) => a - b), waived: waive.length + (skipped ? 1 : 0) };
    sections[slot] = { root: roots[width], width, roots, geometry, type, waive, pixel: validatePixel(slot, section.pixel, problems), ...(skipped ? { skip: section.skip } : {}) };
  }
  return { sections, problems, coverage };
}
