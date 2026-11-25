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
 *   node stardust/scripts/replica/extend-roster.mjs output --pass <dir> --unit <name> --files <a.html,b.html>
 *        [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs relink-approve|relink-restore|redeliver --pass <dir>
 *        --files <a.html,b.html> [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs published --pass <dir> --out <dir> [--content content]
 *   node stardust/scripts/replica/extend-roster.mjs opening-check --pass <dir> [--content content]
 *        [--coverage stardust/rollout/coverage/pages.json]
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
 *   Deploy ledgers read (the publication evidence): stardust/deploy/ledger-*.json (rollout's unit ledgers; not
 *   media-ledger.json), <content>/.deploy-ledger.json (deploy-batch's default) and every pass's approved/r<k>/
 *   .deploy-ledger.json. A row's `published` (the last verified publication: sha256 and time) is the evidence, else a
 *   row reading `live` (its `sha256`, when it has one). A ledger that cannot be parsed stops every command (exit 2).
 *
 *   opening-check  the library refresh's inputs whose published bytes cannot be recovered as `published` recovers
 *             them (its file, else any committed copy), listed in <pass>/unproven.paths; exit 1 while any is left, 0
 *             when none. With a library published to this site (lib/documents.mjs libraryMarkerPath, rollout.json
 *             site.da) the refresh is `da-library.mjs --add` and its inputs are the delivered pages that publication
 *             has not read (libraryDelta) — usually none; without one, every page coverage delivers (deliveredRows,
 *             contentFile). A document no coverage row names (a ledger-only nav) is never an input: it stays reserved.
 *   redeliver the owner-approved fallback for an unproven page: freezes the opening commit's bytes of the named files
 *             (never the working file) as <pass>/approved/r<k>/ with r<k>.sha256 and r<k>.paths; a file with no
 *             committed bytes is refused (exit 1, nothing frozen). Commit it, then deploy-batch.mjs --content <it>
 *             --allow <it>.paths.
 *
 *   inventory writes <pass>/inventory.tsv once, at the opening: `<sha256>\t<file>\t<tracked|ignored>\t<published>`
 *             for every document under --content (`tracked` per `git ls-files`). `published` is what the ledgers
 *             say of THESE bytes: `live` (the newest live row's sha256 is theirs), `live-unverified` (a live row from
 *             before ledgers kept a sha256), `differs` (another version
 *             landed last, or an earlier pass ended with it a conflict or held), `unpublished` (no live row). It is
 *             the record of what existed, tracked by git; the bytes it names are never needed on disk. Written once,
 *             with <pass>/reserved.paths: every DA document a ledger records live, whether or not its file is in the
 *             checkout (an ignored nav) — no pass output or also.paths entry may name one or share its destination.
 *   output    a unit that succeeded records the exact files it wrote for its roster pages in its own
 *             <pass>/outputs/<unit>.paths (one writer per file: concurrent units never share a record); a record only
 *             grows — a resumed unit reporting a subset keeps the rest, an identical replay is a no-op. Refused (exit
 *             2, nothing written): a file that is no document, existed at the opening, is reserved, sits under
 *             /library, is no roster page's, or a second file for a page any record (this unit's too) gives an output.
 *   publish   writes <pass>/publish.paths — the union of outputs/*.paths (two files for one page exit 2) plus
 *             <pass>/also.paths (a fragment the pages need, written
 *             by the unit that creates it), each checked with the deployer's own entry rule — and <pass>/targets.paths:
 *             the link targets (every opening document a ledger records live or coverage delivers, and the publish
 *             list), and <pass>/rewrite.paths: what the localizer may rewrite (the publish list, and an opening
 *             document only when its published bytes are in a commit), for `localize-links.mjs --targets / --rewrite`.
 *             Any other new document (an owner's draft, one at a roster page whose capture failed) is
 *             held and named. An entry that is missing, existed at the opening, sits under /library or would resolve
 *             to another document, or is reserved, exits 2, nothing written.
 *   published writes into --out (a new dir) every document — in the working tree, the opening inventory or a
 *             ledger's live rows, so a delivered document whose file is gone is not left out — at bytes known delivered:
 *             the bytes, working file or any committed copy, whose digest is its NEWEST live row's; names the rest
 *             withheld: the
 *             input of `da-library.mjs --content <out>`, so a held or conflicted working file never reaches the library.
 *   reconcile writes <pass>/redrive.paths: every document of publish.paths whose bytes are not the newest live
 *             row's sha256 in any ledger — a pass page relinked after its PUT, a C-archetype representative a
 *             sibling's localizer changed, a fragment never sent — for `deploy-batch.mjs --paths <it> --allow
 *             <pass>/publish.paths`.
 *   relink-status  classifies every inventory document a localize-links receipt of the pass names
 *             (<pass>/receipts/*.json, written by `localize-links.mjs --receipt`: the input and output digest of
 *             each file that run itself rewrote), against its LAST PUBLISHED BYTES: the newest live row across every
 *             ledger decides (none: never published; no digest: unknown), and its digest is matched against every
 *             committed copy — any pass's approved/r<k>/<file>, any pass's opening blob (`git show <base.txt>:./
 *             <content>/<file>`). A run interrupted before it
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
 *             bytes classified (lib/documents.mjs replaceIfUnchanged); a file saved meanwhile is kept and refused as a
 *             conflict; any other failure puts the original back.
 *             approve and restore act only on candidates; a named file that is not one is refused (exit 1).
 *
 * Exit codes: 0 ok (an empty roster is ok) · 1 a named file refused · 2 usage, an unreadable input, a --named url
 * refused, or a missing pass record. --help / -h prints this usage and touches no file.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The shared rules (contracts.mjs), found the way every skill's scripts find them: plugin tree, project copy, flat.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs', './stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('extend-roster: contracts.mjs not found (looked in ../../stardust/scripts/, ../stardust/ and ./stardust/) — copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(2); }
const { pathKey, deliveredUrl, documentPath, contentDocuments, resolveEntry, isLibraryPath, deliveredRows, contentFile, replaceIfUnchanged, libraryMarkerPath, libraryDelta } = await import(CONTRACTS.href);

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

const EXT = 'stardust/replica/extend';
const passDirs = () => (existsSync(EXT) ? readdirSync(EXT).filter((n) => /^x\d+$/i.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))) : []);

// Every committed copy of a document the passes recorded, newest first: their approved revisions, then their opening
// blobs (`git show <base>:./<content>/<file>`). A blob git cannot read (a shallow clone) is reported in `missing`.
function committedCopies(o, file, missing) {
  const out = [];
  for (const pass of passDirs()) {
    const ap = join(EXT, pass, 'approved');
    if (!existsSync(ap)) continue;
    for (const r of readdirSync(ap).filter((n) => /^r\d+$/.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))) {
      if (existsSync(join(ap, r, file))) out.push(() => readFileSync(join(ap, r, file)));
    }
  }
  const spec = `./${relative(process.cwd(), resolve(o.content, file)).split(sep).join('/')}`;
  const bases = [resolve(o.pass), ...passDirs().map((p) => resolve(EXT, p))].filter((d, i, a) => a.indexOf(d) === i)
    .map((d) => join(d, 'base.txt')).filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8').trim()).filter(Boolean);
  for (const base of [...new Set(bases)]) {
    out.push(() => {
      try { return execFileSync('git', ['show', `${base}:${spec}`], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {
        if (spawnSync('git', ['cat-file', '-e', `${base}^{commit}`]).status !== 0) missing.push(base);
        return null;
      }
    });
  }
  return out;
}

// The last published bytes of a document: the NEWEST live row across every ledger decides — no row, never published;
// a row without a digest, unknown — and its digest is matched against the working file, then every committed copy.
// Returns { bytes } or { bytes: null, why }.
function lastPublished(o, file, entry, cache = {}, current = null) {
  const newest = liveRows(o, file, cache)[0];
  if (!newest) return { bytes: null, why: 'no deploy ledger records it live: never published — not a republish' };
  if (!newest.sha256) return { bytes: null, why: newest.unverified ? 'an unverified live publication is its newest: which version is live is not known — re-drive it' : 'its newest live row has no digest: which version DA holds is not known — re-deliver it from its committed bytes (`redeliver`) on the owner\'s yes' };
  if (current && sha(current) === newest.sha256) return { bytes: current, from: 'working' };
  if (entry && entry.ignored) return { bytes: null, why: 'git-ignored: its published bytes are in no commit — never restored or re-published by the pass' };
  const missing = [];
  for (const read of committedCopies(o, file, missing)) {
    const b = read();
    if (b && sha(b) === newest.sha256) return { bytes: b, from: 'committed' };
  }
  if (missing.length) return { bytes: null, why: `the opening commit ${missing[0].slice(0, 12)} is not in this clone — \`git fetch --depth 1 origin ${missing[0]}\`, then again` };
  return { bytes: null, why: `DA holds the version ${newest.sha256.slice(0, 12)}, whose bytes are in no commit here` };
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

// Every deploy ledger the project keeps — stardust/deploy/ledger-*.json (rollout's unit ledgers; media-ledger.json is
// not one), <content>/.deploy-ledger.json (deploy-batch's default), every pass's approved/r<k>/.deploy-ledger.json —
// and the publications they record for one document, newest first. A ledger that cannot be read stops the command
// (exit 2, named): a reservation or a published version is never decided from incomplete evidence.
const isDocPath = (w) => typeof w === 'string' && /^\/[^\\\0]*$/.test(w) && w.slice(1).split('/').every((seg) => seg && seg !== '.' && seg !== '..');
const docFile = (w) => `${w.slice(1)}.html`;
// a path inside root, or a usage error: no ledger key or list entry writes outside the tree it names
const inside = (root, f) => { const p = resolve(root, f); if (p !== resolve(root) && !p.startsWith(`${resolve(root)}${sep}`)) usage(`${f} resolves outside ${root}`); return p; };

function ledgerFiles(o) {
  const out = [];
  if (existsSync('stardust/deploy')) for (const n of readdirSync('stardust/deploy').sort()) if (/^ledger-.*\.json$/.test(n)) out.push(join('stardust/deploy', n));
  if (existsSync(join(o.content, '.deploy-ledger.json'))) out.push(join(o.content, '.deploy-ledger.json'));
  for (const pass of passDirs()) {
    const ap = join(EXT, pass, 'approved');
    if (!existsSync(ap)) continue;
    for (const r of readdirSync(ap)) if (/^r\d+$/.test(r) && existsSync(join(ap, r, '.deploy-ledger.json'))) out.push(join(ap, r, '.deploy-ledger.json'));
  }
  return out;
}
function liveRows(o, file, cache) {
  if (!cache.rows) {
    cache.rows = new Map();
    for (const lf of ledgerFiles(o)) {
      let l;
      try { l = JSON.parse(readFileSync(lf, 'utf8')); } catch (e) { usage(`deploy ledger ${lf} cannot be read (${e.message.split('\n')[0]}) — repair or restore it; nothing is decided without it`); }
      if (!l || typeof l !== 'object' || Array.isArray(l)) usage(`deploy ledger ${lf} is not a ledger (an object of web paths) — repair or restore it`);
      for (const [doc, rec] of Object.entries(l)) {
        if (!rec || typeof rec !== 'object') continue;
        // a key becomes a file path (published, opening-check): a canonical DA document path or the ledger is refused
        if (!isDocPath(doc)) usage(`deploy ledger ${lf}: ${JSON.stringify(doc)} is not a DA document path (/a/b, no '.', '..' or empty segment) — repair it`);
        // `published` is the last verified publication, kept apart from a later attempt's status; `liveAttempt` a
        // publication not yet verified, which makes the version live unknown until it is (deploy-batch)
        const rows = [];
        if (rec.published && rec.published.sha256) rows.push({ sha256: rec.published.sha256, ts: rec.published.at || rec.ts || '' });
        else if (rec.status === 'live') rows.push({ sha256: rec.sha256 || null, ts: rec.ts || '' });
        if (rec.liveAttempt && rec.liveAttempt.at) rows.push({ sha256: null, unverified: true, ts: rec.liveAttempt.at });
        if (!cache.rows.has(doc)) cache.rows.set(doc, []);
        for (const row of rows) cache.rows.get(doc).push({ ...row, ledger: lf });
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
  const inv = readInventory(o.pass); const recs = relinkRecords(o.pass); const out = []; const cache = {};
  for (const [file, records] of recs) {
    const entry = inv.get(file);
    if (!entry) continue;
    const path = join(o.content, file);
    const current = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
    const { bytes: published, why } = lastPublished(o, file, entry, cache);
    out.push({ file, ...classify({ published, unavailable: why, current, records }), published, current });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const FLAGS = {
  select: ['--candidates', '--out', '--max', '--state', '--coverage', '--content', '--slugs-out'],
  inventory: ['--pass', '--content'],
  publish: ['--pass', '--content', '--coverage'],
  reconcile: ['--pass', '--content'],
  output: ['--pass', '--content', '--unit', '--files'],
  'opening-check': ['--pass', '--content', '--coverage'],
  redeliver: ['--pass', '--content', '--files'],
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
  const need = cmd === 'select' ? ['candidates', 'out'] : cmd === 'output' ? ['pass', 'unit', 'files'] : ['relink-approve', 'relink-restore', 'redeliver'].includes(cmd) ? ['pass', 'files'] : cmd === 'published' ? ['pass', 'out'] : ['pass'];
  for (const n of need) if (!o[n]) usage(`${cmd} needs --${n}`);
  if (o.files) o.files = o.files.split(',').map((s) => s.trim().replace(/^\/+/, '')).filter(Boolean);
  return o;
}

// Every DA document a deploy ledger records live — whether or not its file is in this checkout (an ignored nav).
function liveDocuments(o) {
  const cache = {}; liveRows(o, 'x.html', cache);
  return [...cache.rows.keys()].sort();
}

// The library's inputs — every page rollout coverage delivers (lib/documents.mjs deliveredRows, as da-library reads them)
// — whose published bytes cannot be recovered the way `published` recovers them (the working file, then every
// committed copy). Written to <pass>/unproven.paths for `redeliver`; exit 1 while any is left, 0 when none. An untouched
// document no coverage row names (a ledger-only nav) is not an input: it stays reserved, and is held only if a revision
// is proposed for it.
function openingCheck(o) {
  const inv = existsSync(join(o.pass, 'inventory.tsv')) ? readInventory(o.pass) : new Map();
  const cache = {};
  const cov = existsSync(o.coverage) ? readJson(o.coverage, '--coverage') : null;
  // A library already published to this site is extended (`da-library.mjs --add`): it reads only the delivered pages
  // that publication has not read (lib/documents.mjs libraryDelta) — never an older page it covers. With no current
  // publication (none, another site's, or one that cannot be read) the refresh rebuilds it from every delivered page.
  const rolloutDir = dirname(dirname(o.coverage));
  const parse = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
  const marker = parse(libraryMarkerPath(rolloutDir)); const da = ((parse(join(rolloutDir, 'rollout.json')) || {}).site || {}).da || {};
  let rows = deliveredRows(cov);
  if (marker && marker.org && `${marker.org}/${marker.site}` === `${da.org}/${da.site}`) {
    const { unread, newer } = libraryDelta(marker, rows.map((p) => ({ path: p.path, deployedAt: p.delivery.deployedAt })));
    const keys = new Set([...unread, ...newer].map(pathKey));
    console.error(`opening-check: the library published to ${da.org}/${da.site} is extended (da-library.mjs --add): ${keys.size} delivered page(s) it has not read are its inputs; the ${rows.length - keys.size} it covers are not read`);
    rows = rows.filter((p) => keys.has(pathKey(p.path)));
  }
  const unproven = []; let pages = 0;
  for (const row of rows) {
    pages += 1;
    const rel = row.path === '/' || row.path === '' ? 'index' : String(row.path).replace(/^\/|\/$/g, '');
    const onDisk = contentFile(o.content, row.path);
    const candidates = onDisk ? [relative(o.content, onDisk).split(sep).join('/')] : [`${rel}.html`, `${rel}/index.html`];
    const tried = candidates.map((f) => ({ f, ...lastPublished(o, f, inv.get(f) || null, cache, existsSync(join(o.content, f)) ? readFileSync(join(o.content, f)) : null) }));
    if (tried.some((t) => t.bytes)) continue;
    unproven.push(`/${candidates[0]}`);
    console.error(`unproven /${candidates[0]} (coverage ${row.path}) — ${tried[0].why}`);
  }
  writeAtomic(join(o.pass, 'unproven.paths'), lines(unproven));
  console.error(`opening-check: ${pages} delivered page(s), ${unproven.length} unproven → ${join(o.pass, 'unproven.paths')}`);
  if (unproven.length) throw new Refused(`extend-roster: ${unproven.length} delivered page(s) without recoverable published bytes`);
  return 0;
}

// The owner-approved fallback for an unproven page: its committed bytes (the opening commit's blob) frozen as a revision,
// deployed from that dir and its own ledger — never the working file, which may have changed since.
function redeliver(o) {
  const baseFile = join(o.pass, 'base.txt');
  if (!existsSync(baseFile)) usage(`${baseFile} not found`);
  const base = readFileSync(baseFile, 'utf8').trim();
  const frozen = []; const refused = [];
  for (const f of o.files) {
    let b = null;
    try { b = execFileSync('git', ['show', `${base}:./${relative(process.cwd(), inside(o.content, f)).split(sep).join('/')}`], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { b = null; }
    if (b) frozen.push({ file: f, bytes: b }); else refused.push(`/${f} — not in the opening commit ${base.slice(0, 12)} (git-ignored, new, or a clone without it: \`git fetch --depth 1 origin ${base}\`)`);
  }
  for (const r of refused) console.error(`refused ${r}`);
  if (refused.length) throw new Refused(`extend-roster: ${refused.length} file(s) without committed bytes; nothing frozen`);
  freezeRevision(o, frozen, 'redeliver');
  return 0;
}

// A frozen revision: approved/r<k>/<file> with r<k>.sha256 and r<k>.paths — deployed with `deploy-batch.mjs --content
// <it> --allow <it>.paths` (its own ledger inside it), committed before it is sent.
function freezeRevision(o, docs, what) {
  const dir = join(o.pass, 'approved');
  const k = (existsSync(dir) ? readdirSync(dir).filter((n) => /^r\d+$/.test(n)).map((n) => Number(n.slice(1))) : []).reduce((m, x) => Math.max(m, x), 0) + 1;
  const rev = join(dir, `r${k}`);
  for (const d of docs) writeAtomic(inside(rev, d.file), d.bytes);
  writeAtomic(`${rev}.sha256`, lines(docs.map((d) => `${sha(d.bytes)}  ${d.file}`)));
  writeAtomic(`${rev}.paths`, lines(docs.map((d) => `/${d.file}`)));
  console.error(`${what} r${k}: ${docs.length} document(s) frozen in ${rev} — on the owner's yes, commit it, then deploy-batch.mjs --content ${rev} --allow ${rev}.paths`);
}

function select(o) {
  let text;
  try { text = readFileSync(o.candidates, 'utf8'); } catch (e) { return usage(`--candidates ${o.candidates}: ${e.code || e.message}`); }
  const candidates = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const captured = capturedDestinations(readJson(o.state, '--state'));
  const cov = coverageOf(readJson(o.coverage, '--coverage'));
  for (const w of liveDocuments(o)) cov.paths.add(pathKey(w)); // a ledger's live document reserves its destination too
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
  writeAtomic(join(o.pass, 'reserved.paths'), lines(liveDocuments(o)));
  writeAtomic(out, lines(rows));
  console.error(`inventory: ${rows.length} document(s) → ${out}, ${liveDocuments(o).length} live DA document(s) → ${join(o.pass, 'reserved.paths')} (${rows.filter((r) => r.includes('\tignored\t')).length} ignored; ${Object.entries(count).map(([k, n]) => `${n} ${k}`).join(', ')})`);
  return 0;
}

const readList = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim().replace(/^\/+/, '')).filter(Boolean) : []);
function rosterDestinations(pass) {
  const f = join(pass, 'urls.txt');
  if (!existsSync(f)) usage(`${f} not found — the roster comes first`);
  return new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean).map((u) => destinationOf(u)));
}

// The DA documents live at the opening (inventory's reserved.paths): no pass output, no also.paths entry may name one
// or share its destination, whether or not its file is in the checkout.
function reservedOf(pass) {
  const f = join(pass, 'reserved.paths');
  if (!existsSync(f)) usage(`${f} not found — \`inventory\` writes it at the opening`);
  const docs = new Set(readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
  return { docs, keys: new Set([...docs].map((w) => pathKey(w))) };
}
const reservedWhy = (res, f) => (res.docs.has(documentPath(f)) || res.keys.has(pathKey(`/${f}`)) ? `a deploy ledger records ${documentPath(f)} or its destination live — an older document, never a pass output` : '');
const outputRecords = (pass) => {
  const dir = join(pass, 'outputs');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.paths')).sort().map((n) => ({ unit: n.slice(0, -'.paths'.length), files: readList(join(dir, n)) })) : [];
};

// A unit records the exact files it wrote for its roster pages, once it succeeded, in its own <pass>/outputs/<unit>.paths
// (one writer per file: concurrent units never share one). The only page documents publish lists.
function output(o) {
  if (!/^[A-Za-z0-9._-]+$/.test(o.unit)) usage(`--unit ${o.unit}: letters, digits, '.', '_' and '-' only`);
  const inv = readInventory(o.pass); const pages = rosterDestinations(o.pass); const res = reservedOf(o.pass);
  const docs = new Set(documents(o.content));
  // every record's claims, this unit's included: a record only grows (a resumed unit that reports a subset keeps the rest)
  const others = new Map(); const own = [];
  for (const r of outputRecords(o.pass)) for (const f of r.files) { others.set(pathKey(`/${f}`), { f, unit: r.unit }); if (r.unit === o.unit) own.push(f); }
  const claim = new Map(own.map((f) => [pathKey(`/${f}`), f])); const problems = [];
  for (const f of o.files) {
    const dest = pathKey(`/${f}`);
    if (!docs.has(f)) problems.push(`/${f} — not a document under ${o.content} (a lowercase .html file deploy sends)`);
    else if (inv.has(f)) problems.push(`/${f} — existed at the opening: never a pass output`);
    else if (reservedWhy(res, f)) problems.push(`/${f} — ${reservedWhy(res, f)}`);
    else if (isLibraryPath(`/${f}`)) problems.push(`/${f} — the DA authoring library's folder`);
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

function publish(o) {
  const inv = readInventory(o.pass); const pages = rosterDestinations(o.pass); const res = reservedOf(o.pass);
  const docs = contentDocuments(o.content); const byFile = new Map(docs.map((d) => [d.file, d]));
  const webPaths = new Set(docs.map((d) => d.webPath));
  const records = outputRecords(o.pass); const also = readList(join(o.pass, 'also.paths'));
  const keep = new Set(); const problems = []; const owner = new Map();
  for (const r of records) {
    for (const f of r.files) {
      const dest = pathKey(`/${f}`);
      if (!pages.has(dest)) problems.push(`/${f} — unit ${r.unit}: ${dest} is not a roster page`);
      else if (owner.has(dest) && owner.get(dest).f !== f) problems.push(`/${f} — unit ${r.unit} and unit ${owner.get(dest).unit} (/${owner.get(dest).f}) claim roster page ${dest}`);
      else owner.set(dest, { f, unit: r.unit });
    }
  }
  for (const f of [...[...owner.values()].map((v) => v.f), ...also]) {
    if (!byFile.has(f)) problems.push(`/${f} — listed, but no such document under ${o.content}`);
    else if (inv.has(f)) problems.push(`/${f} — existed at the opening: never on the publish list`);
    else if (reservedWhy(res, f)) problems.push(`/${f} — ${reservedWhy(res, f)}`);
    else if (isLibraryPath(`/${f}`)) problems.push(`/${f} — the DA authoring library's folder`);
    // the consumer's rule (deploy-batch --allow): the entry must name this document and no other
    else if (resolveEntry(`/${f}`, webPaths).match !== byFile.get(f).webPath) problems.push(`/${f} — deploy-batch would not read this entry as this document`);
    else keep.add(f);
  }
  if (problems.length) {
    for (const p of problems) console.error(`refused ${p}`);
    console.error(`extend-roster: ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} of outputs/*.paths / also.paths refused; nothing written`);
    return 2;
  }
  let held = 0;
  for (const { file: f } of docs) {
    if (inv.has(f) || keep.has(f)) continue;
    held += 1;
    const dest = pathKey(`/${f}`);
    console.error(`held /${f} — ${owner.has(dest) ? `roster page ${dest} has its output /${owner.get(dest).f}` : pages.has(dest) ? `no unit recorded it as the output of roster page ${dest}` : 'new, neither a unit\'s output nor in also.paths'}`);
  }
  // link targets: an opening document a ledger records live or coverage delivers (a page delivered by hand has no
  // ledger row), and what the pass publishes — never a draft
  const cache = {}; const cov = existsSync(o.coverage) ? readJson(o.coverage, '--coverage') : null;
  const deliveredFiles = new Set(deliveredRows(cov).map((r) => contentFile(o.content, r.path)).filter(Boolean).map((f) => relative(o.content, f).split(sep).join('/')));
  const targets = [...[...inv.keys()].filter((f) => liveRows(o, f, cache).length || deliveredFiles.has(f)), ...keep];
  writeAtomic(join(o.pass, 'targets.paths'), lines([...new Set(targets)].sort().map((f) => `/${f}`)));
  // rewrite inputs: the pass's own documents, and an opening document only when its published bytes are in a committed
  // copy — rewriting one whose only proven copy is its working file would destroy what the library and a restore need
  const rewrite = [...keep, ...[...inv.entries()].filter(([f, e]) => !e.ignored && lastPublished(o, f, e, cache, null).from === 'committed').map(([f]) => f)];
  writeAtomic(join(o.pass, 'rewrite.paths'), lines([...new Set(rewrite)].sort().map((f) => `/${f}`)));
  writeAtomic(join(o.pass, 'publish.paths'), lines([...keep].sort().map((f) => `/${f}`)));
  console.error(`publish: ${keep.size} document(s) → ${join(o.pass, 'publish.paths')} (${inv.size} existing at opening, ${held} new held); targets.paths: ${new Set(targets).size} link target(s); rewrite.paths: ${new Set(rewrite).size - keep.size} of ${inv.size} opening document(s) may be relinked — the rest (published bytes in no commit) keep their links`);
  return 0;
}

// The library's input: every document at bytes known delivered — its newest verified digest, a landed approved
// revision, or the opening blob of a document the ledgers show live — never a held or conflicted working file.
function published(o) {
  if (existsSync(o.out)) usage(`--out ${o.out} exists — one tree per refresh: a new dir (mktemp -d)`);
  const inv = readInventory(o.pass); const cache = {};
  let n = 0; const withheld = [];
  // the working tree, the opening inventory and every document a ledger records live: a delivered document whose file
  // is gone from content/ is recovered from its committed copies, or named withheld — never silently left out
  liveRows(o, 'x.html', cache);
  const known = new Set([...documents(o.content), ...inv.keys(), ...[...cache.rows.keys()].map(docFile)]);
  for (const f of [...known].sort()) {
    const p = inside(o.content, f);
    const cur = existsSync(p) ? readFileSync(p) : null;
    if (!cur && !liveRows(o, f, cache).length) continue;
    const { bytes, why } = lastPublished(o, f, inv.get(f) || null, cache, cur);
    if (!bytes) { withheld.push(`/${f} — ${why}`); continue; }
    const target = inside(o.out, f);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes); n += 1;
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
    const newest = liveRows(o, f, cache)[0];
    const now = sha(readFileSync(p));
    if (!newest || newest.sha256 !== now) { redrive.push(entry); console.error(`redrive ${entry} — ${!newest ? 'no delivery recorded' : newest.unverified ? 'an unverified live publication is its newest — what is live is not known' : !newest.sha256 ? 'its newest live row has no digest' : 'changed since its last verified delivery'}`); }
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

function relinkAct(o, act) {
  const by = new Map(statusAll(o).map((s) => [s.file, s]));
  const ok = []; const refused = [];
  for (const f of o.files) {
    const s = by.get(f);
    if (s && s.state === 'candidate') ok.push(s); else refused.push(`/${f} — ${s ? `${s.state}${s.why ? `: ${s.why}` : ''}` : 'not an existing document the localizer changed'}`);
  }
  if (act === 'restore') {
    for (const s of ok) {
      const why = replaceIfUnchanged(join(o.content, s.file), sha(s.current), s.published); // lib/documents.mjs
      if (why) refused.push(`/${s.file} — conflict: ${why}`); else console.error(`restored /${s.file} to its last published bytes`);
    }
  } else if (ok.length) {
    // the exact bytes classified and shown to the owner — never a second read of the working file
    freezeRevision(o, ok.map((st) => ({ file: st.file, bytes: st.current })), 'approved');
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
      select, inventory, output, publish, published, reconcile, 'opening-check': openingCheck, redeliver, 'relink-status': relinkStatus,
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
