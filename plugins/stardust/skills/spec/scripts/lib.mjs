/**
 * skills/spec/scripts/lib.mjs — shared helpers for the spec stages: args, io, the project config,
 * a bounded concurrency pool, url keys, and a dependency-free HTML tree reader (the plugin ships no
 * node_modules; the spec stages parse thousands of server-rendered pages without a browser).
 * No site-specific values live here; everything a site contributes arrives through spec.config.json.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, no-continue, no-plusplus */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const HERE = dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------- args --- */
export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
export const flag = (name) => process.argv.includes(`--${name}`);
export const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Print the file's leading /** … *\/ block and exit 0 when --help is asked (before any I/O). */
export function helpAndExit(metaUrl) {
  if (!process.argv.includes('--help') && !process.argv.includes('-h')) return;
  const src = readFileSync(fileURLToPath(metaUrl), 'utf8');
  const m = src.match(/\/\*\*[\s\S]*?\*\//);
  process.stdout.write(`${m ? m[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'usage: see source'}\n`);
  process.exit(0);
}

/* ---------------------------------------------------------------- io ---- */
export function readJSON(file, fallback) {
  if (!existsSync(file)) { if (fallback !== undefined) return fallback; throw new Error(`missing ${file}`); }
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function writeJSON(file, obj) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(obj, null, 1)}\n`); }
export function writeText(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`); }
export function readJSONL(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
export function appendJSONL(file, rec) { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(rec)}\n`); }
export const log = (...a) => process.stderr.write(`[spec] ${a.join(' ')}\n`);

/* ------------------------------------------------------------ config --- */
/**
 * spec.config.json at the project root (reference/config.md). `dir` defaults to stardust/spec.
 * Returns the config with resolved paths: { root, dir, origin, scopePath, ... }.
 */
export function loadConfig(path = arg('config', 'spec.config.json')) {
  const file = resolve(path);
  const cfg = readJSON(file);
  if (!cfg.origin || !cfg.scopePath) throw new Error(`${file}: origin and scopePath are required`);
  const root = dirname(file);
  const dir = resolve(root, cfg.dir || 'stardust/spec');
  return { ...cfg, origin: cfg.origin.replace(/\/$/, ''), root, dir, p: (...parts) => join(dir, ...parts) };
}

/**
 * The page group used everywhere a "template" is meant: the CMS template read at fetch, plus — when
 * config.template.pathSegments = N — the first N path segments under scopePath (for sites where every page shares
 * one template and the page type lives in the URL structure). Pure.
 */
export function templateOf(fetchRow, cfg) {
  const t = fetchRow.template || '(none)';
  const n = cfg.template?.pathSegments;
  if (!n) return t;
  let path; try { path = new URL(fetchRow.final_url || fetchRow.url).pathname; } catch { return t; }
  const rest = path.slice(cfg.scopePath.length).replace(/\.html$/, '').split('/').filter(Boolean).slice(0, n);
  return rest.length ? `${t} · ${rest.join('/')}` : `${t} · (root)`;
}

/* ------------------------------------------------------------- misc ---- */
export const urlKey = (u) => createHash('sha1').update(u).digest('hex').slice(0, 16);
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Run fn over items with at most `n` in flight; results keep input order. */
export async function pool(items, n, fn, onProgress) {
  const out = new Array(items.length);
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Playwright from the project (the plugin tree ships none). */
export async function loadPlaywright() {
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    const mod = await import(req.resolve('playwright'));
    return mod.chromium ? mod : mod.default;
  } catch { /* fall through */ }
  const mod = await import('playwright');
  return mod.chromium ? mod : mod.default;
}

/* ----------------------------------------------------- HTML tree reader --- */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template']); // <template> content is not in the document tree
// an open <p>/<li>/… is closed by these start tags (the HTML parsing algorithm, the cases that matter here)
const IMPLIED = {
  p: /^(address|article|aside|blockquote|div|dl|fieldset|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/,
  li: /^li$/, dt: /^(dt|dd)$/, dd: /^(dt|dd)$/, option: /^(option|optgroup)$/, tr: /^tr$/, td: /^(td|th|tr)$/, th: /^(td|th|tr)$/,
};
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
  if (ENT[e.toLowerCase()]) return ENT[e.toLowerCase()];
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return m;
});

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/**
 * Parse HTML into { tag, attrs, children, text, parent } nodes (text nodes: { text }).
 * Tolerant, not spec-complete: enough for server-rendered CMS pages (void tags, raw-text tags,
 * implied end tags, stray end tags ignored).
 */
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>/g;
  let last = 0; let m;
  const pushText = (t) => { if (t && /\S/.test(t)) cur.children.push({ text: decode(t), parent: cur }); };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[1]) continue; // comment / doctype / cdata
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') { // end tag: close up to the nearest matching open element
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    while (IMPLIED[cur.tag] && IMPLIED[cur.tag].test(tag)) cur = cur.parent;
    const el = { tag, attrs: parseAttrs(m[2]), children: [], parent: cur };
    cur.children.push(el);
    if (VOID.has(tag) || m[3] === '/') continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const body = html.slice(last, end < 0 ? html.length : end);
      if (tag === 'title' || tag === 'textarea') el.children.push({ text: decode(body), parent: el });
      else el.raw = body;
      last = end < 0 ? html.length : html.indexOf('>', end) + 1;
      re.lastIndex = last;
      continue;
    }
    cur = el;
  }
  pushText(html.slice(last));
  return root;
}

export const classes = (el) => (el.attrs?.class || '').split(/\s+/).filter(Boolean);
export const hasClass = (el, c) => classes(el).includes(c);

export function* walk(node) {
  for (const ch of node.children || []) {
    if (ch.tag) { yield ch; yield* walk(ch); }
  }
}

/** Minimal selector: tag, #id, .a.b, tag.a#id, [attr], [attr=value]; comma = any of. */
export function matches(el, selector) {
  return selector.split(',').some((sel) => {
    const s = sel.trim();
    const m = s.match(/^([a-z0-9-]+)?((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) return false;
    if (m[1] && el.tag !== m[1].toLowerCase()) return false;
    for (const part of m[2].match(/[#.][\w-]+/g) || []) {
      if (part[0] === '#' ? el.attrs.id !== part.slice(1) : !hasClass(el, part.slice(1))) return false;
    }
    for (const a of m[3].match(/\[[^\]]+\]/g) || []) {
      const [k, v] = a.slice(1, -1).split('=');
      if (!(k.toLowerCase() in el.attrs)) return false;
      if (v !== undefined && el.attrs[k.toLowerCase()] !== v.replace(/^["']|["']$/g, '')) return false;
    }
    return true;
  });
}
export const query = (node, selector) => { for (const el of walk(node)) if (matches(el, selector)) return el; return null; };
export const queryAll = (node, selector) => [...walk(node)].filter((el) => matches(el, selector));

export function textOf(node) {
  let s = '';
  for (const ch of node.children || []) s += ch.text !== undefined ? ` ${ch.text}` : (ch.tag && !ch.raw ? textOf(ch) : '');
  return s;
}
export const textLen = (node) => textOf(node).replace(/\s+/g, ' ').trim().length;
export const isInside = (el, ancestor) => { for (let n = el.parent; n; n = n.parent) if (n === ancestor) return true; return false; };
