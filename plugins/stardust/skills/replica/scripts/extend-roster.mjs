#!/usr/bin/env node
/**
 * skills/replica/scripts/extend-roster.mjs
 *
 * The delivery side of replica's extend pass (reference/extend-pass.md): which source pages a pass may deliver and
 * which documents it may publish. The rule it keeps: a pass never sends a document that existed at its opening. The
 * crawler stays a source tool — it lists the uncaptured source pages in order (`crawl.mjs --skip-captured …
 * --select-only`); this script decides against what the delivered site holds, with the EDS path rules of
 * contracts.mjs (lib/paths.mjs). Its records live in the pass dir (--pass, e.g. stardust/replica/extend/x1) and are
 * meant to be committed: a checkpoint clone resumes from them.
 *
 * Usage:
 *   node stardust/scripts/replica/extend-roster.mjs select --candidates <urls.txt> --out <roster.txt>
 *        [--named] [--max <n>] [--slugs-out <file>] [--reserved-out <file> --opening <file>]
 *        [--state stardust/state.json] [--coverage stardust/rollout/coverage/pages.json] [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs output --pass <dir> --unit <name> --files <a.html,b.html>
 *        [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs publish --pass <dir> [--content content]
 *
 *   select    reads the candidate urls (one per line, in the crawler's order) and keeps those whose EDS destination
 *             (pathKey(deliveredUrl(path)): case, `.html`, `/index`, trailing slash, query and `_` folded) is new: not
 *             the destination of a captured page (state.json pages[] url / finalUrl, and the capture records beside
 *             it under current/pages/, as the crawler reads them), not a coverage row's `path`,
 *             not a document a deploy ledger records as sent (stardust/deploy/ledger-*.json and
 *             <content>/.deploy-ledger.json — its file in this checkout or not), not an existing content document
 *             (nav, footer and fragments included, though no coverage row names them), and not under /library (the
 *             DA authoring library). One destination takes one slot, at its first candidate's place; a query-less url
 *             of that destination replaces a query one. --max n keeps the first n (0 or absent: all). --slugs-out
 *             gets every coverage `slug` (for `crawl.mjs --reserve-slugs`) and --reserved-out every destination
 *             taken now (captured, coverage, ledgers, content). --opening names the content file paths recorded
 *             when the pass opened (`/a/index.html`, one per line; git-ignored files included): their destinations
 *             stay taken though the file has left the tree since, and --reserved-out needs it. --slugs-out and
 *             --reserved-out are written BEFORE the roster, each through a temp
 *             file + rename: a roster on disk means the selection completed. Hand the roster to capture as a file
 *             (`crawl.mjs --pages-file`): a url may hold a comma. --named (urls the owner named): a url with a query
 *             string, or one whose destination is delivered, an existing document or the library — captured or not
 *             — exits 2 and writes nothing; one captured but not delivered (an interrupted capture) is dropped.
 *   output    a unit that succeeded records the exact files it wrote for its roster pages in its own
 *             <pass>/outputs/<unit>.paths (one writer per file: concurrent units never share a record); a record only
 *             grows — a resumed unit reporting a subset keeps the rest. Refused (exit 2, nothing written): a file
 *             that is no document (a lowercase `.html` under --content), that is another file under a second name
 *             (a symbolic or hard link), whose destination was taken at the opening (<pass>/reserved.paths), that
 *             is no roster page's (<pass>/urls.txt), or a second file for a page any record gives an output.
 *   publish   writes the guard <content>/.deploy-allow: a `# pass x<N>` line that names the pass, then the DA path
 *             (`/visit/index`) of every recorded output plus every entry of <pass>/also.paths (a NEW fragment the
 *             pages need, written there by the unit that creates it), one per line. Only the pass the run ledger
 *             shows open may publish (exit 2 otherwise). While the guard exists, `deploy-batch.mjs` sends only the
 *             documents it lists and `localize-links.mjs` rewrites only those. Any other new document (an owner's draft, a file
 *             at a roster page no unit recorded) is held and named. An entry that is missing, a symbolic or hard
 *             link, or whose destination was taken at the opening, exits 2 with nothing written. So does a second
 *             file at a pass output's destination (`visit.html` beside `visit/index.html`): rollout's autofix and
 *             library take the first file that matches a page's path. It reads
 *             the records and replaces the guard under a lock (deploy/file-lock.mjs), so units may run it at once.
 *             Run it after every `output` and before every deploy of the pass; delete the guard after `extend end`.
 *
 * Exit codes: 0 ok (an empty roster is ok) · 2 usage, an unreadable input, a refused url, file or entry, or a missing
 * pass record. --help / -h prints this usage and touches no file.
 */
import {
  existsSync, readdirSync, readFileSync, realpathSync, renameSync, mkdirSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The shared rules (contracts.mjs), found the way every skill's scripts find them: plugin tree, project copy, flat.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs', './stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('extend-roster: contracts.mjs not found (looked in ../../stardust/scripts/, ../stardust/ and ./stardust/) — copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(2); }
const { pathKey, deliveredUrl, documentPath, loadSibling } = await import(CONTRACTS.href);

class UsageError extends Error {}
const usage = (m) => { throw new UsageError(`extend-roster: ${m}`); };
// The guard `publish` writes under --content; deploy-batch.mjs and localize-links.mjs read the same name.
const GUARD = '.deploy-allow';

/** The EDS destination of a source url, as a lookup key. Pure. */
export const destinationOf = (href) => pathKey(deliveredUrl(new URL(href).pathname));

/** The documents under dir, walked as deploy-batch.mjs walks them (every `.html` file): content file paths, sorted. */
export function documents(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(join(dir, rel)).flatMap((name) => {
    const f = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, f)).isDirectory()) return documents(dir, f);
    return name.endsWith('.html') ? [f] : [];
  }).sort();
}

// A document that is another file under a second name — reached through a symbolic link (the file or a folder above
// it), or a hard link — can be an older document: writing it would rewrite that older document.
const aliased = (content, f) => realpathSync(join(content, f)) !== join(realpathSync(content), f) || statSync(join(content, f)).nlink > 1;
const ALIASED = 'another file under a second name (a symbolic or hard link): never a pass output';

// `/library` is the DA folder rollout's da-library.mjs writes: never a page's destination.
const isLibraryPath = (key) => key === '/library' || key.startsWith('/library/');

/**
 * The roster: `candidates` filtered against `captured`, `delivered` and `docs` (destination key sets), one slot per
 * destination, a query-less url preferred, capped at `max`. `named` refuses query urls and taken destinations.
 * Returns { urls, dropped: [{ url, why }], refused: [{ url, why }] }. Pure.
 */
export function selectRoster({ candidates, captured, delivered, documents: docs, max = Infinity, named = false }) {
  const slots = new Map(); const dropped = []; const refused = [];
  for (const url of candidates) {
    let dest;
    try { dest = destinationOf(url); } catch { dropped.push({ url, why: 'not a url' }); continue; }
    const query = Boolean(new URL(url).search);
    if (named && query) { refused.push({ url, why: 'has a query string — name the page without it' }); continue; }
    if (isLibraryPath(dest)) { (named ? refused : dropped).push({ url, why: `${dest} is the DA authoring library's folder (da-library writes it)` }); continue; }
    // a named url is refused on a delivered or document destination even when it is captured too (checked first)
    if (named && delivered.has(dest)) { refused.push({ url, why: `delivered at ${dest} (coverage)` }); continue; }
    if (named && docs.has(dest)) { refused.push({ url, why: `an existing content document holds ${dest}` }); continue; }
    if (captured.has(dest)) { dropped.push({ url, why: `already captured (${dest})` }); continue; }
    if (delivered.has(dest)) { dropped.push({ url, why: `delivered at ${dest} (coverage)` }); continue; }
    if (docs.has(dest)) { dropped.push({ url, why: `an existing content document holds ${dest}` }); continue; }
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
const writeAtomic = (file, data) => { mkdirSync(dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };
const lines = (arr) => (arr.length ? `${arr.join('\n')}\n` : '');
const readList = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim().replace(/^\/+/, '')).filter(Boolean) : []);

// The destinations of the DA documents a deploy ledger records as sent (live, previewed, or a PUT that landed), their
// file in this checkout or not (an ignored nav). A ledger that cannot be read stops the command (exit 2): a
// reservation is never dropped silently.
function liveDocuments(content) {
  const dir = join('stardust', 'deploy');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => /^ledger-.*\.json$/.test(n)).sort().map((n) => join(dir, n)) : [];
  if (existsSync(join(content, '.deploy-ledger.json'))) files.push(join(content, '.deploy-ledger.json'));
  const out = new Set();
  for (const f of files) {
    const ledger = readJson(f, 'deploy ledger');
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) usage(`deploy ledger ${f} is not an object of web paths — repair or restore it`);
    for (const [doc, rec] of Object.entries(ledger)) if (rec && (['live', 'previewed'].includes(rec.status) || (rec.put >= 200 && rec.put < 300))) out.add(pathKey(doc));
  }
  return out;
}

// The capture records beside a state.json (current/pages/*.json); one that cannot be parsed is skipped.
function captureRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).flatMap((n) => {
    try { return [JSON.parse(readFileSync(join(dir, n), 'utf8'))]; } catch { return []; }
  });
}

const FLAGS = {
  select: ['--candidates', '--out', '--max', '--state', '--coverage', '--content', '--slugs-out', '--reserved-out', '--opening'],
  output: ['--pass', '--content', '--unit', '--files'],
  publish: ['--pass', '--content'],
};
const NEEDS = { select: ['candidates', 'out'], output: ['pass', 'unit', 'files'], publish: ['pass'] };

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!FLAGS[cmd]) usage(`first argument is one of ${Object.keys(FLAGS).join(', ')} (got ${cmd ?? 'nothing'})`);
  const o = { cmd, state: 'stardust/state.json', coverage: 'stardust/rollout/coverage/pages.json', content: 'content', max: Infinity, named: false };
  for (let i = 0; i < rest.length; i += 1) {
    const f = rest[i];
    if (cmd === 'select' && f === '--named') { o.named = true; continue; }
    if (!FLAGS[cmd].includes(f)) usage(`unknown argument for ${cmd}: ${f}`);
    const v = rest[(i += 1)];
    if (v === undefined || !v.trim() || v.startsWith('--')) usage(`${f} needs a value`);
    if (f === '--max') { if (!/^\d+$/.test(v)) usage('--max needs a whole number'); o.max = Number(v) === 0 ? Infinity : Number(v); } else o[f.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  for (const n of NEEDS[cmd]) if (!o[n]) usage(`${cmd} needs --${n}`);
  if (o.files) o.files = o.files.split(',').map((s) => s.trim().replace(/^\/+/, '')).filter(Boolean);
  return o;
}

function select(o) {
  let text;
  try { text = readFileSync(o.candidates, 'utf8'); } catch (e) { return usage(`--candidates ${o.candidates}: ${e.code || e.message}`); }
  const candidates = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (o.reservedOut && !o.opening) usage('--reserved-out needs --opening <file>: the content file paths recorded when the pass opened');
  if (o.opening && !existsSync(o.opening)) usage(`--opening ${o.opening}: not found — the opening of the pass writes it`);
  const state = readJson(o.state, '--state');
  const captured = capturedDestinations(state);
  // the capture records on disk, as the crawler reads them: a redirect's final url is captured too
  for (const key of capturedDestinations({ site: state.site, pages: captureRecords(join(dirname(o.state), 'current', 'pages')) })) captured.add(key);
  const cov = coverageOf(readJson(o.coverage, '--coverage'));
  for (const key of liveDocuments(o.content)) cov.paths.add(key); // a ledger's live document reserves its destination too
  const docs = new Set([...documents(o.content), ...(o.opening ? readList(o.opening) : [])].map((f) => pathKey(`/${f}`)));
  const r = selectRoster({ candidates, captured, delivered: cov.paths, documents: docs, max: o.max, named: o.named });
  for (const d of r.dropped) console.error(`dropped ${d.url} — ${d.why}`);
  if (r.refused.length) {
    for (const d of r.refused) console.error(`refused ${d.url} — ${d.why}`);
    console.error(`extend-roster: ${r.refused.length} named url(s) refused; nothing written`);
    return 2;
  }
  // the reservations first, the roster last: a roster on disk means every output of the selection is written
  if (o.slugsOut) writeAtomic(o.slugsOut, lines(cov.slugs));
  if (o.reservedOut) writeAtomic(o.reservedOut, lines([...new Set([...captured, ...cov.paths, ...docs])].sort()));
  writeAtomic(o.out, lines(r.urls));
  console.error(`roster: ${r.urls.length} page(s) → ${o.out} (${candidates.length} candidate(s); ${captured.size} captured, ${cov.paths.size} delivered, ${docs.size} document destination(s) reserved)`);
  return 0;
}

function rosterDestinations(pass) {
  const f = join(pass, 'urls.txt');
  if (!existsSync(f)) usage(`${f} not found — the roster comes first`);
  return new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean).map((u) => destinationOf(u)));
}

// The destinations taken when the pass opened (`select --reserved-out`): no pass output and no also.paths entry may
// take one.
function reservedOf(pass) {
  const f = join(pass, 'reserved.paths');
  if (!existsSync(f)) usage(`${f} not found — \`select --reserved-out\` writes it with the roster`);
  return new Set(readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
}
const takenWhy = (reserved, dest) => (isLibraryPath(dest) ? 'the DA authoring library\'s folder'
  : reserved.has(dest) ? `${dest} was taken when the pass opened: never a pass output` : '');
const outputRecords = (pass) => {
  const dir = join(pass, 'outputs');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.paths')).sort().map((n) => ({ unit: n.slice(0, -'.paths'.length), files: readList(join(dir, n)) })) : [];
};

// A unit records the exact files it wrote for its roster pages, once it succeeded, in its own <pass>/outputs/<unit>.paths
// (one writer per file: concurrent units never share one). The only page documents publish lists.
function output(o) {
  if (!/^[A-Za-z0-9._-]+$/.test(o.unit)) usage(`--unit ${o.unit}: letters, digits, '.', '_' and '-' only`);
  const pages = rosterDestinations(o.pass); const reserved = reservedOf(o.pass);
  const docs = new Set(documents(o.content));
  // every record's claims, this unit's included: a record only grows (a resumed unit that reports a subset keeps the rest)
  const others = new Map(); const own = [];
  for (const r of outputRecords(o.pass)) for (const f of r.files) { others.set(pathKey(`/${f}`), { f, unit: r.unit }); if (r.unit === o.unit) own.push(f); }
  const claim = new Map(own.map((f) => [pathKey(`/${f}`), f])); const problems = [];
  for (const f of o.files) {
    const dest = pathKey(`/${f}`);
    if (!docs.has(f)) problems.push(`/${f} — not a document under ${o.content} (a lowercase .html file deploy sends)`);
    else if (aliased(o.content, f)) problems.push(`/${f} — ${ALIASED}`);
    else if (takenWhy(reserved, dest)) problems.push(`/${f} — ${takenWhy(reserved, dest)}`);
    else if (!pages.has(dest)) problems.push(`/${f} — ${dest} is not a roster page (a fragment the pages need goes in also.paths)`);
    else if ((claim.has(dest) && claim.get(dest) !== f) || (others.has(dest) && others.get(dest).f !== f)) problems.push(`/${f} — roster page ${dest} already has its output /${claim.get(dest) || others.get(dest).f}${others.has(dest) ? ` (unit ${others.get(dest).unit})` : ''}`);
    else claim.set(dest, f);
  }
  if (problems.length) {
    for (const p of problems) console.error(`refused ${p}`);
    console.error(`extend-roster: ${problems.length} output(s) refused; nothing written`);
    return 2;
  }
  const file = join(o.pass, 'outputs', `${o.unit}.paths`);
  writeAtomic(file, lines([...new Set(claim.values())].sort().map((f) => `/${f}`)));
  console.error(`output: unit ${o.unit} now records ${claim.size} file(s) (${claim.size - own.length} new) → ${file}`);
  return 0;
}

// The records are read and the guard replaced under one lock: a unit that publishes while another does never writes
// a guard without the other's documents.
async function publish(o) {
  const { withLock } = await loadSibling('deploy', 'file-lock.mjs');
  const { openPassOf } = await loadSibling('deploy', 'publish-guard.mjs');
  // only the open pass writes the guard: a retried command of an earlier pass never authorizes its documents again
  const track = basename(resolve(o.pass)).toLowerCase(); const open = openPassOf(o.content);
  if (open !== track) usage(`${o.pass} is not the open extend pass (${open ? `pass ${open} is open` : 'the run ledger shows none open'}) — nothing written`);
  return withLock(join(o.pass, 'guard'), () => buildGuard(o, track));
}

function buildGuard(o, track) {
  const pages = rosterDestinations(o.pass); const reserved = reservedOf(o.pass);
  const docs = new Set(documents(o.content));
  const keep = new Set(); const problems = []; const owner = new Map();
  for (const r of outputRecords(o.pass)) {
    for (const f of r.files) {
      const dest = pathKey(`/${f}`);
      if (!pages.has(dest)) problems.push(`/${f} — unit ${r.unit}: ${dest} is not a roster page`);
      else if (owner.has(dest) && owner.get(dest).f !== f) problems.push(`/${f} — unit ${r.unit} and unit ${owner.get(dest).unit} (/${owner.get(dest).f}) claim roster page ${dest}`);
      else owner.set(dest, { f, unit: r.unit });
    }
  }
  for (const f of [...[...owner.values()].map((v) => v.f), ...readList(join(o.pass, 'also.paths'))]) {
    const why = !docs.has(f) ? `listed, but no such document under ${o.content}`
      : aliased(o.content, f) ? ALIASED : takenWhy(reserved, pathKey(`/${f}`));
    if (why) problems.push(`/${f} — ${why}`); else keep.add(f);
  }
  // rollout's autofix and library take the first file that matches a page's path: a second file there is never guessed
  for (const f of docs) {
    const dest = pathKey(`/${f}`);
    if (!keep.has(f) && owner.has(dest)) problems.push(`/${f} — shares the destination ${dest} with the pass output /${owner.get(dest).f}: remove or rename it`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`refused ${p}`);
    console.error(`extend-roster: ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} of outputs/*.paths / also.paths refused; nothing written`);
    return 2;
  }
  let held = 0;
  for (const f of docs) {
    const dest = pathKey(`/${f}`);
    if (keep.has(f) || reserved.has(dest)) continue;
    held += 1;
    console.error(`held /${f} — ${pages.has(dest) ? `no unit recorded it as the output of roster page ${dest}` : 'new, neither a unit\'s output nor in also.paths'}`);
  }
  const guard = join(o.content, GUARD);
  writeAtomic(guard, lines([`# pass ${track}`, ...[...keep].sort().map((f) => documentPath(f))]));
  console.error(`publish: ${keep.size} document(s) → ${guard} (${held} new held); deploy-batch sends and localize-links rewrites only these while it exists`);
  return 0;
}

const help = () => readFileSync(SELF, 'utf8').match(/\/\*\*[\s\S]*?\*\//)[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim();

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  try {
    const o = parseArgs(argv);
    return await { select, output, publish }[o.cmd](o);
  } catch (e) {
    if (e instanceof UsageError) { console.error(e.message); return 2; }
    if (e && typeof e.code === 'string') { console.error(`extend-roster: ${e.code}${e.path ? ` ${e.path}` : ''}: ${e.message}`); return 2; }
    console.error(`extend-roster: ${e.message}`); return 2;
  }
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === SELF; } catch { /* not run as a script */ }
if (isMain) process.exit(await main(process.argv.slice(2)));
