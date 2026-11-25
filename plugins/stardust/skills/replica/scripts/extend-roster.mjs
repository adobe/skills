#!/usr/bin/env node
/**
 * skills/replica/scripts/extend-roster.mjs
 *
 * The delivery side of replica's extend pass (reference/extend-pass.md): which source pages a pass may deliver,
 * which documents it may publish, and which older documents it may re-publish or restore after the link localizer
 * rewrote them. The crawler stays a source tool — it lists the uncaptured source pages in order (`crawl.mjs
 * --skip-captured … --select-only`); this script decides against what the delivered site holds, with the EDS path
 * rules of contracts.mjs (lib/paths.mjs) and the documents of lib/documents.mjs — the deployer's own enumeration,
 * entry resolution and library folder, one copy for producer and consumer. Everything it keeps lives in the pass dir (--pass, e.g.
 * stardust/replica/extend/x1) and is meant to be committed: a checkpoint clone resumes from it.
 *
 * Usage:
 *   node stardust/scripts/replica/extend-roster.mjs select --candidates <urls.txt> --out <roster.txt>
 *        [--named] [--max <n>] [--state stardust/state.json] [--coverage stardust/rollout/coverage/pages.json]
 *        [--content content] [--slugs-out <file>]
 *   node stardust/scripts/replica/extend-roster.mjs inventory|publish|reconcile|relink-status --pass <dir>
 *        [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs output|relink-approve|relink-restore --pass <dir>
 *        --files <a.html,b.html> [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs published --pass <dir> --out <dir> [--content content]
 *
 *   select    reads the candidate urls (one per line, in the crawler's order) and keeps those whose EDS destination
 *             (pathKey(deliveredUrl(path)): case, `.html`, `/index`, trailing slash, query and `_` folded) is new: not
 *             the destination of a captured page (state.json pages[] url / finalUrl), not a coverage row's `path`,
 *             not an existing content document (nav, footer and fragments included, though no coverage row names
 *             them), and not under /library (the DA authoring library, lib/documents.mjs). One destination takes one slot, at its first candidate's place; a query-less url of that
 *             destination replaces a query one. --max n keeps the first n (0 or absent: all). With --slugs-out it
 *             writes every coverage `slug` (for `crawl.mjs --reserve-slugs`) FIRST, then the roster, each through a
 *             temp file + rename: a roster on disk means the selection completed. Hand the roster to capture as a
 *             file (`crawl.mjs --pages-file`): a url may hold a comma. --named (urls the owner named): a url with a
 *             query string, or one whose destination is delivered, an existing document or the library — captured or not —
 *             exits 2 and writes nothing; one captured but not delivered (an interrupted capture) is dropped.
 *   Deploy ledgers read (the publication evidence): stardust/deploy/*.json (rollout's unit ledgers),
 *   <content>/.deploy-ledger.json (deploy-batch's default) and every pass's approved/r<k>/.deploy-ledger.json; a
 *   row is evidence when it reads `live`, its `sha256` (the bytes verified delivered) naming the version.
 *
 *   inventory writes <pass>/inventory.tsv once, at the opening: `<sha256>\t<file>\t<tracked|ignored>\t<published>`
 *             for every document under --content (`tracked` per `git ls-files`). `published` is what the ledgers
 *             say of THESE bytes: `live` (the newest live row's sha256 is theirs), `live-unverified` (a live row from
 *             before ledgers kept a sha256 — `deploy-batch.mjs --adopt` records one), `differs` (another version
 *             landed last, or an earlier pass ended with it a conflict or held), `unpublished` (no live row). It is
 *             the record of what existed, tracked by git; the bytes it names are never needed on disk. Written once.
 *   output    a unit that succeeded records the exact files it wrote for its roster pages in <pass>/outputs.paths.
 *             Refused (exit 2, nothing written): a file that is no document, existed at the opening, sits under
 *             /library, is no roster page's, or a second file for a page that has its output.
 *   publish   writes <pass>/publish.paths — outputs.paths plus <pass>/also.paths (a fragment the pages need, written
 *             by the unit that creates it), each checked with the deployer's own entry rule — and <pass>/targets.paths:
 *             the link targets (every opening document with a live row, and the publish list) for `localize-links.mjs
 *             --targets`. Any other new document (an owner's draft, one at a roster page whose capture failed) is
 *             held and named. An entry that is missing, existed at the opening, sits under /library or would resolve
 *             to another document exits 2, nothing written.
 *   published writes into --out (a new dir) every document at bytes known delivered — its newest verified digest, a
 *             landed approved revision, or the opening blob of a `live` document — and names the rest withheld: the
 *             input of `da-library.mjs --content <out>`, so a held or conflicted working file never reaches the library.
 *   reconcile writes <pass>/redrive.paths: every document of publish.paths whose bytes are not the newest live
 *             row's sha256 in any ledger — a pass page relinked after its PUT, a C-archetype representative a
 *             sibling's localizer changed, a fragment never sent — for `deploy-batch.mjs --paths <it> --allow
 *             <pass>/publish.paths`.
 *   relink-status  classifies every inventory document a localize-links receipt of the pass names
 *             (<pass>/receipts/*.json, written by `localize-links.mjs --receipt`: the input and output digest of
 *             each file that run itself rewrote), against its LAST PUBLISHED BYTES (the newest <pass>/approved/
 *             r<k>/<file> whose ledger records that exact sha256 live, else — when the inventory says `live` — the
 *             opening commit's blob, `git show $(cat <pass>/base.txt):./<content>/<file>`). A run interrupted before it
 *             reached a file left a record whose input is still the file: it is not counted:
 *               candidate  the localizer's own edit and nothing else: a receipt's input is the last published bytes,
 *                          each later receipt's input (by `at`) the previous output, the file still the last output,
 *                          and the difference href values only — the owner may approve or decline it
 *               conflict   anything else (an edit before, between or after the localizer's runs, or changes other
 *                          than links): held, the file kept as it is, the reason named
 *               held       its last published bytes are not here or not known: an ignored document (in no commit),
 *                          one never published, a live row without a digest, another version published last, or a
 *                          shallow clone without the opening commit (the line names the `git fetch` that brings it)
 *               unchanged  the file is its last published bytes
 *             Prints one line per document and writes <pass>/relink-status.json. Exit 0.
 *   relink-approve  for the named candidates: freezes the exact bytes classified (one read) in <pass>/approved/r<k>/
 *             <file> (k the next free number) with r<k>.sha256 and r<k>.paths; commit it, then deploy that frozen copy with `deploy-batch.mjs --content
 *             <pass>/approved/r<k> --allow <pass>/approved/r<k>.paths` (a retry is the same command; its ledger is
 *             r<k>/.deploy-ledger.json, committed with it).
 *   relink-restore  for the named candidates: writes the last published bytes back only while the file still holds the
 *             bytes classified — moved aside, checked, the restored bytes linked in; a file saved meanwhile is kept
 *             and refused as a conflict.
 *             approve and restore act only on candidates; a named file that is not one is refused (exit 1).
 *
 * Exit codes: 0 ok (an empty roster is ok) · 1 a named file refused · 2 usage, an unreadable input, a --named url
 * refused, or a missing pass record. --help / -h prints this usage and touches no file.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The shared rules (contracts.mjs), found the way every skill's scripts find them: plugin tree, project copy, flat.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs', './stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('extend-roster: contracts.mjs not found (looked in ../../stardust/scripts/, ../stardust/ and ./stardust/) — copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(2); }
const { pathKey, deliveredUrl, documentPath, contentDocuments, resolveEntry, isLibraryPath } = await import(CONTRACTS.href);

class UsageError extends Error {}
class Refused extends Error {}
const usage = (m) => { throw new UsageError(`extend-roster: ${m}`); };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** The EDS destination of a source url, as a lookup key. Pure. */
export const destinationOf = (href) => pathKey(deliveredUrl(new URL(href).pathname));

/** The documents under dir — lib/documents.mjs contentDocuments, the deployer's rule: content file paths, sorted. */
export const documents = (dir) => contentDocuments(dir).map((d) => d.file);

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

/** A document's markup with every href value blanked: two files equal under it differ in links only. Pure. */
export const withoutHrefs = (html) => String(html).replace(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, 'href=""');

/**
 * One inventory document's relink state. `published` is its last published bytes (null when unavailable), `current`
 * its bytes now, `records` its receipt records in order. Returns { state, why }. Pure.
 */
export function classify({ published, unavailable, current, records }) {
  if (published === null) return { state: 'held', why: unavailable || 'its last published bytes cannot be read' };
  const L = sha(published); const C = sha(current);
  if (C === L) return { state: 'unchanged', why: '' };
  // the receipt is written before the pages: a run interrupted before reaching this file left its record, not its bytes
  if (records.length && C === records[records.length - 1].input && C !== records[records.length - 1].output) records = records.slice(0, -1);
  if (!records.length) return { state: 'conflict', why: 'edited, and no localizer run of the pass wrote it' };
  let start = -1;
  records.forEach((r, i) => { if (r.input === L) start = i; });
  if (start === -1) return { state: 'conflict', why: 'edited before the localizer ran: no run started from its last published bytes' };
  for (let j = start + 1; j < records.length; j += 1) {
    if (records[j].input !== records[j - 1].output) return { state: 'conflict', why: 'edited between localizer runs' };
  }
  if (C !== records[records.length - 1].output) return { state: 'conflict', why: 'edited after the localizer ran' };
  if (withoutHrefs(published) !== withoutHrefs(current)) return { state: 'conflict', why: 'changes other than links' };
  return { state: 'candidate', why: 'links only, the localizer\'s own output' };
}

const readJson = (file, what) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return usage(`${what} ${file}: ${e.code === 'ENOENT' ? 'not found' : e.message}`); }
};
const writeAtomic = (file, data) => { mkdirSync(dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };
const lines = (arr) => (arr.length ? `${arr.join('\n')}\n` : '');

const PUBLISHED = ['live', 'live-unverified', 'differs', 'unpublished'];
const isPublished = (e) => e.pub === 'live' || e.pub === 'live-unverified';
function readInventory(pass) {
  const f = join(pass, 'inventory.tsv');
  if (!existsSync(f)) usage(`${f} not found — run \`inventory\` at the opening`);
  const map = new Map();
  for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const [hash, file, kind, pub] = l.split('\t');
    if (!/^[0-9a-f]{64}$/.test(hash) || !file || !['tracked', 'ignored'].includes(kind) || !PUBLISHED.includes(pub)) usage(`${f}: malformed line ${JSON.stringify(l)}`);
    map.set(file, { sha: hash, ignored: kind === 'ignored', pub });
  }
  return map;
}

// The last published bytes of an inventory document: the newest approved revision whose ledger records its exact
// bytes live, else the opening commit's blob (tracked documents only). Returns { bytes } or { bytes: null, why }.
function lastPublished(o, file, entry) {
  const dir = join(o.pass, 'approved');
  const revs = existsSync(dir) ? readdirSync(dir).filter((n) => /^r\d+$/.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))) : [];
  for (const r of revs) {
    const copy = join(dir, r, file);
    if (!existsSync(copy)) continue;
    const ledgerFile = join(dir, r, '.deploy-ledger.json');
    const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {};
    const rec = ledger[documentPath(file)];
    const bytes = readFileSync(copy);
    if (rec && rec.status === 'live' && rec.sha256 === sha(bytes)) return { bytes };
  }
  if (entry.ignored) return { bytes: null, why: 'git-ignored: its published bytes are in no commit — never restored or re-published by the pass' };
  if (entry.pub === 'unpublished') return { bytes: null, why: 'no deploy ledger records it live: never published — not a republish' };
  if (entry.pub === 'live-unverified') return { bytes: null, why: 'its live row predates ledger digests: which version DA holds is not known — `deploy-batch.mjs --adopt` records it when DA holds the opening bytes' };
  if (entry.pub === 'differs') return { bytes: null, why: 'another version than the opening commit\'s was published last, or an earlier pass ended with it held — DA\'s bytes are not known here' };
  const baseFile = join(o.pass, 'base.txt');
  if (!existsSync(baseFile)) usage(`${baseFile} not found`);
  const base = readFileSync(baseFile, 'utf8').trim();
  // `<rev>:./<path>` is read from the working directory, as every other path here
  const spec = `${base}:./${relative(process.cwd(), resolve(o.content, file)).split(sep).join('/')}`;
  let bytes;
  try { bytes = execFileSync('git', ['show', spec], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {
    return { bytes: null, why: `the opening commit ${base.slice(0, 12)} is not in this clone — \`git fetch --depth 1 origin ${base}\`, then again` };
  }
  return sha(bytes) === entry.sha ? { bytes } : { bytes: null, why: `the opening commit's blob differs from the inventory (${spec})` };
}

// The localizer's receipts of this pass, in order: one record per file a run itself rewrote.
function relinkRecords(pass) {
  const dir = join(pass, 'receipts'); const by = new Map();
  if (!existsSync(dir)) return by;
  const receipts = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => ({ n, r: readJson(join(dir, n), 'receipt') }))
    .filter(({ r }) => r && r.tool === 'localize-links' && r.files && typeof r.files === 'object')
    .sort((a, b) => String(a.r.at).localeCompare(String(b.r.at)) || a.n.localeCompare(b.n));
  for (const { n, r } of receipts) {
    for (const [key, d] of Object.entries(r.files)) {
      const file = key.replace(/^\/+/, '');
      if (!by.has(file)) by.set(file, []);
      by.get(file).push({ input: d.input, output: d.output, at: r.at, receipt: n });
    }
  }
  return by;
}

// Every deploy ledger the project keeps; the live rows for one document across them, newest first.
function ledgerFiles(o) {
  const out = [];
  if (existsSync('stardust/deploy')) for (const n of readdirSync('stardust/deploy')) if (n.endsWith('.json')) out.push(join('stardust/deploy', n));
  if (existsSync(join(o.content, '.deploy-ledger.json'))) out.push(join(o.content, '.deploy-ledger.json'));
  const ext = 'stardust/replica/extend';
  if (existsSync(ext)) {
    for (const pass of readdirSync(ext)) {
      const ap = join(ext, pass, 'approved');
      if (!existsSync(ap)) continue;
      for (const r of readdirSync(ap)) if (/^r\d+$/.test(r) && existsSync(join(ap, r, '.deploy-ledger.json'))) out.push(join(ap, r, '.deploy-ledger.json'));
    }
  }
  return out;
}
function liveRows(o, file, cache) {
  if (!cache.rows) {
    cache.rows = new Map();
    for (const lf of ledgerFiles(o)) {
      let l; try { l = JSON.parse(readFileSync(lf, 'utf8')); } catch { continue; }
      for (const [doc, rec] of Object.entries(l || {})) {
        if (!rec || rec.status !== 'live') continue;
        if (!cache.rows.has(doc)) cache.rows.set(doc, []);
        cache.rows.get(doc).push({ sha256: rec.sha256 || null, ts: rec.ts || '', ledger: lf });
      }
    }
    for (const rows of cache.rows.values()) rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }
  return cache.rows.get(documentPath(file)) || [];
}

// Documents an earlier pass ended with as a conflict or held: what DA holds is not their committed bytes.
function unresolvedEarlier(o) {
  const ext = 'stardust/replica/extend'; const out = new Set();
  if (!existsSync(ext)) return out;
  for (const pass of readdirSync(ext)) {
    const f = join(ext, pass, 'relink-status.json');
    if (resolve(ext, pass) === resolve(o.pass) || !existsSync(f)) continue;
    try { for (const s of JSON.parse(readFileSync(f, 'utf8'))) if (s.state === 'conflict' || s.state === 'held') out.add(s.file); } catch { /* unreadable: no evidence */ }
  }
  return out;
}

function statusAll(o) {
  const inv = readInventory(o.pass); const recs = relinkRecords(o.pass); const out = [];
  for (const [file, records] of recs) {
    const entry = inv.get(file);
    if (!entry) continue;
    const path = join(o.content, file);
    const current = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
    const { bytes: published, why } = lastPublished(o, file, entry);
    out.push({ file, ...classify({ published, unavailable: why, current, records }), published, current });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const FLAGS = {
  select: ['--candidates', '--out', '--max', '--state', '--coverage', '--content', '--slugs-out'],
  inventory: ['--pass', '--content'],
  publish: ['--pass', '--content'],
  reconcile: ['--pass', '--content'],
  output: ['--pass', '--content', '--files'],
  published: ['--pass', '--content', '--out'],
  'relink-status': ['--pass', '--content'],
  'relink-approve': ['--pass', '--content', '--files'],
  'relink-restore': ['--pass', '--content', '--files'],
};

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
  const need = cmd === 'select' ? ['candidates', 'out'] : ['relink-approve', 'relink-restore', 'output'].includes(cmd) ? ['pass', 'files'] : cmd === 'published' ? ['pass', 'out'] : ['pass'];
  for (const n of need) if (!o[n]) usage(`${cmd} needs --${n}`);
  if (o.files) o.files = o.files.split(',').map((s) => s.trim().replace(/^\/+/, '')).filter(Boolean);
  return o;
}

function select(o) {
  let text;
  try { text = readFileSync(o.candidates, 'utf8'); } catch (e) { return usage(`--candidates ${o.candidates}: ${e.code || e.message}`); }
  const candidates = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const captured = capturedDestinations(readJson(o.state, '--state'));
  const cov = coverageOf(readJson(o.coverage, '--coverage'));
  const docs = new Set(documents(o.content).map((f) => pathKey(`/${f}`)));
  const r = selectRoster({ candidates, captured, delivered: cov.paths, documents: docs, max: o.max, named: o.named });
  for (const d of r.dropped) console.error(`dropped ${d.url} — ${d.why}`);
  if (r.refused.length) {
    for (const d of r.refused) console.error(`refused ${d.url} — ${d.why}`);
    console.error(`extend-roster: ${r.refused.length} named url(s) refused; nothing written`);
    return 2;
  }
  // the reservations first, the roster last: a roster on disk means every output of the selection is written
  if (o.slugsOut) writeAtomic(o.slugsOut, lines(cov.slugs));
  writeAtomic(o.out, lines(r.urls));
  console.error(`roster: ${r.urls.length} page(s) → ${o.out} (${candidates.length} candidate(s); ${captured.size} captured, ${cov.paths.size} delivered, ${docs.size} document destination(s) reserved)`);
  return 0;
}

function inventory(o) {
  const out = join(o.pass, 'inventory.tsv');
  if (existsSync(out)) usage(`${out} exists — the opening inventory is written once`);
  let tracked;
  try {
    tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', o.content], { encoding: 'utf8' }).split('\0').filter(Boolean)
      .map((f) => relative(resolve(o.content), resolve(f)).split(sep).join('/')));
  } catch (e) { return usage(`git ls-files failed (${e.message.split('\n')[0]}) — the project is a git repository`); }
  const cache = {}; const earlier = unresolvedEarlier(o); const count = {};
  const rows = documents(o.content).map((f) => {
    const h = sha(readFileSync(join(o.content, f)));
    const newest = liveRows(o, f, cache)[0];
    const pub = !newest ? 'unpublished' : earlier.has(f) ? 'differs' : !newest.sha256 ? 'live-unverified' : newest.sha256 === h ? 'live' : 'differs';
    count[pub] = (count[pub] || 0) + 1;
    return `${h}\t${f}\t${tracked.has(f) ? 'tracked' : 'ignored'}\t${pub}`;
  });
  writeAtomic(out, lines(rows));
  console.error(`inventory: ${rows.length} document(s) → ${out} (${rows.filter((r) => r.includes('\tignored\t')).length} ignored; ${Object.entries(count).map(([k, n]) => `${n} ${k}`).join(', ')})`);
  return 0;
}

const readList = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim().replace(/^\/+/, '')).filter(Boolean) : []);
function rosterDestinations(pass) {
  const f = join(pass, 'urls.txt');
  if (!existsSync(f)) usage(`${f} not found — the roster comes first`);
  return new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean).map((u) => destinationOf(u)));
}

// A unit records the exact files it wrote for its roster pages, once it succeeded: the only page documents publish lists.
function output(o) {
  const inv = readInventory(o.pass); const pages = rosterDestinations(o.pass);
  const docs = new Set(documents(o.content));
  const file = join(o.pass, 'outputs.paths');
  const claim = new Map(readList(file).map((f) => [pathKey(`/${f}`), f]));
  const problems = [];
  for (const f of o.files) {
    const dest = pathKey(`/${f}`);
    if (!docs.has(f)) problems.push(`/${f} — not a document under ${o.content} (a lowercase .html file deploy sends)`);
    else if (inv.has(f)) problems.push(`/${f} — existed at the opening: never a pass output`);
    else if (isLibraryPath(`/${f}`)) problems.push(`/${f} — the DA authoring library's folder`);
    else if (!pages.has(dest)) problems.push(`/${f} — ${dest} is not a roster page (a fragment the pages need goes in also.paths)`);
    else if (claim.has(dest) && claim.get(dest) !== f) problems.push(`/${f} — roster page ${dest} already has its output /${claim.get(dest)}`);
    else claim.set(dest, f);
  }
  if (problems.length) {
    for (const p of problems) console.error(`refused ${p}`);
    console.error(`extend-roster: ${problems.length} output(s) refused; nothing written`);
    return 2;
  }
  writeAtomic(file, lines([...new Set(claim.values())].sort().map((f) => `/${f}`)));
  console.error(`output: ${o.files.length} recorded → ${file} (${claim.size} roster page(s) with their output)`);
  return 0;
}

function publish(o) {
  const inv = readInventory(o.pass); const pages = rosterDestinations(o.pass);
  const docs = contentDocuments(o.content); const byFile = new Map(docs.map((d) => [d.file, d]));
  const webPaths = new Set(docs.map((d) => d.webPath));
  const outputs = readList(join(o.pass, 'outputs.paths')); const also = readList(join(o.pass, 'also.paths'));
  const keep = new Set(); const problems = [];
  for (const f of [...outputs, ...also]) {
    if (!byFile.has(f)) problems.push(`/${f} — listed, but no such document under ${o.content}`);
    else if (inv.has(f)) problems.push(`/${f} — existed at the opening: never on the publish list`);
    else if (isLibraryPath(`/${f}`)) problems.push(`/${f} — the DA authoring library's folder`);
    // the consumer's rule (deploy-batch --allow): the entry must name this document and no other
    else if (resolveEntry(`/${f}`, webPaths).match !== byFile.get(f).webPath) problems.push(`/${f} — deploy-batch would not read this entry as this document`);
    else keep.add(f);
  }
  if (problems.length) {
    for (const p of problems) console.error(`refused ${p}`);
    console.error(`extend-roster: ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} of outputs.paths / also.paths refused; nothing written`);
    return 2;
  }
  const owner = new Map(outputs.map((f) => [pathKey(`/${f}`), f]));
  let held = 0;
  for (const { file: f } of docs) {
    if (inv.has(f) || keep.has(f)) continue;
    held += 1;
    const dest = pathKey(`/${f}`);
    console.error(`held /${f} — ${owner.has(dest) ? `roster page ${dest} has its output /${owner.get(dest)}` : pages.has(dest) ? `no unit recorded it as the output of roster page ${dest}` : 'new, neither a unit\'s output nor in also.paths'}`);
  }
  // link targets: what was published before the pass (any live row) and what the pass publishes
  const targets = [...[...inv.entries()].filter(([, e]) => e.pub !== 'unpublished').map(([f]) => f), ...keep];
  writeAtomic(join(o.pass, 'targets.paths'), lines([...new Set(targets)].sort().map((f) => `/${f}`)));
  writeAtomic(join(o.pass, 'publish.paths'), lines([...keep].sort().map((f) => `/${f}`)));
  console.error(`publish: ${keep.size} document(s) → ${join(o.pass, 'publish.paths')} (${inv.size} existing at opening, ${held} new held); targets.paths: ${new Set(targets).size} link target(s)`);
  return 0;
}

// The library's input: every document at bytes known delivered — its newest verified digest, a landed approved
// revision, or the opening blob of a document the ledgers show live — never a held or conflicted working file.
function published(o) {
  if (existsSync(o.out)) usage(`--out ${o.out} exists — one tree per refresh: a new dir (mktemp -d)`);
  const inv = readInventory(o.pass); const cache = {};
  let n = 0; const withheld = [];
  for (const f of documents(o.content)) {
    const cur = readFileSync(join(o.content, f));
    const newest = liveRows(o, f, cache).find((r) => r.sha256);
    let bytes = newest && newest.sha256 === sha(cur) ? cur : null; let why = '';
    if (!bytes && inv.has(f)) ({ bytes, why } = lastPublished(o, f, inv.get(f)));
    else if (!bytes) why = newest ? 'changed since its last verified delivery' : 'no verified delivery recorded';
    if (!bytes) { withheld.push(`/${f} — ${why}`); continue; }
    mkdirSync(dirname(join(o.out, f)), { recursive: true });
    writeFileSync(join(o.out, f), bytes); n += 1;
  }
  for (const w of withheld) console.error(`withheld ${w}`);
  console.error(`published: ${n} document(s) at their delivered bytes → ${o.out}; ${withheld.length} withheld (da-library --content ${o.out} refuses when a delivered page is among them)`);
  return 0;
}

function reconcile(o) {
  const listFile = join(o.pass, 'publish.paths');
  if (!existsSync(listFile)) usage(`${listFile} not found — run publish first`);
  const cache = {}; const redrive = [];
  for (const entry of readFileSync(listFile, 'utf8').split('\n').filter(Boolean)) {
    const f = entry.replace(/^\/+/, '');
    const p = join(o.content, f);
    if (!existsSync(p)) { console.error(`missing ${entry} — on the list, not on disk`); continue; }
    const newest = liveRows(o, f, cache).find((r) => r.sha256);
    const now = sha(readFileSync(p));
    if (!newest || newest.sha256 !== now) { redrive.push(entry); console.error(`redrive ${entry} — ${newest ? 'changed since its last verified delivery' : 'no verified delivery recorded'}`); }
  }
  writeAtomic(join(o.pass, 'redrive.paths'), lines(redrive));
  console.error(`reconcile: ${redrive.length} document(s) → ${join(o.pass, 'redrive.paths')}`);
  return 0;
}

function relinkStatus(o) {
  const all = statusAll(o);
  for (const s of all) console.log(`${s.state.padEnd(9)} /${s.file}${s.why ? ` — ${s.why}` : ''}`);
  writeAtomic(join(o.pass, 'relink-status.json'), `${JSON.stringify(all.map(({ published, current, ...s }) => s), null, 2)}\n`);
  const n = (k) => all.filter((s) => s.state === k).length;
  console.error(`relink-status: ${n('candidate')} candidate(s), ${n('conflict')} conflict(s), ${n('held')} held, ${n('unchanged')} unchanged`);
  return 0;
}

// Restore one file only while it still holds the bytes that were classified: moved aside atomically, checked, and the
// restored bytes linked in (a link never replaces a file). Anything else leaves the newer bytes in place. Returns why not.
export function guardedRestore(path, expected, bytes) {
  const aside = `${path}.relink-${process.pid}`;
  try { renameSync(path, aside); } catch (e) { return `cannot move it aside (${e.code})`; }
  if (sha(readFileSync(aside)) !== expected) {
    try { linkSync(aside, path); rmSync(aside); } catch { return `changed since it was classified, and a new file took its place — the changed bytes are kept in ${aside}`; }
    return 'changed since it was classified — left as it is';
  }
  const tmp = `${path}.restore-${process.pid}`;
  writeFileSync(tmp, bytes);
  try { linkSync(tmp, path); } catch { rmSync(tmp); rmSync(aside); return 'saved again while it was restored — the new file is kept'; }
  rmSync(tmp); rmSync(aside);
  return null;
}

function relinkAct(o, act) {
  const by = new Map(statusAll(o).map((s) => [s.file, s]));
  const ok = []; const refused = [];
  for (const f of o.files) {
    const s = by.get(f);
    if (s && s.state === 'candidate') ok.push(s); else refused.push(`/${f} — ${s ? `${s.state}${s.why ? `: ${s.why}` : ''}` : 'not an existing document the localizer changed'}`);
  }
  if (act === 'restore') {
    for (const s of ok) {
      const why = guardedRestore(join(o.content, s.file), sha(s.current), s.published);
      if (why) refused.push(`/${s.file} — conflict: ${why}`); else console.error(`restored /${s.file} to its last published bytes`);
    }
  } else if (ok.length) {
    const dir = join(o.pass, 'approved');
    const k = (existsSync(dir) ? readdirSync(dir).filter((n) => /^r\d+$/.test(n)).map((n) => Number(n.slice(1))) : []).reduce((m, x) => Math.max(m, x), 0) + 1;
    const rev = join(dir, `r${k}`);
    const sums = [];
    for (const s of ok) {
      // the exact bytes classified and shown to the owner — never a second read of the working file
      writeAtomic(join(rev, s.file), s.current);
      sums.push(`${sha(s.current)}  ${s.file}`);
    }
    writeAtomic(`${rev}.sha256`, lines(sums));
    writeAtomic(`${rev}.paths`, lines(ok.map((s) => `/${s.file}`)));
    console.error(`approved r${k}: ${ok.length} document(s) frozen in ${rev} — commit it, then deploy-batch.mjs --content ${rev} --allow ${rev}.paths`);
  }
  for (const r of refused) console.error(`refused ${r}`);
  if (refused.length) throw new Refused(`extend-roster: ${refused.length} named file(s) refused`);
  return 0;
}

const help = () => readFileSync(SELF, 'utf8').match(/\/\*\*[\s\S]*?\*\//)[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim();

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  try {
    const o = parseArgs(argv);
    const run = {
      select, inventory, output, publish, published, reconcile, 'relink-status': relinkStatus,
      'relink-approve': (x) => relinkAct(x, 'approve'), 'relink-restore': (x) => relinkAct(x, 'restore'),
    }[o.cmd];
    return run(o);
  } catch (e) {
    if (e instanceof Refused) { console.error(e.message); return 1; }
    if (e instanceof UsageError) { console.error(e.message); return 2; }
    if (e && typeof e.code === 'string') { console.error(`extend-roster: ${e.code}${e.path ? ` ${e.path}` : ''}: ${e.message}`); return 2; }
    console.error(`extend-roster: ${e.message}`); return 2;
  }
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === SELF; } catch { /* not run as a script */ }
if (isMain) process.exit(main(process.argv.slice(2)));
