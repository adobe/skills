// skills/reskin/scripts/deployed/deltas.mjs — the declared differences between a source page and what its aem.page
// preview delivers: one schema, read by dom-equality and slot-coverage through `--deltas <json>` (the page's
// reskin/deltas/<slug>.json). A library, no CLI: the gates import it after their --help guard.
//
//   { "version": 1,                                       required
//     "blocking": false,                                  absent = true: a failed check fails the run
//     "text":   { "allow": [ { "id", "from", "to", "why" } ] },   literal source text → rendered text; `to` may be ""
//     "images": "count+alt+width",                        replaces the host+path image comparison
//     "links":  { "localize": { "sourceHost": "<host>" } },       slot-coverage: CTA hrefs also match as localized
//     "metadata": { "ignore": ["canonical", "og:url", …], "jsonLd": "count-only" | "ignore", "absent": [ … ] } }
//
//   loadDeltas(path)                    read and validate; a UsageError (exit 2) lists every problem at once
//   isBlocking(deltas)                  false only when the file says "blocking": false
//   applyText(text, deltas)             the text allow entries applied in file order, every occurrence:
//                                       { text, applied: [{ id, count }], unused: [id] }
//   applyTexts(texts, deltas)           the same over several texts, each entry counted once across all of them
//   compareImages(src, rendered, mode)  count+alt+width over [{ alt, width }]: same count, same alt in order, every
//                                       rendered width above 0 → { pass, detail }
//   normalizeHref(href, { sourceHost, renderedOrigin })   a source-host link as deploy delivers it on the preview
//   metadataPlan(deltas)                { ignore: Set, jsonLd, absent: Set }
//   reportSection(deltas, usage), warningLines(deltas, unused), ADVISORY   what both gates print about deltas
// eds-path.mjs (deploy's delivered-path contract) is looked up when this module loads, in both layouts, and only
// normalizeHref needs it: without it everything else works and normalizeHref throws a UsageError naming where it looked.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from '../figma/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts: the plugin tree (skills/reskin/scripts/deployed ↔ skills/deploy/scripts) and the project copy
// (stardust/scripts/reskin/deployed ↔ stardust/scripts/deploy).
const EDS_PATH = ['../../../deploy/scripts/eds-path.mjs', '../../deploy/eds-path.mjs'];
const edsPathFile = EDS_PATH.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const edsPath = edsPathFile ? await import(pathToFileURL(edsPathFile).href) : null;

export const IMAGES_MODE = 'count+alt+width';
export const ADVISORY = 'ADVISORY (deltas.blocking false)';
const JSON_LD_MODES = ['count-only', 'ignore'];
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const quote = (s, max = 60) => JSON.stringify(String(s).length > max ? `${String(s).slice(0, max)}…` : String(s));

export function requireEdsPath() {
  if (!edsPath) throw new UsageError('eds-path.mjs not found (looked in ../../../deploy/scripts/ and ../../deploy/): copy the deploy skill\'s eds-path.mjs beside the reskin scripts (stardust/scripts/deploy/)');
  return edsPath;
}

// The parsed file, checked: every problem is collected before anything is thrown.
export function loadDeltas(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    throw new UsageError(`deltas ${path}: ${e.code === 'ENOENT' ? 'file not found' : `not valid JSON (${e.message})`}`);
  }
  if (!isObject(raw)) throw new UsageError(`deltas ${path}: the file must hold a JSON object`);
  const problems = [];
  const nested = (v, where, keys) => {
    if (!isObject(v)) { problems.push(`${where} must be an object`); return false; }
    for (const k of Object.keys(v)) if (!keys.includes(k)) problems.push(`${where}: unknown key "${k}"`);
    return true;
  };
  const stringList = (v, where) => {
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !s.trim())) { problems.push(`${where} must be a list of non-empty strings`); return []; }
    return v;
  };
  for (const k of Object.keys(raw)) if (!['version', 'blocking', 'text', 'images', 'links', 'metadata'].includes(k)) problems.push(`unknown key "${k}"`);
  if (raw.version !== 1) problems.push(`version must be 1, got ${raw.version === undefined ? 'nothing' : JSON.stringify(raw.version)}`);
  if (raw.blocking !== undefined && typeof raw.blocking !== 'boolean') problems.push('blocking must be true or false');

  const allow = [];
  if (raw.text !== undefined && nested(raw.text, 'text', ['allow'])) {
    if (raw.text.allow !== undefined && !Array.isArray(raw.text.allow)) problems.push('text.allow must be a list');
    const seen = new Set();
    (Array.isArray(raw.text.allow) ? raw.text.allow : []).forEach((a, i) => {
      const where = `text.allow[${i}]${isObject(a) && typeof a.id === 'string' && a.id ? ` "${a.id}"` : ''}`;
      if (!nested(a, where, ['id', 'from', 'to', 'why'])) return;
      for (const k of ['id', 'from', 'why']) if (typeof a[k] !== 'string' || !a[k].trim()) problems.push(`${where}: needs "${k}" (a non-empty string)`);
      if (a.to !== undefined && typeof a.to !== 'string') problems.push(`${where}: "to" must be a string`);
      if (typeof a.id === 'string' && a.id) {
        if (seen.has(a.id)) problems.push(`${where}: duplicate id "${a.id}"`);
        seen.add(a.id);
      }
      allow.push({ id: a.id, from: a.from, to: a.to ?? '', why: a.why });
    });
  }
  if (raw.images !== undefined && raw.images !== IMAGES_MODE) problems.push(`images must be "${IMAGES_MODE}" (the only mode), got ${JSON.stringify(raw.images)}`);

  let localize = null;
  if (raw.links !== undefined && nested(raw.links, 'links', ['localize']) && raw.links.localize !== undefined
    && nested(raw.links.localize, 'links.localize', ['sourceHost'])) {
    const host = raw.links.localize.sourceHost;
    if (typeof host !== 'string' || !host.trim() || /[/\s]/.test(host)) problems.push('links.localize.sourceHost must be a bare host such as "src.test" (no scheme, no path)');
    else localize = { sourceHost: host };
  }

  let ignore = []; let absent = []; let jsonLd = null;
  if (raw.metadata !== undefined && nested(raw.metadata, 'metadata', ['ignore', 'jsonLd', 'absent'])) {
    if (raw.metadata.ignore !== undefined) ignore = stringList(raw.metadata.ignore, 'metadata.ignore');
    if (raw.metadata.absent !== undefined) absent = stringList(raw.metadata.absent, 'metadata.absent');
    if (raw.metadata.jsonLd !== undefined) {
      if (JSON_LD_MODES.includes(raw.metadata.jsonLd)) jsonLd = raw.metadata.jsonLd;
      else problems.push(`metadata.jsonLd must be "count-only" or "ignore", got ${JSON.stringify(raw.metadata.jsonLd)}`);
    }
  }
  if (problems.length) throw new UsageError(`deltas ${path}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  return { version: 1, blocking: raw.blocking !== false, text: { allow }, images: raw.images ?? null, links: { localize }, metadata: { ignore, jsonLd, absent } };
}

export const isBlocking = (deltas) => deltas?.blocking !== false;

// Each entry replaces its literal `from` by `to` everywhere, on the text the entries before it left. An entry that
// found nothing is unused.
export function applyText(sourceText, deltas) {
  let text = String(sourceText);
  const applied = []; const unused = [];
  for (const { id, from, to = '' } of deltas?.text?.allow ?? []) {
    const parts = text.split(from);
    if (parts.length === 1) { unused.push(id); continue; }
    applied.push({ id, count: parts.length - 1 });
    text = parts.join(to);
  }
  return { text, applied, unused };
}

export function applyTexts(texts, deltas) {
  const counts = new Map();
  const out = texts.map((t) => {
    const r = applyText(t, deltas);
    for (const a of r.applied) counts.set(a.id, (counts.get(a.id) ?? 0) + a.count);
    return r.text;
  });
  const ids = (deltas?.text?.allow ?? []).map((a) => a.id);
  return { texts: out, applied: ids.filter((id) => counts.has(id)).map((id) => ({ id, count: counts.get(id) })), unused: ids.filter((id) => !counts.has(id)) };
}

// sourceImgs: [{ alt }] on the source side, renderedImgs: [{ alt, width }] on the preview. Alt compares with its
// whitespace collapsed; a width that was not measured is not above 0.
export function compareImages(sourceImgs, renderedImgs, mode) {
  if (mode !== IMAGES_MODE) throw new UsageError(`images mode "${mode}" is not supported: only "${IMAGES_MODE}"`);
  const problems = [];
  if (sourceImgs.length !== renderedImgs.length) problems.push(`count: source ${sourceImgs.length}, rendered ${renderedImgs.length}`);
  for (let i = 0; i < Math.min(sourceImgs.length, renderedImgs.length); i += 1) {
    if (squash(sourceImgs[i].alt) !== squash(renderedImgs[i].alt)) problems.push(`[${i}] alt: source ${JSON.stringify(squash(sourceImgs[i].alt))}, rendered ${JSON.stringify(squash(renderedImgs[i].alt))}`);
  }
  renderedImgs.forEach((img, i) => { if (!(img.width > 0)) problems.push(`[${i}] rendered width ${img.width ?? 'not measured'}`); });
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${renderedImgs.length} image(s): count, alt and width agree` };
}

// deploy's localize-links keeps ?query and #fragment and matches the host with or without www., any scheme.
const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');
export function normalizeHref(href, { sourceHost, renderedOrigin }) {
  let u;
  try { u = new URL(href, 'https://relative.invalid'); } catch { return href; }
  if (!/^https?:$/.test(u.protocol) || u.hostname === 'relative.invalid' || bareHost(u.host) !== bareHost(sourceHost)) return href;
  // URL percent-encodes the path ("/About Us/" → "%20"); deliveredUrl sanitises the source path as authored
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* a malformed escape stays as it is */ }
  return `${renderedOrigin.replace(/\/+$/, '')}${requireEdsPath().deliveredUrl(path)}${u.search}${u.hash}`;
}

export function metadataPlan(deltas) {
  const m = deltas?.metadata ?? {};
  return { ignore: new Set(m.ignore ?? []), jsonLd: m.jsonLd ?? 'count-only', absent: new Set(m.absent ?? []) };
}

// The "Declared deltas" report section. usage: { file, applied: [{ id, count }], unused: [string], ignored: [key],
// notes: [string] }; an unused entry is an allow id or a text such as `metadata.ignore "key"`.
export function reportSection(deltas, { file, applied = [], unused = [], ignored = [], notes = [] }) {
  const entry = (id) => (deltas.text.allow.find((a) => a.id === id) ?? { from: '', why: '' });
  let md = `## Declared deltas\n\n- File: \`${file}\`\n`;
  md += isBlocking(deltas) ? '- Blocking: `true` (a failed check fails the run)\n' : '- Blocking: `false` (deltas.blocking) — a failed check is reported and the exit code stays 0\n';
  for (const n of notes) md += `- ${n}\n`;
  md += applied.length ? '- Applied:\n' : '- Applied: none\n';
  for (const { id, count } of applied) { const a = entry(id); md += `  - ${id} ×${count}: ${quote(a.from)} → ${quote(a.to)} — ${a.why}\n`; }
  if (ignored.length) md += `- Ignored by delta: ${ignored.join(', ')}\n`;
  if (unused.length) {
    md += '- Unused — declared, but matched nothing:\n';
    for (const id of unused) { const a = deltas.text.allow.find((x) => x.id === id); md += a ? `  - ${id}: ${quote(a.from)} — ${a.why}\n` : `  - ${id}\n`; }
  }
  return `${md}\n`;
}

// The stdout warning, one line per unused delta.
export function warningLines(deltas, unused) {
  return unused.map((id) => {
    const a = deltas.text.allow.find((x) => x.id === id);
    return a ? `WARNING unused delta ${id}: ${quote(a.from)} matched nothing (${a.why})` : `WARNING unused delta ${id}: matched nothing`;
  });
}
