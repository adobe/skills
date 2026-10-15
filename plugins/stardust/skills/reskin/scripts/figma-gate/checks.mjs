// skills/reskin/scripts/figma-gate/checks.mjs — the checks file (reskin/figma-checks/<slug>.json): the agent
// pairs page selectors with Figma nodes, this module validates the pairing against the join, the box trees
// and donor-tokens.json and applies the defaults. Every problem is collected, never the first only.
// Pure: boxes come from loadBoxes/buildBoxes (rootsNamed lists the roots to load), no I/O here.
import { findBox } from './boxes.mjs';

export const MEASURES = ['width', 'left', 'right', 'top', 'height', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const CONTENT_DEPENDENT = new Set(['top', 'height']);
const PADDING = { paddingTop: 0, paddingRight: 1, paddingBottom: 2, paddingLeft: 3 };
const PIXEL_MODES = ['auto', 'fixture', 'off'];
const PX = /^-?\d+(\.\d+)?px$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '';
const entries = (v) => (Array.isArray(v) ? v : []);

const rootOf = (section, joined) => (text(section?.node) ? section.node : joined.node);

// The roots a checks file needs in loadBoxes: each joined module's frame (or the section's own node)
// and every per-width root, in first-seen order.
export function rootsNamed(checks, join) {
  const out = new Set();
  for (const j of join?.sections ?? []) {
    if (!j.module) continue;
    const section = checks?.sections?.[j.slot];
    const root = rootOf(section, j);
    if (root) out.add(root);
    for (const node of Object.values(isObject(section?.roots) ? section.roots : {})) if (text(node)) out.add(node);
  }
  return [...out];
}

const tokenValue = (tokens, path) => path.split('.').reduce((v, k) => (isObject(v) ? v[k] : undefined), tokens);

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
  if (!isObject(checks)) return { sections, problems: ['the checks file must be a JSON object'] };
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
    sections[slot] = { root, width, roots, geometry, type, pixel: validatePixel(slot, section.pixel, problems), ...(skipped ? { skip: section.skip } : {}) };
  }
  return { sections, problems };
}
