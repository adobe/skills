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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const rest = path.slice(cfg.scopePath.length).replace(/\.html?$/, '').split('/').filter(Boolean).slice(0, n);
  const section = rest.length ? rest.join('/') : '(root)';
  // a path-only rule (no body attribute, class or meta) names the template by its section alone
  return fetchRow.template || cfg.template.bodyAttr || cfg.template.bodyClass || cfg.template.meta ? `${t} · ${section}` : section;
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
/**
 * The diff skill's live-session.mjs: the plugin's one hardened way to reach a live site (challenge detection, the
 * stealth real-Chrome `--headed` tier, document-only standard headers). Plugin tree or project copy, as replica.
 */
export async function loadLiveSession() {
  const p = [join(HERE, '..', '..', 'diff', 'scripts', 'live-session.mjs'), join(HERE, '..', 'diff', 'live-session.mjs')].find((x) => existsSync(x));
  if (!p) throw new Error('live-session.mjs not found (../../diff/scripts/ or ../diff/): copy the diff skill\'s scripts next to these (spec SKILL.md § Setup)');
  return import(pathToFileURL(p).href);
}

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

/* ------------------------------------------------------ generic profile ---- */
/**
 * Component rules for sites without AEM conventions. Self-contained (no outer references) so spec-capture can
 * inject the same source into the page: the parser and the tagger must find the same roots. `A` adapts a node:
 * { tag(el), cls(el) → [], attr(el, name), kids(el) → element children, weight(el) → text length + media count }.
 * opts: { nameAttrs?: [attribute names that carry a component name, checked first], stripPrefix?: regex source removed
 * from class names first (a site's hash prefix) }.
 * Roots: below a container, single-child wrappers are skipped; at the top every significant child is a root (text
 * elements too: they become default content); below a root only container children are, and only two or more.
 * Names: a component attribute, a block-style class (wp-block-*, elementor-widget-*, paragraph--type--*), else the
 * first class that is not a utility, a hash or a layout word (BEM and CSS-module names reduced to their block; hash-like
 * leading tokens dropped), else a shape label from the structure: tag, first heading level, a repeated child, media
 * (e.g. `section.h2.list` or `div.media`), stable across pages where class names are only utilities.
 */
export function genericRules(A, opts = {}) {
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'br', 'svg', 'path', 'head', 'title']);
  const CHROME = new Set(['header', 'footer', 'nav']);
  const CONTAINER = new Set(['div', 'section', 'article', 'aside', 'form', 'ul', 'ol', 'figure', 'details', 'dl', 'table', 'main', 'header', 'footer', 'nav']);
  const NAME_ATTRS = [...(opts.nameAttrs || []), 'data-component', 'data-block-name', 'data-module', 'data-widget_type', 'data-section-type', 'data-block', 'data-cmp', 'data-component-name'];
  const UTIL = /^-?(?:[a-z]+:)|[[\]/:!@]|^(?:uppercase|lowercase|capitalize|italic|underline|whitespace-[a-z-]+|break-[a-z]+|light-theme|dark-theme|relative|absolute|fixed|sticky|static|hidden|block|inline|inline-block|inline-flex|inline-grid|contents|flow-root|prose|not-prose|isolate|truncate|antialiased|group|peer|dark|light|visible|invisible|sr-only|container)$|^-?(?:p[xytblr]?|m[xytblr]?|w|h|min-w|max-w|min-h|max-h|gap|space-[xy]|flex|grid|grid-cols|col|col-span|row|row-span|items|justify|content|self|place|order|text|font|leading|tracking|bg|border|rounded|shadow|opacity|z|top|left|right|bottom|inset|overflow|object|aspect|d|align|float|pull|push|offset|order|g|gx|gy|ps|pe|ms|me|fs|fw|lh|basis|grow|shrink|fill|stroke|ring|outline|divide|blur|transition|duration|ease|delay|animate|transform|scale|rotate|translate|cursor|select|pointer-events|sr|visible|invisible|is|has|js|u|t|l|o|c|lg|md|sm|xl|xs|xxl)(?:-|$)/;
  const LAYOUT = /^(container|container-fluid|wrapper|wrap|inner|outer|content|contents|section|block|row|column|columns|col|grid|flex|clearfix|cf|group|holder|box|layout|main|page|site|region|area|module|component|widget|element|item|items|list|body|entry|post|elementor|elementor-section|elementor-element|elementor-widget|elementor-container|elementor-column|elementor-widget-wrap|e-con|e-con-inner|e-flex|wp-block|is-layout-flow|is-layout-constrained|is-layout-flex|has-global-padding|alignfull|alignwide|alignnone|aligncenter)$/;
  const HASH = /(?:^|[_-])(?=[a-z0-9]{5,}$)(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]+$|^(?:css|sc|jsx|emotion|styled|svelte|astro|chakra|mantine|tw)-/i;
  const strip = opts.stripPrefix ? new RegExp(opts.stripPrefix) : null;
  const hashy = (t) => /\d/.test(t) || t.length <= 2 || !/[aeiouy]/i.test(t);
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const good = (n) => (/^[a-z][a-z0-9-]{2,}$/i.test(n) && !LAYOUT.test(n) && !UTIL.test(n) ? kebab(n) : null);
  const fromClass = (c0) => {
    const c = strip ? c0.replace(strip, '') : c0;
    if (!c) return null;
    let m = c.match(/^wp-block-(.+)$/) || c.match(/^elementor-widget-(.+)$/) || c.match(/^paragraph--type--(.+)$/) || c.match(/^block-(?:block-content-|views-block-)?(.+)$/);
    if (m) { const b = m[1].replace(/-is-layout-.*$/, ''); return LAYOUT.test(b) ? null : kebab(b); } // a CMS layout wrapper: named by its shape
    if (UTIL.test(c) || LAYOUT.test(c)) return null;
    m = c.match(/^([A-Za-z][A-Za-z0-9]*?)(?:-module)?_{1,2}[A-Za-z0-9]+_{0,3}[A-Za-z0-9-]*$/); // CSS modules: Hero_root__x1y2z → hero
    if (m && /_/.test(c) && HASH.test(c.split('_').pop())) return good(m[1]);
    const toks = c.split('__')[0].split('--')[0].split('-'); // BEM block, then hash prefixes: qrk1f-w-hero → hero
    while (toks.length > 1 && hashy(toks[0])) toks.shift();
    const block = toks.join('-');
    return HASH.test(block) ? null : good(block);
  };
  const shape = (el) => {
    const parts = [A.tag(el)]; const seen = []; const stack = [[el, 0]];
    while (stack.length) { const [n, d] = stack.shift(); for (const k of A.kids(n)) { seen.push(A.tag(k)); if (d < 2) stack.push([k, d + 1]); } }
    const h = seen.find((t) => /^h[1-6]$/.test(t)); if (h) parts.push(h);
    const ks = A.kids(el).map(A.tag); const rep = ks.find((t, i) => ks.indexOf(t) !== i && ks.filter((x) => x === t).length >= 3);
    if (rep || seen.includes('li')) parts.push('list');
    if (seen.some((t) => ['img', 'picture', 'video', 'iframe'].includes(t))) parts.push('media');
    if (seen.includes('form')) parts.push('form');
    return parts.join('.');
  };
  const name = (el) => {
    for (const a of NAME_ATTRS) { const v = A.attr(el, a); if (v) return kebab(v.replace(/\.default$/, '')); }
    for (const c of A.cls(el)) { const n = fromClass(c); if (n) return n; }
    return CONTAINER.has(A.tag(el)) ? shape(el) : A.tag(el);
  };
  const significant = (el, top) => A.kids(el).filter((k) => !SKIP.has(A.tag(k)) && !(top && CHROME.has(A.tag(k))) && A.weight(k) > 0);
  const roots = (container, depth, isBody) => {
    let level = container;
    for (let i = 0; i < 8; i += 1) { const ks = significant(level, isBody); if (ks.length === 1 && CONTAINER.has(A.tag(ks[0]))) level = ks[0]; else break; }
    const ks = significant(level, isBody);
    if (depth === 0) return ks;
    const cont = ks.filter((k) => CONTAINER.has(A.tag(k)));
    return cont.length >= 2 ? cont : [];
  };
  return { name, roots };
}

/* ------------------------------------------------- profiles and layout ---- */
/** Group aem-core grid members into rows: consecutive members narrower than 12 whose widths fill the grid. Pure. */
export function groupRows(items, width, newline) {
  const out = []; let row = []; let sum = 0;
  const flush = () => { if (row.length > 1) out.push({ row }); else if (row.length) out.push(row[0]); row = []; sum = 0; };
  for (const it of items) {
    const w = width(it);
    if (w >= 12 || newline(it)) { flush(); if (w >= 12) { out.push(it); continue; } }
    if (sum + w > 12) flush();
    row.push(it); sum += w;
    if (sum >= 12) flush();
  }
  flush();
  return out;
}

/**
 * The rules of a parser profile over a node adapter `A` ({ tag, cls, attr, kids, parent, weight }; genericRules lists
 * them). Self-contained apart from genericRules and groupRows, which spec-capture injects alongside, so the parser and
 * the in-page tagger run the same rules.
 *   aem-classic — a root is a `c-*` component (not `*-content`) or a `colctrl`, whose columns are its col-* children.
 *   aem-core    — a root is a grid member (`aem-GridColumn`), named by its first non-`aem-` class (AEM writes the
 *                 component type first; style-system classes follow); width and newline group members into rows.
 *   generic     — structural roots and hinted names (genericRules).
 * Returns { name(el), roots?(el, depth, isBody), isColumns?(el), columns?(el), width?(el), newline?(el) }: with
 * `roots` the profile picks its roots itself; without it, `name` is the root test (null: not a root).
 */
export function profileRules(profile, A, opts = {}) {
  if (profile === 'generic') return genericRules(A, opts);
  if (profile === 'aem-classic') {
    const R = {
      name(el) {
        for (const c of A.cls(el)) {
          if (c === 'colctrl') { const w = (A.parent(el) ? A.cls(A.parent(el)) : [])[0] || 'cols'; return `colctrl:${w.startsWith('cols') ? w : 'cols'}`; }
          if (c.startsWith('c-') && !c.endsWith('-content')) return c;
        }
        return null;
      },
      columns(el) {
        const row = A.kids(el).find((c) => A.cls(c).includes('row')) || el;
        return A.kids(row).filter((c) => A.cls(c).some((x) => x.startsWith('col-')));
      },
    };
    R.isColumns = (el) => (R.name(el) || '').startsWith('colctrl'); // the name decides: a c-* class listed first wins
    return R;
  }
  if (profile === 'aem-core') {
    return {
      name(el) {
        const cl = A.cls(el);
        if (!cl.includes('aem-GridColumn')) return null;
        const n = cl.find((c) => !c.startsWith('aem-')) || 'grid';
        return n === 'responsivegrid' ? 'container' : n;
      },
      width(el) { const m = A.cls(el).map((c) => c.match(/^aem-GridColumn--default--(\d+)$/)).find(Boolean); return m ? Number(m[1]) : 12; },
      newline: (el) => A.cls(el).includes('aem-GridColumn--default--newline'),
    };
  }
  throw new Error(`unknown parser profile: ${profile}`);
}

/**
 * The component layout of a main region: every component with its path id and depth, grid rows (aem-core) and
 * column controls (aem-classic). The one place path ids are assigned — spec-parse describes these nodes,
 * spec-capture's tagger measures them. Self-contained apart from groupRows.
 * Nodes: { el, p, depth, kids?: [node], cols?: [[node]] } or rows { row: true, p, widths, members: [node] }.
 * Paths: top `i`, child `<p>.k<i>`, column-control column `<p>.c<ci>.<i>`, row member `<row p>.c<ci>.0`.
 */
export function componentLayout(main, R, A, isBody = false) {
  const rootsBelow = (node) => { const out = []; for (const ch of A.kids(node)) { if (R.name(ch)) out.push(ch); else out.push(...rootsBelow(ch)); } return out; };
  const level = (items, depth, pathOf) => (R.width ? groupRows(items, R.width, R.newline) : items).map((g, i) => (g.row
    ? { row: true, p: pathOf(i), widths: g.row.map(R.width), members: g.row.map((m, ci) => comp(m, depth + 1, `${pathOf(i)}.c${ci}.0`)) }
    : comp(g, depth, pathOf(i))));
  function comp(el, depth, path) {
    const n = { el, p: path, depth };
    if (depth >= 6) return n;
    if (R.isColumns && R.isColumns(el)) { n.cols = R.columns(el).map((c, ci) => rootsBelow(c).map((k, ki) => comp(k, depth + 1, `${path}.c${ci}.${ki}`))); return n; }
    const kids = R.roots ? R.roots(el, depth + 1).map((k, ki) => comp(k, depth + 1, `${path}.k${ki}`)) : level(rootsBelow(el), depth + 1, (ki) => `${path}.k${ki}`);
    if (kids.length) n.kids = kids;
    return n;
  }
  return R.roots ? R.roots(main, 0, isBody).map((e, i) => comp(e, 0, String(i))) : level(rootsBelow(main), 0, String);
}
