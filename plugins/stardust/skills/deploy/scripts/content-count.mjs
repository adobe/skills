#!/usr/bin/env node
/**
 * skills/deploy/scripts/content-count.mjs — the offline content count (L5 completeness): is every heading, link, image
 * and text run of a capture's content root FOUND in a document? No browser, no network, nothing written.
 *
 * The capture's root (--root, else the map's root, else main) minus the map's chrome, its drop:/dynamics: markers (the
 * first marker an element matches, as the encoder classifies) and its rich-text drops (transform.json `drop`, a
 * marker's own `drop`) is compared with the document's <main> by deploy's content-inventory.mjs (offlineInventory +
 * diffOffline, the engine the migrate encoder runs on every encoded page). Roles: headings by text, level ignored;
 * links by text + href identity (documents by file name; with --project, internal links through the redirects);
 * images by the media ledger's contentUrl (--project), then file stem, then alt; text runs. Exact matches first, then
 * the tolerant rules (merged, promoted/demoted, relabelled, duplicate, unlinked, split). Threshold: 0 MISSING in every
 * role, never a ratio; EXTRA and tolerated items are reported only. A MISSING item is fixed in the map (a cell selector,
 * a rich-text rule) or declared as a `drop:`. It cannot see HIDDEN content, CSS-generated text or layout (gate-all's).
 * A standalone approximation of the encoder's in-run count: it models neither `walkSiblings` (it can miss a loss in
 * the root's following siblings) nor cell-level `drop` (it can only over-report MISSING) — the encoder's own
 * `incomplete` stop is authoritative.
 *
 * Usage:
 *   node skills/deploy/scripts/content-count.mjs --capture <html> --doc <html> [--root <sel>] [--exclude <sel,…>]
 *        [--map <vocabulary.json>] [--url <page url>] [--project <dir>] [--json]
 *   --capture  the committed capture (stardust/current/pages/<slug>.html); its <slug>.json sidecar gives the page URL
 *   --doc      the document to check (stardust/encoded/<path>.html, content/<path>.html)
 *   --root     the capture's content root selector (default: the map's root, else main)
 *   --exclude  more capture selectors to leave out, comma-separated (a stand-in for a map drop)
 *   --map      the template map, stardust/import/<archetype>/vocabulary.json (transform.json beside it is read too);
 *              markers in the encoder's form, an array [{sel, kind, emitter, drop?, …}] (an object is rejected)
 *   --url      the page URL (default: the sidecar's finalUrl, else url — what the browser resolved against):
 *              resolves relative URLs; links on its host are keyed by their delivered path
 *   --project  the project root: image identity from stardust/deploy/media-ledger.json (each entry's sources and
 *              source → its contentUrl; a failed upload never resolves), internal links through stardust/redirects.tsv
 *   --json     the full result on stdout: { pass, counts, missing, extra, tolerated, excluded }
 * Exit: 0 = no MISSING item, 1 = at least one MISSING item, 2 = usage, unreadable input, invalid map or URL, or the
 *       capture root not found.
 * Writes: nothing — the verdict goes to stdout (text or --json), errors to stderr.
 * Needs migrate's encode/dom.mjs: skills/migrate/scripts/encode/ (plugin) or stardust/scripts/migrate/encode/ (project copy).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diffOffline, offlineInventory, summariseOffline } from './content-inventory.mjs';
import { deliveredUrl, pathKey } from './eds-path.mjs';
import { redirectPairs } from './localize-links.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DOM = [join(HERE, '..', '..', 'migrate', 'scripts', 'encode', 'dom.mjs'), join(HERE, '..', 'migrate', 'encode', 'dom.mjs')].find((p) => existsSync(p));
if (!DOM) {
  console.error('content-count: migrate\'s encode/dom.mjs not found (../../migrate/scripts/encode/ in the plugin, ../migrate/encode/ in a stardust/scripts/ copy)');
  process.exit(2);
}
const { parseHTML, qs, matches } = await import(pathToFileURL(DOM).href);

// the encoder's grammar: markers is an ARRAY of { sel, kind, emitter, drop?, … }; array order is the only precedence
const markerList = (map) => {
  const m = map && map.markers;
  if (m === undefined || m === null) return [];
  if (!Array.isArray(m)) throw new Error('invalid map — markers: an ARRAY of { sel, kind, emitter, … } (order is precedence; an object keyed by selector is the old form)');
  return m.map((x, i) => {
    if (!x || typeof x.sel !== 'string' || !x.sel.trim()) throw new Error(`invalid map — markers[${i}].sel: a selector string is required`);
    return [x.sel, x];
  });
};

/** The capture's exclusions under a map: Map(topmost excluded element → reason). Pure. */
export function mapExclusions(root, { map = null, transform = null, exclude = [] } = {}) {
  const out = new Map();
  const chrome = map && Array.isArray(map.chrome) ? map.chrome : [];
  const markers = markerList(map);
  const any = (sels, n) => sels.some((s) => matches(n, s, root));
  const visit = (n, drops) => {
    for (const c of n.children) {
      if (c.type !== 'element') continue;
      const m = markers.find(([s]) => matches(c, s, root));
      const emitter = m ? String(m[1].emitter || '') : '';
      let reason = null;
      if (any(exclude, c)) reason = 'exclude';
      else if (any(chrome, c)) reason = 'chrome';
      else if (/^drop:/.test(emitter)) reason = 'drop';
      else if (/^dynamics:/.test(emitter)) reason = 'dynamics';
      else if (any(drops, c)) reason = 'rich-text-drop';
      if (reason) out.set(c, reason);
      else visit(c, m && Array.isArray(m[1].drop) ? [...drops, ...m[1].drop] : drops);
    }
  };
  visit(root, transform && Array.isArray(transform.drop) ? transform.drop : []);
  return out;
}

/**
 * mediaKey from the media ledger, as the encoder's site loader reads it: every URL in an entry's `sources` (and a
 * non-null `source`), without its #fragment, → its contentUrl; a failed upload never resolves. Pure.
 */
export function mediaIndex(ledger) {
  const key = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u); } };
  const by = new Map();
  for (const k of Object.keys(ledger || {}).sort()) {
    const e = ledger[k];
    if (!e || typeof e.contentUrl !== 'string' || !e.contentUrl || e.status === 'failed') continue;
    for (const s of [...(Array.isArray(e.sources) ? e.sources : []), e.source]) {
      if (typeof s === 'string' && s && !by.has(key(s))) by.set(key(s), e.contentUrl);
    }
  }
  return (abs) => by.get(key(abs)) ?? null;
}

/** linkKey from redirect pairs: a same-site link whose delivered path is a redirect source keys as its destination. Pure. */
export function redirectKey(pairs, base) {
  const key = (p) => pathKey(deliveredUrl(String(p).replace(/^https?:\/\/[^/]+/i, '')));
  const to = new Map();
  for (const [s, d] of pairs) if (!to.has(key(s))) to.set(key(s), key(d));
  const hosts = new Set(['doc.invalid']);
  if (base) { const h = new URL(base).host.replace(/^www\./, ''); hosts.add(h); hosts.add(`www.${h}`); }
  return (abs) => {
    const u = new URL(abs);
    const k = hosts.has(u.host) ? to.get(pathKey(deliveredUrl(u.pathname))) : undefined;
    return k === undefined ? null : `${k}${u.search}`;
  };
}

/** One page: the capture's root (minus the map's exclusions) against the document's <main>. Pure; selectors may throw. */
export function countPage({ captureHtml, docHtml, map = null, transform = null, root = null, exclude = [], base = null, ledger = null, redirects = [] }) {
  const rootSel = root || (map && typeof map.root === 'string' && map.root) || 'main';
  const capRoot = qs(parseHTML(captureHtml), rootSel);
  if (!capRoot) return { error: `capture root not found: ${rootSel}` };
  const doc = parseHTML(docHtml);
  const docRoot = qs(doc, 'main') || qs(doc, 'body') || doc;
  const skip = mapExclusions(capRoot, { map, transform, exclude });
  const opts = { base, mediaKey: ledger ? mediaIndex(ledger) : null, linkKey: redirects.length ? redirectKey(redirects, base) : null };
  const cap = offlineInventory(capRoot, { ...opts, exclude: (n) => skip.get(n) || false });
  const r = diffOffline(cap, offlineInventory(docRoot, opts));
  return { pass: r.pass, counts: r.counts, missing: r.missing, extra: r.extra, tolerated: r.tolerated, excluded: cap.excluded };
}

const VALUE = new Set(['capture', 'doc', 'root', 'exclude', 'map', 'url', 'project']);
function parseArgs(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (name === 'json') o.json = true;
    else if (VALUE.has(name) && i + 1 < argv.length) { o[name] = argv[i + 1]; i += 1; } else return { error: `unknown or incomplete argument ${argv[i]}` };
  }
  return o.capture && o.doc ? o : { error: 'need --capture <html> --doc <html>' };
}

function main() {
  const fail = (msg) => { console.error(`content-count: ${msg}`); return 2; };
  const a = parseArgs(process.argv.slice(2));
  if (a.error) return fail(`${a.error}\nusage: content-count.mjs --capture <html> --doc <html> [--root <sel>] [--exclude <sel,…>] [--map <vocabulary.json>] [--url <page url>] [--project <dir>] [--json]`);
  const read = (p, what) => { try { return { text: readFileSync(p, 'utf8') }; } catch (e) { return { error: `cannot read ${what} ${p}: ${e.message}` }; } };
  const readJson = (p, what) => { const r = read(p, what); if (r.error) return r; try { return { value: JSON.parse(r.text) }; } catch (e) { return { error: `cannot read ${what} ${p}: ${e.message}` }; } };
  const cap = read(a.capture, 'the capture'); if (cap.error) return fail(cap.error);
  const doc = read(a.doc, 'the document'); if (doc.error) return fail(doc.error);
  let map = null; let transform = null;
  if (a.map) {
    const m = readJson(a.map, 'the map'); if (m.error) return fail(m.error);
    map = m.value;
    const tf = join(dirname(a.map), 'transform.json');
    if (existsSync(tf)) { const t = readJson(tf, 'the map'); if (t.error) return fail(t.error); transform = t.value; }
  }
  let base = a.url || null;
  const sidecar = a.capture.replace(/\.html?$/i, '.json');
  if (!base && sidecar !== a.capture && existsSync(sidecar)) { const s = readJson(sidecar, 'the capture sidecar'); if (s.value) base = s.value.finalUrl || s.value.url || null; }
  if (base) { try { base = new URL(base).href; } catch { return fail(`--url ${base} is not an absolute URL`); } } else console.error('content-count: no page URL (--url or the capture sidecar) — absolute links to the site count as external');
  let ledger = null; let redirects = [];
  if (a.project) {
    const lp = join(a.project, 'stardust', 'deploy', 'media-ledger.json');
    if (existsSync(lp)) { const l = readJson(lp, 'the media ledger'); if (l.error) return fail(l.error); ledger = l.value; }
    const rp = join(a.project, 'stardust', 'redirects.tsv');
    if (existsSync(rp)) { const r = read(rp, 'the redirects'); if (r.error) return fail(r.error); redirects = redirectPairs(r.text, rp); }
  }
  let r;
  try {
    r = countPage({ captureHtml: cap.text, docHtml: doc.text, map, transform, root: a.root, exclude: (a.exclude || '').split(',').map((s) => s.trim()).filter(Boolean), base, ledger, redirects });
  } catch (e) { return fail(e.message); }
  if (r.error) return fail(r.error);
  if (a.json) console.log(JSON.stringify(r, null, 2));
  else {
    const short = (t) => (t.length > 100 ? `${t.slice(0, 99)}…` : t);
    console.log(`content-count: ${summariseOffline(r)}`);
    const ex = Object.entries(r.excluded);
    if (ex.length) console.log(`excluded: ${ex.map(([k, v]) => `${k} ${v.n}`).join(' · ')}`);
    for (const m of r.missing) console.log(`  MISSING ${m.role} "${short(m.text)}"${m.href !== undefined ? ` → ${m.href}` : ''}${m.src && m.src !== m.text ? ` ${m.src}` : ''} (${m.reason})`);
    for (const e of r.extra.slice(0, 20)) console.log(`  EXTRA ${e.role} "${short(e.text)}"${e.href !== undefined ? ` → ${e.href}` : ''}`);
    if (r.extra.length > 20) console.log(`  … ${r.extra.length - 20} more EXTRA`);
  }
  return r.pass ? 0 : 1;
}

if (process.argv[1] && /content-count\.mjs$/.test(process.argv[1])) process.exit(main());
