// skills/reskin/scripts/figma-gate/boxes.mjs — the only reader of the Figma capture's nodes.json for
// figma-gate. A kit capture can reach hundreds of MB, so nodes.json is parsed once per file version:
// box trees are built for the roots asked for and cached under
// <dir>/.work/reskin/gates/figma-boxes/<fileKey>/<version>.json, and every later question (any step,
// any run) is answered from that file, even after nodes.json is gone. The cache file carries the
// capture stamp (manifest capturedAt and frames, plus a schema number) and is dropped when it differs.
// Box: { id, name, type, x, y, w, h, layout, text, fill, fillKind, children } with x and y relative
// to the root's absoluteBoundingBox, rounded to 2 decimals; hidden subtrees are dropped.
import { join } from 'node:path';
import { cacheFor, readCurrent } from '../figma/cache.mjs';
import { UsageError } from '../figma/errors.mjs';
import { readJsonIf, writeJson } from '../figma/io.mjs';
import { solidFill } from '../figma/normalize.mjs';

const SCHEMA = 1;
const round = (n) => Math.round((n ?? 0) * 100) / 100 || 0;
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');
const absBox = (node) => node.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };

export function boxTree(node, origin = node.absoluteBoundingBox) {
  const abs = absBox(node);
  const o = origin || abs;
  const fill = solidFill(node.fills);
  const style = node.style || {};
  const auto = node.layoutMode && node.layoutMode !== 'NONE';
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: round(abs.x - o.x),
    y: round(abs.y - o.y),
    w: round(abs.width),
    h: round(abs.height),
    layout: auto ? {
      mode: node.layoutMode,
      padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map((p) => p ?? 0),
      gap: node.itemSpacing ?? null,
    } : null,
    text: node.type === 'TEXT' ? {
      characters: node.characters ?? '',
      fontFamily: style.fontFamily ?? null,
      fontWeight: style.fontWeight ?? null,
      fontSize: style.fontSize ?? null,
      lineHeightPx: style.lineHeightPx ?? null,
      lineHeightUnit: style.lineHeightUnit ?? null,
      letterSpacing: style.letterSpacing ?? null,
      textCase: style.textCase ?? null,
      color: fill.css,
    } : null,
    fill: fill.kind === 'SOLID' ? fill.css : null,
    fillKind: fill.kind,
    children: (node.children || []).filter((c) => c.visible !== false).map((c) => boxTree(c, o)),
  };
}

// One walk over every captured frame, collecting the wanted ids with the frame that holds them.
function locate(nodes, wanted) {
  const found = new Map();
  const walk = (node, frame) => {
    if (wanted.has(node.id) && !found.has(node.id)) found.set(node.id, { frame, node });
    for (const c of node.children || []) walk(c, frame);
  };
  for (const [frameId, entry] of Object.entries(nodes.nodes || nodes)) {
    if (entry?.document) walk(entry.document, { id: frameId, node: entry.document });
  }
  return found;
}

export function buildBoxes({ nodes, roots }) {
  const found = locate(nodes, new Set(roots));
  const out = {};
  const missing = [];
  for (const id of roots) {
    const hit = found.get(id);
    if (!hit) { missing.push(id); continue; }
    const fa = absBox(hit.frame.node);
    const ra = absBox(hit.node);
    out[id] = {
      frame: hit.frame.id,
      frameBox: { x: round(fa.x), y: round(fa.y), w: round(fa.width), h: round(fa.height) },
      offset: { x: round(ra.x - fa.x), y: round(ra.y - fa.y) },
      box: boxTree(hit.node),
    };
  }
  return { roots: out, missing };
}

export function findBox(box, id) {
  if (box.id === id) return box;
  for (const c of box.children) { const r = findBox(c, id); if (r) return r; }
  return null;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const round1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

// A box's colour (rgb()/rgba() css or hex) as lower-case hex; an alpha below 1 is a fourth byte.
export function hexOf(css) {
  const m = RGB.exec(String(css ?? '').trim());
  if (!m) return String(css ?? '').trim().toLowerCase();
  const byte = (n) => Math.min(255, Number(n)).toString(16).padStart(2, '0');
  return `#${byte(m[1])}${byte(m[2])}${byte(m[3])}${m[4] !== undefined && Number(m[4]) < 1 ? byte(Math.round(Number(m[4]) * 255)) : ''}`;
}

export function outline(box, depth) {
  const lines = [];
  const walk = (b, level) => {
    let line = `${b.id} ${b.type} "${b.name}" ${b.x},${b.y} ${b.w}×${b.h}`;
    if (b.layout) line += ` ${b.layout.mode} pad ${b.layout.padding.join(',')}${b.layout.gap === null ? '' : ` gap ${b.layout.gap}`}`;
    if (b.text) line += ` ${b.text.fontFamily} ${b.text.fontWeight} ${b.text.fontSize}/${b.text.lineHeightPx}${round1(b.text.letterSpacing) === null ? '' : ` ls ${round1(b.text.letterSpacing)}`}${b.text.color ? ` ${hexOf(b.text.color)}` : ''} "${clip(b.text.characters, 40)}"`;
    lines.push(`${'  '.repeat(level)}${line}`);
    if (level < depth) for (const c of b.children) walk(c, level + 1);
  };
  walk(box, 0);
  return lines;
}

function noCapture(dir) {
  const selected = readJsonIf(join(dir, 'canon-source', '_crawl-log.json'))?.discovery?.selected;
  const ids = Array.isArray(selected) && selected.length ? selected : null;
  const cost = ids
    ? `2 + 2 × ceil(${ids.length} / 5) = ${2 + 2 * Math.ceil(ids.length / 5)} API calls`
    : 'frame count unknown, so 2 + 2 × ceil(frames / 5) API calls';
  return new UsageError(`no Figma capture to read under ${dir}/.work/reskin/figma/: run node figma-donor.mjs capture <figma-url> --frames ${ids ? ids.join(',') : '<ids>'} (${cost}), then curate`);
}

export function loadBoxes(dir, roots) {
  const current = readCurrent(dir);
  if (!current) throw noCapture(dir);
  const { fileKey, version } = current;
  const cachePath = join(dir, '.work', 'reskin', 'gates', 'figma-boxes', safe(fileKey), `${safe(version)}.json`);
  // A re-capture of the same version (another frame selection) rewrites nodes.json, so the cache
  // follows the manifest it was built from; a Box-shape change bumps SCHEMA.
  const manifest = cacheFor(dir, fileKey).version(version).read('manifest.json');
  const stamp = { schema: SCHEMA, capturedAt: manifest?.capturedAt ?? null, frames: manifest?.frames ?? null };
  const onDisk = readJsonIf(cachePath);
  const fresh = onDisk && JSON.stringify(onDisk.stamp) === JSON.stringify(stamp);
  const cached = fresh ? onDisk : { fileKey, version, stamp, roots: {}, missing: [] };
  const answer = () => ({
    fileKey,
    version,
    confidential: Boolean(current.confidential),
    roots: Object.fromEntries(roots.filter((id) => cached.roots[id]).map((id) => [id, cached.roots[id]])),
    missing: roots.filter((id) => !cached.roots[id]),
  });
  const uncovered = roots.filter((id) => !cached.roots[id] && !cached.missing.includes(id));
  if (!uncovered.length) return answer();

  const nodes = cacheFor(dir, fileKey).version(version).read('nodes.json');
  if (!nodes) throw noCapture(dir);
  const built = buildBoxes({ nodes, roots: uncovered });
  Object.assign(cached.roots, built.roots);
  cached.missing = [...new Set([...cached.missing, ...built.missing])];
  writeJson(cachePath, cached);
  return answer();
}
