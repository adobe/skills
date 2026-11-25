#!/usr/bin/env node
/**
 * skills/replica/scripts/extend-roster.mjs
 *
 * The delivery side of replica's extend pass (reference/extend-pass.md): which source pages a pass may deliver,
 * and which DA documents it may publish. The crawler stays a source tool — it lists the uncaptured source pages in
 * order (`crawl.mjs --skip-captured … --select-only`); this script filters that list against what the delivered
 * site already holds, with the EDS path rules of contracts.mjs (lib/paths.mjs).
 *
 * Usage:
 *   node stardust/scripts/replica/extend-roster.mjs select --candidates <urls.txt> --out <roster.txt>
 *        [--named] [--max <n>] [--state stardust/state.json] [--coverage stardust/rollout/coverage/pages.json]
 *        [--content content] [--slugs-out <file>]
 *   node stardust/scripts/replica/extend-roster.mjs publish --before <opening content dir> [--content content]
 *        --out <publish.paths>
 *
 *   select   reads the candidate urls (one per line, in the crawler's order) and keeps those whose EDS
 *            destination (pathKey(deliveredUrl(path)): case, `.html`, `/index`, trailing slash, query and `_`
 *            folded) is new: not the destination of a captured page (state.json pages[] url / finalUrl), not a
 *            coverage row's `path`, and not an existing content document (every `*.html` under --content — nav,
 *            footer and fragments included, though no coverage row names them). One destination takes one slot, at
 *            its first candidate's place; a query-less url of that destination replaces a query one, so the roster
 *            replays exactly. --max n keeps the first n (0 or absent: all). Writes the roster through a temp file +
 *            rename only on success, and with --slugs-out every coverage `slug`, for `crawl.mjs --reserve-slugs`.
 *            stderr names what was dropped and why. --named (urls the owner named): a url with a query string,
 *            or one whose destination is delivered or an existing document — captured or not — exits 2 and
 *            writes nothing; one captured but not delivered (an interrupted capture) is named and dropped.
 *   publish  lists the DA document (`/a/index` for `a/index.html`) of every `*.html` under --content that is not
 *            under --before (the opening snapshot of content/): the pass's new documents, the only ones its
 *            deploys may send. Written through temp + rename.
 *
 * Exit codes: 0 ok (an empty roster is ok: discovery found nothing new) · 2 usage, an unreadable input, or a --named
 * url refused. --help / -h prints this usage and touches no file.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The shared rules (contracts.mjs), found the way every skill's scripts find them: plugin tree, project copy, flat.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs', './stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('extend-roster: contracts.mjs not found (looked in ../../stardust/scripts/, ../stardust/ and ./stardust/) — copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(2); }
const { pathKey, deliveredUrl, documentPath } = await import(CONTRACTS.href);

class UsageError extends Error {}
const usage = (m) => { throw new UsageError(`extend-roster: ${m}`); };

/** The EDS destination of a source url, as a lookup key. Pure. */
export const destinationOf = (href) => pathKey(deliveredUrl(new URL(href).pathname));

/** Every `*.html` under dir, root-relative with `/`; dot-entries skipped, symlinks not followed. */
export function htmlFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * The roster: `candidates` filtered against `captured`, `delivered` and `documents` (destination key sets), one slot
 * per destination, a query-less url preferred, capped at `max`. `named` refuses query urls and taken destinations.
 * Returns { urls, dropped: [{ url, why }], refused: [{ url, why }] }. Pure.
 */
export function selectRoster({ candidates, captured, delivered, documents, max = Infinity, named = false }) {
  const slots = new Map(); const dropped = []; const refused = [];
  for (const url of candidates) {
    let dest;
    try { dest = destinationOf(url); } catch { dropped.push({ url, why: 'not a url' }); continue; }
    const query = Boolean(new URL(url).search);
    if (named && query) { refused.push({ url, why: 'has a query string — name the page without it' }); continue; }
    // a named url is refused on a delivered or document destination even when it is captured too (checked first)
    if (named && delivered.has(dest)) { refused.push({ url, why: `delivered at ${dest} (coverage)` }); continue; }
    if (named && documents.has(dest)) { refused.push({ url, why: `an existing content document holds ${dest}` }); continue; }
    if (captured.has(dest)) { dropped.push({ url, why: `already captured (${dest})` }); continue; }
    if (delivered.has(dest)) { dropped.push({ url, why: `delivered at ${dest} (coverage)` }); continue; }
    if (documents.has(dest)) { dropped.push({ url, why: `an existing content document holds ${dest}` }); continue; }
    const held = slots.get(dest);
    if (!held) slots.set(dest, url);
    else if (new URL(held).search && !query) { dropped.push({ url: held, why: `one destination with ${url}` }); slots.set(dest, url); }
    else dropped.push({ url, why: `one destination with ${held}` });
  }
  return { urls: [...slots.values()].slice(0, max), dropped, refused };
}

/** Destinations captured pages hold, from a state.json object (relative urls against site.originUrl). Pure. */
export function capturedDestinations(state) {
  if (!Array.isArray(state?.pages)) throw new Error('has no pages[] array — not a stardust state.json');
  const base = state.site?.originUrl || undefined; const out = new Set();
  for (const p of state.pages) for (const u of [p?.url, p?.finalUrl]) {
    if (!u) continue;
    try { out.add(destinationOf(new URL(u, base).href)); } catch { /* unresolvable */ }
  }
  return out;
}

/** Coverage paths (as lookup keys) and slugs, from a rollout coverage pages.json object. Pure. */
export function coverageOf(cov) {
  if (!Array.isArray(cov?.pages)) throw new Error('has no pages[] array — not a rollout coverage pages.json');
  const rows = cov.pages.filter(Boolean);
  return { paths: new Set(rows.map((r) => r.path).filter((p) => typeof p === 'string').map((p) => pathKey(p))), slugs: rows.map((r) => r.slug).filter((s) => typeof s === 'string') };
}

const readJson = (file, what) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return usage(`${what} ${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`); }
};
const writeAtomic = (file, text) => { mkdirSync(dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, file); };

const FLAGS = {
  select: ['--candidates', '--out', '--max', '--state', '--coverage', '--content', '--slugs-out'],
  publish: ['--before', '--content', '--out'],
};
const BOOL = { select: ['--named'], publish: [] };

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!FLAGS[cmd]) usage(`first argument is select or publish (got ${cmd ?? 'nothing'})`);
  const o = { cmd, state: 'stardust/state.json', coverage: 'stardust/rollout/coverage/pages.json', content: 'content', max: Infinity, named: false };
  for (let i = 0; i < rest.length; i += 1) {
    const f = rest[i];
    if (BOOL[cmd].includes(f)) { o.named = true; continue; }
    if (!FLAGS[cmd].includes(f)) usage(`unknown argument for ${cmd}: ${f}`);
    const v = rest[(i += 1)];
    if (v === undefined || !v.trim() || v.startsWith('--')) usage(`${f} needs a value`);
    if (f === '--max') { if (!/^\d+$/.test(v)) usage('--max needs a whole number'); o.max = Number(v) === 0 ? Infinity : Number(v); } else o[f.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  for (const need of cmd === 'select' ? ['candidates', 'out'] : ['before', 'out']) if (!o[need]) usage(`${cmd} needs --${need}`);
  return o;
}

function select(o) {
  let text;
  try { text = readFileSync(o.candidates, 'utf8'); } catch (e) { return usage(`--candidates ${o.candidates}: ${e.code || e.message}`); }
  const candidates = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const captured = capturedDestinations(readJson(o.state, '--state'));
  const cov = coverageOf(readJson(o.coverage, '--coverage'));
  const documents = new Set(htmlFiles(o.content).map((f) => pathKey(`/${f}`)));
  const r = selectRoster({ candidates, captured, delivered: cov.paths, documents, max: o.max, named: o.named });
  for (const d of r.dropped) console.error(`dropped ${d.url} — ${d.why}`);
  if (r.refused.length) {
    for (const d of r.refused) console.error(`refused ${d.url} — ${d.why}`);
    console.error(`extend-roster: ${r.refused.length} named url(s) refused; nothing written`);
    return 2;
  }
  writeAtomic(o.out, r.urls.length ? `${r.urls.join('\n')}\n` : '');
  if (o.slugsOut) writeAtomic(o.slugsOut, cov.slugs.length ? `${cov.slugs.join('\n')}\n` : '');
  console.error(`roster: ${r.urls.length} page(s) → ${o.out} (${candidates.length} candidate(s); ${captured.size} captured, ${cov.paths.size} delivered, ${documents.size} document destination(s) reserved)`);
  return 0;
}

function publish(o) {
  if (!existsSync(o.before) || !statSync(o.before).isDirectory()) usage(`--before is not a directory: ${o.before}`);
  const before = new Set(htmlFiles(o.before));
  const fresh = htmlFiles(o.content).filter((f) => !before.has(f)).map((f) => documentPath(f));
  writeAtomic(o.out, fresh.length ? `${fresh.join('\n')}\n` : '');
  console.error(`publish: ${fresh.length} new document(s) → ${o.out} (${before.size} under ${o.before} held)`);
  return 0;
}

const help = () => readFileSync(SELF, 'utf8').match(/\/\*\*[\s\S]*?\*\//)[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim();

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  try {
    const o = parseArgs(argv);
    return o.cmd === 'select' ? select(o) : publish(o);
  } catch (e) {
    if (e instanceof UsageError) { console.error(e.message); return 2; }
    if (e && typeof e.code === 'string') { console.error(`extend-roster: ${e.code}${e.path ? ` ${e.path}` : ''}: ${e.message}`); return 2; }
    console.error(`extend-roster: ${e.message}`); return 2;
  }
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === SELF; } catch { /* not run as a script */ }
if (isMain) process.exit(main(process.argv.slice(2)));
